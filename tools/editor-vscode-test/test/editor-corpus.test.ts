import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BinaryReader } from "@tk-reawakened/core";
import { createDocumentIdentity, openMainDocument } from "@tk-reawakened/editor-model";
import { runClosingGame, parseClosingPlan, type ClosingFiles } from "@tk-reawakened/runner-harness";
import { createSessionCopy } from "@tk-reawakened/host-web/testing";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const gameName = "School2Demo";
const gameRoot = join(root, "fixtures/legacy", gameName);
const mainPath = "Main/Schoolsout2.gam";
const hasGame = existsSync(join(gameRoot, mainPath));

test("a fetched corpus main file preserves non-title bytes and boots through the headless engine", { skip: hasGame ? false : "run pnpm fixtures:fetch" }, async () => {
  const gameFiles = loadGameFiles(gameRoot);
  const original = gameFiles.get(mainPath);
  if (original === undefined) throw new Error(`fetched ${gameName} corpus contains no ${mainPath}`);
  const project = createSessionCopy(mainPath, original);
  const identity = createDocumentIdentity(project.project.id, mainPath);
  const opened = await openMainDocument(project.services.fs, identity);
  if (!opened.ok) throw new Error(`could not open fetched ${mainPath}: ${opened.error.error.message}`);
  const initialSnapshot = opened.document.getSnapshot();
  if (initialSnapshot.readOnly !== null) throw new Error(`fetched ${mainPath} is read-only: ${initialSnapshot.readOnly.message}`);
  const title = `Corpus settings ${initialSnapshot.gameTitle}`;
  const applied = opened.document.apply({ type: "set-game-title", title });
  if (!applied.ok) throw new Error(`could not edit fetched ${mainPath}: ${applied.rejection.message}`);
  const saved = await opened.document.save();
  if (!saved.ok) throw new Error(`could not save fetched ${mainPath}: ${saved.failure.message}`);
  const persisted = await project.services.fs.read(mainPath);
  if (!persisted.ok) throw new Error(`could not read saved ${mainPath}: ${persisted.error.message}`);

  const beforeTitle = titleSpan(original);
  const afterTitle = titleSpan(persisted.value);
  deepEqual(persisted.value.slice(0, beforeTitle.start), original.slice(0, beforeTitle.start), "bytes before gameTitle are preserved");
  deepEqual(persisted.value.slice(afterTitle.end), original.slice(beforeTitle.end), "bytes after gameTitle are preserved");
  const reopened = await openMainDocument(project.services.fs, identity);
  if (!reopened.ok) throw new Error(`could not reopen saved ${mainPath}: ${reopened.error.error.message}`);
  equal(reopened.document.getSnapshot().gameTitle, title);

  const plan = parseClosingPlan(readFileSync(join(root, "golden/closing/plan.json"), "utf8"));
  const game = plan.games.find((entry) => entry.name === gameName);
  if (!game) throw new Error(`closing plan has no ${gameName} game`);
  const bundledEntries: Array<readonly [string, Uint8Array]> = [];
  for (const folder of plan.bundled) {
    for (const [path, bytes] of loadGameFiles(join(root, folder))) bundledEntries.push([`${folder}/${path}`, bytes]);
  }
  const bundled: ClosingFiles = new Map(bundledEntries);
  const updated = new Map(gameFiles);
  updated.set(mainPath, persisted.value);
  const run = runClosingGame(plan, game, updated, bundled);
  deepEqual(run.batchProblems, []);
  equal(run.record.outcome, game.expect.outcome);
});

function loadGameFiles(gameRootPath: string): ClosingFiles {
  const files = new Map<string, Uint8Array>();
  for (const entry of readdirSync(gameRootPath, { recursive: true, encoding: "utf8" }).map((path) => path.split("\\").join("/")).sort()) {
    const fullPath = join(gameRootPath, entry);
    if (statSync(fullPath).isFile()) files.set(entry, new Uint8Array(readFileSync(fullPath)));
  }
  return files;
}

function titleSpan(bytes: Uint8Array): { readonly start: number; readonly end: number } {
  const reader = new BinaryReader(bytes);
  for (const result of [reader.header(), reader.i16(), reader.str(), reader.str()]) {
    if (!result.ok) throw new Error(`cannot locate gameTitle field: ${result.error.message}`);
  }
  const start = reader.offset;
  const title = reader.str();
  ok(title.ok, title.ok ? undefined : title.error.message);
  return { start, end: reader.offset };
}
