import { createDecoder, decode, isJsonObject, shapeOf } from "./decode";
import { createEncoder, encode } from "./encode";
import type {
  Envelope,
  ParseOptions,
  RefEntry,
  Refs,
  SerializeErrorCode,
  StringifyOptions,
} from "./types";
import { hasOwn, limit, SerializeError } from "./utils";

/**
 * Serializes any JavaScript value to a self-describing, type-preserving JSON
 * string: `{"v": <value>, "$refs"?: {...}}`.
 *
 * Plain data stays readable JSON. Special values become `"@n"` tokens whose
 * real type lives in the `$refs` table: `Date`, `RegExp`, `Map`, `Set`, typed
 * arrays, `ArrayBuffer`, `DataView`, `Error`, `URL`, `BigInt`, boxed
 * primitives, `Temporal`, `NaN`/`±Infinity`/`-0` and `undefined`. Circular
 * references and shared identity among plain objects and arrays are kept.
 *
 * Throws `SerializeError` on symbols, functions, class instances and cycles
 * that run through a `Map`, `Set` or `Error`.
 */
export function stringify(value: unknown, options?: StringifyOptions): string {
  const enc = createEncoder(options);
  enc.mark(value);
  const v = enc.node(value);
  const out: Envelope = enc.hasRefs() ? { v, $refs: enc.refs } : { v };
  return JSON.stringify(out);
}

/**
 * Parses a string produced by `stringify` back into the original value with
 * live typed values. Safe for untrusted input: `"__proto__"` keys become own
 * properties (prototypes are never changed), malformed input throws a
 * `SerializeError`, and `maxLength` / `maxDepth` bound the work done.
 */
export function parse<T = unknown>(text: string, options: ParseOptions = {}): T {
  const maxLength = limit("maxLength", options.maxLength);
  if (typeof text !== "string") {
    throw new SerializeError("INVALID_INPUT", `expected a string, got ${shapeOf(text)}`);
  }
  if (text.length > maxLength) {
    throw new SerializeError(
      "INPUT_TOO_LARGE",
      `input is ${text.length} characters, over maxLength (${maxLength})`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SerializeError("INVALID_JSON", `input is not valid JSON: ${(err as Error).message}`, {
      cause: err,
    });
  }
  if (!isJsonObject(raw) || !hasOwn(raw, "v")) {
    throw new SerializeError(
      "INVALID_ENVELOPE",
      `expected the {"v": ..., "$refs"?: {...}} envelope written by stringify(), got ${
        isJsonObject(raw) ? 'an object without a "v" key' : shapeOf(raw)
      }`,
    );
  }
  return createDecoder(raw.$refs, options).node(raw.v) as T;
}

export {
  decode,
  type Envelope,
  encode,
  type ParseOptions,
  type RefEntry,
  type Refs,
  SerializeError,
  type SerializeErrorCode,
  type StringifyOptions,
};
