import type { Refs, StringifyOptions } from "./types";
import {
  bytesToB64,
  isPlainObject,
  isTypedArray,
  limit,
  SerializeError,
  setOwn,
  temporalName,
} from "./utils";

function isPlainContainer(x: object): boolean {
  return Array.isArray(x) || isPlainObject(x);
}

/** Internal encoder state; see `createEncoder`. */
export interface Encoder {
  mark(x: unknown, depth?: number): void;
  node(x: unknown, depth?: number): unknown;
  refs: Refs;
  hasRefs(): boolean;
}

/**
 * Builds an encoder whose `$refs` table and identity map are shared by every
 * root it encodes. Call `mark` on every root first, then `node` on each.
 */
export function createEncoder(options: StringifyOptions = {}): Encoder {
  const maxDepth = limit("maxDepth", options.maxDepth);
  const refs: Refs = {};
  const seen = new Set<object>();
  let count = 0;

  const enter = (depth: number): number => {
    if (depth >= maxDepth) {
      throw new SerializeError("MAX_DEPTH", `value nests deeper than maxDepth (${maxDepth})`);
    }
    return depth + 1;
  };

  const ref = (_t: string, _v?: unknown): string => {
    const key = String(++count);
    refs[key] = _v === undefined ? { _t } : { _t, _v };
    return `@${key}`;
  };

  // Pass 1: find plain containers reachable by more than one edge (shared or
  // cyclic). Only those are hoisted into $refs; single-use containers stay
  // inline so the common case keeps its readable JSON shape.
  const walked = new Set<object>();
  const shared = new Set<object>();
  const mark = (x: unknown, depth = 0): void => {
    if (x === null || typeof x !== "object") return;
    const obj = x as object;
    if (isPlainContainer(obj)) {
      if (walked.has(obj)) {
        shared.add(obj);
        return;
      }
      walked.add(obj);
      const d = enter(depth);
      if (Array.isArray(obj)) {
        for (const e of obj) mark(e, d);
      } else {
        const o = obj as Record<string, unknown>;
        for (const k of Object.keys(o)) mark(o[k], d);
      }
      return;
    }
    // Special containers: guard cycles while scanning for nested shared values.
    if (walked.has(obj)) return;
    walked.add(obj);
    if (obj instanceof Map) {
      const d = enter(depth);
      for (const [k, v] of obj) {
        mark(k, d);
        mark(v, d);
      }
    } else if (obj instanceof Set) {
      const d = enter(depth);
      for (const v of obj) mark(v, d);
    } else if (obj instanceof Error) {
      const d = enter(depth);
      const s = obj as unknown as Record<string, unknown>;
      for (const k of Object.keys(obj)) mark(s[k], d);
    }
  };

  // Pass 2: identity table for hoisted plain containers.
  const idOf = new Map<object, string>();

  const encodeContainer = (obj: object, depth: number): unknown => {
    const d = enter(depth);
    if (Array.isArray(obj)) return obj.map((e) => node(e, d));
    const o = obj as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) setOwn(out, k, node(o[k], d));
    return out;
  };

  // Returns a JSON-safe node: a primitive, array, plain object, or a "@n" token.
  const node = (x: unknown, depth = 0): unknown => {
    if (x === null) return null;

    const type = typeof x;
    if (type === "string") {
      const s = x as string;
      // Escape a real string that could be mistaken for a ref token or an escape.
      return s.startsWith("@") ? `@${s}` : s;
    }
    if (type === "boolean") return x;
    if (type === "number") {
      const num = x as number;
      // -0, NaN and ±Infinity are not representable in JSON, so they go to a ref.
      if (Number.isFinite(num) && !Object.is(num, -0)) return num;
      return ref(
        "num",
        num === Number.POSITIVE_INFINITY
          ? "Infinity"
          : num === Number.NEGATIVE_INFINITY
            ? "-Infinity"
            : Number.isNaN(num)
              ? "NaN"
              : "-0",
      );
    }
    if (x === undefined) return ref("undef");
    if (type === "bigint") return ref("bigint", (x as bigint).toString());
    if (type === "symbol" || type === "function") {
      throw new SerializeError("UNSUPPORTED_VALUE", `${type} values are not serializable`);
    }

    const obj = x as object;

    // Plain containers: hoist into $refs when shared/cyclic (referenced by
    // token so identity and cycles survive), otherwise inline as readable JSON.
    if (isPlainContainer(obj)) {
      if (shared.has(obj)) {
        const existing = idOf.get(obj);
        if (existing !== undefined) return `@${existing}`;
        const key = String(++count);
        idOf.set(obj, key);
        const encoded = encodeContainer(obj, depth);
        refs[key] = { _t: Array.isArray(obj) ? "arr" : "obj", _v: encoded };
        return `@${key}`;
      }
      return encodeContainer(obj, depth);
    }

    // Special containers can still form cycles (a Map holding itself); guard
    // those so stringify throws instead of recursing forever.
    if (seen.has(obj)) {
      throw new SerializeError(
        "CIRCULAR_REF",
        "circular references through Map, Set or Error are not serializable",
      );
    }
    seen.add(obj);
    try {
      if (obj instanceof Date) {
        return ref("Date", Number.isNaN(obj.getTime()) ? "NaN" : obj.toISOString());
      }
      if (obj instanceof RegExp) return ref("RegExp", [obj.source, obj.flags]);
      if (typeof URL !== "undefined" && obj instanceof URL) return ref("URL", obj.href);
      if (obj instanceof Map) {
        const d = enter(depth);
        return ref(
          "Map",
          [...obj].map(([k, v]) => [node(k, d), node(v, d)]),
        );
      }
      if (obj instanceof Set) {
        const d = enter(depth);
        return ref(
          "Set",
          [...obj].map((v) => node(v, d)),
        );
      }
      if (isTypedArray(obj)) {
        // The internal [[TypedArrayName]], so subclasses (e.g. Node's Buffer)
        // encode under their base tag rather than an undecodable class name.
        const tag = Object.prototype.toString.call(obj).slice(8, -1);
        return ref(tag, bytesToB64(new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)));
      }
      if (obj instanceof ArrayBuffer) return ref("ArrayBuffer", bytesToB64(new Uint8Array(obj)));
      if (obj instanceof DataView) {
        return ref(
          "DataView",
          bytesToB64(new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)),
        );
      }
      if (obj instanceof Error) {
        const d = enter(depth);
        const src = obj as unknown as Record<string, unknown>;
        const own: Record<string, unknown> = {};
        for (const k of Object.keys(obj)) setOwn(own, k, node(src[k], d));
        return ref("Error", { name: obj.name, message: obj.message, own });
      }
      if (obj instanceof Number) return ref("Number", node(obj.valueOf(), depth));
      if (obj instanceof String) return ref("String", obj.valueOf());
      if (obj instanceof Boolean) return ref("Boolean", obj.valueOf());

      const tn = temporalName(obj);
      if (tn) return ref(tn, (obj as { toString(): string }).toString());

      throw new SerializeError(
        "UNSUPPORTED_VALUE",
        "unsupported value (class instance or exotic object)",
      );
    } finally {
      seen.delete(obj);
    }
  };

  return { mark, node, refs, hasRefs: () => count > 0 };
}

/**
 * Low-level encoder for embedding values in your own JSON structure (this is
 * what obj-diff's per-op `serialize` builds on). All `roots` share one `$refs`
 * table, so identity and cycles are preserved across them. Each returned value
 * is JSON-safe; `refs` is `undefined` when nothing needed a ref.
 */
export function encode(
  roots: readonly unknown[],
  options?: StringifyOptions,
): { values: unknown[]; refs: Refs | undefined } {
  const enc = createEncoder(options);
  for (const r of roots) enc.mark(r);
  const values = roots.map((r) => enc.node(r));
  return { values, refs: enc.hasRefs() ? enc.refs : undefined };
}
