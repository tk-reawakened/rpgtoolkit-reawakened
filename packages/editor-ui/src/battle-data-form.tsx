import {
  createEditTracker,
  extensionOf,
  kindForPath,
  linkedFileCandidates,
  resolveDocumentPath,
  linkReferenceProblem,
  projectLayoutForDocumentPath,
  reservedFolder,
  type ProjectLayout,
  type AssetContent,
  type AssetKind,
  type DocumentSnapshot,
  type HeldFields,
  type LinkLookup,
  type PendingEdits,
  type PickOutcome,
} from "@tk-reawakened/editor-model";
import type { Capability, DocumentEdited, FileSystemService } from "@tk-reawakened/platform-services";
import type { ComponentChildren, JSX } from "preact";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { AssetRefreshContext } from "./asset-refresh.ts";
import type { ViewDocument } from "./mount.ts";
import { LineHistory, writtenText } from "./line-endings.ts";
import { useDocumentSnapshot } from "./use-document.ts";

/**
 * The pieces the special move and status effect forms share (story 13.10, T-57, T-58): the command runner that tells the
 * host an edit was accepted, the draft handling that keeps typing out of the document until a field is left, the
 * Save and conflict row, and a reference row with Choose, Open and a check that the linked file is in the project.
 * The documents own every rule about values; a refusal's own sentence is what the form shows.
 *
 * Typing is applied as it happens (#3385): each keystroke is sent to the document at once, continuing the field's
 * gesture (`ApplyOptions.coalesce`, one per focus of the field), so the document is unsaved from the first character and
 * every host's own Save All and close prompt see it, while Undo takes back the gesture as one step. Text that is not a
 * value yet is held in the document (`hold-field-text`): still an edit, still unsaved, and a save refuses with its
 * reason. The only view-side draft is the moment between a keystroke and its acknowledgement, which a host save waits
 * for through the pending-edit settlement.
 */

export interface BattleDataNavigation {
  readonly pickAsset?: (request: { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly content?: AssetContent; readonly field: string }) => Promise<PickOutcome>;
  /** Owning game layout, when a host knows it independently of this document's path. */
  readonly layout?: ProjectLayout;
  /** Open the project file at this project-relative path in its own editor, remembering the way back. Resolves with a message when it could not. */
  readonly open?: (path: string) => Promise<string | null>;
  /**
   * Whether this host can open the project file at `path` (a project-relative path, or a reference's text). A host
   * states what it can open; without it, a file is openable when a document kind is registered for its extension. A
   * link that cannot be opened shows no Open action, and keeps its picker and diagnostics.
   */
  readonly canOpen?: (path: string) => boolean;
}

export interface BattleDataFormProps<Snapshot extends DocumentSnapshot<Command>, Command> extends BattleDataNavigation {
  readonly doc: ViewDocument<Snapshot, Command>;
  readonly fs: Pick<FileSystemService, "readProject"> & Partial<Pick<FileSystemService, "list">>;
  readonly capabilities: ReadonlySet<Capability>;
  readonly pendingEdits: PendingEdits;
  readonly onEdited: (event: DocumentEdited) => void;
}

/** Identity is per input event, even when two drafts display the same text. */
interface FieldDraft { readonly text: string }
type FieldDrafts = Readonly<Record<string, FieldDraft>>;

interface PreparedEdit<Command> {
  readonly command: Command;
  accept?(): void;
}

