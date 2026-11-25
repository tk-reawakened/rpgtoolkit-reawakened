import { BinaryReader, readMainFile } from "@tk-reawakened/core";
import { mainSettingsOf, projectLayoutOfMain, referencePath, type CommandRegistry, type MainSettings, type ProjectLayout, type WorkbenchCommand } from "@tk-reawakened/editor-model";
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
  /** What the author should know about this play, such as a fallback from the project's own settings. Null when there is nothing to say. */
  readonly notice: string | null;
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
  const soundFont: AuditionOutcome<SoundFontChoice> = format.value === "midi" ? await readSoundFont(audition, main, layout) : { ok: true, value: NO_SOUNDFONT };
  if (!soundFont.ok) return soundFont;
  return { ok: true, value: { bytes: bytes.value, format: format.value, soundFont: soundFont.value.bytes, notice: soundFont.value.notice } };
}

/** The SoundFont a play uses, and the notice when the project's own one could not be read. */
interface SoundFontChoice {
  readonly bytes: Uint8Array | null;
  readonly notice: string | null;
}

const NO_SOUNDFONT: SoundFontChoice = { bytes: null, notice: null };

async function readSoundFont(audition: BoardAudition, main: string, layout: ProjectLayout): Promise<AuditionOutcome<SoundFontChoice>> {
  const settings = await readMainSettings(audition, main);
  if (!settings.ok) return settings;
  const soundFont = settings.value.defaultSoundFont;
  if (soundFont === null) return { ok: true, value: NO_SOUNDFONT };
  const bytes = await audition.fs.readProject(audition.projectId, referencePath(layout, "media", soundFont));
  // A configured SoundFont that cannot be read is not a refusal: the game plays its bundled bank, and the author is told.
  if (!bytes.ok) return { ok: true, value: { bytes: null, notice: `The project's default SoundFont "${soundFont}" could not be read, so the bundled bank plays instead.` } };
  return { ok: true, value: { bytes: bytes.value, notice: null } };
}

async function readMainSettings(audition: BoardAudition, main: string): Promise<AuditionOutcome<MainSettings>> {
  const bytes = await audition.fs.readProject(audition.projectId, main);
  if (!bytes.ok) return { ok: false, message: `Could not read the project's main file "${main}".` };
  const parsed = readMainFile(new BinaryReader(bytes.value, main));
  if (!parsed.ok) return { ok: false, message: `The project's main file "${main}" could not be parsed.` };
  return { ok: true, value: mainSettingsOf(parsed.value) };
}

/** What the audition shows: the note on the last failure or fallback, and whether playback loops. */
export interface AuditionSnapshot {
  readonly loop: boolean;
  readonly note: string | null;
}

/**
 * One board's background-music audition. The properties panel and the palette commands drive the same controls, so
 * they play, stop, and loop the same sound.
 */
export interface AuditionControls {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AuditionSnapshot;
  /** The reference the panel shows. A play loads the reference as it is when the play starts. */
  setReference(reference: string): void;
  setLoop(loop: boolean): void;
  play(): Promise<void>;
  stop(): void;
  /** Releases the board. Stops the sound only when this board started it, so another board's sound is left alone. */
  dispose(): void;
}

/** What a board view is given: its audition controls, and the palette commands that drive them. */
export interface AuditionPanel {
  readonly controls: AuditionControls;
  readonly commands: CommandRegistry;
}

/**
 * The plays and stops made on one host output. A play still loading or starting checks these counts, so it can tell
 * that a later play or a stop overtook it. `owner` is the controls that started the sound now playing.
 */
interface Transport {
  plays: number;
  stops: number;
  owner: AuditionControls | null;
}

const transports = new WeakMap<AudioOutputService, Transport>();

function transportOf(output: AudioOutputService): Transport {
  const existing = transports.get(output);
  if (existing !== undefined) return existing;
  const created: Transport = { plays: 0, stops: 0, owner: null };
  transports.set(output, created);
  return created;
}

/** Controls for one board's audition. The host output is shared by every board, so plays and stops are counted on it. */
export function createAuditionControls(audition: BoardAudition): AuditionControls {
  const transport = transportOf(audition.audioOutput);
  const listeners = new Set<() => void>();
  let reference = "";
  let disposed = false;
  let snapshot: AuditionSnapshot = { loop: false, note: null };
  const publish = (next: Partial<AuditionSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const controls: AuditionControls = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setReference(next) {
      reference = next;
    },
    setLoop: (loop) => publish({ loop }),
    async play() {
      if (disposed) return;
      transport.plays += 1;
      const play = transport.plays;
      const stops = transport.stops;
      publish({ note: null });
      const input = await loadAuditionInput(audition, reference);
      if (disposed || transport.plays !== play || transport.stops !== stops) return;
      if (!input.ok) {
        publish({ note: input.message });
        return;
      }
      publish({ note: input.value.notice });
      transport.owner = controls;
      const result = await audition.audioOutput.play(input.value.bytes, input.value.format, {
        loop: snapshot.loop,
        soundFont: input.value.soundFont,
      });
      if (transport.plays === play && transport.stops !== stops) {
        void audition.audioOutput.stop();
        return;
      }
      if (!result.ok && transport.plays === play) publish({ note: result.error.message });
    },
    stop() {
      transport.stops += 1;
      transport.owner = null;
      publish({ note: null });
      void audition.audioOutput.stop();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      if (transport.owner === controls) controls.stop();
    },
  };
  return controls;
}

/**
 * The palette's background-music commands. They act on the active board's audition and are disabled while no board is
 * active.
 */
export function createAuditionCommands(active: () => AuditionControls | null): readonly WorkbenchCommand[] {
  return [
    {
      id: "board.audition.play",
      category: "Run",
      label: "Play background music",
      get disabled() {
        return active() === null;
      },
      run: async () => {
        await active()?.play();
      },
    },
    {
      id: "board.audition.stop",
      category: "Run",
      label: "Stop background music",
      get disabled() {
        return active() === null;
      },
      run: () => {
        active()?.stop();
      },
    },
    {
      id: "board.audition.loop",
      category: "Run",
      label: "Toggle background music loop",
      get disabled() {
        return active() === null;
      },
      run: () => {
        const controls = active();
        if (controls !== null) controls.setLoop(!controls.getSnapshot().loop);
      },
    },
  ];
}
