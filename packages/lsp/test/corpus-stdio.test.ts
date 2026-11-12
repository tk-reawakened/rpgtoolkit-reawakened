import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeCp1252 } from "@tk-reawakened/core";
import { analyse } from "@tk-reawakened/script-tools";
import type { DocumentSymbol, Hover } from "vscode-languageserver-protocol";
import { UNASSESSED_CODE } from "../src/index.ts";
import { folderSnapshot } from "./project-support.ts";
import { startStdio, type StdioClient } from "./stdio-client.ts";

/**
 * Epic #666 Done-when 1 on the fetched sample games (#2089): diagnostics, hover
 * and the outline through the shipped stdio server, with the running project
 * selected from the game's own main file. The legacy fixtures are fetched at
 * test time (`pnpm fixtures:fetch`); without them these tests skip, and the CI
 * no-skips guard turns that skip into a failure, so an absent corpus never passes.
 */

const legacy = fileURLToPath(new URL("../../../fixtures/legacy/", import.meta.url));
const haveLegacy = existsSync(legacy);
const skip = haveLegacy ? false : "run pnpm fixtures:fetch";
const game = join(legacy, "FinalDestiny");

// One server for the file: the corpus is one running project, and a spawn per test would
// spend most of each test's time starting Node rather than exercising the server.
let client: StdioClient;
before(async () => {
  if (!haveLegacy) return;
  client = await startStdio();
  await client.project(folderSnapshot(join(game, "Main", "FinalDestiny.gam")));
});
after(async () => {
  if (haveLegacy) await client.close();
});

function text(path: string): string {
  const bytes = readFileSync(path);
  return decodeCp1252(bytes, 0, bytes.length);
}

test("FinalDestiny: every program is assessed as Toolkit 2 and the 3.1 false syntax errors are gone", { skip, timeout: 15_000 }, async () => {
  const programs = readdirSync(join(game, "Prg")).filter((name) => name.toLowerCase().endsWith(".prg")).sort();
  equal(programs.length, 55, "the pinned FinalDestiny corpus has 55 programs");
  {
    const sources = programs.map((name) => text(join(game, "Prg", name)));
    // The extension opens a .prg in the ordinary `rpgcode` mode; the project, not the mode, decides.
    const published = await Promise.all(programs.map((name, at) => client.open(pathToFileURL(join(game, "Prg", name)).href, sources[at]!, "rpgcode")));
    const failing: string[] = [];
    const falseUnder31: string[] = [];
    published.forEach((diagnostics, at) => {
      const name = programs[at]!;
      ok(diagnostics.every((item) => item.code !== UNASSESSED_CODE), `${name} is assessed`);
      if (diagnostics.length > 0) failing.push(name);
      if (diagnostics.length === 0 && !analyse(sources[at]!).ok) falseUnder31.push(name);
    });
    deepEqual(failing, programs.filter((_, at) => !analyse(sources[at]!, { dialect: "tk2" }).ok), "the published errors are exactly the Toolkit 2 frontend's");
    equal(failing.length, 1, "one program the Toolkit 2 frontend still rejects");
    equal(falseUnder31.length, 6, "six programs a 3.1 reading would falsely reject are clean in their project");
  }
});

test("FinalDestiny: hover and the outline work on Toolkit 2 programs of the running project", { skip, timeout: 15_000 }, async () => {
  {
    const chest = pathToFileURL(join(game, "Prg", "Basic Armor chest.prg")).href;
    deepEqual(await client.open(chest, text(join(game, "Prg", "Basic Armor chest.prg"))), []);
    // `#mwin("You found Basic Armor!")` on line 3.
    const hover = await client.connection.sendRequest<Hover | null>("textDocument/hover", { textDocument: { uri: chest }, position: { line: 2, character: 2 } });
    ok(hover !== null, "hover on a Toolkit 2 built-in call");
    ok(JSON.stringify(hover.contents).length > 20, "hover carries the command documentation");
    // The column is the Toolkit 2 frontend's normalised one until #2102 is fixed; the line is exact.
    equal(hover.range?.start.line, 2);

    const system = pathToFileURL(join(game, "Prg", "system.prg")).href;
    deepEqual(await client.open(system, text(join(game, "Prg", "system.prg"))), []);
    const symbols = await client.connection.sendRequest<DocumentSymbol[]>("textDocument/documentSymbol", { textDocument: { uri: system } });
    const pause = symbols.find((symbol) => symbol.name === "pause");
    ok(pause !== undefined, `the outline lists #Method Pause (${symbols.map((symbol) => symbol.name).join(", ")})`);
    equal(pause.range.start.line, 18, "#Method Pause() is on line 19");
    ok(symbols.length >= 5, "the outline lists the program's methods");
  }
});