/** What the rows need of a form: the shared snapshot surface, the command runner, field drafts and the Save row's state. */
export interface BattleDataFormBase<Command> {
  readonly snapshot: DocumentSnapshot<Command> & HeldFields;
  readonly drafts: FieldDrafts;
  readonly message: string | null;
  readonly resolving: boolean;
  readonly locked: boolean;
  /** True while the document is read-only or waits on a conflict: no field edits then. */
  readonly disabled: boolean;
  setMessage(message: string | null): void;
  setDraft(key: string, text: string): void;
  /** Drop one field's typed text, for a change that replaced it (a Choose). */
  dropDraft(key: string): void;
  /** Drop every draft, for an author who chooses not to apply a refused field. */
  discardDrafts(): void;
  /** Apply one command and tell the host; resolves true when the document accepted it. */
  run(command: Command): Promise<boolean>;
  save(): Promise<void>;
  resolve(choice: "keep-local" | "reload"): Promise<void>;
  commitText(key: string, prepare: () => PreparedEdit<Command>, live?: boolean): Promise<void>;
  commitNumber(key: string, text: string, build: (value: number) => Command, live?: boolean): Promise<void>;
  /** The field was left: the next keystroke in it starts a new undoable gesture. */
  endGesture(key: string): void;
  /**
   * The field was left with `text`: apply it unless the keystrokes already sent it (a change event without input events,
   * as a script or an older host sends), then end the gesture.
   */
  leave(key: string, text: string, commit: (text: string) => Promise<void>): void;
  /** Let a save apply this field's draft first, and take part in the host's pending-edit settlement. */
  registerField(key: string, submit: (text: string) => Promise<void>): () => void;
}

/** `BattleDataFormBase` with the kind's own snapshot, which the views read their fields from. */
export interface BattleDataForm<Snapshot extends DocumentSnapshot<Command> & HeldFields, Command> extends BattleDataFormBase<Command> {
  readonly snapshot: Snapshot;
}

const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Whole numbers only: a decimal point or an exponent would be rounded into a value the author did not type. */
const WHOLE_NUMBER = /^[+-]?\d+$/;
let nextFormScope = 0;

