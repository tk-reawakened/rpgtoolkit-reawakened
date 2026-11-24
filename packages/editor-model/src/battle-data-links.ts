import { BinaryReader, readStatusEffect, type StatusEffect } from "@tk-reawakened/core";

/**
 * What a special move shows beside its status-effect link (story 13.10, T-57): the linked `.ste` file's own numbers in
 * words, read from its saved bytes. It reads and changes nothing; the status effect is edited in its own document, with
 * its own history (`docs/editor-features.md#special-move-status-effect-editors`). The words state what the stored
 * values are (`docs/spec/formats/battle-data.md#status-effect`) and make no claim about what a battle does with a status
 * whose rounds are below 1.
 */
export type LinkedStatusEffect =
  | { readonly ok: true; readonly name: string; readonly rounds: number; readonly effects: readonly string[]; readonly text: string }
  | { readonly ok: false; readonly message: string };

function effectsOf(status: StatusEffect): string[] {
  const effects: string[] = [];
  if (status.speedUp !== 0) effects.push("speeds up the fighter's charge");
  if (status.slowDown !== 0) effects.push("slows the fighter's charge");
  if (status.disable !== 0) effects.push("freezes the fighter's charge");
  if (status.hpEnabled !== 0 && status.hpPerRound !== 0) {
    effects.push(status.hpPerRound > 0 ? `removes ${status.hpPerRound} HP each round` : `restores ${-status.hpPerRound} HP each round`);
  }
  if (status.smpEnabled !== 0 && status.smpPerRound !== 0) {
    effects.push(status.smpPerRound > 0 ? `removes ${status.smpPerRound} SMP each round` : `restores ${-status.smpPerRound} SMP each round`);
  }
  if (status.runProgram !== 0 && status.program !== "") effects.push(`runs ${status.program} each round`);
  return effects;
}

/** Describe the status effect stored in `bytes`; a file that is not a status effect says so and names `path`. */
export function describeLinkedStatusEffect(bytes: Uint8Array, path: string): LinkedStatusEffect {
  const read = readStatusEffect(new BinaryReader(bytes, path));
  if (!read.ok) return { ok: false, message: `${path} is not a status effect this editor can read: ${read.error.message}` };
  const status = read.value;
  const effects = effectsOf(status);
  const name = status.name === "" ? "(unnamed)" : status.name;
  const rounds = `${status.rounds} round${status.rounds === 1 ? "" : "s"}`;
  return { ok: true, name, rounds: status.rounds, effects, text: `${name}: ${rounds}${effects.length === 0 ? "; no per-round effect is turned on" : `; ${effects.join("; ")}`}.` };
}
