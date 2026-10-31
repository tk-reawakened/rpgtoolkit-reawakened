import { ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * G2: `script-tools` is a pure library. It reads a string, returns data, and
 * touches no host: the only modules it may import are its own files and core.
 * The package `tsconfig` (`lib: ES2022`, `types: []`) already makes a Node or
 * DOM import a compile error; this test states the rule where a reviewer reads
 * it, so an `import "node:fs"` cannot arrive with a `// @ts-expect-error`.
 */

const sourceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const SPECIFIER = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

test("script-tools imports only its own files and the pure core package", () => {
  const files = readdirSync(sourceDir).filter((name) => name.endsWith(".ts"));
  ok(files.length > 0, "the package has sources");
  for (const name of files) {
    const text = readFileSync(join(sourceDir, name), "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1]!;
      ok(
        specifier.startsWith("./") || specifier === "@tk-reawakened/core",
        `${name} imports ${JSON.stringify(specifier)}; only relative files and @tk-reawakened/core are allowed (G2)`,
      );
    }
  }
});
