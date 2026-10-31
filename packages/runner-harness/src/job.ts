import type { Engine } from "@tk-reawakened/core";
import { createNullAudio } from "./audio.ts";
import { createTestEngine } from "./double/test-engine.ts";
import { runLog } from "./driver.ts";
import { compareGolden, formatGolden, parseGolden, parseRun } from "./golden.ts";
import { checkVectors } from "./vectors.ts";
import { compareScriptsGolden, formatScriptsGolden, runAllCorpusPrograms } from "./corpus.ts";
import { checkSceneGolden, checkSceneGoldens, type SceneGoldenInput } from "./scene-golden.ts";
import { checkAudioGoldens, formatAudioGolden, type AudioGoldenRun } from "./audio-golden.ts";

export type GoldenTexts = {
  readonly vectors?: string | undefined;
  readonly run?: string | undefined;
  readonly golden?: string | undefined;
  readonly scriptsGolden?: string | null | undefined;
  readonly sceneGolden?: SceneGoldenInput | undefined;
  /** `null` means the ledger file is absent, which compare mode refuses; `[]` is a present, empty ledger. */
  readonly sceneGoldens?: readonly SceneGoldenInput[] | null | undefined;
  readonly audioGolden?: string | undefined;
  readonly audioRuns?: readonly AudioGoldenRun[] | undefined;
  readonly audioSynthetic?: AudioGoldenRun | undefined;
};

export type GoldenOutcome =
  | {
      readonly ok: true;
      readonly lines: string[];
      readonly golden?: string | undefined;
      readonly scriptsGolden?: string | undefined;
      readonly audioGolden?: string | undefined;
    }
  | { readonly ok: false; readonly lines: string[] };

export function goldenJob(
  texts: GoldenTexts,
  record?: boolean,
  engineFactory: () => Engine = createTestEngine,
): GoldenOutcome {
  const lines: string[] = [];

  try {
    // Stage 1: vectors
    if (texts.vectors === undefined) throw new Error("hash-vectors.json is absent");
    const { count } = checkVectors(texts.vectors);
    lines.push(`vectors: ${count} rows ok`);

    // Stage 2: run
    if (texts.run === undefined) throw new Error("run.json is absent");
    const run = parseRun(texts.run);
    if (run.log.length === 0) throw new Error("run.json: log is empty");
    lines.push(`run: ${run.ticks} ticks`);

    // Stage 3: batching
    const engine1 = engineFactory();
    const audio1 = createNullAudio();
    const records1 = runLog(engine1, parseRun(texts.run), 1, audio1);
    const engine3 = engineFactory();
    const audio3 = createNullAudio();
    const records3 = runLog(engine3, parseRun(texts.run), 3, audio3);
    const engineS = engineFactory();
    const audioS = createNullAudio();
    const recordsS = runLog(engineS, parseRun(texts.run), run.ticks, audioS);
    for (const r3 of records3) {
      const r1 = records1[r3.tick - 1];
      if (!r1 || r1.state !== r3.state || r1.draw !== r3.draw) throw new Error(`batching: tick ${r3.tick}: n=1 and n=3 mismatch`);
    }
    for (const rS of recordsS) {
      const r1 = records1[rS.tick - 1];
      if (!r1 || r1.state !== rS.state || r1.draw !== rS.draw) throw new Error(`batching: tick ${rS.tick}: n=1 and n=${run.ticks} mismatch`);
    }
    lines.push("batching: 1,3,S ok");

    // Stage 4: golden
    let formattedGolden: string | undefined;
    if (record) {
      formattedGolden = formatGolden(records1);
      lines.push(`golden: ${run.ticks} recorded`);
    } else {
      if (texts.golden === undefined) throw new Error("golden.json is absent");
      const golden = parseGolden(texts.golden);
      if (golden.records.length === 0) throw new Error("golden.json: records is empty");
      const cmp = compareGolden(records1, golden.records);
      if (!cmp.ok) throw new Error(cmp.message);
      lines.push(`golden: ${run.ticks} compared`);
    }

    // Stage 5: script corpus & snapshot restore
    let formattedScriptsGolden: string | undefined;
    if (texts.scriptsGolden !== undefined) {
      const results = runAllCorpusPrograms(0);
      if (record) {
        formattedScriptsGolden = formatScriptsGolden(results);
        lines.push(`scripts: ${results.length} programs ok (snapshot/restore verified)`);
      } else {
        if (!texts.scriptsGolden) throw new Error("golden/scripts/golden.json is absent");
        const cmpScripts = compareScriptsGolden(results, texts.scriptsGolden);
        if (!cmpScripts.ok) throw new Error(cmpScripts.message);
        lines.push(`scripts: ${results.length} programs ok (snapshot/restore verified)`);
      }
    }

    // Stage 6: replay every ledger scene through the real engine.
    if (texts.sceneGoldens === null) throw new Error("golden/ledger.json is absent");
    if (texts.sceneGoldens !== undefined) {
      const scenes = checkSceneGoldens(texts.sceneGoldens, texts.sceneGoldens[0]?.ledgerText ?? "");
      if (!scenes.ok) throw new Error(scenes.lines[scenes.lines.length - 1] ?? "scene-golden failed");
      lines.push(...scenes.lines.map((line) => `scene-golden: ${line}`));
    } else if (texts.sceneGolden !== undefined) {
      const scene = checkSceneGolden(texts.sceneGolden);
      if (!scene.ok) throw new Error(scene.message);
      lines.push(`scene-golden: ${scene.message}; draw=${scene.drawHash}; state=${scene.stateHash}`);
    }

    // Stage 7: fetched sample-game cue streams under the null-audio sink.
    let formattedAudioGolden: string | undefined;
    if (texts.audioGolden !== undefined || texts.audioRuns !== undefined || texts.audioSynthetic !== undefined) {
      if (texts.audioRuns === undefined || texts.audioSynthetic === undefined) throw new Error("audio golden runs are absent");
      if (record) {
        formattedAudioGolden = formatAudioGolden(texts.audioRuns, texts.audioSynthetic);
        lines.push(`audio-golden: ${texts.audioRuns.length} games and synthetic battle recorded`);
      } else {
        if (!texts.audioGolden) throw new Error("golden/audio/cues.json is absent");
        const audio = checkAudioGoldens(texts.audioRuns, texts.audioSynthetic, texts.audioGolden);
        if (!audio.ok) throw new Error(audio.lines[audio.lines.length - 1] ?? "audio golden failed");
        lines.push(...audio.lines.map((line) => `audio-golden: ${line}`));
      }
    }

    return {
      ok: true,
      lines,
      ...(formattedGolden !== undefined ? { golden: formattedGolden } : {}),
      ...(formattedScriptsGolden !== undefined ? { scriptsGolden: formattedScriptsGolden } : {}),
      ...(formattedAudioGolden !== undefined ? { audioGolden: formattedAudioGolden } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    lines.push(message);
    return { ok: false, lines };
  }
}
