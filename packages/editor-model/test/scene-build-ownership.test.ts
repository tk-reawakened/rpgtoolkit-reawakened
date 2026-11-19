import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { utf8Decode, utf8Encode } from "@tk-reawakened/core";
import { platformError, platformOk, type PlatformResult } from "@tk-reawakened/platform-services";
import { createSceneBuildOwnership, type SceneBuildOwnershipStorage, type SceneBuildRecord } from "../src/scene-build-ownership.ts";
import { sha256Hex } from "../src/document-history.ts";

const SCENE = "Boards/cottage.tkrscn";
const OUTPUT = "Boards/cottage.brd";
const location = { kind: "project-folder" as const, description: "test project history" };

function setup(initial: Record<string, Uint8Array> = {}) {
  const files = new Map(Object.entries(initial));
  const records = new Map<string, Uint8Array>();
  const pending = new Set<string>();
  const history: string[] = [];
  const failures = new Set<string>();
  const writes: string[] = [];
  const fs = {
    async read(path: string): Promise<PlatformResult<Uint8Array>> {
      const bytes = files.get(path);
      return bytes === undefined ? platformError("not-found", "missing") : platformOk(bytes.slice());
    },
    async write(path: string, bytes: Uint8Array): Promise<PlatformResult<void>> {
      if (failures.has(`file:${path}`)) return platformError("io-error", "file write failed");
      writes.push(path);
      files.set(path, bytes.slice());
      return platformOk(undefined);
    },
  };
  const storage: SceneBuildOwnershipStorage = {
    location,
    async readRecord(path) { return platformOk(records.get(path)?.slice() ?? null); },
    async isPending(path) { return platformOk(pending.has(path)); },
    async markPending(path) {
      if (failures.has(`pending:${path}`)) return platformError("io-error", "pending marker failed");
      pending.add(path);
      return platformOk(undefined);
    },
    async writeRecord(path, bytes) {
      if (failures.has(`record:${path}`)) return platformError("io-error", "record write failed");
      records.set(path, bytes.slice());
      return platformOk(undefined);
    },
    async clearPending(path) {
      if (failures.has(`clear:${path}`)) return platformError("io-error", "pending cleanup failed");
      pending.delete(path);
      return platformOk(undefined);
    },
  };
  const ownership = () => createSceneBuildOwnership({
    fs,
    storage,
    history: { async keep(path, bytes) { history.push(`${path}:${utf8Decode(bytes)}`); return { outcome: "held" as const }; } },
  });
  return { fs, files, records, pending, history, failures, storage, ownership, writes };
}

async function persistBaseline(records: Map<string, Uint8Array>, scene: string, path: string, bytes: Uint8Array): Promise<void> {
  const record: SceneBuildRecord = { version: 1, scene, output: path, sha256: await sha256Hex(bytes) };
  records.set(path, utf8Encode(JSON.stringify(record)));
}

test("durable ownership survives coordinator restart and matching baseline writes normally", async () => {
  const baseline = utf8Encode("first board");
  const state = setup({ [OUTPUT]: baseline });
  await persistBaseline(state.records, SCENE, OUTPUT, baseline);
  const check = await state.ownership().check(SCENE, [{ path: OUTPUT, bytes: utf8Encode("next board") }]);
  ok(check.ok);
  deepEqual(check.check.conflicts, []);
  const restarted = state.ownership();
  const again = await restarted.check(SCENE, [{ path: OUTPUT, bytes: utf8Encode("next board") }]);
  ok(again.ok);
  const saved = await restarted.write(again.check, [{ path: OUTPUT, bytes: utf8Encode("next board") }]);
  equal(saved.ok, true);
  equal(state.history.length, 1);
  equal(state.pending.size, 0);
  const next = await state.ownership().check(SCENE, [{ path: OUTPUT, bytes: utf8Encode("third board") }]);
  ok(next.ok);
  deepEqual(next.check.conflicts, []);
});

