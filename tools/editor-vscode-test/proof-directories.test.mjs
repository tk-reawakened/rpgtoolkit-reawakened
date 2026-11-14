import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createProofDirectories } from "./proof-directories.mjs";

test("workspace setup removes its temporary directory when the fixture copy fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-setup-test-"));
  try {
    await assert.rejects(createProofDirectories(join(root, "missing.gam"), "example.gam", root), { code: "ENOENT" });
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("profile setup failure preserves its error and removes the workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "tkr-proof-setup-test-"));
  try {
    const game = join(root, "source.gam");
    await writeFile(game, "fixture");
    const failure = new Error("profile setup failed");
    await assert.rejects(createProofDirectories(game, "example.gam", root, async () => { throw failure; }), (error) => error === failure);
    assert.deepEqual(await readdir(root), ["source.gam"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the proof rejects case variants of the reserved sentinel name", async () => {
  await assert.rejects(
    promisify(execFile)(process.execPath, [fileURLToPath(new URL("./run.mjs", import.meta.url)), "--extension", "unused", "--workspace", "unused", "--game", "__TKR_SENTINEL.gam"]),
    (error) => error.stderr.includes("--game cannot use the reserved proof sentinel name"),
  );
});
