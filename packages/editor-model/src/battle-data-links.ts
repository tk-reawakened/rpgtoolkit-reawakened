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

/**
 * Why a reference a form holds cannot be looked up in the project, or `null` when it can (story 13.10). A stored
 * reference names a file inside one reserved folder (`docs/spec/formats/README.md#paths-inside-files`), so a `..` or `.`
 * segment, a leading separator or a drive letter escapes it: the form says so and sends no read, which a host may refuse
 * without answering.
 */
export function linkReferenceProblem(reference: string): string | null {
  const trimmed = reference.trim();
  if (trimmed === "") return null;
  const slashed = trimmed.split("\\").join("/");
  if (/^\/|^[A-Za-z]:/.test(slashed)) return "A reference is relative to its own folder and cannot start with a separator or a drive.";
  const segments = slashed.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return "A reference cannot step out of its folder with a \".\" or \"..\" segment.";
  if (segments.some((segment) => segment === "")) return "A reference cannot hold an empty folder name.";
  return null;
}

/**
 * The project-relative paths to try for `reference`, most faithful first (story 13.10). The game itself resolves a
 * stored reference by its folder, ignoring the extension the author left off and the case of the name, so the form tries
 * the spelling as written, then with the kind's own extension, then each of those ASCII-lowercased — the spelling every
 * legacy file is stored in. It never guesses outside the folder: `folder` is the reserved folder's project path.
 */
export function linkedFileCandidates(folder: string, reference: string, extensions: readonly string[]): readonly string[] {
  const base = folder.replace(/\/+$/, "");
  const inside = reference.trim().split("\\").join("/").replace(/^\/+/, "");
  // A reference that repeats the type folder (`StatusE\burn.ste`) names the same file as the bare name, so the folder
  // prefix is dropped before looking it up.
  const head = base.slice(base.lastIndexOf("/") + 1).toLowerCase();
  const bare = inside.split("/");
  // `StatusE` alone names `StatusE.ste`, not the folder: the prefix is only dropped when a file name follows it.
  const withoutFolder = bare.length > 1 && bare[0]?.toLowerCase() === head ? bare.slice(1).join("/") : inside;
  const typed = `${base}/${withoutFolder}`;
  const hasExtension = extensions.some((extension) => typed.toLowerCase().endsWith(extension));
  // The game appends the type's extension when the author left it off, so the completed path is tried first.
  // The runtime appends the type's extension when the author left it off, so an extensionless reference names the
  // completed file only; the extensionless spelling is never what the game loads.
  const complete = hasExtension || extensions.length === 0 ? [typed] : [`${typed}${extensions[0]}`];
  // The folder keeps its stored spelling (a project may hold `StatusE`), while the legacy file name is ASCII lower case.
  const lowerFile = (path: string): string => {
    const cut = path.lastIndexOf("/");
    return `${path.slice(0, cut + 1)}${path.slice(cut + 1).replace(/[A-Z]/g, (letter) => letter.toLowerCase())}`;
  };
  // ASCII folding only: the engine compares names ASCII-folded, so `CAFÉ.STE` must not be looked up as a different name.
  const foldAscii = (text: string): string => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return [...new Set([...complete, ...complete.map(lowerFile), ...complete.map(foldAscii)])];
}
