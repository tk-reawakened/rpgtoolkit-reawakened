import { BinaryReader, readMainFile } from "@tk-reawakened/core";
import { audioContentOf, mainSettingsOf, referencePath, type CommandRegistry, type MainSettings, type ProjectLayout, type WorkbenchCommand } from "@tk-reawakened/editor-model";
import type { AudioOutputService, AuditionFormat, FileSystemService } from "@tk-reawakened/platform-services";

/**
 * A board's background music uses its resolved owner layout for Media. `main` is null for a loose board with no owning
 * Main; when present, it supplies only the configured SoundFont for MIDI.
 */
export interface BoardAudition {
  readonly audioOutput: AudioOutputService;
  readonly fs: Pick<FileSystemService, "readProject">;
  readonly projectId: string;
  readonly layout: ProjectLayout;
  readonly main: string | null;
}

export type AuditionOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/**
 * The audition format of a file, judged from its own first bytes and never from its name, as the game does
 * (`docs/spec/engine/audio-media.md#audio-format-policy`). Bytes that are neither a WAV nor a Standard MIDI File never
 * reach the host.
 */
export function auditionFormatOf(reference: string, bytes: Uint8Array): AuditionOutcome<AuditionFormat> {
  const format = audioContentOf(bytes);
  if (format !== null) return { ok: true, value: format };
  return { ok: false, message: `Audition plays WAV and MIDI files, judged by their contents. "${reference.trim()}" is neither: its first bytes are not a WAV or MIDI header.` };
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
 * Reads the audio file from the board owner's Media folder and decides its format from the bytes. A Main file is only
 * read for a MIDI audition's configured SoundFont; without one, playback uses the host's bundled bank. A refusal leaves
 * the reference as it was.
 */
export async function loadAuditionInput(audition: BoardAudition, reference: string, resolvedPath?: string): Promise<AuditionOutcome<AuditionInput>> {
  const name = resolvedPath === undefined ? reference.trim() : reference;
  if (name === "") return { ok: false, message: "Set a background music file first." };
  const layout = audition.layout;
  const bytes = await audition.fs.readProject(audition.projectId, resolvedPath ?? referencePath(layout, "media", name));
  if (!bytes.ok) return { ok: false, message: `Could not read "${name}" from the project's Media folder.` };
  const format = auditionFormatOf(name, bytes.value);
  if (!format.ok) return format;
  const soundFont: AuditionOutcome<SoundFontChoice> =
    format.value === "midi" && audition.main !== null
      ? await readSoundFont(audition, audition.main, layout)
      : { ok: true, value: NO_SOUNDFONT };
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
  /** Begin a per-view attempt before asynchronous reference resolution; Stop invalidates its returned token. */
  beginPlay(): number;
  isPlayCurrent(token: number): boolean;
  /** Publish a diagnostic only if the lookup that produced it is still current. */
  setNote(note: string | null, token?: number): void;
  /** The reference the panel shows. A play loads the reference as it is when the play starts. */
  setReference(reference: string, resolvedPath?: string): void;
  setLoop(loop: boolean): void;
  play(token?: number): Promise<void>;
  stop(): void;
  /** Releases the board. Stops the sound only when this board started it, so another board's sound is left alone. */
  dispose(): void;
}

/** What a board view is given: its audition controls, and the palette commands that drive them. */
export interface AuditionPanel {
  readonly controls: AuditionControls;
  readonly commands: CommandRegistry;
  /** Host routing hook invoked when this view receives focus or a pointer. */
  readonly onFocus?: () => void;
  /** Clear host routing when this view is removed. */
  readonly onDispose?: () => void;
}

/**
 * The plays and stops made on one host output. A play still loading or starting checks these counts, so it can tell
 * that a later play or a stop overtook it. `owner` is the controls that started the sound now playing.
 */
interface Transport {
  plays: number;
  stops: number;
  owner: AuditionControls | null;
  ownerPlay: number | null;
}

const transports = new WeakMap<AudioOutputService, Transport>();

function transportOf(output: AudioOutputService): Transport {
  const existing = transports.get(output);
  if (existing !== undefined) return existing;
  const created: Transport = { plays: 0, stops: 0, owner: null, ownerPlay: null };
  transports.set(output, created);
  return created;
}

/** Controls for one board's audition. The host output is shared by every board, so plays and stops are counted on it. */
export function createAuditionControls(audition: BoardAudition): AuditionControls {
  const transport = transportOf(audition.audioOutput);
  const listeners = new Set<() => void>();
  let reference = "";
  let resolvedPath: string | undefined;
  let disposed = false;
  let latestPlay: { readonly token: number; readonly play: number; readonly stops: number } | null = null;
  let playGeneration = 0;
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
    getSnapshot() {
      return snapshot;
    },
    beginPlay() {
      const token = ++playGeneration;
      const play = ++transport.plays;
      latestPlay = { token, play, stops: transport.stops };
      return token;
    },
    isPlayCurrent(token) {
      return !disposed && token === playGeneration && latestPlay?.token === token &&
        latestPlay.play === transport.plays && latestPlay.stops === transport.stops;
    },
    setNote(note, token) {
      if (token === undefined || controls.isPlayCurrent(token)) publish({ note });
    },
    setReference(next, path) {
      reference = next;
      resolvedPath = path;
    },
    setLoop: (loop) => publish({ loop }),
    async play(token) {
      const attempt = token ?? controls.beginPlay();
      const request = latestPlay;
      if (!controls.isPlayCurrent(attempt) || request?.token !== attempt) return;
      const { play, stops } = request;
      publish({ note: null });
      const input = await loadAuditionInput(audition, reference, resolvedPath);
      if (!controls.isPlayCurrent(attempt) || transport.plays !== play || transport.stops !== stops) return;
      if (!input.ok) {
        publish({ note: input.message });
        return;
      }
      publish({ note: input.value.notice });
      transport.owner = controls;
      transport.ownerPlay = play;
      const result = await audition.audioOutput.play(input.value.bytes, input.value.format, {
        loop: snapshot.loop,
        soundFont: input.value.soundFont,
      });
      if (transport.plays === play && transport.stops !== stops) {
        void audition.audioOutput.stop();
        return;
      }
      if (!controls.isPlayCurrent(attempt)) return;
      if (!result.ok && transport.plays === play) publish({ note: result.error.message });
    },
    stop() {
      const ownsPendingPlay = latestPlay !== null && latestPlay.token === playGeneration &&
        latestPlay.play === transport.plays;
      playGeneration += 1;
      const ownsPlayback = transport.owner === controls;
      if (ownsPlayback) {
        if (transport.ownerPlay === transport.plays) transport.stops += 1;
        transport.owner = null;
        transport.ownerPlay = null;
        void audition.audioOutput.stop();
      } else if (ownsPendingPlay) {
        transport.stops += 1;
      }
      publish({ note: null });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      if (transport.owner === controls) {
        if (transport.ownerPlay === transport.plays) controls.stop();
        else {
          // Do not advance the shared stop generation: a newer view may be loading its play through the same output.
          transport.owner = null;
          transport.ownerPlay = null;
          void audition.audioOutput.stop();
        }
      }
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
export type AuditionPathResolution = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };
export interface BattleBackgroundAuditionTarget {
  readonly controls: AuditionControls;
  readonly reference: (field: "music" | "selectSound" | "chooseSound" | "readySound" | "cantDoSound") => string;
  readonly resolvePath: (reference: string) => Promise<AuditionPathResolution>;
}

const BATTLE_BACKGROUND_CUES = [
  ["music", "battle music"],
  ["selectSound", "menu cursor sound"],
  ["chooseSound", "menu choice sound"],
  ["readySound", "fighter ready sound"],
  ["cantDoSound", "action unavailable sound"],
] as const;

/** Commands for the active fight-background document; each cue resolves against that document's owning Media folder. */
export function createBattleBackgroundAuditionCommands(active: () => BattleBackgroundAuditionTarget | null): readonly WorkbenchCommand[] {
  const playCommands: WorkbenchCommand[] = BATTLE_BACKGROUND_CUES.map(([field, label]) => ({
    id: `battle-background.audition.play.${field}`,
    category: "Run",
    label: `Play ${label}`,
    get disabled() {
      const target = active();
      return target === null || target.reference(field) === "";
    },
    run: async () => {
      const target = active();
      if (target === null) return;
      const reference = target.reference(field);
      if (reference === "") return;
      const attempt = target.controls.beginPlay();
      target.controls.setNote(null, attempt);
      let resolved: AuditionPathResolution;
      try {
        resolved = await target.resolvePath(reference);
      } catch (error) {
        target.controls.setNote(`Could not resolve "${reference}": ${error instanceof Error ? error.message : String(error)}`, attempt);
        return;
      }
      if (!target.controls.isPlayCurrent(attempt)) return;
      if (!resolved.ok) {
        target.controls.setNote(resolved.message, attempt);
        return;
      }
      target.controls.setReference(reference, resolved.path);
      await target.controls.play(attempt);
    },
  }));
  return [
    ...playCommands,
    {
      id: "battle-background.audition.stop",
      category: "Run",
      label: "Stop fight-background audition",
      get disabled() { return active() === null; },
      run: () => active()?.controls.stop(),
    },
    {
      id: "battle-background.audition.loop",
      category: "Run",
      label: "Toggle fight-background audition loop",
      get disabled() { return active() === null; },
      run: () => {
        const controls = active()?.controls;
        if (controls !== undefined) controls.setLoop(!controls.getSnapshot().loop);
      },
    },
  ];
}