export function useBattleDataForm<Snapshot extends DocumentSnapshot<Command> & HeldFields, Command>(
  { doc, pendingEdits, capabilities, onEdited }: Pick<BattleDataFormProps<Snapshot, Command>, "doc" | "pendingEdits" | "capabilities" | "onEdited">,
  what: string,
  unchanged: (snapshot: Snapshot, command: Command) => boolean,
): BattleDataForm<Snapshot, Command> {
  const snapshot = useDocumentSnapshot(doc);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  const [drafts, setDrafts] = useState<FieldDrafts>({});
  const [message, setMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [locked, setLocked] = useState(false);
  // The draft map is kept ref-authoritative: a host save runs outside a render, so `busy()` must see a commit at once.
  const draftsRef = useRef<FieldDrafts>({});
  const publishDrafts = (next: FieldDrafts): void => {
    draftsRef.current = next;
    setDrafts(next);
  };
  const fields = useRef(new Map<string, (text: string) => Promise<void>>());
  const saved = `${what[0]!.toUpperCase()}${what.slice(1)} saved.`;

  const gestures = useRef(new Map<string, number>());
  const formScope = useRef<number | null>(null);
  if (formScope.current === null) formScope.current = ++nextFormScope;
  const coalesceKey = (key: string): string => `${formScope.current}:${key}#${gestures.current.get(key) ?? 0}`;
  const endGesture = (key: string): void => { gestures.current.set(key, (gestures.current.get(key) ?? 0) + 1); };
  /** The text each field last sent as a keystroke, so leaving it does not send the same text again as a second edit. */
  const typed = useRef(new Map<string, string>());
  const leave = (key: string, text: string, commit: (text: string) => Promise<void>): void => {
    if (!locked && typed.current.get(key) !== text) void commit(text);
    typed.current.delete(key);
    endGesture(key);
  };
  const enqueue = (prepare: () => PreparedEdit<Command>, coalesce?: string): Promise<boolean> =>
    attempt(prepare, coalesce).then((refusal) => refusal === null);
  /**
   * Apply one prepared edit in order; resolves `null` when accepted, else the refusal's sentence. `fallback` is applied in
   * the same turn of the queue when the edit is refused, so text held for a refused keystroke can never land after a newer
   * keystroke in the same field.
   */
  const attempt = (prepare: () => PreparedEdit<Command>, coalesce?: string, fallback?: (refusal: string) => Command): Promise<string | null> => {
    const finish = submitted.current.begin();
    const operation = queue.current.then(async () => {
      try {
        const { command, accept } = prepare();
        // Compare after prior edits have settled, not against the value that happened to be rendered on blur. A field that
        // holds text is never unchanged: typing its stored value back replaces that text.
        const latest = doc.getSnapshot();
        const field = (command as { readonly field?: unknown }).field;
        const holds = typeof field === "string" && latest.heldText[field] !== undefined;
        if (!holds && (command as { readonly type?: unknown }).type !== "hold-field-text" && unchanged(latest, command)) { accept?.(); return null; }
        let result = await doc.apply(command, coalesce === undefined ? undefined : { coalesce });
        if (!result.ok && result.rejection.unchanged !== true && result.rejection.reason === "invalid" && fallback !== undefined) {
          result = await doc.apply(fallback(result.rejection.message.replace(/\.$/, "")), coalesce === undefined ? undefined : { coalesce });
        }
        if (!result.ok) {
          if (result.rejection.unchanged === true) { accept?.(); return null; }
          setMessage(result.rejection.message);
          return result.rejection.message;
        }
        accept?.();
        // An amended edit is the one the host was already told about; telling it again would add a second undo entry.
        if (result.amended === true) { setMessage(null); return null; }
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? `Edit ${what}` });
        setMessage(null);
        return null;
      } catch (error) {
        setMessage(problem(error));
        return problem(error);
      } finally { finish(); }
    });
    queue.current = operation.then(() => undefined);
    return operation;
  };
  const run = (command: Command): Promise<boolean> => enqueue(() => ({ command }));
  /** Apply every field that still holds a draft, in form order. A field whose draft no longer differs commits nothing. */
  const flush = async (): Promise<void> => {
    for (const [key, submit] of [...fields.current]) {
      const draft = draftsRef.current[key];
      if (draft !== undefined) await submit(draft.text);
    }
  };
  // An explicit save applies the focused field first; autosave and a backup leave the gesture alone (ADR 0022 D11.2);
  // a revert drops text typed against the version being discarded, with the message that named it.
  useLayoutEffect(() => pendingEdits.register({
    busy: () => submitted.current.busy(),
    holdsDraft: () => Object.keys(draftsRef.current).length > 0,
    lock: setLocked,
    // Asked on every settlement: a field the file cannot store refuses the host's save with its reason, so a host save
    // cannot report success while that text is left behind.
    // Only an explicit save is refused, and only while a draft remains that the file could not store: a backup, a query
    // before a revert's question and the revert itself settle the accepted edits without judging the field.
    refusal: (reason) => {
      if (Object.keys(draftsRef.current).length === 0) return null;
      if (reason === "explicit") return "a field still holds text this file cannot store; correct it or discard it";
      // A host that cannot say whose save this is writes nothing while a field holds text, and the document stays unsaved.
      if (reason === "guard") return "a field still holds text that is not part of the document yet. Leave the field to apply it, or discard it";
      return null;
    },
    idle: async (reason) => {
      if (reason === "revert") {
        if (Object.keys(draftsRef.current).length > 0) { publishDrafts({}); setMessage(null); }
      } else if (reason === undefined || reason === "explicit") {
        await flush();
      }
      await submitted.current.idle(reason);
    },
  }), [pendingEdits]);
  const save = async (): Promise<void> => {
    try {
      // Every view of this document takes part, not only this one: the shared registry applies each view's fields and
      // refuses the save, writing nothing, when any of them holds text the file cannot store. Nothing is awaited between
      // its answer and the write, so no text can be typed in between.
      const outcome = await pendingEdits.settle("explicit");
      if (!outcome.ok) {
        setMessage(`Nothing was saved: ${outcome.message}.`);
        return;
      }
      const result = await doc.save();
      setMessage(result.ok ? saved : result.failure.message);
    } catch (error) { setMessage(problem(error)); }
  };
  const resolve = async (choice: "keep-local" | "reload"): Promise<void> => {
    setResolving(true);
    try {
      if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        // Text the document holds would refuse the save after the choice was consumed: refuse first, keeping both versions.
        const held = Object.keys(doc.getSnapshot().heldText);
        if (held.length > 0) { setMessage(`Nothing was saved and the conflict is kept: ${held.join(", ")} holds text that is not a value yet.`); return; }
        // Check the fields before the choice is consumed: a refusal afterwards would leave the other version adopted as the
        // baseline, the conflict gone and nothing written. A refused choice keeps the conflict and both versions.
        const outcome = await pendingEdits.settle("explicit");
        if (!outcome.ok) { setMessage(`Nothing was saved and the conflict is kept: ${outcome.message}.`); return; }
      }
      const result = await doc.resolveConflict(choice);
      if (!result.ok) setMessage(result.message);
      else if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        // "Save my version" is a save like any other: it goes through the same guard, so a field holding text is applied or
        // refused with its reason instead of the file being replaced around it.
        await save();
      } else {
        if (choice === "reload") await pendingEdits.settle("revert");
        setMessage(null);
      }
    } catch (error) { setMessage(problem(error)); }
    finally { setResolving(false); }
  };
  const setDraft = (key: string, text: string): void => publishDrafts({ ...draftsRef.current, [key]: { text } });
  /**
   * Throw away the text refused fields hold, so the file's values show and saving can finish. Text the document holds is
   * discarded by an edit of its own, so Undo can bring it back.
   */
  const discardDrafts = (): void => {
    publishDrafts({});
    setMessage(null);
    for (const field of Object.keys(doc.getSnapshot().heldText)) {
      void enqueue(() => ({ command: ({ type: "hold-field-text", field, text: null, message: "" }) as unknown as Command }));
    }
  };
  const dropDraft = (key: string): void => {
    if (draftsRef.current[key] === undefined) return;
    const next = { ...draftsRef.current };
    delete next[key];
    publishDrafts(next);
  };
  const clearDraft = (key: string, draft: FieldDraft | undefined): void => {
    if (draft !== undefined && draftsRef.current[key] === draft) dropDraft(key);
  };
  const hold = (key: string, text: string, message: string): Command =>
    ({ type: "hold-field-text", field: key, text, message }) as unknown as Command;
  /**
   * Apply a text field's value. `live` is a keystroke: it continues the field's gesture. A value the document refuses
   * (a character the file cannot store) is held in the document with the refusal's sentence instead of being lost.
   */
  const commitText = async (key: string, prepare: () => PreparedEdit<Command>, live = false): Promise<void> => {
    const draft = draftsRef.current[key];
    const coalesce = live ? coalesceKey(key) : undefined;
    if (live && draft !== undefined) typed.current.set(key, draft.text);
    const refused = await attempt(prepare, coalesce, draft === undefined ? undefined : (refusal) => hold(key, draft.text, refusal));
    if (refused === null) clearDraft(key, draft);
  };
  /** Apply a number field's value; text that is not a whole number the field can store is held in the document with its reason. */
  const commitNumber = async (key: string, text: string, build: (value: number) => Command, live = false): Promise<void> => {
    const draft = draftsRef.current[key];
    const coalesce = live ? coalesceKey(key) : undefined;
    if (live) typed.current.set(key, text);
    const trimmed = text.trim();
    const reason = trimmed === "" ? "enter a whole number"
      : !WHOLE_NUMBER.test(trimmed) ? "enter a whole number: a decimal point or an exponent would be rounded into a value you did not type"
      : null;
    let accepted: boolean;
    if (reason === null) {
      // Out of range: the document's own sentence says why, and the text is held with it.
      accepted = await attempt(() => ({ command: build(Number(trimmed)) }), coalesce, (refusal) => hold(key, text, refusal)) === null;
    } else {
      accepted = await enqueue(() => ({ command: hold(key, text, reason) }), coalesce);
    }
    if (accepted) clearDraft(key, draft);
  };
  const registerField = (key: string, submit: (text: string) => Promise<void>): (() => void) => {
    fields.current.set(key, submit);
    return () => { if (fields.current.get(key) === submit) fields.current.delete(key); };
  };
  return {
    snapshot, drafts, message, locked, resolving, setMessage, setDraft, dropDraft, discardDrafts, run, save, resolve,
    commitText, commitNumber, registerField, endGesture, leave,
    disabled: snapshot.readOnly !== null || snapshot.conflict !== null || resolving,
  };
}

