import { readFileSync } from "node:fs";
import { log } from "node:console";
import { assetKey } from "@tk-reawakened/core";
import { awaitMenu, bootUiRig } from "./battle-ui-rig.ts";
import { play } from "./battle-cues-engine-harness.ts";

const bkgPath = process.env["TKR_EDITOR_PROOF_BKG"];
const musicPath = process.env["TKR_EDITOR_PROOF_MUSIC"];
if (bkgPath === undefined || musicPath === undefined) throw new Error("Expected editor-saved BKG and music fixture paths");
const editorSavedBytes = new Uint8Array(readFileSync(bkgPath));
const editorMusic = new Uint8Array(readFileSync(musicPath));

const rig = bootUiRig({ background: "tbm" });
rig.files.set(assetKey("Bkrounds/meadow.bkg"), editorSavedBytes);
awaitMenu(rig);
rig.press("DOWN");
const frame = rig.frame();
const pixel = [...frame.rgba.slice((263 * frame.w + 320) * 4, (263 * frame.w + 320) * 4 + 3)];
const engineRun = play(80, false, false, false, editorSavedBytes, editorMusic, 2);

log(JSON.stringify({
  requestedImage: rig.requested.includes(assetKey("Bitmap/hero_rest.png")),
  pixel,
  menuCue: rig.cues.some((cue) => String(cue.asset) === assetKey("Media/cant.wav")),
  musicCue: engineRun.cues.some((cue) => cue.kind === "media.play" && cue.track === "music" && String(cue.asset) === assetKey("Media/editor-proof-theme.mid")),
}));