test("check reports unowned, changed, deleted, owner mismatch and pending outputs without writes", async () => {
  const state = setup({
    "Boards/unowned.brd": utf8Encode("unowned"),
    "Boards/changed.brd": utf8Encode("outside edit"),
  });
  await persistBaseline(state.records, SCENE, "Boards/changed.brd", utf8Encode("baseline"));
  await persistBaseline(state.records, SCENE, "Boards/deleted.brd", utf8Encode("gone"));
  await persistBaseline(state.records, "Boards/other.tkrscn", "Boards/wrong-owner.brd", utf8Encode("wrong owner"));
  await persistBaseline(state.records, SCENE, "Boards/pending.brd", utf8Encode("pending"));
  state.pending.add("Boards/pending.brd");
  const outputs = ["Boards/unowned.brd", "Boards/changed.brd", "Boards/deleted.brd", "Boards/wrong-owner.brd", "Boards/pending.brd"].map((path) => ({ path, bytes: utf8Encode(path === "Boards/pending.brd" ? "pending" : "new") }));
  const result = await state.ownership().check(SCENE, outputs);
  ok(result.ok);
  deepEqual(result.check.conflicts.map((item) => item.kind), ["unowned", "modified", "missing", "owner-mismatch", "untrusted"]);
  equal(result.check.observations[4]!.skipReason, null);
  equal(state.files.get("Boards/unowned.brd") !== undefined, true);
  equal(state.history.length, 0);
  equal(state.records.size, 4);
});

test("all outputs are checked before writes and conflict authorization is explicit", async () => {
  const state = setup({ "Boards/a.brd": utf8Encode("unowned a"), "Boards/b.brd": utf8Encode("unowned b") });
  const outputs = ["Boards/a.brd", "Boards/b.brd"].map((path) => ({ path, bytes: utf8Encode(`built ${path}`) }));
  const review = await state.ownership().check(SCENE, outputs);
  ok(review.ok);
  equal(review.check.conflicts.length, 2);
  const refused = await state.ownership().write(review.check, outputs);
  equal(refused.ok, false);
  equal(state.files.get("Boards/a.brd") && utf8Decode(state.files.get("Boards/a.brd")!), "unowned a");
  const authorized = await state.ownership().write(review.check, outputs, ["Boards/a.brd", "Boards/b.brd"]);
  equal(authorized.ok, true);
  deepEqual(authorized.outcomes.map((item) => item.status), ["written", "written"]);
  equal(state.records.size, 2);
  equal(state.pending.size, 0);
});

test("stale review and duplicate outputs cannot authorize a write", async () => {
  const state = setup({ [OUTPUT]: utf8Encode("unowned") });
  const output = { path: OUTPUT, bytes: utf8Encode("built") };
  const review = await state.ownership().check(SCENE, [output]);
  ok(review.ok);
  const changedPlan = await state.ownership().write(review.check, [{ ...output, bytes: utf8Encode("different reviewed output") }], [OUTPUT]);
  equal(changedPlan.ok, false);
  state.files.set(OUTPUT, utf8Encode("changed after review"));
  const result = await state.ownership().write(review.check, [output], [OUTPUT]);
  equal(result.ok, false);
  const duplicate = await state.ownership().check(SCENE, [output, { path: OUTPUT.toLowerCase(), bytes: output.bytes }]);
  equal(duplicate.ok, false);
});

