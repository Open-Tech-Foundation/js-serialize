# Changelog

All notable changes to this package are documented here.

## [Unreleased]

### Added

- `stringify` / `parse`: type-preserving JSON for `Date`, `RegExp`, `URL`, `Map`, `Set`,
  `Error` (and standard subclasses), boxed primitives, every typed array, `ArrayBuffer`,
  `DataView`, `Temporal`, `BigInt`, `undefined`, `NaN`, `±Infinity` and `-0`. Extracted from
  `@opentf/obj-diff` 0.18; output for the same values is byte-identical.
- `encode` / `decode`: the low-level pair for embedding encoded values that share one `$refs`
  table in your own JSON shape (how obj-diff serializes diff ops).
- `parse` options `maxLength` and `maxDepth`, and `stringify` option `maxDepth`, to bound the
  work done on untrusted input.
- `SerializeError`, thrown for every failure, with a machine-readable `code`.
- Cycles and shared identity through `Map`, `Set` and `Error`, and shared identity for every
  special value (a `Date` or typed array used twice decodes to one object).
- Sparse arrays keep their holes, via one shared `{"_t":"hole"}` entry. Older decoders,
  including obj-diff 0.18, reject it with an unknown-type error instead of misreading it.

### Security

- `"__proto__"` keys are defined as own properties when decoding (and encoding), so input can
  never set an object's prototype.
- Input without the `{"v": ..., "$refs"?: ...}` envelope throws `INVALID_ENVELOPE` instead of
  decoding to `undefined`.
- Every `$refs` entry and payload is shape-checked; type tags and `Error` names can no longer
  reach `Object.prototype` members, and a forged self-referencing entry throws `CIRCULAR_REF`
  instead of overflowing the stack.
