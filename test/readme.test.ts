import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { END, extractBlock, renderExampleBlock, replaceBlock, START } from "../scripts/readme-example.ts";

const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");

describe("README", () => {
  it("o exemplo de payload bruto e status normalizado é a saída real do código", async () => {
    expect(extractBlock(readme)).toBe(await renderExampleBlock());
  });

  it("o comparador acusa bloco ausente, duplicado ou adulterado", async () => {
    const block = await renderExampleBlock();
    expect(extractBlock("sem bloco")).toBeNull();
    expect(extractBlock(`${block}\n${block}`)).toBeNull();
    expect(extractBlock(readme.replace('"status": "saiu_para_entrega"', '"status": "entregue"'))).not.toBe(block);
    expect(() => replaceBlock("sem bloco", block)).toThrow();
    expect(block.startsWith(START) && block.endsWith(END)).toBe(true);
  });

  it("a nota de IA diz o que foi feito com IA e traz a revisão escrita pela pessoa candidata", () => {
    const section = readme.split("## Uso de IA")[1] ?? "";
    const done = section.split("### Feito com IA")[1]?.split("###")[0] ?? "";
    const reviewed = section.split("### O que eu revisei")[1]?.split("###")[0] ?? "";
    expect(done.trim().length).toBeGreaterThan(100);
    expect(reviewed, "Preencha a seção 'O que eu revisei' no README antes de entregar.").not.toMatch(/pendente/);
    expect(reviewed.replace(/<!--[\s\S]*?-->/g, "").trim().length).toBeGreaterThan(50);
  });
});
