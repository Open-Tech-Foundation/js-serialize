/** One entry of the `$refs` table: a type tag and its JSON payload. */
export type RefEntry = { _t: string; _v?: unknown };

/** The `$refs` table: ref id (decimal string) → entry. Tokens `"@<id>"` point into it. */
export type Refs = Record<string, RefEntry>;

/** The JSON shape `stringify` writes and `parse` reads. */
export type Envelope = { v: unknown; $refs?: Refs };

/** Options for `stringify` and `encode`. */
export interface StringifyOptions {
  /**
   * Maximum container nesting depth (arrays, plain objects, `Map`, `Set`, `Error`
   * own properties). `[[1]]` has depth 2. Exceeding it throws `MAX_DEPTH`.
   * Default: unlimited.
   */
  maxDepth?: number;
}

/** Options for `parse` and `decode`. */
export interface ParseOptions {
  /**
   * Maximum input length in UTF-16 code units (`string.length`), checked before
   * any parsing work. Exceeding it throws `INPUT_TOO_LARGE`. `parse` only.
   * Default: unlimited.
   */
  maxLength?: number;
  /**
   * Maximum container nesting depth of the decoded value; same counting as
   * `StringifyOptions.maxDepth`. Exceeding it throws `MAX_DEPTH`.
   * Default: unlimited.
   */
  maxDepth?: number;
}

/** Machine-readable reason carried by every `SerializeError`. */
export type SerializeErrorCode =
  | "INVALID_OPTION"
  | "INVALID_INPUT"
  | "INVALID_JSON"
  | "INPUT_TOO_LARGE"
  | "INVALID_ENVELOPE"
  | "MAX_DEPTH"
  | "MISSING_REF"
  | "UNKNOWN_TYPE"
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_VALUE"
  | "CIRCULAR_REF"
  | "TEMPORAL_UNAVAILABLE";
