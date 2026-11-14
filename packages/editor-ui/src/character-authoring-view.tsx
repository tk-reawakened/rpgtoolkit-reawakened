import {
  classifyImageReference,
  spritePicturePreview,
  spriteProjectAssetPath,
  spriteTileBitmapPreviewFromAssets,
  spriteTileFrameFromReference,
  type AssetKind,
  type CharacterAuthoringFields,
  type PickOutcome,
  type SpriteCommand,
  type SpritePreviewFrame,
} from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited, FileSystemService } from "@tk-reawakened/platform-services";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SpriteViewDocument } from "./sprite-view.tsx";
import { useDocumentSnapshot } from "./use-document.ts";

const VARIABLES = [
  ["Experience", 0], ["Defence (DP)", 1], ["Fighting power (FP)", 2], ["Health (HP)", 3],
  ["Maximum health (max HP)", 4], ["Character name", 5], ["Special-move power (SMP)", 6],
  ["Maximum special-move power (max SMP)", 7], ["Level", 8],
] as const;
const STATS = [
  ["experience", "Experience"], ["hp", "Health (HP)"], ["maxHp", "Maximum health (max HP)"],
  ["dp", "Defence (DP)"], ["fp", "Fighting power (FP)"], ["smp", "Special-move power (SMP)"],
  ["maxSmp", "Maximum special-move power (max SMP)"], ["level", "Level"],
] as const;
const MOVE_FIELDS = [
  ["file", "Special-move file"], ["minExp", "Minimum experience"], ["minLevel", "Minimum level"],
  ["condVar", "Condition variable"], ["condValue", "Required variable value"],
] as const;
const INCREASES = [[0, "HP"], [1, "DP"], [2, "FP"], [3, "SMP"]] as const;
const ACCESSORY_SLOTS = Array.from({ length: 10 }, (_, index) => `Accessory ${index + 1}`);
const BODY_SLOTS = ["Head", "Neck", "Left hand", "Right hand", "Body", "Legs"] as const;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const INT16_MIN = -32_768;
const INT16_MAX = 32_767;
const INT8_MIN = -128;
const INT8_MAX = 127;

export interface CharacterAuthoringViewProps {
  readonly doc: SpriteViewDocument;
  readonly fs: Pick<FileSystemService, "readProject">;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly pickAsset?: (request: { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly field: string }) => Promise<PickOutcome>;
  readonly visit?: (path: string) => Promise<VisitOutcome>;
}

type TextField = "name" | "profilePicture" | "specialMoveCategory" | "levelUpProgram";
type Command = SpriteCommand;
type Move = CharacterAuthoringFields["specialMoves"][number];
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MoveField = (typeof MOVE_FIELDS)[number][0];
type CommandInput = Command | ((latest: CharacterAuthoringFields) => Command);
type Cleanup = readonly (readonly [string, string])[];
type Drafts = Readonly<Record<string, string>>;
type AssetPickRequest = { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly field: string };
type VisitOutcome = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };
type PendingDraft = { readonly generation: number; readonly count: number };


function paintFrame(canvas: HTMLCanvasElement | null, frame: SpritePreviewFrame | null): void {
  if (canvas === null || frame === null) return;
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (context !== null) context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
}

function ProfilePicturePreview({
  reference, fs, projectId,
}: {
  readonly reference: string;
  readonly fs: Pick<FileSystemService, "readProject">;
  readonly projectId: string;
}) {
  const [frame, setFrame] = useState<SpritePreviewFrame | null>(null);
  const [message, setMessage] = useState("Enter a picture or tile reference to preview it.");
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    setFrame(null);
    if (reference.trim() === "") {
      setMessage("Enter a picture or tile reference to preview it.");
      return () => { active = false; };
    }
    const value = reference.trim();
    const kind = classifyImageReference(value);
    const load = async (path: string): Promise<Uint8Array | null> => {
      const result = await fs.readProject(projectId, path);
      return result.ok ? result.value : null;
    };
    const readFrame = async (): Promise<SpritePreviewFrame | null> => {
      if (kind.kind === "picture") {
        const path = spriteProjectAssetPath("Bitmap", kind.path);
        const bytes = await load(path);
        return bytes === null ? null : spritePicturePreview(bytes, path);
      }
      if (kind.kind === "tile" || kind.kind === "singleTile" || value.toLowerCase().endsWith(".tan")) {
        return spriteTileFrameFromReference(value, load);
      }
      if (kind.kind === "tileBitmap") {
        const path = spriteProjectAssetPath("Bitmap", kind.path);
        const bytes = await load(path);
        return bytes === null ? null : spriteTileBitmapPreviewFromAssets(bytes, path, load);
      }
      return null;
    };
    void readFrame().then((preview) => {
      if (!active) return;
      setFrame(preview);
      setMessage(preview === null ? "No preview is available for this reference." : `${preview.width} × ${preview.height} profile picture preview.`);
    }).catch((error: unknown) => {
      if (active) setMessage(`Preview unavailable: ${error instanceof Error ? error.message : "project file could not be read"}`);
    });
    return () => { active = false; };
  }, [reference, fs, projectId]);
  useEffect(() => paintFrame(canvas.current, frame), [frame]);
  return <div class="tkr-character-picture-preview">
    {frame === null ? <p role="status">{message}</p> : <canvas ref={canvas} role="img" aria-label={`Profile picture: ${message}`} />}
    {frame !== null && <p role="status">{message}</p>}
  </div>;
}

