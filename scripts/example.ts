import { readFileSync, writeFileSync } from "node:fs";
import { extractBlock, renderExampleBlock, replaceBlock } from "./readme-example.ts";

const write = process.argv.includes("--write-readme");
const block = await renderExampleBlock();
console.log(block);

const readme = readFileSync("README.md", "utf8");
if (write) {
  writeFileSync("README.md", replaceBlock(readme, block));
  console.error("\nREADME atualizado.");
} else if (extractBlock(readme) !== block) {
  console.error("\nO exemplo do README está diferente da saída atual. Rode: npm run example -- --write-readme");
  process.exitCode = 1;
}
