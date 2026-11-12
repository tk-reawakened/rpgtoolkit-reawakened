import { deepEqual, equal, match, ok } from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Location } from "vscode-languageserver-protocol";
import { test } from "node:test";
import { UNASSESSED_CODE } from "../src/index.ts";
import { folderSnapshot, mainFileBytes, memoryProject } from "./project-support.ts";
import { startStdio } from "./stdio-client.ts";

/**
 * #2089 through the shipped stdio binary: the running project's dialect, not the
 * editor language mode, decides whether Toolkit 2 dialogue parses
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
 */

const TK2 = memoryProject({ "Main/legacy.gam": mainFileBytes("tk2"), "Prg/talk.prg": "" }, "Main/legacy.gam");
const TK3 = memoryProject({ "Main/modern.gam": mainFileBytes("tk3"), "Prg/talk.prg": "" }, "Main/modern.gam", { rootUri: "file:///modern/" });

test("stdio: a Toolkit 2 project parses loose dialogue; a 3.1 project and an unassessed buffer do not claim it", { timeout: 15_000 }, async () => {
  const client = await startStdio();
  try {
    await client.project(TK2.snapshot());
    deepEqual(await client.open(TK2.uri("Prg/talk.prg"), "Hello there\n", "rpgcode-tk2"), [], "assessed Toolkit 2 project");
    const loose = await client.open("file:///loose/talk.prg", "Hello there\n", "rpgcode");
    deepEqual(loose.map((item) => item.code), [UNASSESSED_CODE, "syntax.error"], "outside the project: provisional 3.1 reading, marked unassessed");
    match(loose[0]!.message, /not a program of the running project/);
    await client.project(TK3.snapshot(2));
    const modern = await client.open(TK3.uri("Prg/talk.prg"), "Hello there\n", "rpgcode-tk2");
    deepEqual(modern.map((item) => item.code), ["syntax.error"], "a 3.1 project keeps the genuine error whatever the language mode");
    equal(modern[0]!.severity, 1);
  } finally {
    await client.close();
  }
});

test("stdio #2081: definitions across explicit and implicit includes land on the real file's URI", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "tkr-lsp-2081-"));
  const client = await startStdio();
  try {
    mkdirSync(join(root, "Main"));
    mkdirSync(join(root, "Prg", "Tools"), { recursive: true });
    writeFileSync(join(root, "Main", "game.gam"), mainFileBytes("tk3"));
    const main = '#include "tools/my lib.prg"\ny = helper(1)\nz = lib.twice(2)\n';
    writeFileSync(join(root, "Prg", "main.prg"), main);
    writeFileSync(join(root, "Prg", "Tools", "My Lib.PRG"), "// helpers\nfunction helper(a) { return a }\n");
    writeFileSync(join(root, "Prg", "Lib.prg"), "function twice(a) { return a * 2 }\n");
    await client.project(folderSnapshot(join(root, "Main", "game.gam")));
    const mainUri = pathToFileURL(join(root, "Prg", "main.prg")).href;
    deepEqual(await client.open(mainUri, main), []);
    const definition = (line: number, character: number): Promise<Location[]> =>
      client.connection.sendRequest<Location[]>("textDocument/definition", { textDocument: { uri: mainUri }, position: { line, character } });

    const explicit = await definition(1, 5);
    equal(explicit.length, 1);
    equal(explicit[0]!.uri, pathToFileURL(join(root, "Prg", "Tools", "My Lib.PRG")).href, "the original spelling, not prg/tools/my lib.prg");
    ok(existsSync(fileURLToPath(explicit[0]!.uri)), "the URI names a file a client can open");
    deepEqual(explicit[0]!.range, { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } });

    const implicit = await definition(2, 5);
    deepEqual(implicit.map((item) => item.uri), [pathToFileURL(join(root, "Prg", "Lib.prg")).href]);
    deepEqual((await definition(0, 3)).map((item) => item.uri), [explicit[0]!.uri], "the #include line opens the file");
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
