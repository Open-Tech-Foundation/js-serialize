import type { ParseOptions } from "./types";
import {
  b64ToBytes,
  ERR_CTORS,
  hasOwn,
  limit,
  REF_TOKEN,
  SerializeError,
  setOwn,
  TA_CTORS,
} from "./utils";

type JsonObject = Record<string, unknown>;

/** What a `hole` entry decodes to: never a value, only "leave this index empty". */
const HOLE: unique symbol = Symbol("hole");

export const isJsonObject = (x: unknown): x is JsonObject =>
  x !== null && typeof x === "object" && !Array.isArray(x);

/** Describes a value's JSON shape in error messages, without echoing its contents. */
export function shapeOf(x: unknown): string {
  if (x === null) return "null";
  if (Array.isArray(x)) return "an array";
  if (typeof x === "object") return "an object";
  return `a ${typeof x}`;
}

/** Internal decoder state; see `createDecoder`. */
export interface Decoder {
  node(x: unknown, depth?: number): unknown;
}

/**
 * Builds a decoder over one `$refs` table. The input is treated as untrusted:
 * every entry and payload is shape-checked, and any malformed part throws a
 * `SerializeError` instead of yielding `undefined` or a half-built value.
 */
export function createDecoder(rawRefs: unknown, options: ParseOptions = {}): Decoder {
  const maxDepth = limit("maxDepth", options.maxDepth);
  if (rawRefs !== undefined && !isJsonObject(rawRefs)) {
    throw new SerializeError(
      "INVALID_ENVELOPE",
      `"$refs" must be an object, got ${shapeOf(rawRefs)}`,
    );
  }
  const refs: JsonObject = rawRefs ?? {};
  const cache = new Map<string, unknown>();
  // Keys whose leaf value (e.g. a boxed Number) is being built. Containers are
  // cached as empty shells before their children, so only a leaf can meet
  // itself again, and that input is a forged cycle, not a stack overflow.
  const building = new Set<string>();

  const enter = (depth: number): number => {
    if (depth >= maxDepth) {
      throw new SerializeError("MAX_DEPTH", `input nests deeper than maxDepth (${maxDepth})`);
    }
    return depth + 1;
  };

  const check = (ok: boolean, t: string, expected: string): void => {
    if (!ok) throw new SerializeError("INVALID_PAYLOAD", `"${t}" payload must be ${expected}`);
  };

  /** Builds entry `key`. Containers register their empty shell in `cache` first. */
  const build = (key: string, t: string, v: unknown, depth: number): unknown => {
    switch (t) {
      case "undef":
        return undefined;
      case "hole":
        return HOLE;
      case "bigint":
        check(typeof v === "string", t, "a string");
        return BigInt(v as string);
      case "num":
        switch (v) {
          case "Infinity":
            return Number.POSITIVE_INFINITY;
          case "-Infinity":
            return Number.NEGATIVE_INFINITY;
          case "NaN":
            return Number.NaN;
          case "-0":
            return -0;
          default:
            return check(false, t, '"Infinity", "-Infinity", "NaN" or "-0"');
        }
      case "Date":
        check(typeof v === "string", t, "a string");
        return new Date(v === "NaN" ? Number.NaN : (v as string));
      case "RegExp": {
        check(
          Array.isArray(v) &&
            v.length === 2 &&
            typeof v[0] === "string" &&
            typeof v[1] === "string",
          t,
          "[source, flags]",
        );
        const [source, flags] = v as [string, string];
        return new RegExp(source, flags);
      }
      case "URL":
        check(typeof v === "string", t, "a string");
        return new URL(v as string);
      case "Map": {
        check(
          Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2),
          t,
          "an array of [key, value] pairs",
        );
        const d = enter(depth);
        const map = new Map<unknown, unknown>();
        cache.set(key, map);
        for (const [k, val] of v as [unknown, unknown][]) map.set(node(k, d), node(val, d));
        return map;
      }
      case "Set": {
        check(Array.isArray(v), t, "an array");
        const d = enter(depth);
        const set = new Set<unknown>();
        cache.set(key, set);
        for (const e of v as unknown[]) set.add(node(e, d));
        return set;
      }
      case "ArrayBuffer":
        check(typeof v === "string", t, "a base64 string");
        return b64ToBytes(v as string).buffer;
      case "DataView":
        check(typeof v === "string", t, "a base64 string");
        return new DataView(b64ToBytes(v as string).buffer);
      case "Error":
        return buildError(key, v, depth);
      case "Number": {
        const n = node(v, depth);
        check(typeof n === "number", t, "a number");
        return new Number(n);
      }
      case "String":
        check(typeof v === "string", t, "a string");
        return new String(v);
      case "Boolean":
        check(typeof v === "boolean", t, "a boolean");
        return new Boolean(v);
      default: {
        const TA = TA_CTORS[t];
        if (TA) {
          check(typeof v === "string", t, "a base64 string");
          return new TA(b64ToBytes(v as string).buffer);
        }
        if (t.startsWith("Temporal.")) return buildTemporal(t, v);
        throw new SerializeError("UNKNOWN_TYPE", `unknown type tag "${t}"`);
      }
    }
  };

  const buildError = (key: string, v: unknown, depth: number): Error => {
    check(
      isJsonObject(v) &&
        typeof v.name === "string" &&
        typeof v.message === "string" &&
        isJsonObject(v.own),
      "Error",
      "{ name: string, message: string, own: object }",
    );
    const { name, message, own } = v as { name: string; message: string; own: JsonObject };
    const Ctor = ERR_CTORS[name] ?? Error;
    const e = new Ctor(message);
    if (e.name !== name) e.name = name;
    const d = enter(depth);
    cache.set(key, e);
    for (const k of Object.keys(own)) setOwn(e, k, node(own[k], d));
    return e;
  };

  const buildTemporal = (t: string, v: unknown): unknown => {
    const T = (globalThis as { Temporal?: Record<string, { from?: unknown }> }).Temporal;
    if (!T) {
      throw new SerializeError(
        "TEMPORAL_UNAVAILABLE",
        `Temporal is not available in this runtime (needed for "${t}")`,
      );
    }
    const name = t.slice("Temporal.".length);
    const Kind = hasOwn(T, name) ? T[name] : undefined;
    if (!Kind || typeof Kind.from !== "function") {
      throw new SerializeError("UNKNOWN_TYPE", `unknown type tag "${t}"`);
    }
    check(typeof v === "string", t, "a string");
    return (Kind.from as (s: string) => unknown)(v as string);
  };

  const resolve = (key: string, depth: number): unknown => {
    if (cache.has(key)) return cache.get(key);
    if (!hasOwn(refs, key)) throw new SerializeError("MISSING_REF", `missing $ref "@${key}"`);
    const entry = refs[key];
    if (!isJsonObject(entry) || typeof entry._t !== "string") {
      throw new SerializeError(
        "INVALID_PAYLOAD",
        `$refs entry "@${key}" must be an object with a string "_t"`,
      );
    }
    const t = entry._t;
    const v = entry._v;

    // Hoisted plain containers: register the empty shell before populating so a
    // self- or cross-reference back into this key resolves to the same object.
    if (t === "arr") {
      check(Array.isArray(v), t, "an array");
      const d = enter(depth);
      const src = v as unknown[];
      const arr = new Array<unknown>(src.length);
      cache.set(key, arr);
      fill(arr, src, d);
      return arr;
    }
    if (t === "obj") {
      check(isJsonObject(v), t, "an object");
      const d = enter(depth);
      const obj: JsonObject = {};
      cache.set(key, obj);
      const src = v as JsonObject;
      for (const k of Object.keys(src)) setOwn(obj, k, node(src[k], d));
      return obj;
    }

    if (building.has(key)) {
      throw new SerializeError("CIRCULAR_REF", `$ref "@${key}" (${t}) refers back to itself`);
    }
    building.add(key);
    let built: unknown;
    try {
      built = build(key, t, v, depth);
    } catch (err) {
      if (err instanceof SerializeError) throw err;
      // Native constructors reject bad payloads with their own errors
      // (BigInt("x"), new URL("x"), atob("!"), misaligned typed array, ...).
      throw new SerializeError(
        "INVALID_PAYLOAD",
        `invalid "${t}" payload: ${(err as Error)?.message ?? String(err)}`,
        { cause: err },
      );
    } finally {
      building.delete(key);
    }
    cache.set(key, built);
    return built;
  };

  /** Array elements: a `hole` token leaves the index empty, as in the source array. */
  const fill = (arr: unknown[], src: unknown[], depth: number): void => {
    for (let i = 0; i < src.length; i++) {
      const e = item(src[i], depth);
      if (e !== HOLE) arr[i] = e;
    }
  };

  /** Any position that is not an array element: a hole there is forged input. */
  const node = (x: unknown, depth = 0): unknown => {
    const v = item(x, depth);
    if (v === HOLE) {
      throw new SerializeError("INVALID_PAYLOAD", 'a "hole" can only be an array element');
    }
    return v;
  };

  const item = (x: unknown, depth: number): unknown => {
    if (typeof x === "string") {
      if (REF_TOKEN.test(x)) return resolve(x.slice(1), depth);
      return x.startsWith("@") ? x.slice(1) : x; // unescape
    }
    if (x === null || typeof x !== "object") return x;
    const d = enter(depth);
    if (Array.isArray(x)) {
      const arr = new Array<unknown>(x.length);
      fill(arr, x, d);
      return arr;
    }
    const o = x as JsonObject;
    const out: JsonObject = {};
    for (const k of Object.keys(o)) setOwn(out, k, node(o[k], d));
    return out;
  };

  return { node };
}

/**
 * Low-level counterpart of `encode`: decodes JSON-safe `values` that share one
 * `refs` table (pass `undefined` when there is none). `options.maxLength` does
 * not apply here — there is no input text.
 */
export function decode(
  values: readonly unknown[],
  refs: unknown,
  options?: ParseOptions,
): unknown[] {
  const dec = createDecoder(refs, options);
  return values.map((v) => dec.node(v));
}
