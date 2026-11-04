import { describe, expect, test } from "runtime:test";
import { parse, stringify } from "./lib";

const rt = <T>(v: T): T => parse<T>(stringify(v));

describe("stringify / parse round-trip", () => {
  test("primitives and top-level special values", () => {
    expect(rt(42)).toBe(42);
    expect(rt("hello")).toBe("hello");
    expect(rt(true)).toBe(true);
    expect(rt(null)).toBe(null);
    expect(rt(undefined)).toBe(undefined);
    expect(Number.isNaN(rt(Number.NaN))).toBe(true);
    expect(Object.is(rt(-0), -0)).toBe(true);
    expect(rt(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(rt(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    expect(rt(9007199254740993n)).toBe(9007199254740993n);
  });

  test("strings that look like ref tokens survive escaping", () => {
    expect(rt("@1")).toBe("@1");
    expect(rt("@42 hello")).toBe("@42 hello");
    expect(rt("@@escaped")).toBe("@@escaped");
    const back = rt({ a: "@1", b: new Date(0) });
    expect(back.a).toBe("@1");
    expect(back.b).toBeInstanceOf(Date);
  });

  test("Date (valid and invalid), RegExp, URL", () => {
    expect(rt(new Date(0))).toEqual(new Date(0));
    expect(Number.isNaN(rt(new Date(Number.NaN)).getTime())).toBe(true);
    expect(rt(/foo\d+/giu)).toEqual(/foo\d+/giu);
    const u = rt(new URL("https://a.example/p?q=1#h"));
    expect(u).toBeInstanceOf(URL);
    expect(u.href).toBe("https://a.example/p?q=1#h");
  });

  test("Map and Set, incl. object keys", () => {
    expect(rt(new Map<string, number>([["k", 1]]))).toEqual(new Map([["k", 1]]));
    expect(rt(new Set([1, 2, 3]))).toEqual(new Set([1, 2, 3]));
    const m = rt(new Map([[{ id: 1 }, new Date(0)]]));
    expect([...m.keys()][0]).toEqual({ id: 1 });
    expect([...m.values()][0]).toEqual(new Date(0));
  });

  test("typed arrays / ArrayBuffer / DataView are byte-exact", () => {
    expect(rt(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    const f = rt(new Float64Array([Number.NaN, Number.POSITIVE_INFINITY, -0]));
    expect(f).toBeInstanceOf(Float64Array);
    expect(Number.isNaN(f[0])).toBe(true);
    expect(Object.is(f[2], -0)).toBe(true);
    expect(rt(new BigInt64Array([9007199254740993n]))[0]).toBe(9007199254740993n);
    // a view into the middle of a larger buffer encodes only its own bytes
    const view = new Uint16Array(new Uint8Array([0, 0, 1, 0, 2, 0, 0, 0]).buffer, 2, 2);
    expect(rt(view)).toEqual(new Uint16Array([1, 2]));
    expect(new Uint8Array(rt(new Uint8Array([9, 8, 7]).buffer))).toEqual(new Uint8Array([9, 8, 7]));
    const dv = rt(new DataView(new Uint8Array([1, 2, 3, 4]).buffer));
    expect(dv).toBeInstanceOf(DataView);
    expect(dv.getUint8(3)).toBe(4);
  });

  test("Error and standard subclasses keep name, message and own props", () => {
    const e = new TypeError("boom") as TypeError & { code?: string };
    e.code = "E_BOOM";
    const back = rt(e);
    expect(back).toBeInstanceOf(TypeError);
    expect(back.message).toBe("boom");
    expect(back.code).toBe("E_BOOM");
    const custom = new Error("x");
    custom.name = "MyError";
    expect(rt(custom).name).toBe("MyError");
  });

  test("boxed primitives", () => {
    const n = rt(new Number(42));
    expect(n).toBeInstanceOf(Number);
    expect(n.valueOf()).toBe(42);
    expect(rt(new Number(Number.NaN)).valueOf()).toBeNaN();
    expect(rt(new String("hi")).valueOf()).toBe("hi");
    expect(rt(new Boolean(true)).valueOf()).toBe(true);
  });

  test("Temporal", () => {
    const d = rt(Temporal.PlainDate.from("2021-06-15"));
    expect(d.toString()).toBe("2021-06-15");
    const z = rt(Temporal.ZonedDateTime.from("2021-06-15T08:30[America/New_York]"));
    expect(z.toString()).toBe("2021-06-15T08:30:00-04:00[America/New_York]");
    expect(rt(Temporal.Duration.from({ hours: 2 })).toString()).toBe("PT2H");
  });

  test("nested mix of special types", () => {
    const value = {
      user: {
        joined: new Date("2020-01-01T00:00:00Z"),
        roles: new Set(["admin"]),
        prefs: new Map([["theme", "dark"]]),
        scores: new Float64Array([1.5, 2.5]),
        big: 123n,
        seen: [new Date(0), undefined],
      },
    };
    expect(rt(value)).toEqual(value);
  });

  test("user keys named _t / _v are ordinary data", () => {
    expect(rt({ _t: "Date", _v: "not a date" })).toEqual({ _t: "Date", _v: "not a date" });
  });

  test("circular references and shared identity", () => {
    const self: Record<string, unknown> = { name: "a" };
    self.self = self;
    const back = rt(self);
    expect(back.name).toBe("a");
    expect(back.self).toBe(back);

    const a: Record<string, unknown> = { id: "a" };
    const b: Record<string, unknown> = { id: "b", peer: a };
    a.peer = b;
    const ra = rt(a);
    expect((ra.peer as Record<string, unknown>).peer).toBe(ra);

    const arr: unknown[] = [1];
    arr.push(arr);
    const rarr = rt(arr);
    expect(rarr[1]).toBe(rarr);

    const shared = { id: 7 };
    const pair = rt({ a: shared, b: shared, list: [shared] });
    expect(pair.a).toBe(pair.b);
    expect(pair.list[0]).toBe(pair.a);

    // a plain object shared through a Map is still one object
    const viaMap = rt({ o: shared, m: new Map([["k", shared]]) });
    expect(viaMap.m.get("k")).toBe(viaMap.o);
  });

  test("throws on symbols, functions, class instances, cycles through Map", () => {
    expect(() => stringify(Symbol("s"))).toThrow();
    expect(() => stringify(() => 1)).toThrow();
    class Widget {}
    expect(() => stringify(new Widget())).toThrow();
    const m = new Map<string, unknown>();
    m.set("self", m);
    expect(() => stringify(m)).toThrow();
  });
});

describe("wire format (stays compatible with obj-diff 0.18)", () => {
  test("single-use containers stay inline and no $refs is written", () => {
    expect(stringify({ user: { name: "a", tags: ["x"] } })).toBe(
      '{"v":{"user":{"name":"a","tags":["x"]}}}',
    );
  });

  test("special values become tokens into the $refs table", () => {
    expect(stringify({ d: new Date(0), s: new Set([1]) })).toBe(
      '{"v":{"d":"@1","s":"@2"},"$refs":{"1":{"_t":"Date","_v":"1970-01-01T00:00:00.000Z"},"2":{"_t":"Set","_v":[1]}}}',
    );
  });

  test("shared containers are hoisted as obj/arr entries", () => {
    const shared = { id: 7 };
    expect(stringify({ a: shared, b: shared })).toBe(
      '{"v":{"a":"@1","b":"@1"},"$refs":{"1":{"_t":"obj","_v":{"id":7}}}}',
    );
  });

  test("parses output written by obj-diff's stringify", () => {
    const v = parse<{ m: Map<string, bigint> }>(
      '{"v":{"m":"@1"},"$refs":{"1":{"_t":"Map","_v":[["k","@2"]]},"2":{"_t":"bigint","_v":"5"}}}',
    );
    expect(v.m.get("k")).toBe(5n);
  });
});
