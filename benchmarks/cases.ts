// Inputs for the comparison: fidelity cases, size cases and speed payloads.

// ---- cycle-safe, type-aware equality ---------------------------------------

function sameBytes(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

const tag = (x: unknown): string => Object.prototype.toString.call(x);

/** True when `b` has the same types, values, keys and graph shape as `a`. */
export function sameValue(a: unknown, b: unknown, seen = new Map<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (tag(a).startsWith("[object Temporal.")) return tag(a) === tag(b) && String(a) === String(b);
  if (a instanceof Date) return Object.is(a.getTime(), (b as Date).getTime());
  if (a instanceof RegExp) {
    return a.source === (b as RegExp).source && a.flags === (b as RegExp).flags;
  }
  if (a instanceof URL) return a.href === (b as URL).href;
  if (a instanceof Number || a instanceof String || a instanceof Boolean) {
    return Object.is(a.valueOf(), (b as typeof a).valueOf());
  }
  if (a instanceof ArrayBuffer) {
    return sameBytes(new Uint8Array(a), new Uint8Array(b as ArrayBuffer));
  }
  if (a instanceof DataView) {
    const bv = b as DataView;
    return sameBytes(
      new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
      new Uint8Array(bv.buffer, bv.byteOffset, bv.byteLength),
    );
  }
  if (ArrayBuffer.isView(a)) {
    const x = a as unknown as ArrayLike<unknown>;
    const y = b as unknown as ArrayLike<unknown>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  }
  if (a instanceof Map) {
    const bm = b as Map<unknown, unknown>;
    if (a.size !== bm.size) return false;
    const be = [...bm];
    let i = 0;
    for (const [k, v] of a) {
      if (!sameValue(k, be[i][0], seen) || !sameValue(v, be[i][1], seen)) return false;
      i++;
    }
    return true;
  }
  if (a instanceof Set) {
    const bs = b as Set<unknown>;
    if (a.size !== bs.size) return false;
    const bv = [...bs];
    let i = 0;
    for (const v of a) if (!sameValue(v, bv[i++], seen)) return false;
    return true;
  }
  if (a instanceof Error) {
    const be = b as Error & { code?: unknown };
    return (
      a.name === be.name &&
      a.message === be.message &&
      (a as Error & { code?: unknown }).code === be.code
    );
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  for (const k of ak) if (!sameValue(ao[k], bo[k], seen)) return false;
  return true;
}

// ---- fidelity ----------------------------------------------------------------

const selfCycle = () => {
  const o: Record<string, unknown> = { name: "n" };
  o.self = o;
  return o;
};

/** [label, make] — each value must come back with the same type, value and shape. */
export const fidelityCases: [string, () => unknown][] = [
  ["Plain nested object", () => ({ a: { b: [1, 2] } })],
  ["Date", () => new Date(1e12)],
  ["Invalid Date", () => new Date(Number.NaN)],
  ["RegExp", () => /foo\d+/giu],
  ["Map", () => new Map([["k", 1]])],
  ["Set", () => new Set([1, 2, 3])],
  ["BigInt", () => 9007199254740993n],
  ["Int8Array", () => new Int8Array([1, 2, 3])],
  ["Float64Array [NaN, -0, ∞]", () => new Float64Array([Number.NaN, -0, Number.POSITIVE_INFINITY])],
  ["BigInt64Array", () => new BigInt64Array([9007199254740993n])],
  ["ArrayBuffer", () => new Uint8Array([9, 8, 7]).buffer],
  ["DataView", () => new DataView(new Uint8Array([1, 2, 3, 4]).buffer)],
  ["Error + custom prop", () => Object.assign(new TypeError("boom"), { code: "E1" })],
  ["Boxed Number", () => new Number(42)],
  ["Boxed String", () => new String("hi")],
  ["undefined", () => undefined],
  ["NaN", () => Number.NaN],
  ["-0", () => -0],
  ["Infinity", () => Number.POSITIVE_INFINITY],
  ["URL", () => new URL("https://a.example/p?q=1")],
  ["Temporal.PlainDate", () => Temporal.PlainDate.from("2021-06-15")],
  ["Temporal.ZonedDateTime", () => Temporal.ZonedDateTime.from("2021-06-15T08:30[Europe/Paris]")],
  [
    "Shared reference",
    () => {
      const s = { id: 1 };
      return { a: s, b: s };
    },
  ],
  ["Circular object", selfCycle],
  [
    "Circular array",
    () => {
      const a: unknown[] = [1];
      a.push(a);
      return a;
    },
  ],
  [
    "Cycle through a Map",
    () => {
      const m = new Map<string, unknown>();
      m.set("self", m);
      return m;
    },
  ],
  // biome-ignore lint/suspicious/noSparseArray: the case under test
  ["Sparse array", () => [1, , 3]],
  ["Own __proto__ key", () => JSON.parse('{"__proto__":{"x":1},"a":1}')],
];

/** Identity that `sameValue` cannot see: copies would compare equal, so check `===`. */
export const identityChecks: Record<string, (back: unknown) => boolean> = {
  "Shared reference": (b) => (b as { a: unknown; b: unknown }).a === (b as { b: unknown }).b,
  "Circular object": (b) => (b as { self: unknown }).self === b,
  "Circular array": (b) => (b as unknown[])[1] === b,
  "Cycle through a Map": (b) => (b as Map<string, unknown>).get("self") === b,
};

// ---- wire size -----------------------------------------------------------------

export const sizeCases: [string, unknown][] = [
  ["Flat object", { id: 1, name: "Ada", active: true }],
  [
    "Mixed native types",
    { at: new Date(0), tags: new Set(["a", "b"]), prefs: new Map([["t", "dark"]]) },
  ],
  ["Typed array (8)", { buf: new Int8Array([1, 2, 3, 4, 5, 6, 7, 8]) }],
  [
    "Nested record",
    { user: { id: 1, joined: new Date(0), roles: new Set(["admin", "editor"]), big: 42n } },
  ],
  ["Tricky numbers", { a: Number.NaN, b: -0, c: Number.POSITIVE_INFINITY }],
  ["Circular graph", selfCycle()],
];

// ---- speed -----------------------------------------------------------------------

const typedRecord = {
  user: {
    id: 1,
    joined: new Date(0),
    roles: new Set(["admin", "editor"]),
    prefs: new Map([
      ["theme", "dark"],
      ["lang", "en"],
    ]),
    scores: new Float64Array([1.5, 2.5, 3.5]),
    big: 123n,
    tags: ["a", "b", "c"],
    note: null,
  },
};

const plainRows = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  name: `user ${i}`,
  email: `user${i}@example.com`,
  active: i % 3 !== 0,
  score: i * 1.5,
  tags: ["a", "b"],
}));

const typedRows = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  name: `user ${i}`,
  joined: new Date(1e12 + i * 86_400_000),
  roles: new Set(i % 2 ? ["admin"] : ["editor", "viewer"]),
  balance: BigInt(i) * 1_000_000_007n,
}));

/** [label, payload, include the plain-JSON baseline] */
export const speedCases: [string, unknown, boolean][] = [
  ["Typed record", typedRecord, false],
  ["1,000 plain rows", plainRows, true],
  ["1,000 typed rows", typedRows, false],
];
