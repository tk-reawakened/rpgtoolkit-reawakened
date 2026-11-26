// The actual stock battle provider consumes the bytes saved through the BKG editor, not an independently authored fixture.
import { spawnSync } from "node:child_process";
import { deepEqual, equal, ok } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createDocumentIdentity, openBattleBackgroundDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const engineProofRunner = resolve(repositoryRoot, "packages/core/test/editor-saved-bkg-engine-runner.ts");
const BKG = "Bkrounds/forest.bkg";
const example = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Game/Example/Bkrounds/forest.bkg", import.meta.url)));
const editorMusic = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 12, 0, 144, 60, 100, 96, 128, 60, 0, 0, 255, 47, 0]);

test("editor-saved BKG bytes drive the stock battle's authored picture, menu sound, and music", async () => {
  const host = createMemoryPlatformServices({ files: { [BKG]: example } });
  const opened = await openBattleBackgroundDocument(host.fs, createDocumentIdentity("memory-project", BKG));
  if (!opened.ok) throw new Error(JSON.stringify(opened.error));
  const document = opened.document;
  ok(document.apply({ type: "set-battle-background-text", field: "image", value: "hero_rest.png" }).ok);
  ok(document.apply({ type: "set-battle-background-text", field: "selectSound", value: "cant.wav" }).ok);
  ok(document.apply({ type: "set-battle-background-text", field: "music", value: "editor-proof-theme.mid" }).ok);
  ok((await document.save()).ok);
  const editorSavedBytes = host.bytesOf(BKG);
  if (editorSavedBytes === undefined) throw new Error("The BKG editor did not persist bytes");

  const proofDirectory = mkdtempSync(join(tmpdir(), "tkr-editor-saved-bkg-"));
  try {
    const bkgFixture = join(proofDirectory, "forest.bkg");
    const musicFixture = join(proofDirectory, "editor-proof-theme.mid");
    writeFileSync(bkgFixture, editorSavedBytes);
    writeFileSync(musicFixture, editorMusic);
    const engineProof = spawnSync(process.execPath, [engineProofRunner], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, TKR_EDITOR_PROOF_BKG: bkgFixture, TKR_EDITOR_PROOF_MUSIC: musicFixture },
    });
    if (engineProof.error !== undefined) throw engineProof.error;
    equal(engineProof.status, 0, engineProof.stderr || "The stock battle engine proof failed");
    const evidence = JSON.parse(engineProof.stdout) as {
      requestedImage: boolean;
      pixel: number[];
      menuCue: boolean;
      musicCue: boolean;
    };
    ok(evidence.requestedImage, "the stock battle requested the distinct image named by the editor-saved BKG");
    deepEqual(evidence.pixel, [60, 90, 220], "the displayed pixel is the editor-linked hero image");
    ok(evidence.menuCue, "the stock battle emitted the distinct menu cue named by the editor-saved BKG");
    ok(evidence.musicCue, "FightEnemy emitted the distinct music track from the editor-saved BKG through the real engine");
  } finally {
    rmSync(proofDirectory, { recursive: true, force: true });
  }
});

