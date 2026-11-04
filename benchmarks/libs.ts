// The libraries under comparison, each reduced to string-in / string-out so they
// are measured on the same job: a value to JSON text and back.
import * as ungap from "@ungap/structured-clone/json";
import * as devalue from "devalue";
import { fromJSON, toJSON } from "seroval";
import superjson from "superjson";
import { parse, stringify } from "../src/index";

export interface Lib {
  name: string;
  /** npm package to read the version from; undefined for built-ins and this package. */
  pkg?: string;
  stringify(value: unknown): string;
  parse(text: string): unknown;
}

export const OURS = "@opentf/serialize";

export const libs: Lib[] = [
  { name: OURS, stringify: (v) => stringify(v), parse: (s) => parse(s) },
  {
    name: "superjson",
    pkg: "superjson",
    stringify: (v) => superjson.stringify(v),
    parse: (s) => superjson.parse(s),
  },
  {
    name: "devalue",
    pkg: "devalue",
    stringify: (v) => devalue.stringify(v),
    parse: (s) => devalue.parse(s),
  },
  {
    // JSON mode (toJSON / fromJSON): seroval's default serialize() emits JS source
    // that must be eval'd, which is not an option for untrusted input.
    name: "seroval",
    pkg: "seroval",
    stringify: (v) => JSON.stringify(toJSON(v)),
    parse: (s) => fromJSON(JSON.parse(s)),
  },
  {
    name: "@ungap/structured-clone",
    pkg: "@ungap/structured-clone",
    stringify: (v) => ungap.stringify(v),
    parse: (s) => ungap.parse(s),
  },
];

/** Baseline only: loses every non-JSON type, so it appears in the speed table for plain data. */
export const json: Lib = {
  name: "JSON",
  stringify: (v) => JSON.stringify(v),
  parse: (s) => JSON.parse(s),
};
