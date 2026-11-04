// Compares @opentf/serialize with the type-preserving JSON alternatives on what
// decides a wire format: fidelity, behaviour on malformed input, size and speed.
//
//   tsr bench          measure, and write benchmarks/results.json
//   tsr bench:readme   ...then render the results into README.md
import * as fs from "runtime:fs";
import { Command } from "runtime:system";
import { test } from "runtime:test";
import { fidelityCases, identityChecks, sameValue, sizeCases, speedCases } from "./cases";
import { json, type Lib, libs, OURS } from "./libs";

// Paths from this file, not the working directory, so any cwd works.
const at = (rel: string): string => new URL(rel, import.meta.url).pathname;
const OUT = at("results.json");
const BENCH = { time: 500, warmupTime: 100 };

async function version(lib: Lib): Promise<string> {
  const manifest = lib.pkg ? `../node_modules/${lib.pkg}/package.json` : "../package.json";
  return JSON.parse(await fs.file(at(manifest)).text()).version;
}

/** The CPU model, for the README's machine line; null where lscpu is unavailable. */
async function cpu(): Promise<string | null> {
  try {
    const out = await new Command("lscpu", { args: [] }).output();
    const line = new TextDecoder()
      .decode(out.stdout)
      .split("\n")
      .find((l) => l.startsWith("Model name"));
    return line ? line.slice(line.indexOf(":") + 1).trim() : null;
  } catch {
    return null;
  }
}

type Cell = "pass" | "fail" | "throws";

function fidelity(lib: Lib): Cell[] {
  return fidelityCases.map(([label, make]) => {
    const value = make();
    try {
      const back = lib.parse(lib.stringify(value));
      const identity = identityChecks[label]?.(back) ?? true;
      return sameValue(value, back) && identity ? "pass" : "fail";
    } catch {
      return "throws";
    }
  });
}

/** What parse does with JSON that is not its own format: "throws", or what it returns. */
const malformedCases: [string, string][] = [
  ["Empty object `{}`", "{}"],
  ['Foreign object `{"x":1}`', '{"x":1}'],
  ["Bare number `42`", "42"],
];

function malformed(lib: Lib): string[] {
  return malformedCases.map(([, text]) => {
    try {
      const out = lib.parse(text);
      return `returns ${out === undefined ? "undefined" : JSON.stringify(out)}`;
    } catch {
      return "throws";
    }
  });
}

const utf8 = new TextEncoder();

function sizes(lib: Lib): (number | null)[] {
  return sizeCases.map(([, value]) => {
    try {
      return utf8.encode(lib.stringify(value)).length;
    } catch {
      return null;
    }
  });
}

test("serialization comparison", async ({ bench }) => {
  const speed = [];
  for (const [label, payload, withJson] of speedCases) {
    const group = withJson ? [...libs, json] : libs;
    const usable = group.filter((lib) => {
      try {
        lib.parse(lib.stringify(payload));
        return true;
      } catch {
        return false;
      }
    });
    const ops = [];
    for (const op of ["stringify", "parse"] as const) {
      const runs = usable.map((lib) => {
        const wire = lib.stringify(payload);
        return bench(`${label} · ${op} · ${lib.name}`, () =>
          op === "stringify" ? lib.stringify(payload) : lib.parse(wire),
        );
      });
      const results = await bench.compare(...runs, BENCH);
      ops.push({
        op,
        rows: group.map((lib) => {
          const r = results.get(`${label} · ${op} · ${lib.name}`);
          return {
            lib: lib.name,
            opsPerSec: r ? Math.round(r.throughput.mean) : null,
            meanMs: r ? r.latency.mean : null,
            rme: r ? Number(r.latency.rme.toFixed(2)) : null,
          };
        }),
      });
    }
    speed.push({ scenario: label, ops });
  }

  const data = {
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      runtime: navigator.userAgent,
      cpu: await cpu(),
      threads: navigator.hardwareConcurrency,
      package: OURS,
      versions: Object.fromEntries(
        await Promise.all(libs.map(async (l) => [l.name, await version(l)])),
      ),
      regenerate: "tsr bench:readme",
    },
    libraries: libs.map((l) => l.name),
    fidelity: {
      cases: fidelityCases.map(([label]) => label),
      rows: libs.map((lib) => {
        const cells = fidelity(lib);
        return { lib: lib.name, cells, score: cells.filter((c) => c === "pass").length };
      }),
    },
    malformed: {
      cases: malformedCases.map(([label]) => label),
      rows: libs.map((lib) => ({ lib: lib.name, cells: malformed(lib) })),
    },
    size: {
      cases: sizeCases.map(([label]) => label),
      rows: libs.map((lib) => ({ lib: lib.name, bytes: sizes(lib) })),
    },
    speed,
  };
  await fs.write(OUT, `${JSON.stringify(data, null, 2)}\n`);
  console.log("wrote benchmarks/results.json");
});
