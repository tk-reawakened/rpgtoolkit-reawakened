import { BinaryReader, readMainFile } from "@tk-reawakened/core";
import { mainSettingsOf, projectLayoutOfMain, referencePath, type MainSettings, type ProjectLayout } from "@tk-reawakened/editor-model";
import type { AudioOutputService, AuditionFormat, FileSystemService } from "@tk-reawakened/platform-services";

/**
 * What a board view needs to audition its background music: the host's player, the project's files, and the main file
 * that names the project's type folders and default SoundFont. `main` is null when the host has no main file open.
 */
export interface BoardAudition {
  readonly audioOutput: AudioOutputService;
  readonly fs: Pick<FileSystemService, "readProject" | "list">;
  readonly projectId: string;
  readonly main: string | null;
}

export type AuditionOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** The audition format of a background-music reference, judged from its extension. Other formats never reach the host. */
export function auditionFormatOf(reference: string): AuditionOutcome<AuditionFormat> {
  const name = reference.trim().toLowerCase();
  if (name.endsWith(".wav")) return { ok: true, value: "wav" };
  if (name.endsWith(".mid") || name.endsWith(".midi")) return { ok: true, value: "midi" };
  return { ok: false, message: `Audition plays .wav, .mid and .midi files. "${reference.trim()}" is none of these.` };
}

export interface AuditionInput {
  readonly bytes: Uint8Array;
  readonly format: AuditionFormat;
  /** The SoundFont a MIDI file plays with. Null hands the choice to the host, which uses its bundled bank. */
  readonly soundFont: Uint8Array | null;
}

/**
 * Reads the bytes an audition plays. The file and any SoundFont come from the Media folder under the layout the main
 * file declares. A failure names the problem; nothing falls back silently.
 */
export async function loadAuditionInput(audition: BoardAudition, reference: string): Promise<AuditionOutcome<AuditionInput>> {
  const name = reference.trim();
  if (name === "") return { ok: false, message: "Set a background music file first." };
  const format = auditionFormatOf(name);
  if (!format.ok) return format;
  const main = audition.main;
  if (main === null) return { ok: false, message: "Set the project's main file to audition sound." };
  const layout = await projectLayoutOfMain(audition.fs, audition.projectId, main);
  const bytes = await audition.fs.readProject(audition.projectId, referencePath(layout, "media", name));
  if (!bytes.ok) return { ok: false, message: `Could not read "${name}" from the project's Media folder.` };
  const soundFont = format.value === "midi" ? await readSoundFont(audition, main, layout) : { ok: true as const, value: null };
  if (!soundFont.ok) return soundFont;
  return { ok: true, value: { bytes: bytes.value, format: format.value, soundFont: soundFont.value } };
}

async function readSoundFont(audition: BoardAudition, main: string, layout: ProjectLayout): Promise<AuditionOutcome<Uint8Array | null>> {
  const settings = await readMainSettings(audition, main);
  if (!settings.ok) return settings;
  const soundFont = settings.value.defaultSoundFont;
  if (soundFont === null) return { ok: true, value: null };
  const bytes = await audition.fs.readProject(audition.projectId, referencePath(layout, "media", soundFont));
  if (!bytes.ok) return { ok: false, message: `The project's default SoundFont "${soundFont}" could not be read.` };
  return { ok: true, value: bytes.value };
}

async function readMainSettings(audition: BoardAudition, main: string): Promise<AuditionOutcome<MainSettings>> {
  const bytes = await audition.fs.readProject(audition.projectId, main);
  if (!bytes.ok) return { ok: false, message: `Could not read the project's main file "${main}".` };
  const parsed = readMainFile(new BinaryReader(bytes.value, main));
  if (!parsed.ok) return { ok: false, message: `The project's main file "${main}" could not be parsed.` };
  return { ok: true, value: mainSettingsOf(parsed.value) };
}
