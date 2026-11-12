import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeCp1252, newProjectMainFile, writeMainFile } from "@tk-reawakened/core";
import { analyse } from "@tk-reawakened/script-tools";
import type { DocumentSymbol, Hover, Location } from "vscode-languageserver-protocol";
import { UNASSESSED_CODE } from "../src/index.ts";
import { encodeBase64 } from "../src/protocol.ts";
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

// #2081 / #943: go-to-definition across includes on the fetched games. Each test selects its
// game's project with a higher revision, as a client does when the author switches project.
let revision = 1;

async function definitionIn(uri: string, source: string, line: number, character: number): Promise<Location[]> {
  deepEqual((await client.open(uri, source)).filter((item) => item.code === UNASSESSED_CODE), [], "assessed");
  return client.connection.sendRequest<Location[]>("textDocument/definition", { textDocument: { uri }, position: { line, character } });
}

test("FinalDestiny (TK2): the implicit include #system.pause() goes to #Method Pause in Prg/system.prg", { skip, timeout: 15_000 }, async () => {
  await client.project(folderSnapshot(join(game, "Main", "FinalDestiny.gam"), (revision += 1)));
  const chest = join(game, "Prg", "Basic Armor chest.prg");
  const source = text(chest);
  equal(source.split(/\r?\n/)[4], "#system.pause()", "the fixture line under test");
  const found = await definitionIn(pathToFileURL(chest).href, source, 4, 3);
  deepEqual(found.map((item) => [item.uri, item.range.start.line]), [[pathToFileURL(join(game, "Prg", "system.prg")).href, 18]]);
});

test("School2Demo (TK2): the runtime #Include(...) form gets no guessed location", { skip, timeout: 15_000 }, async () => {
  // In Toolkit 2.x `#Include("file")` is an ordinary run-time include() call that emits no
  // compile-time include request (#1947), so the index has no edge for it and the server must
  // not invent one: neither the include line nor a call into the file it loads at run time
  // navigates. The static forms are covered by FinalDestiny (implicit) and Basic (#include).
  const school = join(legacy, "School2Demo");
  await client.project(folderSnapshot(join(school, "Main", "Schoolsout2.gam"), (revision += 1)));
  const innkeeper = join(school, "Prg", "lontala innkeeper.prg");
  const source = text(innkeeper);
  const lines = source.split(/\r?\n/);
  equal(lines[1], '#include("system.prg")');
  const pauseLine = lines.findIndex((line) => line.trim() === "#Pause()");
  ok(pauseLine > 0, "the innkeeper calls #Pause()");
  deepEqual(await definitionIn(pathToFileURL(innkeeper).href, source, 1, 3), []);
  const pause = await client.connection.sendRequest<Location[]>("textDocument/definition", {
    textDocument: { uri: pathToFileURL(innkeeper).href },
    position: { line: pauseLine, character: 1 },
  });
  deepEqual(pause, []);
});

test("Basic (3.1): #include \"system.prg\" and a call into it navigate to Prg/system.prg", { skip, timeout: 15_000 }, async () => {
  // Basic ships no .gam; like the closing plan (golden/closing/plan.json) the client supplies a
  // synthesised 3.1 main file at Main/basic.gam beside the real program files.
  const basic = join(legacy, "Basic");
  const main = writeMainFile({ ...newProjectMainFile() });
  if (!main.ok) throw new Error(main.error.message);
  const programs = readdirSync(join(basic, "Prg")).filter((name) => name.toLowerCase().endsWith(".prg"));
  await client.project({
    revision: (revision += 1),
    main: { uri: pathToFileURL(join(basic, "Main", "basic.gam")).href, bytes: encodeBase64(main.value) },
    rootUri: pathToFileURL(basic).href + "/",
    files: programs.map((name) => ({ path: `Prg/${name}`, uri: pathToFileURL(join(basic, "Prg", name)).href, bytes: encodeBase64(readFileSync(join(basic, "Prg", name))) })),
    lintConfig: null,
  });
  const start = join(basic, "Prg", "start.prg");
  const source = text(start);
  const lines = source.split(/\r?\n/);
  equal(lines[5], '#include "system.prg"');
  const system = pathToFileURL(join(basic, "Prg", "system.prg")).href;
  deepEqual((await definitionIn(pathToFileURL(start).href, source, 5, 3)).map((item) => item.uri), [system]);
  const systemSource = text(join(basic, "Prg", "system.prg"));
  const pauseDefinition = systemSource.split(/\r?\n/).findIndex((line) => /^\s*(?:function|method)\s+pause\s*\(/i.test(line));
  ok(pauseDefinition >= 0, "system.prg defines pause");
  const callLine = lines.findIndex((line) => /\bpause\s*\(/i.test(line) && !line.trimStart().startsWith("//"));
  ok(callLine > 5, "start.prg calls pause after the include");
  const pause = await client.connection.sendRequest<Location[]>("textDocument/definition", {
    textDocument: { uri: pathToFileURL(start).href },
    position: { line: callLine, character: lines[callLine]!.search(/pause/i) + 1 },
  });
  deepEqual(pause.map((item) => [item.uri, item.range.start.line]), [[system, pauseDefinition]]);
});