/** The Save button, the read-only reason, a conflict with its choices, and the last message. */
export function SaveBar<Command>({ form, capabilities }: {
  readonly form: BattleDataFormBase<Command>;
  readonly capabilities: ReadonlySet<Capability>;
}): JSX.Element {
  const { snapshot, save, resolve, resolving, message } = form;
  return <>
    <p>
      <button type="button" data-editor-save="true" disabled={form.disabled || form.locked || snapshot.saving} onClick={() => void save()}>Save</button>
      {snapshot.dirty ? " Unsaved changes." : ""}
    </p>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <section role="alert">
      <p>{snapshot.conflict.message} Nothing was saved.</p>
      <button type="button" disabled={resolving || snapshot.readOnly !== null} onClick={() => void resolve("keep-local")}>{capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null && <button type="button" disabled={resolving} onClick={() => void resolve("reload")}>Use the version on disk</button>}
    </section>}
    {message !== null && (snapshot.conflict === null || !message.startsWith(snapshot.conflict.message)) && <p role="alert">{message}{Object.keys(form.drafts).length > 0 && Object.keys(snapshot.heldText).length === 0
      ? <> <button type="button" onClick={() => form.discardDrafts()}>Discard the unapplied text</button></>
      : null}</p>}
    {Object.keys(snapshot.heldText).length > 0 && <p>
      Some fields hold text that is not a value yet, so this file cannot be saved until it is corrected or discarded.
      {" "}<button type="button" disabled={form.disabled} onClick={() => form.discardDrafts()}>Discard the unapplied text</button>
    </p>}
  </>;
}

