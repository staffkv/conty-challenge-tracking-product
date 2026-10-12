import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const ADAPTER_DIR = "src/providers/rastreio-fake/";
const COMPOSITION_ROOT = "src/main.ts";
// Nomes do formato bruto do agregador. Se aparecerem fora do adaptador, o formato vazou.
const AGGREGATOR_FIELDS = ["checkpoint_id", "checkpoint_time", "checkpoint_tz", "courier_status", "courier_code", "tracking_number", "checkpoints"];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const outsideAdapter = sourceFiles("src").filter((f) => !f.startsWith(ADAPTER_DIR));

describe("fronteira do agregador", () => {
  it("só a composição importa o adaptador do agregador", () => {
    const importers = outsideAdapter.filter((f) => /from\s+["'][^"']*providers\/rastreio-fake\//.test(readFileSync(join(ROOT, f), "utf8")));
    expect(importers).toEqual([COMPOSITION_ROOT]);
  });

  it("os nomes de campo do agregador não aparecem fora do adaptador", () => {
    const leaks = outsideAdapter.flatMap((f) => {
      const text = readFileSync(join(ROOT, f), "utf8");
      return AGGREGATOR_FIELDS.filter((field) => new RegExp(`\\b${field}\\b`).test(text)).map((field) => `${relative(ROOT, join(ROOT, f))}: ${field}`);
    });
    expect(leaks).toEqual([]);
  });

  it("o adaptador não depende do serviço, do banco nem da API", () => {
    const deps = sourceFiles(ADAPTER_DIR.slice(0, -1)).flatMap((f) =>
      [...readFileSync(join(ROOT, f), "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!),
    );
    expect(deps.filter((d) => /\/(tracking|storage)\/|\/(app|main)\.ts$/.test(d))).toEqual([]);
  });
});