function integerValue(raw: string, minimum: number, maximum: number): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

/** T-50/T-51/T-53/T-54 fields from `docs/spec/formats/character.md#layout`; shared graphics stay in SpriteView. */
export function CharacterAuthoringView({ doc, fs, capabilities: _capabilities, onEdited, pickAsset, visit }: CharacterAuthoringViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const character = snapshot.character;
  const [drafts, setDrafts] = useState<Drafts>({});
  const [feedback, setFeedback] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const draftVersions = useRef(new Map<string, number>());
  const mutationGeneration = useRef(0);
  const observedSnapshot = useRef(snapshot);
  const pendingDraftKeys = useRef(new Map<string, PendingDraft>());
  const disabled = snapshot.readOnly !== null || snapshot.conflict !== null || snapshot.saving;
  const projectId = doc.identity.projectId;
  const isDraftPending = (key: string): boolean => {
    const pending = pendingDraftKeys.current.get(key);
    return pending?.generation === mutationGeneration.current && pending.count > 0;
  };
  const hasPendingPrefix = (prefix: string): boolean => [...pendingDraftKeys.current].some(([key, pending]) =>
    key.startsWith(prefix) && pending.generation === mutationGeneration.current && pending.count > 0);

  useEffect(() => {
    observedSnapshot.current = doc.getSnapshot();
    return doc.subscribe(() => {
      const previous = observedSnapshot.current;
      const next = doc.getSnapshot();
      observedSnapshot.current = next;
      if (previous.conflict !== null && next.conflict === null && !next.dirty && next.edits.length === 0) {
        mutationGeneration.current += 1;
        pendingDraftKeys.current.clear();
        draftVersions.current.clear();
        setDrafts({});
        setFeedback("Character fields were reloaded from disk.");
      }
    });
  }, [doc]);

  const submit = (commandInput: CommandInput, clear: Cleanup = []): void => {
    const generation = mutationGeneration.current;
    for (const [key] of clear) {
      const pending = pendingDraftKeys.current.get(key);
      pendingDraftKeys.current.set(key, {
        generation,
        count: pending?.generation === generation ? pending.count + 1 : 1,
      });
    }
    setPendingCount((count) => count + 1);
    const apply = async (): Promise<void> => {
      try {
        if (generation !== mutationGeneration.current) return;
        if (doc.getSnapshot().conflict !== null) {
          setFeedback("Resolve the external-change conflict before applying character edits.");
          return;
        }
        let command: Command;
        if (typeof commandInput === "function") {
          const latest = doc.getSnapshot().character;
          if (latest === null) {
            setFeedback("The character fields are no longer available.");
            return;
          }
          command = commandInput(latest);
        } else {
          command = commandInput;
        }
        const result = await doc.apply(command);
        if (generation !== mutationGeneration.current) return;
        if (!result.ok) {
          setFeedback(result.rejection.message);
          return;
        }
        setFeedback("Character change recorded. Save the document to keep it.");
        onEdited({ document: doc.identity.key, editId: result.editId, label: "Edit character" });
        if (clear.length > 0) {
          setDrafts((current) => {
            const next = { ...current };
            for (const [key, submitted] of clear) if (next[key] === submitted) delete next[key];
            return next;
          });
        }
      } catch (error) {
        if (generation === mutationGeneration.current) setFeedback(error instanceof Error ? error.message : "The character change could not be applied.");
      } finally {
        for (const [key] of clear) {
          const pending = pendingDraftKeys.current.get(key);
          if (pending?.generation !== generation) continue;
          if (pending.count <= 1) pendingDraftKeys.current.delete(key);
          else pendingDraftKeys.current.set(key, { generation, count: pending.count - 1 });
        }
        setPendingCount((count) => Math.max(0, count - 1));
      }
    };
    queue.current = queue.current.then(apply, apply);
  };

  if (character === null) return <section class="tkr-character-authoring" aria-label="Character authoring"><p>This document has no character-only fields.</p></section>;

  const text = (key: string, value: string): string => drafts[key] ?? value;
  const editText = (key: string, value: string): void => {
    draftVersions.current.set(key, (draftVersions.current.get(key) ?? 0) + 1);
    setDrafts((current) => ({ ...current, [key]: value }));
  };
  const clearDrafts = (keys: readonly string[]): void => setDrafts((current) => keys.reduce(without, current));
  const requestAsset = async (key: string, request: AssetPickRequest): Promise<string | null> => {
    if (pickAsset === undefined) return null;
    const version = draftVersions.current.get(key) ?? 0;
    const generation = mutationGeneration.current;
    try {
      const outcome = await pickAsset(request);
      if (!outcome.chosen) return null;
      if (generation !== mutationGeneration.current) return null;
      if ((draftVersions.current.get(key) ?? 0) !== version) {
        setFeedback("A newer reference edit was kept; the picker selection was not applied.");
        return null;
      }
      editText(key, outcome.reference);
      return outcome.reference;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The asset picker could not complete.");
      return null;
    }
  };
  const applyTextValue = (field: TextField, key: string, value: string): void => {
    if (value.includes("\0")) { setFeedback("This text field cannot contain NUL."); return; }
    if (value === character[field] && !isDraftPending(key)) { setDrafts((current) => without(current, key)); return; }
    submit({ type: "set-character-text", field, value }, [[key, value]]);
  };
  const commitText = (field: TextField, key: string, value: string): void => {
    if (drafts[key] !== value) return;
    applyTextValue(field, key, value);
  };
  const pickProfileReference = async (kind: "bitmaps" | "tiles"): Promise<void> => {
    const reference = await requestAsset("profilePicture", {
      kind, extensions: kind === "bitmaps" ? [".bmp", ".png", ".jpg", ".gif", ".tbm"] : [".tan", ".gph"],
      field: kind === "bitmaps" ? "the character's profile picture" : "the character's profile tile",
    });
    if (reference !== null) applyTextValue("profilePicture", "profilePicture", reference);
  };
  const pickLevelUpProgram = async (): Promise<void> => {
    const reference = await requestAsset("levelUpProgram", {
      kind: "programs", extensions: [".prg"], field: "the level-up program",
    });
    if (reference !== null) applyTextValue("levelUpProgram", "levelUpProgram", reference);
  };
  const commitInteger = (raw: string, minimum: number, maximum: number, current: number, command: (value: number) => Command, key: string): void => {
    const value = integerValue(raw, minimum, maximum);
    if (value === null) {
      setFeedback(`Enter a whole number from ${minimum} to ${maximum}.`);
      return;
    }
    if (value === current && !isDraftPending(key)) {
      setDrafts((draft) => without(draft, key));
      return;
    }
    submit(command(value), [[key, raw]]);
  };
  const commitDiscrete = (key: string, value: number, command: Command): void => {
    const encoded = String(value);
    editText(key, encoded);
    submit(command, [[key, encoded]]);
  };
  const textInput = (label: string, key: string, value: string, field: TextField): JSX.Element => (
    <label>{label}<input aria-label={label} value={text(key, value)} disabled={disabled} onInput={(event) => editText(key, event.currentTarget.value)} onBlur={(event) => commitText(field, key, event.currentTarget.value)} /></label>
  );
  const numericInput = (label: string, key: string, value: number, minimum: number, maximum: number, command: (value: number) => Command): JSX.Element => (
    <label>{label}<input aria-label={label} type="number" step="1" min={minimum} max={maximum} value={text(key, String(value))} disabled={disabled} onInput={(event) => editText(key, event.currentTarget.value)} onBlur={(event) => commitInteger(event.currentTarget.value, minimum, maximum, value, command, key)} /></label>
  );

  return <section class="tkr-character-authoring" aria-label="Character authoring">
    <h2>Character</h2>
    <fieldset disabled={disabled}>
      <legend>Identity and script bindings</legend>
      {textInput("Character name", "name", character.name, "name")}
      {VARIABLES.map(([label, index]) => {
        const key = `variable:${index}`;
        const value = character.variableNames[index] ?? "";
        return <label key={index}>{`${label} variable`}<input aria-label={`${label} variable`} value={text(key, value)} onInput={(event) => editText(key, event.currentTarget.value)} onBlur={(event) => {
          const next = event.currentTarget.value;
          if (drafts[key] !== next) return;
          if (next === value && !isDraftPending(key)) { setDrafts((current) => without(current, key)); return; }
          if (next.includes("\0")) { setFeedback("Script variable names cannot contain NUL."); return; }
          submit({ type: "set-character-variable", index, value: next }, [[key, next]]);
        }} /></label>;
      })}
    </fieldset>

    <fieldset disabled={disabled}>
      <legend>Starting stats</legend>
      {STATS.map(([field, label]) => {
        const key = `stat:${field}`;
        const current = character.stats[field];
        const minimum = field === "experience" || field === "level" || field === "maxHp" || field === "maxSmp" ? 0 : INT32_MIN;
        return <label key={field}>{label}<input aria-label={label} type="number" step="1" min={minimum} max={INT32_MAX} value={text(key, String(current))} onInput={(event) => editText(key, event.currentTarget.value)} onBlur={(event) => {
          const raw = event.currentTarget.value;
          const parsed = integerValue(raw, minimum, INT32_MAX);
          if (parsed === null) { setFeedback(`Enter a whole number from ${minimum} to ${INT32_MAX}.`); return; }
          if (parsed !== current || isDraftPending(key)) submit({ type: "set-character-stat", field, value: parsed }, [[key, raw]]);
          else setDrafts((draft) => without(draft, key));
        }} /></label>;
      })}
    </fieldset>

    <fieldset disabled={disabled}>
      <legend>Profile picture</legend>
      {textInput("Profile picture reference", "profilePicture", character.profilePicture, "profilePicture")}
      <div role="group" aria-label="Profile picture asset pickers">
        <button type="button" aria-label="Choose profile bitmap…" disabled={disabled || pickAsset === undefined} onClick={() => { void pickProfileReference("bitmaps"); }}>Choose profile bitmap…</button>
        <button type="button" aria-label="Choose profile tile…" disabled={disabled || pickAsset === undefined} onClick={() => { void pickProfileReference("tiles"); }}>Choose profile tile…</button>
      </div>
      {pickAsset === undefined && <p>Asset picker unavailable here; enter a project reference above.</p>}
      <ProfilePicturePreview reference={text("profilePicture", character.profilePicture)} fs={fs} projectId={projectId} />
    </fieldset>

    <fieldset disabled={disabled}>
      <legend>Special moves</legend>
      {textInput("Special-move category", "specialMoveCategory", character.specialMoveCategory, "specialMoveCategory")}
      <label>Character has special moves
        <select aria-label="Character has special moves" value={text("movesEnabled", String(character.hasSpecialMoves))} onChange={(event) => {
          const value = Number(event.currentTarget.value);
          const current = Number(text("movesEnabled", String(character.hasSpecialMoves)));
          if (value !== current) commitDiscrete("movesEnabled", value, { type: "set-character-moves-enabled", value });
        }}>
          <option value="0">Yes</option><option value="1">No</option>
        </select>
      </label>
      <MoveEditor character={character} disabled={disabled} drafts={drafts} editText={editText} clearDrafts={clearDrafts} hasPendingPrefix={hasPendingPrefix} requestAsset={requestAsset} pickerAvailable={pickAsset !== undefined} {...(visit === undefined ? {} : { visit })} submit={submit} feedback={setFeedback} />
    </fieldset>

    <fieldset disabled={disabled}>
      <legend>Equipment slots</legend>
      {ACCESSORY_SLOTS.map((label, slot) => {
        const index = slot + 1;
        const key = `accessory:${index}`;
        const value = character.accessorySlots[index] ?? "";
        return <label key={index}>{`${label} slot name`}<input aria-label={`${label} slot name`} value={text(key, value)} onInput={(event) => editText(key, event.currentTarget.value)} onBlur={(event) => {
          const next = event.currentTarget.value;
          if (drafts[key] !== next) return;
          if (next === value && !isDraftPending(key)) { setDrafts((current) => without(current, key)); return; }
          if (next.includes("\0")) { setFeedback("Accessory slot names cannot contain NUL."); return; }
          submit({ type: "set-character-accessory", index, value: next }, [[key, next]]);
        }} /></label>;
      })}
      {BODY_SLOTS.map((label, slot) => {
        const index = slot + 1;
        const value = character.bodySlots[index] ?? 0;
        return <label key={index}><input type="checkbox" aria-label={`${label} body slot used`} checked={Number(text(`body:${index}`, String(value))) !== 0} onChange={(event) => {
          const next = event.currentTarget.checked ? 1 : 0;
          const current = Number(text(`body:${index}`, String(value)));
          if (next !== current) commitDiscrete(`body:${index}`, next, { type: "set-character-body-slot", index, value: next });
        }} />{`${label} body slot used`}</label>;
      })}
    </fieldset>

    <fieldset disabled={disabled}>
      <legend>Level progression</legend>
      {numericInput("Experience for first level-up", "growth:firstLevelExp", character.firstLevelExp, 0, snapshot.minor === 3 ? INT8_MAX : INT32_MAX, (value) => ({ type: "set-character-growth", field: "firstLevelExp", value }))}
      {numericInput("Experience increase per level", "growth:experienceIncrease", character.experienceIncrease, 0, INT16_MAX, (value) => ({ type: "set-character-growth", field: "experienceIncrease", value }))}
      {numericInput("Maximum level (0 disables progression)", "growth:maxLevel", character.maxLevel, 0, INT32_MAX, (value) => ({ type: "set-character-growth", field: "maxLevel", value }))}
      {INCREASES.map(([index, label]) => numericInput(`${label} increase per level`, `increase:${index}`, character.levelIncreases[index] ?? 0, 0, INT16_MAX, (value) => ({ type: "set-character-increase", index, value })))}
      {textInput("Level-up program", "levelUpProgram", character.levelUpProgram, "levelUpProgram")}
      <button type="button" aria-label="Choose level-up program" disabled={disabled || pickAsset === undefined} onClick={() => { void pickLevelUpProgram(); }}>Choose level-up program…</button>
      {visit !== undefined && <button type="button" aria-label="Open level-up program" disabled={disabled || character.levelUpProgram.trim() === ""} onClick={() => {
        void visit(projectAssetPath("Prg", character.levelUpProgram)).then((result) => setFeedback(result.ok ? `Opened ${result.path}.` : result.message)).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Could not open the level-up program."));
      }}>Open level-up program</button>}
      {visit === undefined && <p>Linked authoring is unavailable here.</p>}
      {pickAsset === undefined && <p>Asset picker unavailable here; enter the project program reference above.</p>}
      <label>Level-up type
        <select aria-label="Level-up type" value={text("growth:levelUpType", String(character.levelUpType))} onChange={(event) => {
          const value = Number(event.currentTarget.value);
          const current = Number(text("growth:levelUpType", String(character.levelUpType)));
          if (value !== current) commitDiscrete("growth:levelUpType", value, { type: "set-character-growth", field: "levelUpType", value });
        }}>
          <option value="0">Percent increase</option><option value="1">Fixed-point increase</option>
        </select>
      </label>
    </fieldset>

    <p role="status" aria-live="polite" aria-label="Character edit status">{feedback || (pendingCount > 0 ? "Applying character changes…" : "")}</p>
  </section>;
}

