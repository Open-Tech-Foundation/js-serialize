// Tests run against src by default; TEST_DIST=true runs them against the build.
import { env } from "runtime:process";
import type * as Lib from "../src/index";

const lib: typeof Lib = env.TEST_DIST
  ? await import("../dist/index.js")
  : await import("../src/index");

export const { stringify, parse, encode, decode, SerializeError } = lib;
