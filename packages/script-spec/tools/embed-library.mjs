import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(packageDirectory, "package/startup.prg");
const outputPath = resolve(packageDirectory, "src/library.generated.ts");
const source = readFileSync(sourcePath, "utf8");
const generated = `// Generated from package/startup.prg by tools/embed-library.mjs. Do not edit.\nexport const SPEC_LIBRARY_SOURCE = ${JSON.stringify(source)};\n`;

if (process.argv.includes("--check")) {
  let current;
  try {
    current = readFileSync(outputPath, "utf8");
  } catch {
    current = "";
  }
  if (current !== generated) {
    console.error("src/library.generated.ts is stale; run npm run generate:library");
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputPath, generated);
}
