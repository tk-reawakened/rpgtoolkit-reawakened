import { deepEqual, equal, ok } from "node:assert/strict";
import test from "node:test";
import { createEmptyBoard, utf8Decode, utf8Encode, writeBoard } from "@tk-reawakened/core";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { sha256Hex } from "../src/document-history.ts";
import { createSceneBuildOwnership, createSceneBuildOwnershipStorage, type SceneBuildCheck, type SceneBuildCheckResult, type SceneBuildOutput, type SceneBuildWriteResult } from "../src/scene-build-ownership.ts";
import { reviewTerrainSceneConflicts, type TerrainSceneConflictDialogs, type TerrainSceneRecoveryReview } from "../src/terrain-scene-conflicts.ts";
import { createDocumentWorkspace } from "../src/workspace.ts";

const scenePath = "Boards/town.tkrscn";
const boardPath = "Boards/town.brd";
const recoveryPath = "Boards/town.recovered.tkrscn";
const sceneBytes = utf8Encode("scene source");
const boardBytes = (() => {
  const written = writeBoard({
    ...createEmptyBoard(), sizeX: 1, sizeY: 1, sizeL: 1, layerTitles: ["", ""],
    tileMatrix: [0], tileRuns: [{ lutIndex: 0, count: 1, marker: false }],
    links: { north: "outside.brd", south: "", east: "", west: "" },
  });
  if (!written.ok) throw new Error(written.error.message);
  return written.value;
})();

async function bytesOf(host: MemoryPlatformServices, path: string): Promise<Uint8Array> {
  const file = await host.fs.read(path);
  if (!file.ok) throw new Error(`${path}: ${file.error.message}`);
  return file.value;
}
async function modifiedCheck(host: MemoryPlatformServices): Promise<SceneBuildCheck> {
  return {
    scene: scenePath,
    observations: [{
      path: boardPath, resolvedPath: boardPath, producer: scenePath,
      plannedHash: "b".repeat(64), currentHash: await sha256Hex(await bytesOf(host, boardPath)),
      recordHash: "c".repeat(64), record: null, pending: false, skipReason: null,
    }],
    conflicts: [{ path: boardPath, kind: "modified", message: `${boardPath}: modified build output; review before replacing or recreating it.` }],
  };
}
interface Ownership {
  check(scene: string, outputs: readonly SceneBuildOutput[]): Promise<SceneBuildCheckResult>;
  write(check: SceneBuildCheck, outputs: readonly SceneBuildOutput[], authorizedPaths?: readonly string[]): Promise<SceneBuildWriteResult>;
}
interface ReviewControl {
  readonly dialogs: TerrainSceneConflictDialogs;
  readonly reports: string[];
  readonly proposals: TerrainSceneRecoveryReview[];
  during: ((proposal: TerrainSceneRecoveryReview) => Promise<void>) | null;
}
function makeReview(approveRecovery: boolean, approveOutputs = false): ReviewControl {
  const control: ReviewControl = {
    reports: [],
    proposals: [],
    during: null,
    dialogs: {
      async reviewRecovery(proposal) {
        control.proposals.push(proposal);
        if (control.during !== null) await control.during(proposal);
        return approveRecovery;
      },
      async reviewOutputs() { return approveOutputs; },
      report(message) { control.reports.push(message); },
    },
  };
  return control;
}
function newHost(): MemoryPlatformServices {
  return createMemoryPlatformServices({ files: { [scenePath]: sceneBytes, [boardPath]: boardBytes } });
}

test("cancelling recovery writes nothing; approving writes a separate scene and preserves both originals", async () => {
  const host = newHost();
  const check = await modifiedCheck(host);

  const decline = makeReview(false);
  equal(await reviewTerrainSceneConflicts(host.fs, check, decline.dialogs), null);
  equal(decline.proposals.length, 1);
  equal(decline.proposals[0]?.path, recoveryPath);
  ok(decline.proposals[0]?.findings.some(({ field }) => field === "U6"));
  const noRecovery = await host.fs.read(recoveryPath);
  ok(!noRecovery.ok && noRecovery.error.code === "not-found");
  deepEqual(await bytesOf(host, boardPath), boardBytes);
  deepEqual(await bytesOf(host, scenePath), sceneBytes);

  const approve = makeReview(true);
  equal(await reviewTerrainSceneConflicts(host.fs, check, approve.dialogs), null);
  const recovered = utf8Decode(await bytesOf(host, recoveryPath));
  ok(recovered.includes("north: outside.brd"));
  deepEqual(await bytesOf(host, boardPath), boardBytes);
  deepEqual(await bytesOf(host, scenePath), sceneBytes);
});