/** What a field shows: its in-flight keystroke, else text the document holds for it, else the stored value. */
function shown<Command>(form: BattleDataFormBase<Command>, id: string, value: string): string {
  return form.drafts[id]?.text ?? form.snapshot.heldText[id]?.text ?? value;
}

/** Why a field's text is not a value yet; the document holds it, so it is unsaved and a save refuses with this reason. */
function HeldNote<Command>({ form, id }: { readonly form: BattleDataFormBase<Command>; readonly id: string }): JSX.Element | null {
  const held = form.snapshot.heldText[id];
  return held === undefined ? null : <small role="alert"> Not saved yet: {held.message}.</small>;
}

/** A one-line field, registered so a save applies its draft first. */
export function TextRow<Command>({ form, id, label, value, hint, command }: {
  readonly form: BattleDataFormBase<Command>;
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly command: (value: string) => Command;
}): JSX.Element {
  const { setDraft, commitText, registerField, disabled, snapshot } = form;
  const commit = (text: string, live = false): Promise<void> => commitText(id, () => ({ command: command(text) }), live);
  // Registered during render, not in an effect: the map is a ref, so this neither loops nor lags a render behind.
  registerField(id, commit);
  return <p>
    <label>{label}
      <input type="text" aria-label={label} value={shown(form, id, value)} disabled={disabled || snapshot.saving} readOnly={form.locked} onInput={(event) => { setDraft(id, event.currentTarget.value); if (!form.locked) void commit(event.currentTarget.value, true); }} onChange={(event) => form.leave(id, event.currentTarget.value, commit)} onBlur={() => form.endGesture(id)} />
    </label>
    {hint !== undefined && <small> {hint}</small>}
    <HeldNote form={form} id={id} />
  </p>;
}

/**
 * A multi-line field. A stored description may hold CR and LF, which an `input` cannot: it is a `textarea`, shown with
 * LF, and a commit writes the line endings the stored text uses, so editing a Windows-line-ending description keeps
 * them instead of silently stripping every CR (story 13.10 follow-up).
 */
