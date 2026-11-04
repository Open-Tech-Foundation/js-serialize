# @opentf/serialize

Type-preserving JavaScript serialization over plain JSON. A drop-in for
`JSON.stringify` / `JSON.parse` that keeps `Date`, `Map`, `Set`, typed arrays,
`BigInt`, `Temporal`, `NaN`/`-0`, `undefined`, circular references and shared
identity — and is safe to point at untrusted input.

Extracted from [obj-diff](https://obj-diff.opentechf.org/docs/serialization);
the wire format is unchanged, so output from either one reads in the other.

```ts
import { parse, stringify } from "@opentf/serialize";

const text = stringify({ at: new Date(0), tags: new Set(["a"]), big: 10n });
// {"v":{"at":"@1","tags":"@2","big":"@3"},"$refs":{"1":{"_t":"Date",...},...}}

const back = parse<{ at: Date; tags: Set<string>; big: bigint }>(text); // live values again
```

## Wire format

`stringify` writes an envelope `{"v": <value>, "$refs"?: {...}}`. Plain data
stays readable JSON; every special value becomes a token `"@n"` whose real type
sits in `$refs["n"]` as `{ "_t": <type>, "_v": <payload> }`. Strings that start
with `@` are escaped with one more `@`. User keys named `_t` / `_v` are ordinary
data. A plain object or array reachable by more than one edge (shared or
cyclic) is hoisted into `$refs` as an `obj` / `arr` entry, so identity and
cycles are rebuilt on the far side; single-use containers stay inline.

| Supported | |
| --- | --- |
| Primitives | `undefined`, `bigint`, `NaN`, `±Infinity`, `-0` |
| Built-ins | `Date` (incl. invalid), `RegExp`, `URL`, `Map`, `Set`, `Error` and its standard subclasses (name, message, own props), boxed `Number`/`String`/`Boolean` |
| Binary | every typed array, `ArrayBuffer`, `DataView` (byte-exact, base64) |
| Temporal | any `Temporal.*` value — decoding needs `globalThis.Temporal` |
| Graphs | cycles and shared identity among plain objects and arrays |

Symbols, functions and class instances throw, as do cycles that run through a
`Map`, `Set` or `Error`.

## Untrusted input

`parse` validates everything it reads and never returns a half-built value:

- **`__proto__` keys** become own properties (via `defineProperty`, as
  `JSON.parse` does). No prototype is ever changed, and type tags such as
  `"constructor"` cannot reach `Object.prototype` members.
- **Malformed input** throws a `SerializeError` with a `code` — a missing
  `{v, $refs}` envelope is `INVALID_ENVELOPE`, not `undefined`.
- **Limits** are opt-in:

```ts
parse(text, {
  maxLength: 1_000_000, // UTF-16 code units, checked before JSON.parse
  maxDepth: 64,         // container nesting: [[1]] has depth 2
});
stringify(value, { maxDepth: 64 });
```

Containers counted for depth: arrays, plain objects, `Map`, `Set` and `Error`
own properties — hoisted ones included.

## Errors

Every failure is a `SerializeError` (a subclass of `Error`). Its `code` is one of:

| `code` | Meaning |
| --- | --- |
| `INVALID_INPUT` | `parse` was given something other than a string |
| `INVALID_JSON` | the text is not JSON (`cause` holds the `SyntaxError`) |
| `INPUT_TOO_LARGE` | longer than `maxLength` |
| `INVALID_ENVELOPE` | not `{"v": ...}`, or `$refs` is not an object |
| `MAX_DEPTH` | nests deeper than `maxDepth` |
| `MISSING_REF` | a `"@n"` token with no `$refs` entry |
| `UNKNOWN_TYPE` | an unrecognised `_t` tag |
| `INVALID_PAYLOAD` | an entry's `_v` is the wrong shape for its type |
| `CIRCULAR_REF` | a cycle through `Map`/`Set`/`Error` (either direction) |
| `UNSUPPORTED_VALUE` | symbol, function or class instance passed to `stringify` |
| `TEMPORAL_UNAVAILABLE` | Temporal data, but no `globalThis.Temporal` |
| `INVALID_OPTION` | a limit that is not a non-negative integer or `Infinity` |

```ts
import { parse, SerializeError } from "@opentf/serialize";

try {
  parse(body, { maxLength: 1e6, maxDepth: 64 });
} catch (err) {
  if (err instanceof SerializeError && err.code === "INPUT_TOO_LARGE") return reply(413);
  throw err;
}
```

## Embedding: `encode` / `decode`

To place encoded values inside your own JSON shape (this is how obj-diff
serializes each diff op), use the low-level pair. All roots share one `$refs`
table, so identity is preserved across them:

```ts
import { decode, encode } from "@opentf/serialize";

const { values: [path, value], refs } = encode([op.path, op.value]);
const wire = JSON.stringify({ type: op.type, path, value, $refs: refs });

const raw = JSON.parse(wire);
const [p, v] = decode([raw.path, raw.value], raw.$refs, { maxDepth: 64 });
```

## Development

Tests and builds run on [esdev](https://esrun.opentechf.org/esdev), pnpm installs
the dev tools (TypeScript, Biome), and [tsr](https://github.com/Open-Tech-Foundation/tsr)
runs the tasks in `tasks.toml`:

```sh
pnpm install
tsr test          # tests against src/
tsr build         # dist/ (esm + cjs + .d.ts)
tsr test:dist     # build, then the tests against dist/
tsr type-check    # esdev typecheck → the project's tsc
tsr lint          # biome lint
tsr fmt           # biome format --write
tsr ci            # all of the above (with fmt:check)
```

## License

MIT
