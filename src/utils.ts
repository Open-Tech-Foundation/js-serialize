import type { SerializeErrorCode } from "./types";

/** The single error type thrown by this package. Check `code` to branch on the reason. */
export class SerializeError extends Error {
  readonly code: SerializeErrorCode;

  constructor(code: SerializeErrorCode, message: string, options?: { cause?: unknown }) {
    super(`@opentf/serialize: ${message}`, options);
    this.name = "SerializeError";
    this.code = code;
  }
}

export const hasOwn = (o: object, k: PropertyKey): boolean => Object.hasOwn(o, k);

/** `proto === Object.prototype` or a null-prototype object. */
export function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (x === null || typeof x !== "object") return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

export function isTypedArray(x: unknown): x is ArrayBufferView {
  return ArrayBuffer.isView(x) && !(x instanceof DataView);
}

/**
 * Assigns `key` as an own enumerable data property. Plain assignment of
 * `"__proto__"` would invoke the prototype setter instead of creating a key, so
 * that one goes through `defineProperty` — the same result `JSON.parse` gives.
 */
export function setOwn(target: object, key: string, value: unknown): void {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    (target as Record<string, unknown>)[key] = value;
  }
}

/** Validates an optional non-negative integer limit; `Infinity`/`undefined` mean unlimited. */
export function limit(name: string, v: unknown): number {
  if (v === undefined || v === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new SerializeError(
      "INVALID_OPTION",
      `${name} must be a non-negative integer or Infinity, got ${String(v)}`,
    );
  }
  return v;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Returns the Temporal type name (e.g. "Temporal.PlainDate") if x is a Temporal value, else null. */
export function temporalName(x: unknown): string | null {
  const tag = Object.prototype.toString.call(x); // "[object Temporal.PlainDate]"
  return tag.startsWith("[object Temporal.") ? tag.slice(8, -1) : null;
}

/** A string that is exactly a ref token `@<digits>`. */
export const REF_TOKEN: RegExp = /^@\d+$/;

type TAConstructor = new (buffer: ArrayBufferLike) => ArrayBufferView;

/** Typed array constructors by tag; Float16Array is included where the runtime has it. */
export const TA_CTORS: Record<string, TAConstructor> = Object.assign(Object.create(null), {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
  ...((globalThis as { Float16Array?: TAConstructor }).Float16Array
    ? { Float16Array: (globalThis as unknown as { Float16Array: TAConstructor }).Float16Array }
    : {}),
});

export const ERR_CTORS: Record<string, ErrorConstructor> = Object.assign(Object.create(null), {
  Error,
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  EvalError,
  URIError,
});