test("two approved recovery reviews cannot write the same new file twice", async () => {
  const host = newHost();
  const check = await modifiedCheck(host);
  const reviews = [makeReview(true), makeReview(true)];
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => { release = resolve; });
  let ready = 0;
  let writes = 0;
  for (const review of reviews) review.during = async () => {
    if (++ready === 2) release();
    await bothReady;
  };
  const filesystem = { ...host.fs, write: (path: string, bytes: Uint8Array) => { writes += 1; return host.fs.write(path, bytes); } };
  await Promise.all(reviews.map(({ dialogs }) => reviewTerrainSceneConflicts(filesystem, check, dialogs)));
  equal(writes, 1);
  ok(reviews.every(({ proposals }) => proposals[0]?.path === recoveryPath));
  ok(reviews.flatMap(({ reports }) => reports).some((message) => message.includes("destination changed during review")));
  deepEqual(await bytesOf(host, boardPath), boardBytes);
  deepEqual(await bytesOf(host, scenePath), sceneBytes);
});

test("recovery refuses a board, scene, or destination changed during review", async () => {
  const host = newHost();
  const check = await modifiedCheck(host);

  const boardRace = makeReview(true);
  boardRace.during = async () => { ok((await host.fs.write(boardPath, utf8Encode("changed board"))).ok); };
  equal(await reviewTerrainSceneConflicts(host.fs, check, boardRace.dialogs), null);
  ok(boardRace.reports.some((message) => message.includes("changed during review")));
  ok(!(await host.fs.read(recoveryPath)).ok);
  deepEqual(await bytesOf(host, scenePath), sceneBytes);

  ok((await host.fs.write(boardPath, boardBytes)).ok);
  const sceneRace = makeReview(true);
  sceneRace.during = async () => { ok((await host.fs.write(scenePath, utf8Encode("changed scene"))).ok); };
  equal(await reviewTerrainSceneConflicts(host.fs, check, sceneRace.dialogs), null);
  ok(!(await host.fs.read(recoveryPath)).ok);
  deepEqual(await bytesOf(host, boardPath), boardBytes);

  ok((await host.fs.write(scenePath, sceneBytes)).ok);
  const collision = makeReview(true);
  collision.during = async (proposal) => { ok((await host.fs.write(proposal.path, utf8Encode("already here"))).ok); };
  equal(await reviewTerrainSceneConflicts(host.fs, check, collision.dialogs), null);
  equal(utf8Decode(await bytesOf(host, recoveryPath)), "already here");
  deepEqual(await bytesOf(host, boardPath), boardBytes);
  deepEqual(await bytesOf(host, scenePath), sceneBytes);
});

test("other destination conflicts need explicitly authorized reviewed paths and revalidated bytes", async () => {
  const outputPath = "Game/Town/Bitmap/.tkr-generated/town/item.png";
  const host = createMemoryPlatformServices({ files: { [outputPath]: utf8Encode("existing"), "Other/generated.png": utf8Encode("other") } });
  const workspace = createDocumentWorkspace({ projectId: "output-review", services: host });
  const ownership: Ownership = createSceneBuildOwnership({ fs: host.fs, storage: createSceneBuildOwnershipStorage(host.fs), history: workspace.history, projectId: "output-review" });
  const output = { path: outputPath, bytes: utf8Encode("planned") };
  const checked = await ownership.check(scenePath, [output]);
  ok(checked.ok);
  if (!checked.ok) return;
  equal(checked.check.conflicts.length, 1);

  equal(await reviewTerrainSceneConflicts(host.fs, checked.check, makeReview(false).dialogs), null);
  const paths = await reviewTerrainSceneConflicts(host.fs, checked.check, makeReview(false, true).dialogs);
  ok(paths);
  if (paths === null) return;
  deepEqual(paths, [outputPath]);

  const wrong = await ownership.write(checked.check, [output], ["Other/generated.png"]);
  ok(!wrong.ok);
  equal(utf8Decode(await bytesOf(host, outputPath)), "existing");

  ok((await host.fs.write(outputPath, utf8Encode("changed after review"))).ok);
  const stale = await ownership.write(checked.check, [output], paths);
  ok(!stale.ok);
  equal(utf8Decode(await bytesOf(host, outputPath)), "changed after review");

  const fresh = await ownership.check(scenePath, [output]);
  ok(fresh.ok);
  if (!fresh.ok) return;
  const freshPaths = await reviewTerrainSceneConflicts(host.fs, fresh.check, makeReview(false, true).dialogs);
  ok(freshPaths);
  if (freshPaths === null) return;
  const written = await ownership.write(fresh.check, [output], freshPaths);
  ok(written.ok, written.ok ? "" : written.message);
  equal(utf8Decode(await bytesOf(host, outputPath)), "planned");
});