function MoveEditor({
  character, disabled, drafts, editText, clearDrafts, hasPendingPrefix, requestAsset, pickerAvailable, visit, submit, feedback,
}: {
  readonly character: CharacterAuthoringFields;
  readonly disabled: boolean;
  readonly drafts: Drafts;
  readonly editText: (key: string, value: string) => void;
  readonly clearDrafts: (keys: readonly string[]) => void;
  readonly hasPendingPrefix: (prefix: string) => boolean;
  readonly requestAsset: (key: string, request: AssetPickRequest) => Promise<string | null>;
  readonly pickerAvailable: boolean;
  readonly visit?: (path: string) => Promise<VisitOutcome>;
  readonly submit: (command: CommandInput, clear?: Cleanup) => void;
  readonly feedback: (message: string) => void;
}) {
  const [slot, setSlot] = useState(1);
  const current = character.specialMoves[slot] ?? EMPTY_MOVE;
  const slotKey = (field: MoveField): string => `move:${slot}:${field}`;
  const save = (): void => {
    const clear: Array<readonly [string, string]> = [];
    const patch: Partial<Mutable<Move>> = {};
    for (const [field] of MOVE_FIELDS) {
      const key = slotKey(field);
      const raw = drafts[key];
      if (raw === undefined) continue;
      clear.push([key, raw]);
      if (field === "file") patch.file = raw;
      else if (field === "condVar") patch.condVar = raw;
      else if (field === "condValue") patch.condValue = raw;
      else {
        const value = integerValue(raw, INT32_MIN, INT32_MAX);
        if (value === null) {
          feedback(`Special-move experience and level must be whole numbers from ${INT32_MIN} to ${INT32_MAX}.`);
          return;
        }
        if (field === "minExp") patch.minExp = value;
        else patch.minLevel = value;
      }
    }
    if (clear.length === 0) return;
    const pendingValue = { ...current, ...patch };
    if ([pendingValue.file, pendingValue.condVar, pendingValue.condValue].some((part) => part.includes("\0"))) {
      feedback("Special-move text fields cannot contain NUL.");
      return;
    }
    if (sameMove(pendingValue, current) && !hasPendingPrefix(`move:${slot}:`)) {
      clearDrafts(clear.map(([key]) => key));
      return;
    }
    submit((latest) => ({
      type: "set-character-move",
      index: slot,
      value: { ...(latest.specialMoves[slot] ?? EMPTY_MOVE), ...patch },
    }), clear);
  };
  return <div class="tkr-character-move-editor">
    <label>Special-move slot (1–200)
      <select aria-label="Special-move slot" value={String(slot)} disabled={disabled} onChange={(event) => setSlot(Number(event.currentTarget.value))}>
        {Array.from({ length: 200 }, (_, index) => index + 1).map((number) => <option value={String(number)} key={number}>{number}</option>)}
      </select>
    </label>
    {MOVE_FIELDS.map(([field, label]) => {
      const key = slotKey(field);
      const value = String(current[field]);
      const input = field === "minExp" || field === "minLevel"
        ? <input aria-label={label} type="number" step="1" value={drafts[key] ?? value} disabled={disabled} onInput={(event) => editText(key, event.currentTarget.value)} />
        : <input aria-label={label} type="text" value={drafts[key] ?? value} disabled={disabled} onInput={(event) => editText(key, event.currentTarget.value)} />;
      return <label key={field}>{label}{input}</label>;
    })}
    <div role="group" aria-label="Special-move reference actions">
      <button type="button" aria-label="Choose special-move file…" disabled={disabled || !pickerAvailable} onClick={() => { void requestAsset(slotKey("file"), { kind: "specialMoves", extensions: [".spc"], field: "the special-move file" }); }}>Choose special-move file…</button>
      {visit !== undefined && <button type="button" aria-label="Open special-move file" disabled={disabled || current.file.trim() === ""} onClick={() => {
        void visit(projectAssetPath("SpcMove", current.file)).then((result) => feedback(result.ok ? `Opened ${result.path}.` : result.message)).catch((error: unknown) => feedback(error instanceof Error ? error.message : "Could not open the special-move file."));
      }}>Open special-move file</button>}
      {visit === undefined && <p>Linked authoring is unavailable here.</p>}
      {!pickerAvailable && <p>Asset picker unavailable here; enter the special-move reference above.</p>}
    </div>
    <button type="button" aria-label={`Apply special-move slot ${slot}`} disabled={disabled} onClick={save}>Apply special-move slot {slot}</button>
  </div>;
}

const EMPTY_MOVE: Move = { file: "", minExp: 0, minLevel: 0, condVar: "", condValue: "" };

function sameMove(left: Move, right: Move): boolean {
  return left.file === right.file && left.minExp === right.minExp && left.minLevel === right.minLevel && left.condVar === right.condVar && left.condValue === right.condValue;
}
function projectAssetPath(folder: "Prg" | "SpcMove", reference: string): string {
  const normalized = reference.replace(/\\/g, "/").replace(new RegExp(`^${folder}/`, "i"), "");
  return `${folder}/${normalized}`;
}

function without(drafts: Drafts, key: string): Drafts {
  if (!(key in drafts)) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}
