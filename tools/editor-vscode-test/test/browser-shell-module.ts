import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";

/** Build the real browser entry for shell tests, resolving its host-only imports from their owning packages. */
export async function writeBrowserShellModule(shellPath: string, hostModulePath: string): Promise<void> {
  const source = await readFile(resolve("tools/browser/editor-web/main.tsx"), "utf8");
  const { code: transformed } = await transform(source, { loader: "tsx", format: "esm" });
  const imports = [
    ["@tk-reawakened/host-web", hostModulePath],
    ["./audition-output.ts", resolve("tools/browser/editor-web/audition-output.ts")],
  ] as const;

  let code = transformed;
  for (const [specifier, modulePath] of imports) {
    const importName = JSON.stringify(specifier);
    if (!code.includes(importName)) throw new Error(`Browser shell entry is missing expected import ${specifier}`);
    code = code.replace(importName, JSON.stringify(pathToFileURL(modulePath).href));
  }
  await writeFile(shellPath, code);
}
