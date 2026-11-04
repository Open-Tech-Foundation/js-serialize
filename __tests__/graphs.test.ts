import { describe, expect, test } from "runtime:test";
import { decode, encode, parse, stringify } from "./lib";

const rt = <T>(v: T): T => parse<T>(stringify(v));

describe("cycles and shared identity through Map, Set and Error", () => {
  test("a Map that contains itself, as a value and as a key", () => {
    const m = new Map<unknown, unknown>();
    m.set("self", m);
    m.set(m, "key");
    const back = rt(m);
    expect(back).toBeInstanceOf(Map);
    expect(back.get("self")).toBe(back);
    expect(back.get(back)).toBe("key");
  });

  test("a Set that contains itself", () => {
    const s = new Set<unknown>([1]);
    s.add(s);
    const back = rt(s);
    expect(back.has(back)).toBe(true);
    expect(back.has(1)).toBe(true);
  });

  test("an Error whose own property points back at it", () => {
    const e = new RangeError("loop") as RangeError & { self?: unknown; code?: string };
    e.self = e;
    e.code = "E_LOOP";
    const back = rt(e);
    expect(back).toBeInstanceOf(RangeError);
    expect(back.self).toBe(back);
    expect(back.code).toBe("E_LOOP");
  });

  test("cycles that cross plain objects and special containers", () => {
    const node: Record<string, unknown> = { name: "root" };
    const children = new Map<string, unknown>([["parent", node]]);
    node.children = children;
    node.seen = new Set([node, children]);
    const back = rt(node);
    const kids = back.children as Map<string, unknown>;
    expect(kids.get("parent")).toBe(back);
    const seen = back.seen as Set<unknown>;
    expect(seen.has(back)).toBe(true);
    expect(seen.has(kids)).toBe(true);
  });

  test("a Map, Set, Date or typed array used twice stays one object", () => {
    const m = new Map([["k", 1]]);
    const s = new Set([1]);
    const d = new Date(0);
    const t = new Uint8Array([1, 2]);
    const back = rt({ a: [m, s, d, t], b: [m, s, d, t] });
    for (let i = 0; i < 4; i++) expect(back.a[i]).toBe(back.b[i]);
    expect(back.a[2]).toEqual(new Date(0));
  });

  test("identity is shared across encode roots", () => {
    const m = new Map<string, unknown>();
    m.set("self", m);
    const { values, refs } = encode([["path", m], m]);
    const [path, value] = decode(JSON.parse(JSON.stringify(values)), refs) as [unknown[], unknown];
    expect(path[1]).toBe(value);
    expect((value as Map<string, unknown>).get("self")).toBe(value);
  });

  test("a shared special value is written once and referenced by token", () => {
    const d = new Date(0);
    expect(stringify([d, d])).toBe(
      '{"v":["@1","@1"],"$refs":{"1":{"_t":"Date","_v":"1970-01-01T00:00:00.000Z"}}}',
    );
    const m = new Map<string, unknown>();
    m.set("self", m);
    expect(stringify(m)).toBe('{"v":"@1","$refs":{"1":{"_t":"Map","_v":[["self","@1"]]}}}');
  });

  test("maxDepth still bounds a cycle through a Map", () => {
    const m = new Map<string, unknown>([["inner", new Map([["x", [1]]])]]);
    m.set("self", m);
    expect(() => parse(stringify(m), { maxDepth: 2 })).toThrow("maxDepth");
    expect(rt(m).get("self")).toBeInstanceOf(Map);
  });
});

describe("sparse arrays", () => {
  test("holes stay holes, distinct from undefined and null", () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const back = rt([1, , undefined, null, , 6]);
    expect(back.length).toBe(6);
    expect(Object.keys(back)).toEqual(["0", "2", "3", "5"]);
    expect(1 in back).toBe(false);
    expect(2 in back).toBe(true);
    expect(back[2]).toBe(undefined);
    expect(back[3]).toBe(null);
  });

  test("leading, trailing and all-hole arrays keep their length", () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const trailing = rt([1, ,]);
    expect(trailing.length).toBe(2);
    expect(1 in trailing).toBe(false);
    const empty = rt(new Array(3));
    expect(empty.length).toBe(3);
    expect(Object.keys(empty)).toEqual([]);
  });

  test("every hole shares one $refs entry", () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    expect(stringify([, 1, ,])).toBe('{"v":["@1",1,"@1"],"$refs":{"1":{"_t":"hole"}}}');
  });

  test("holes inside hoisted, nested and Set-held arrays", () => {
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const shared = [1, , 3];
    // biome-ignore lint/suspicious/noSparseArray: the case under test
    const back = rt({ a: shared, b: shared, deep: [[, 2]], s: new Set([[, "x"]]) });
    expect(back.a).toBe(back.b);
    expect(1 in back.a).toBe(false);
    expect(0 in back.deep[0]).toBe(false);
    expect(0 in [...back.s][0]).toBe(false);
  });

  test("dense arrays are written exactly as before", () => {
    expect(stringify([1, undefined, 3])).toBe('{"v":[1,"@1",3],"$refs":{"1":{"_t":"undef"}}}');
  });
});
