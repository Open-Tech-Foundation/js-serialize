import { describe, expect, test } from "runtime:test";
import { decode, encode, parse, SerializeError, stringify } from "./lib";

/** Runs fn and returns the SerializeError it throws (fails the test otherwise). */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SerializeError);
    return (err as InstanceType<typeof SerializeError>).code;
  }
  throw new Error("expected a SerializeError, but nothing was thrown");
}

describe("__proto__ keys are own properties, never prototypes", () => {
  test("parse defines __proto__ as an own key in plain objects", () => {
    const v = parse<Record<string, unknown>>('{"v":{"__proto__":{"polluted":true},"a":1}}');
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.hasOwn(v, "__proto__")).toBe(true);
    expect(Object.keys(v)).toEqual(["__proto__", "a"]);
    expect((v as { polluted?: unknown }).polluted).toBeUndefined();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  test("hoisted objects and Error own props are safe too", () => {
    const hoisted = parse<{ a: object; b: object }>(
      '{"v":{"a":"@1","b":"@1"},"$refs":{"1":{"_t":"obj","_v":{"__proto__":{"x":1}}}}}',
    );
    expect(Object.getPrototypeOf(hoisted.a)).toBe(Object.prototype);
    expect(Object.hasOwn(hoisted.a, "__proto__")).toBe(true);

    const err = parse<Error>(
      '{"v":"@1","$refs":{"1":{"_t":"Error","_v":{"name":"Error","message":"m","own":{"__proto__":{"x":1}}}}}}',
    );
    expect(Object.getPrototypeOf(err)).toBe(Error.prototype);
    expect(Object.hasOwn(err, "__proto__")).toBe(true);
  });

  test("an own __proto__ key round-trips through stringify", () => {
    const src = JSON.parse('{"__proto__":{"deep":1},"b":2}');
    const back = parse<Record<string, unknown>>(stringify(src));
    expect(Object.hasOwn(back, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(back, "__proto__")?.value).toEqual({ deep: 1 });
    expect(Object.getPrototypeOf(back)).toBe(Object.prototype);
  });

  test("type tags cannot reach Object.prototype members", () => {
    expect(codeOf(() => parse('{"v":"@1","$refs":{"1":{"_t":"constructor","_v":"x"}}}'))).toBe(
      "UNKNOWN_TYPE",
    );
    expect(codeOf(() => parse('{"v":"@1","$refs":{"1":{"_t":"toString","_v":"x"}}}'))).toBe(
      "UNKNOWN_TYPE",
    );
    // an Error name that is an Object.prototype key falls back to plain Error
    const e = parse<Error>(
      '{"v":"@1","$refs":{"1":{"_t":"Error","_v":{"name":"constructor","message":"m","own":{}}}}}',
    );
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("constructor");
    expect(
      codeOf(() => parse('{"v":"@1","$refs":{"1":{"_t":"Temporal.__proto__","_v":"x"}}}')),
    ).toBe("UNKNOWN_TYPE");
  });
});

describe("clear errors for malformed input", () => {
  test("missing {v, $refs} envelope", () => {
    for (const bad of ["{}", '{"$refs":{}}', "[]", "null", "42", '"str"', '{"value":1}']) {
      expect(codeOf(() => parse(bad))).toBe("INVALID_ENVELOPE");
    }
    expect(() => parse("{}")).toThrow(
      'envelope written by stringify(), got an object without a "v" key',
    );
    // an explicit null value is a valid envelope
    expect(parse('{"v":null}')).toBe(null);
  });

  test("non-string input and invalid JSON", () => {
    expect(codeOf(() => parse(undefined as unknown as string))).toBe("INVALID_INPUT");
    expect(codeOf(() => parse({ v: 1 } as unknown as string))).toBe("INVALID_INPUT");
    expect(codeOf(() => parse("{nope"))).toBe("INVALID_JSON");
  });

  test("bad $refs table and entries", () => {
    expect(codeOf(() => parse('{"v":1,"$refs":[]}'))).toBe("INVALID_ENVELOPE");
    expect(codeOf(() => parse('{"v":1,"$refs":"x"}'))).toBe("INVALID_ENVELOPE");
    expect(codeOf(() => parse('{"v":"@9"}'))).toBe("MISSING_REF");
    expect(codeOf(() => parse('{"v":"@1","$refs":{"1":5}}'))).toBe("INVALID_PAYLOAD");
    expect(codeOf(() => parse('{"v":"@1","$refs":{"1":{"_v":1}}}'))).toBe("INVALID_PAYLOAD");
    expect(codeOf(() => parse('{"v":"@1","$refs":{"1":{"_t":"Bogus"}}}'))).toBe("UNKNOWN_TYPE");
  });

  test("bad payloads throw INVALID_PAYLOAD instead of building garbage", () => {
    const one = (t: string, v: unknown) =>
      codeOf(() => parse(JSON.stringify({ v: "@1", $refs: { 1: { _t: t, _v: v } } })));
    expect(one("bigint", "abc")).toBe("INVALID_PAYLOAD");
    expect(one("bigint", 5)).toBe("INVALID_PAYLOAD");
    expect(one("num", "7")).toBe("INVALID_PAYLOAD");
    expect(one("RegExp", "abc")).toBe("INVALID_PAYLOAD");
    expect(one("RegExp", ["(", ""])).toBe("INVALID_PAYLOAD");
    expect(one("URL", "not a url")).toBe("INVALID_PAYLOAD");
    expect(one("Map", [1, 2])).toBe("INVALID_PAYLOAD");
    expect(one("Set", {})).toBe("INVALID_PAYLOAD");
    expect(one("Uint16Array", "AQID")).toBe("INVALID_PAYLOAD"); // 3 bytes: misaligned
    expect(one("Uint8Array", "!!!")).toBe("INVALID_PAYLOAD");
    expect(one("Error", { name: "Error" })).toBe("INVALID_PAYLOAD");
    expect(one("Number", "x")).toBe("INVALID_PAYLOAD");
    expect(one("obj", [])).toBe("INVALID_PAYLOAD");
    expect(one("arr", {})).toBe("INVALID_PAYLOAD");
  });

  test("a self-referencing Map/Set in the input throws instead of overflowing the stack", () => {
    expect(codeOf(() => parse('{"v":"@1","$refs":{"1":{"_t":"Map","_v":[["k","@1"]]}}}'))).toBe(
      "CIRCULAR_REF",
    );
    expect(
      codeOf(() =>
        parse('{"v":"@1","$refs":{"1":{"_t":"Set","_v":["@2"]},"2":{"_t":"Set","_v":["@1"]}}}'),
      ),
    ).toBe("CIRCULAR_REF");
  });

  test("stringify errors are SerializeErrors with codes", () => {
    expect(codeOf(() => stringify(Symbol("s")))).toBe("UNSUPPORTED_VALUE");
    class Widget {}
    expect(codeOf(() => stringify(new Widget()))).toBe("UNSUPPORTED_VALUE");
    const s = new Set<unknown>();
    s.add(s);
    expect(codeOf(() => stringify(s))).toBe("CIRCULAR_REF");
  });
});

describe("optional limits", () => {
  test("maxLength rejects oversized input before parsing", () => {
    const text = stringify({ list: [1, 2, 3] });
    expect(parse(text, { maxLength: text.length })).toEqual({ list: [1, 2, 3] });
    expect(codeOf(() => parse(text, { maxLength: text.length - 1 }))).toBe("INPUT_TOO_LARGE");
    // checked before JSON.parse, so even invalid JSON reports the size first
    expect(codeOf(() => parse("x".repeat(100), { maxLength: 10 }))).toBe("INPUT_TOO_LARGE");
  });

  test("maxDepth counts container nesting on parse", () => {
    const text = stringify({ a: [{ b: 1 }] }); // object > array > object = 3
    expect(parse(text, { maxDepth: 3 })).toEqual({ a: [{ b: 1 }] });
    expect(codeOf(() => parse(text, { maxDepth: 2 }))).toBe("MAX_DEPTH");
    expect(parse('{"v":5}', { maxDepth: 0 })).toBe(5);
    expect(codeOf(() => parse('{"v":[]}', { maxDepth: 0 }))).toBe("MAX_DEPTH");
  });

  test("maxDepth also counts Map, Set, Error and hoisted containers", () => {
    const viaMap = stringify(new Map([["k", new Set([[1]])]])); // Map > Set > array = 3
    expect(parse(viaMap, { maxDepth: 3 })).toBeInstanceOf(Map);
    expect(codeOf(() => parse(viaMap, { maxDepth: 2 }))).toBe("MAX_DEPTH");

    const shared = { x: { y: 1 } };
    const hoisted = stringify([shared, shared]); // array > obj(hoisted) > obj = 3
    expect(codeOf(() => parse(hoisted, { maxDepth: 2 }))).toBe("MAX_DEPTH");
    expect(parse<unknown[]>(hoisted, { maxDepth: 3 })[0]).toEqual(shared);
  });

  test("maxDepth stops pathologically deep input", () => {
    const deep = `{"v":${"[".repeat(5000)}${"]".repeat(5000)}}`;
    expect(codeOf(() => parse(deep, { maxDepth: 100 }))).toBe("MAX_DEPTH");
  });

  test("stringify accepts maxDepth too", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 50; i++) deep = [deep];
    expect(codeOf(() => stringify(deep, { maxDepth: 10 }))).toBe("MAX_DEPTH");
    expect(parse(stringify(deep, { maxDepth: 50 }))).toEqual(deep);
  });

  test("invalid limit options are rejected", () => {
    expect(codeOf(() => parse('{"v":1}', { maxDepth: -1 }))).toBe("INVALID_OPTION");
    expect(codeOf(() => parse('{"v":1}', { maxLength: 1.5 }))).toBe("INVALID_OPTION");
    expect(codeOf(() => stringify(1, { maxDepth: Number.NaN }))).toBe("INVALID_OPTION");
    expect(parse('{"v":1}', { maxDepth: Number.POSITIVE_INFINITY })).toBe(1);
  });
});

describe("encode / decode (low-level, for embedding)", () => {
  test("roots share one $refs table, so identity crosses roots", () => {
    const key = { id: 1 };
    const { values, refs } = encode([["users", key], key]);
    expect(refs).toBeDefined();
    const [path, value] = decode(JSON.parse(JSON.stringify(values)), refs) as [unknown[], unknown];
    expect(path[1]).toBe(value);
  });

  test("refs is undefined when nothing needs a ref", () => {
    expect(encode([{ a: 1 }, "b"])).toEqual({ values: [{ a: 1 }, "b"], refs: undefined });
    expect(decode([{ a: 1 }, "@@x"], undefined)).toEqual([{ a: 1 }, "@x"]);
  });

  test("decode validates refs and honours maxDepth", () => {
    expect(codeOf(() => decode(["@1"], []))).toBe("INVALID_ENVELOPE");
    expect(codeOf(() => decode([[[1]]], undefined, { maxDepth: 1 }))).toBe("MAX_DEPTH");
  });
});