test("all outputs enter history before writes; unchanged outputs skip history", async () => {
  const firstPath = "Boards/first.brd";
  const secondPath = "Boards/second.brd";
  const firstOld = utf8Encode("first old");
  const secondOld = utf8Encode("second old");
  const state = setup({ [firstPath]: firstOld, [secondPath]: secondOld });
  await persistBaseline(state.records, SCENE, firstPath, firstOld);
  await persistBaseline(state.records, SCENE, secondPath, secondOld);
  const outputs = [
    { path: firstPath, bytes: utf8Encode("first new") },
    { path: secondPath, bytes: utf8Encode("second new") },
  ];
  const review = await state.ownership().check(SCENE, outputs);
  ok(review.ok);
  const ownership = createSceneBuildOwnership({
    fs: {
      read: (path) => state.fs.read(path),
      async write(path, bytes) {
        equal(state.history.length, 2);
        return state.fs.write(path, bytes);
      },
    },
    storage: state.storage,
    history: { async keep(path, bytes) { state.history.push(`${path}:${utf8Decode(bytes)}`); return { outcome: "held" as const }; } },
  });
  const result = await ownership.write(review.check, outputs);
  equal(result.ok, true);
  deepEqual(state.history, [`${firstPath}:first old`, `${secondPath}:second old`]);
  const latest = await state.ownership().check(SCENE, outputs);
  ok(latest.ok);
  const noOpService = createSceneBuildOwnership({
    fs: state.fs,
    storage: state.storage,
    history: { async keep() { return { outcome: "uncovered" as const, reason: "size" as const }; } },
  });
  const noOp = await noOpService.write(latest.check, outputs);
  equal(noOp.ok, true);
  deepEqual(noOp.outcomes.map((item) => item.status), ["unchanged", "unchanged"]);
  equal(state.history.length, 2);
  equal(state.writes.length, 2);
  const changedOutputs = outputs.map((output) => ({ ...output, bytes: utf8Encode("replacement") }));
  const changedReview = await state.ownership().check(SCENE, changedOutputs);
  ok(changedReview.ok);
  const failing = createSceneBuildOwnership({
    fs: state.fs,
    storage: state.storage,
    history: { async keep() { throw new Error("history unavailable"); } },
  });
  const blocked = await failing.write(changedReview.check, changedOutputs);
  equal(blocked.ok, false);
  equal(utf8Decode(state.files.get(firstPath)!), "first new");
});
test("a shared identical build is reused without changing its ownership; divergent ownership conflicts", async () => {
  const sharedBytes = utf8Encode("shared tileset bytes");
  const sharedPath = "Tilesets/shared.tkt";
  const firstScene = "Boards/first.tkrscn";
  const secondScene = "Boards/second.tkrscn";
  const state = setup({ [sharedPath]: sharedBytes });
  await persistBaseline(state.records, firstScene, sharedPath, sharedBytes);
  const originalRecord = state.records.get(sharedPath)!.slice();
  const ownership = state.ownership();
  const identical = await ownership.check(secondScene, [{ path: sharedPath, bytes: sharedBytes }]);
  ok(identical.ok);
  deepEqual(identical.check.conflicts, []);
  const reused = await ownership.write(identical.check, [{ path: sharedPath, bytes: sharedBytes }]);
  equal(reused.ok, true);
  deepEqual(reused.outcomes.map((item) => item.status), ["shared"]);
  deepEqual(state.records.get(sharedPath), originalRecord);
  equal(state.writes.length, 0);
  equal(state.history.length, 0);

  const divergentBytes = utf8Encode("different generated tileset");
  const divergent = await ownership.check(secondScene, [{ path: sharedPath, bytes: divergentBytes }]);
  ok(divergent.ok);
  deepEqual(divergent.check.conflicts.map((item) => item.kind), ["owner-mismatch"]);
  const refused = await ownership.write(divergent.check, [{ path: sharedPath, bytes: divergentBytes }]);
  equal(refused.ok, false);
  equal(state.writes.length, 0);
});

test("destination changed during history capture is rechecked and left untouched", async () => {
  const oldBytes = utf8Encode("owned baseline");
  const externalEdit = utf8Encode("external edit after review");
  const state = setup({ [OUTPUT]: oldBytes });
  await persistBaseline(state.records, SCENE, OUTPUT, oldBytes);
  const output = { path: OUTPUT, bytes: utf8Encode("new build") };
  const review = await state.ownership().check(SCENE, [output]);
  ok(review.ok);
  const ownership = createSceneBuildOwnership({
    fs: state.fs,
    storage: state.storage,
    history: {
      async keep() {
        state.files.set(OUTPUT, externalEdit);
        return { outcome: "held" as const };
      },
    },
  });
  const result = await ownership.write(review.check, [output]);
  equal(result.ok, false);
  deepEqual(result.outcomes.map((item) => item.status), ["not-written"]);
  deepEqual(state.files.get(OUTPUT), externalEdit);
  equal(state.writes.length, 0);
});


test("file and ownership-record failures are reported and never trusted on next check", async () => {
  const state = setup();
  const outputs = ["Boards/file-fails.brd", "Boards/record-fails.brd"].map((path) => ({ path, bytes: utf8Encode("built") }));
  state.failures.add("file:Boards/file-fails.brd");
  state.failures.add("record:Boards/record-fails.brd");
  const review = await state.ownership().check(SCENE, outputs);
  ok(review.ok);
  const result = await state.ownership().write(review.check, outputs);
  equal(result.ok, false);
  deepEqual(result.outcomes.map((item) => item.status), ["file-failed", "record-failed"]);
  const followup = await state.ownership().check(SCENE, outputs);
  ok(followup.ok);
  deepEqual(followup.check.conflicts.map((item) => item.kind), ["untrusted", "untrusted"]);
  equal(state.records.has(outputs[0]!.path), false);
  equal(state.records.has(outputs[1]!.path), false);
});