export function LinesRow<Command>({ form, id, label, value, hint, command }: {
  readonly form: BattleDataFormBase<Command>;
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly command: (value: string) => Command;
}): JSX.Element {
  const { drafts, setDraft, commitText, registerField, disabled, snapshot } = form;
  // Each line keeps the ending the stored text used, so a description with mixed endings is not rewritten into one
  // convention. The model follows every edit (with its caret) so a repeated line is placed where the author edited it.
  const model = useRef<{
    base: string;
    history: LineHistory;
    accepted: LineHistory["line"];
    generation: number;
  } | null>(null);
  const current = model.current;
  if (current === null || (drafts[id] === undefined && (current.base !== value || current.accepted !== current.history.line))) {
    if (current !== null && writtenText(current.history.line) === value) {
      // A blur (or Save) accepted this textarea's bytes. Its native Undo stack still exists, so keep its separators too.
      current.base = value;
      current.accepted = current.history.line;
    } else {
      // Another view, document Undo, or discard replaced the text. Reset both histories to the same version.
      const history = new LineHistory(value);
      model.current = { base: value, history, accepted: history.line, generation: current === null ? 0 : current.generation + 1 };
    }
  }
  const commit = (text: string, live = false): Promise<void> => {
    const { history } = model.current!;
    history.follow(text);
    const staged = history.stage();
    return commitText(id, () => {
      const prepared = staged.prepare();
      return { command: command(prepared.text), accept: prepared.accept };
    }, live).finally(staged.release);
  };
  registerField(id, commit);
  return <p>
    <label>{label}
      <textarea key={model.current!.generation} aria-label={label} rows={3} value={drafts[id]?.text ?? model.current!.history.line.text} disabled={disabled || snapshot.saving} readOnly={form.locked} onInput={(event) => {
        const inputType = (event as InputEvent).inputType;
        const direction = inputType === "historyUndo" ? "undo" : inputType === "historyRedo" ? "redo" : undefined;
        const current = model.current!;
        current.history.follow(event.currentTarget.value, event.currentTarget.selectionStart, direction);
        setDraft(id, event.currentTarget.value);
        if (!form.locked) void commit(event.currentTarget.value, true);
      }} onChange={(event) => form.leave(id, event.currentTarget.value, commit)} onBlur={() => form.endGesture(id)} />
    </label>
    {hint !== undefined && <small> {hint}</small>}
    <HeldNote form={form} id={id} />
  </p>;
}

export function NumberRow<Command>({ form, id, label, value, hint, command }: {
  readonly form: BattleDataFormBase<Command>;
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly hint?: string;
  readonly command: (value: number) => Command;
}): JSX.Element {
  const { setDraft, commitNumber, registerField, disabled, snapshot } = form;
  const commit = (text: string, live = false): Promise<void> => commitNumber(id, text, command, live);
  registerField(id, commit);
  // A text input, not `type="number"`: a number input reports "" for `-` or `1e`, and that text is what the document holds.
  return <p>
    <label>{label}
      <input type="text" inputMode="numeric" aria-label={label} value={shown(form, id, String(value))} disabled={disabled || snapshot.saving} readOnly={form.locked} onInput={(event) => { setDraft(id, event.currentTarget.value); if (!form.locked) void commit(event.currentTarget.value, true); }} onChange={(event) => form.leave(id, event.currentTarget.value, commit)} onBlur={() => form.endGesture(id)} />
    </label>
    {hint !== undefined && <small> {hint}</small>}
    <HeldNote form={form} id={id} />
  </p>;
}

export function FlagRow<Command>({ form, label, checked, hint, command }: {
  readonly form: BattleDataFormBase<Command>;
  readonly label: string;
  readonly checked: boolean;
  readonly hint?: string;
  readonly command: (checked: boolean) => Command;
}): JSX.Element {
  const { run, disabled, snapshot } = form;
  return <p>
    <label>
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled || form.locked || snapshot.saving} onChange={(event) => {
        const box = event.currentTarget;
        void run(command(box.checked)).then((accepted) => { if (!accepted) box.checked = checked; });
      }} />
      {" "}{label}
    </label>
    {hint !== undefined && <small> {hint}</small>}
  </p>;
}

