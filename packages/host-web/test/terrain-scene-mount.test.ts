// The browser scene's mount seam (#3561): startup and a reactivation's refresh can overlap, and a superseded startup read
// must not leave the editor unmounted.
import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createTerrainSceneMount } from "../src/terrain-scene-mount.ts";

function deferred(): { promise: Promise<void>; resolve: (ok: boolean) => void } {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<void>((settle) => { resolve = (value: boolean) => { if (value) settle(); }; });
  return { promise, resolve };
}

void test("a refresh during a pending startup read mounts once, after the read that wins", async () => {
  const reads = [deferred(), deferred()];
  let started = 0;
  let mounts = 0;
  const lifecycle = createTerrainSceneMount(async () => {
    const index = started++;
    await reads[index]!.promise;
    return true;
  }, () => { mounts += 1; });
  const startup = lifecycle.start();
  const refresh = lifecycle.refresh();
  // The newer read (the refresh) finishes first and mounts; the superseded startup read must not mount again.
  reads[1]!.resolve(true);
  await refresh;
  equal(mounts, 1, "the refresh mounted the editor");
  equal(lifecycle.mounted, true);
  reads[0]!.resolve(true);
  await startup;
  equal(mounts, 1, "the superseded startup read does not mount a second time");
});

void test("a superseded startup read that finishes first mounts nothing, and the winning read still mounts", async () => {
  const reads = [deferred(), deferred()];
  let started = 0;
  let mounts = 0;
  const lifecycle = createTerrainSceneMount(async () => {
    const index = started++;
    await reads[index]!.promise;
    return true;
  }, () => { mounts += 1; });
  const startup = lifecycle.start();
  const refresh = lifecycle.refresh();
  reads[0]!.resolve(true);
  await startup;
  equal(mounts, 0, "the superseded read is not the one that mounts");
  reads[1]!.resolve(true);
  await refresh;
  equal(mounts, 1, "the winning read mounts");
});

void test("a failed read mounts nothing and a later refresh can still mount", async () => {
  let outcome = false;
  let mounts = 0;
  const lifecycle = createTerrainSceneMount(async () => outcome, () => { mounts += 1; });
  await lifecycle.start();
  equal(mounts, 0);
  equal(lifecycle.mounted, false);
  outcome = true;
  await lifecycle.refresh();
  equal(mounts, 1);
  ok(lifecycle.mounted);
});
