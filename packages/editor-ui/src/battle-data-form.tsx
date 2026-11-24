import {
  createEditTracker,
  linkedFileCandidates,
  resolveDocumentPath,
  linkReferenceProblem,
  projectLayoutForDocumentPath,
  reservedFolder,
  type AssetKind,
  type DocumentSnapshot,
  type PendingEdits,
  type PickOutcome,
} from "@tk-reawakened/editor-model";
import type { Capability, DocumentEdited, FileSystemService } from "@tk-reawakened/platform-services";
import type { ComponentChildren, JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { AssetRefreshContext } from "./asset-refresh.ts";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

/**
 * The pieces the special move and status effect forms share (story 13.10, T-57, T-58): the command runner that tells the
 * host an edit was accepted, the draft handling that keeps typing out of the document until a field is left, the
 * Save and conflict row, and a reference row with Choose, Open and a check that the linked file is in the project.
 * The documents own every rule about values; a refusal's own sentence is what the form shows.
 *
 * A field's draft is not an edit until it is committed, so a save — this view's Save, or the host's Save All, Ctrl+S,
 * revert or close — first applies every field that still holds a draft (`flush`), and the view stays busy for the host's
 * pending-edit settlement until it has. That way a host save can never write the document and silently leave the field
 * the author was typing in behind.
 */

export interface BattleDataNavigation {
  readonly pickAsset?: (request: { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly field: string }) => Promise<PickOutcome>;
  /** Open the project file at this project-relative path in its own editor, remembering the way back. Resolves with a message when it could not. */
  readonly open?: (path: string) => Promise<string | null>;
}

export interface BattleDataFormProps<Snapshot extends DocumentSnapshot<Command>, Command> extends BattleDataNavigation {
  readonly doc: ViewDocument<Snapshot, Command>;
  readonly fs: Pick<FileSystemService, "readProject"> & Partial<Pick<FileSystemService, "list">>;
  readonly capabilities: ReadonlySet<Capability>;
  readonly pendingEdits: PendingEdits;
  readonly onEdited: (event: DocumentEdited) => void;
}

/** What the rows need of a form: the shared snapshot surface, the command runner, field drafts and the Save row's state. */
export interface BattleDataFormBase<Command> {
  readonly snapshot: DocumentSnapshot<Command>;
  readonly drafts: Readonly<Record<string, string>>;
  readonly message: string | null;
  readonly resolving: boolean;
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
  commitText(key: string, text: string, current: string, build: (value: string) => Command): Promise<void>;
  commitNumber(key: string, text: string, current: number, build: (value: number) => Command): Promise<void>;
  /** Let a save apply this field's draft first, and take part in the host's pending-edit settlement. */
  registerField(key: string, submit: () => Promise<void>): () => void;
}

/** `BattleDataFormBase` with the kind's own snapshot, which the views read their fields from. */
export interface BattleDataForm<Snapshot extends DocumentSnapshot<Command>, Command> extends BattleDataFormBase<Command> {
  readonly snapshot: Snapshot;
}

const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Write `edited` (LF lines, as a textarea gives them) with the endings `stored` used, line by line: a line that survives
 * keeps its own ending, a line the author added takes the ending of the line it replaced or of the one before it, and the
 * file's last ending is the fallback. Inserting or deleting a line therefore leaves every other separator untouched.
 */
export function restoreLineEndings(stored: string, edited: string): string {
  const oldLines = stored.split(/\r\n|\n|\r/);
  const breaks = stored.match(/\r\n|\n|\r/g) ?? [];
  const lines = edited.split("\n");
  // Longest common subsequence of line contents: the survivors keep their index into `breaks`.
  const kept: number[] = new Array(lines.length).fill(-1);
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () => new Array<number>(lines.length + 1).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = lines.length - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === lines[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  for (let i = 0, j = 0; i < oldLines.length && j < lines.length;) {
    if (oldLines[i] === lines[j]) { kept[j] = i; i += 1; j += 1; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  const fallback = breaks.at(-1) ?? "\n";
  let previous = -1;
  return lines.map((line, index) => {
    if (index === lines.length - 1) return line;
    const survivor = kept[index] ?? -1;
    let source: number = survivor !== -1 && survivor < breaks.length ? survivor : -1;
    if (source === -1) {
      // A new line takes the ending of the line it follows, so an insertion copies its neighbour rather than the file.
      source = previous >= 0 && previous < breaks.length ? previous : -1;
    }
    if (source !== -1) previous = source;
    return `${line}${source === -1 ? fallback : breaks[source]}`;
  }).join("");
}

/** Whole numbers only: a decimal point or an exponent would be rounded into a value the author did not type. */
const WHOLE_NUMBER = /^[+-]?\d+$/;

export function useBattleDataForm<Snapshot extends DocumentSnapshot<Command>, Command>(
  { doc, pendingEdits, capabilities, onEdited }: Pick<BattleDataFormProps<Snapshot, Command>, "doc" | "pendingEdits" | "capabilities" | "onEdited">,
  what: string,
): BattleDataForm<Snapshot, Command> {
  const snapshot = useDocumentSnapshot(doc);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // The draft map is kept ref-authoritative: a host save runs outside a render, so `busy()` must see a commit at once.
  const draftsRef = useRef<Readonly<Record<string, string>>>({});
  const publishDrafts = (next: Readonly<Record<string, string>>): void => {
    draftsRef.current = next;
    setDrafts(next);
  };
  const fields = useRef(new Map<string, () => Promise<void>>());
  const saved = `${what[0]!.toUpperCase()}${what.slice(1)} saved.`;

  const run = (command: Command): Promise<boolean> => {
    const finish = submitted.current.begin();
    const operation = queue.current.then(async () => {
      try {
        const result = await doc.apply(command);
        if (!result.ok) { setMessage(result.rejection.message); return false; }
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? `Edit ${what}` });
        setMessage(null);
        return true;
      } catch (error) {
        setMessage(problem(error));
        return false;
      } finally { finish(); }
    });
    queue.current = operation.then(() => undefined);
    return operation;
  };
  /** Apply every field that still holds a draft, in form order. A field whose draft no longer differs commits nothing. */
  const flush = async (): Promise<void> => {
    for (const [key, submit] of [...fields.current]) {
      if (draftsRef.current[key] === undefined) continue;
      await submit();
    }
  };
  // An explicit save applies the focused field first; autosave and a backup leave the gesture alone (ADR 0022 D11.2);
  // a revert drops text typed against the version being discarded, with the message that named it.
  useEffect(() => pendingEdits.register({
    busy: () => submitted.current.busy(),
    // Asked on every settlement: a field the file cannot store refuses the host's save with its reason, so a host save
    // cannot report success while that text is left behind.
    // Only an explicit save is refused, and only while a draft remains that the file could not store: a backup, a query
    // before a revert's question and the revert itself settle the accepted edits without judging the field.
    refusal: (reason) => reason === "explicit" && Object.keys(draftsRef.current).length > 0
      ? "A field still holds text this file cannot store, so nothing was saved. Correct it or discard it."
      : null,
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
      await flush();
      if (Object.keys(draftsRef.current).length > 0) {
        setMessage("Nothing was saved: a field above still holds text this file cannot store. Correct it or discard it first.");
        return;
      }
      // This view's Save needs no host settlement: it applies its own drafts and waits for its own acknowledgements. The
      // host's Save All, Ctrl+S, revert and close settle the shared registry, which flushes drafts through `idle()`.
      await submitted.current.idle();
      const result = await doc.save();
      setMessage(result.ok ? saved : result.failure.message);
    } catch (error) { setMessage(problem(error)); }
  };
  const resolve = async (choice: "keep-local" | "reload"): Promise<void> => {
    setResolving(true);
    try {
      const result = await doc.resolveConflict(choice);
      if (!result.ok) setMessage(result.message);
      else if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        const written = await doc.save();
        setMessage(written.ok ? saved : written.failure.message);
      } else {
        if (choice === "reload") publishDrafts({});
        setMessage(null);
      }
    } catch (error) { setMessage(problem(error)); }
    finally { setResolving(false); }
  };
  const setDraft = (key: string, text: string): void => publishDrafts({ ...draftsRef.current, [key]: text });
  /** Throw away the text a refused field holds, so the file's value shows and saving can finish. */
  const discardDrafts = (): void => { publishDrafts({}); setMessage(null); };
  const dropDraft = (key: string): void => {
    if (draftsRef.current[key] === undefined) return;
    const next = { ...draftsRef.current };
    delete next[key];
    publishDrafts(next);
  };
  const clearDraft = (key: string, text: string): void => {
    if (draftsRef.current[key] !== text) return;
    const next = { ...draftsRef.current };
    delete next[key];
    publishDrafts(next);
  };
  /** Leave a text field: a changed value is one edit; an unchanged one is dropped without touching the document. */
  const commitText = async (key: string, text: string, current: string, build: (value: string) => Command): Promise<void> => {
    // The draft is what the author typed; `text` may be that draft re-encoded (a description's line endings), so the
    // draft is cleared by its own text, or it would linger as a phantom that refuses every save.
    const typed = draftsRef.current[key] ?? text;
    if (text === current) { clearDraft(key, typed); return; }
    if (await run(build(text))) clearDraft(key, typed);
  };
  /** Leave a number field: the document says whether the value fits, and its sentence is shown when it does not. */
  const commitNumber = async (key: string, text: string, current: number, build: (value: number) => Command): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed === "") { setMessage("Enter a whole number before leaving this field."); return; }
    if (!WHOLE_NUMBER.test(trimmed)) {
      setMessage("Enter a whole number: a decimal point or an exponent would be rounded into a value you did not type.");
      return;
    }
    const value = Number(trimmed);
    if (value === current) { clearDraft(key, text); return; }
    if (await run(build(value))) clearDraft(key, text);
  };
  const registerField = (key: string, submit: () => Promise<void>): (() => void) => {
    fields.current.set(key, submit);
    return () => { if (fields.current.get(key) === submit) fields.current.delete(key); };
  };
  return {
    snapshot, drafts, message, resolving, setMessage, setDraft, dropDraft, discardDrafts, run, save, resolve,
    commitText, commitNumber, registerField,
    disabled: snapshot.readOnly !== null || snapshot.conflict !== null,
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
      <button type="button" data-editor-save="true" disabled={snapshot.saving || snapshot.readOnly !== null || snapshot.conflict !== null} onClick={() => void save()}>Save</button>
      {snapshot.dirty ? " Unsaved changes." : ""}
    </p>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <section role="alert">
      <p>{snapshot.conflict.message} Nothing was saved.</p>
      <button type="button" disabled={resolving || snapshot.readOnly !== null} onClick={() => void resolve("keep-local")}>{capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null && <button type="button" disabled={resolving} onClick={() => void resolve("reload")}>Use the version on disk</button>}
    </section>}
    {message !== null && (snapshot.conflict === null || !message.startsWith(snapshot.conflict.message)) && <p role="alert">{message}{Object.keys(form.drafts).length > 0
      ? <> <button type="button" onClick={() => form.discardDrafts()}>Discard the unapplied text</button></>
      : null}</p>}
  </>;
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
  const { drafts, setDraft, commitText, registerField, disabled, snapshot } = form;
  const commit = (text: string): Promise<void> => commitText(id, text, value, command);
  // Registered during render, not in an effect: the map is a ref, so this neither loops nor lags a render behind.
  registerField(id, () => drafts[id] === undefined ? Promise.resolve() : commitText(id, drafts[id]!, value, command));
  return <p>
    <label>{label}
      <input type="text" aria-label={label} value={drafts[id] ?? value} disabled={disabled || snapshot.saving} onInput={(event) => setDraft(id, event.currentTarget.value)} onChange={(event) => void commit(event.currentTarget.value)} />
    </label>
    {hint !== undefined && <small> {hint}</small>}
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
  // Each line keeps the ending the stored text used, and a line the author adds takes the last one; a description with
  // mixed endings is therefore not rewritten into one convention.
  const asWritten = (text: string): string => restoreLineEndings(value, text);
  registerField(id, () => {
    const draft = drafts[id];
    return draft === undefined ? Promise.resolve() : commitText(id, asWritten(draft), value, command);
  });
  return <p>
    <label>{label}
      <textarea aria-label={label} rows={3} value={drafts[id] ?? value.split("\r\n").join("\n")} disabled={disabled || snapshot.saving} onInput={(event) => setDraft(id, event.currentTarget.value)} onChange={(event) => void commitText(id, asWritten(event.currentTarget.value), value, command)} />
    </label>
    {hint !== undefined && <small> {hint}</small>}
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
  const { drafts, setDraft, commitNumber, registerField, disabled, snapshot } = form;
  registerField(id, () => drafts[id] === undefined ? Promise.resolve() : commitNumber(id, drafts[id]!, value, command));
  return <p>
    <label>{label}
      <input type="number" step="1" aria-label={label} value={drafts[id] ?? String(value)} disabled={disabled || snapshot.saving} onInput={(event) => setDraft(id, event.currentTarget.value)} onChange={(event) => void commitNumber(id, event.currentTarget.value, value, command)} />
    </label>
    {hint !== undefined && <small> {hint}</small>}
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
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled || snapshot.saving} onChange={(event) => {
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
): LinkedFile {
  const assetRevision = useContext(AssetRefreshContext);
  // A caller writes its extension list inline, so the effect keys on the list's content: a new array of the same
  // extensions must not start the read again on every render.
  const extensionKey = extensions.join(",");
  const [linked, setLinked] = useState<LinkedFile>({ state: "none" });
  useEffect(() => {
    let active = true;
    const wanted = extensionKey === "" ? [] : extensionKey.split(",");
    const trimmed = reference.trim();
    if (trimmed === "") {
      setLinked({ state: "none" });
      return () => { active = false; };
    }
    const refused = linkReferenceProblem(trimmed);
    if (refused !== null) {
      setLinked({ state: "invalid", message: refused });
      return () => { active = false; };
    }
    const folder = reservedFolder(projectLayoutForDocumentPath(documentPath), kind);
    setLinked({ state: "checking" });
    void (async () => {
      let missing: { readonly path: string; readonly message: string } | null = null;
      for (const candidate of linkedFileCandidates(folder, trimmed, wanted)) {
        let path = candidate;
        // The project stores one spelling of a name; a host that can list folders finds it, so `Burn.STE` on disk is
        // found from `burn.ste` even where the file system is case-sensitive.
        if (fs.list !== undefined) {
          try {
            const resolved = await resolveDocumentPath({ list: (folderPath: string) => fs.list!(folderPath) }, candidate);
            if (!resolved.ok) {
              // Two files differ only in case: the reference names neither, so the form says so instead of previewing
              // whichever spelling happens to read.
              if (active) setLinked({ state: "collision", message: resolved.kind === "case-conflict" ? resolved.message : resolved.error.message });
              return;
            }
            if (resolved.exists) path = resolved.path;
          } catch { /* a listing that fails leaves the candidate's own spelling */ }
        }
        let result: Awaited<ReturnType<typeof fs.readProject>>;
        try {
          result = await fs.readProject(projectId, path);
        } catch (error) {
          result = { ok: false, error: { code: "unavailable", message: problem(error) } } as Awaited<ReturnType<typeof fs.readProject>>;
        }
        if (!active) return;
        if (result.ok) { setLinked({ state: "found", bytes: result.value, path }); return; }
        missing ??= { path, message: result.error.message };
      }
      if (active) setLinked({ state: "missing", path: missing!.path, message: missing!.message });
    })();
    return () => { active = false; };
  }, [fs, projectId, documentPath, kind, reference, extensionKey, assetRevision]);
  return linked;
}

export function LinkRow<Command>({ form, id, label, value, hint, kind, extensions, navigation, linked, command, children }: {
  readonly form: BattleDataFormBase<Command>;
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly kind: AssetKind;
  readonly extensions: readonly string[];
  readonly navigation: BattleDataNavigation;
  readonly linked: LinkedFile;
  readonly command: (value: string) => Command;
  readonly children?: ComponentChildren;
}): JSX.Element {
  const { drafts, setDraft, dropDraft, commitText, registerField, run, disabled, snapshot, setMessage } = form;
  registerField(id, () => {
    const draft = drafts[id];
    return draft === undefined ? Promise.resolve() : commitText(id, draft, value, command);
  });
  const busy = disabled || snapshot.saving;
  const origin = snapshot.identity.path;
  const choose = async (): Promise<void> => {
    const outcome = await navigation.pickAsset?.({ kind, extensions, field: `Choose ${label.toLowerCase()}` });
    if (outcome?.chosen !== true || form.snapshot.identity.path !== origin) return;
    // The chosen file replaces whatever was typed, so the stale draft goes with it.
    dropDraft(id);
    if (outcome.reference !== value) await run(command(outcome.reference));
  };
  const openLinked = async (): Promise<void> => {
    if (linked.state !== "found") return;
    const message = await navigation.open?.(linked.path);
    if (message !== null && message !== undefined) setMessage(message);
  };
  return <fieldset>
    <legend>{label}</legend>
    <p>
      <label>{label} file
        <input type="text" aria-label={`${label} file`} value={drafts[id] ?? value} disabled={busy} onInput={(event) => setDraft(id, event.currentTarget.value)} onChange={(event) => void commitText(id, event.currentTarget.value, value, command)} />
      </label>
      {hint !== undefined && <small> {hint}</small>}
    </p>
    <p>
      {navigation.pickAsset !== undefined && <button type="button" aria-label={`Choose ${label.toLowerCase()}`} disabled={busy} onClick={() => void choose()}>Choose…</button>}
      {navigation.open !== undefined && <button type="button" aria-label={`Open ${label.toLowerCase()}`} disabled={linked.state !== "found"} onClick={() => void openLinked()}>Open</button>}
    </p>
    {linked.state === "checking" && <p role="status">Checking {(drafts[id] ?? value).trim()}…</p>}
    {linked.state === "collision" && <p role="status">{linked.message} The reference is kept as typed; rename one of the files.</p>}
    {linked.state === "invalid" && <p role="status">{linked.message} The reference is kept as typed. Choose the file, or type a file inside this folder.</p>}
    {linked.state === "missing" && <p role="status">{linked.path} is not in the project ({linked.message}). The reference is kept as typed.</p>}
    {linked.state === "found" && children}
  </fieldset>;
}