export type LinkedFile =
  | { readonly state: "none" }
  | { readonly state: "checking" }
  | { readonly state: "found"; readonly bytes: Uint8Array; readonly path: string }
  | { readonly state: "missing"; readonly path: string; readonly message: string }
  | { readonly state: "invalid"; readonly message: string }
  | { readonly state: "collision"; readonly message: string };

/**
 * Read the saved file a reference names, the way the game resolves it: its folder, the extension the author may have left
 * off, and ASCII case (story 13.10 follow-up). A reference that would leave its folder is a diagnostic, never a read: a
 * host can refuse such a path without answering, which would leave the form waiting forever. Read again whenever the
 * reference or the saved assets change.
 */
export function useLinkedFile(
  fs: Pick<FileSystemService, "readProject"> & Partial<Pick<FileSystemService, "list">>,
  projectId: string,
  documentPath: string,
  kind: AssetKind,
  reference: string,
  extensions: readonly string[],
  /** Whether the runtime itself appends the extension when the author left it off; false loads the exact reference. */
  lookup: LinkLookup,
  layout?: ProjectLayout,
): LinkedFile {
  const assetRevision = useContext(AssetRefreshContext);
  // A caller writes its extension list inline, so the effect keys on the list's content: a new array of the same
  // extensions must not start the read again on every render.
  const extensionKey = `${extensions.join(",")}|${lookup}`;
  const linkedKey = JSON.stringify([projectId, documentPath, kind, reference, extensionKey, lookup, layout?.projectFolder, assetRevision]);
  const [entry, setEntry] = useState<{ readonly key: string; readonly value: LinkedFile }>({ key: linkedKey, value: { state: "none" } });
  useEffect(() => {
    let active = true;
    const publish = (value: LinkedFile): void => setEntry({ key: linkedKey, value });
    const wanted = extensions.join(",") === "" ? [] : extensions.join(",").split(",");
    // Looked up as the game does: a status effect trims its text, a program or animation is exact, so text that only
    // differs by a space is another program. The stored text itself is never changed.
    const named = lookup === "status-effect" ? reference.trim() : reference;
    if (named === "") {
      publish({ state: "none" });
      return () => { active = false; };
    }
    const refused = linkReferenceProblem(named);
    if (refused !== null) {
      publish({ state: "invalid", message: refused });
      return () => { active = false; };
    }
    const folder = reservedFolder(layout ?? projectLayoutForDocumentPath(documentPath), kind);
    publish({ state: "checking" });
    void (async () => {
      let missing: { readonly path: string; readonly message: string } | null = null;
      for (const candidate of linkedFileCandidates(folder, reference, wanted, lookup)) {
        let path = candidate;
        // The project stores one spelling of a name; a host that can list folders finds it, so `Burn.STE` on disk is
        // found from `burn.ste` even where the file system is case-sensitive.
        if (fs.list !== undefined) {
          try {
            const resolved = await resolveDocumentPath({ list: (folderPath: string) => fs.list!(folderPath) }, candidate);
            if (!resolved.ok) {
              // Two files differ only in case: the reference names neither, so the form says so instead of previewing
              // whichever spelling happens to read.
              if (active) publish({ state: "collision", message: resolved.kind === "case-conflict" ? resolved.message : resolved.error.message });
              return;
            }
            if (!resolved.exists) {
              missing ??= { path: resolved.path, message: "No matching file in the project folder." };
              continue;
            }
            path = resolved.path;
          } catch (error) {
            if (active) publish({ state: "invalid", message: problem(error) });
            return;
          }
        }
        let result: Awaited<ReturnType<typeof fs.readProject>>;
        try {
          result = await fs.readProject(projectId, path);
        } catch (error) {
          result = { ok: false, error: { code: "unavailable", message: problem(error) } } as Awaited<ReturnType<typeof fs.readProject>>;
        }
        if (!active) return;
        if (result.ok) { publish({ state: "found", bytes: result.value, path }); return; }
        missing ??= { path, message: result.error.message };
      }
      if (active) publish({ state: "missing", path: missing!.path, message: missing!.message });
    })();
    return () => { active = false; };
  }, [fs, projectId, documentPath, kind, reference, extensionKey, lookup, layout, assetRevision, linkedKey]);
  return entry.key === linkedKey ? entry.value : { state: "checking" };
}

export function LinkRow<Command>({ form, id, label, value, hint, kind, extensions, content, navigation, linked, command, children }: {
  readonly form: BattleDataFormBase<Command>;
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly kind: AssetKind;
  readonly extensions: readonly string[];
  /** Also offer, in the picker, a file outside `extensions` whose own bytes the field accepts. */
  readonly content?: AssetContent;
  readonly navigation: BattleDataNavigation;
  readonly linked: LinkedFile;
  readonly command: (value: string) => Command;
  readonly children?: ComponentChildren;
}): JSX.Element {
  const { drafts, setDraft, dropDraft, commitText, registerField, run, disabled, snapshot, setMessage } = form;
  const commit = (text: string, live = false): Promise<void> => commitText(id, () => ({ command: command(text) }), live);
  registerField(id, commit);
  const busy = disabled || snapshot.saving;
  const origin = snapshot.identity.path;
  const choose = async (): Promise<void> => {
    const outcome = await navigation.pickAsset?.({ kind, extensions, ...(content === undefined ? {} : { content }), field: `Choose ${label.toLowerCase()}` });
    if (outcome?.chosen !== true || form.snapshot.identity.path !== origin) return;
    // The chosen file replaces whatever was typed, so the stale draft goes with it.
    dropDraft(id);
    await run(command(outcome.reference));
  };
  const openLinked = async (): Promise<void> => {
    if (linked.state !== "found") return;
    const message = await navigation.open?.(linked.path);
    if (message !== null && message !== undefined) setMessage(message);
  };
  const openable = (path: string): boolean => navigation.canOpen?.(path) ?? kindForPath(path) !== null;
  // Only a file the check found says what Open would open. Until then the stored text's own extension says it, and text
  // with none (or none yet) offers Open when any file type this field accepts can be opened.
  const fieldOpenable = extensions.length === 0 || extensions.some((extension) => openable(`file${extension}`));
  const canOpen = navigation.open !== undefined && (linked.state === "found" ? openable(linked.path) : extensionOf(value) !== "" ? openable(value) : fieldOpenable);
  return <fieldset>
    <legend>{label}</legend>
    <p>
      <label>{label} file
        <input type="text" aria-label={`${label} file`} value={shown(form, id, value)} disabled={busy} readOnly={form.locked} onInput={(event) => { setDraft(id, event.currentTarget.value); if (!form.locked) void commit(event.currentTarget.value, true); }} onChange={(event) => form.leave(id, event.currentTarget.value, commit)} onBlur={() => form.endGesture(id)} />
      </label>
      {hint !== undefined && <small> {hint}</small>}
      <HeldNote form={form} id={id} />
    </p>
    <p>
      {navigation.pickAsset !== undefined && <button type="button" aria-label={`Choose ${label.toLowerCase()}`} disabled={busy || form.locked} onClick={() => void choose()}>Choose…</button>}
      {canOpen && <button type="button" aria-label={`Open ${label.toLowerCase()}`} disabled={linked.state !== "found"} onClick={() => void openLinked()}>Open</button>}
    </p>
    {linked.state === "checking" && <p role="status">Checking {drafts[id]?.text ?? value}…</p>}
    {linked.state === "collision" && <p role="status">{linked.message} The reference is kept as typed; rename one of the files.</p>}
    {linked.state === "invalid" && <p role="status">{linked.message} The reference is kept as typed. Choose the file, or type a file inside this folder.</p>}
    {linked.state === "missing" && <p role="status">{linked.path} is not in the project ({linked.message}). The reference is kept as typed.</p>}
    {linked.state === "found" && children}
  </fieldset>;
}
