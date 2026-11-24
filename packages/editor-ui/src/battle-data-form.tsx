import {
  createEditTracker,
  projectLayoutForDocumentPath,
  referencePath,
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
 */

export interface BattleDataNavigation {
  readonly pickAsset?: (request: { readonly kind: AssetKind; readonly extensions: readonly string[]; readonly field: string }) => Promise<PickOutcome>;
  /** Open the project file at this project-relative path in its own editor, remembering the way back. Resolves with a message when it could not. */
  readonly open?: (path: string) => Promise<string | null>;
}

export interface BattleDataFormProps<Snapshot extends DocumentSnapshot<Command>, Command> extends BattleDataNavigation {
  readonly doc: ViewDocument<Snapshot, Command>;
  readonly fs: Pick<FileSystemService, "readProject">;
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
  /** Apply one command and tell the host; resolves true when the document accepted it. */
  run(command: Command): Promise<boolean>;
  save(): Promise<void>;
  resolve(choice: "keep-local" | "reload"): Promise<void>;
  commitText(key: string, text: string, current: string, build: (value: string) => Command): Promise<void>;
  commitNumber(key: string, text: string, current: number, build: (value: number) => Command): Promise<void>;
}

/** `BattleDataFormBase` with the kind's own snapshot, which the views read their fields from. */
export interface BattleDataForm<Snapshot extends DocumentSnapshot<Command>, Command> extends BattleDataFormBase<Command> {
  readonly snapshot: Snapshot;
}

const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);

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
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);
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
  const save = async (): Promise<void> => {
    try {
      await pendingEdits.settle();
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
        if (choice === "reload") setDrafts({});
        setMessage(null);
      }
    } catch (error) { setMessage(problem(error)); }
    finally { setResolving(false); }
  };
  const setDraft = (key: string, text: string): void => setDrafts((previous) => ({ ...previous, [key]: text }));
  const clearDraft = (key: string, text: string): void => setDrafts((previous) => {
    if (previous[key] !== text) return previous;
    const next = { ...previous };
    delete next[key];
    return next;
  });
  /** Leave a text field: a changed value is one edit; an unchanged one is dropped without touching the document. */
  const commitText = async (key: string, text: string, current: string, build: (value: string) => Command): Promise<void> => {
    if (text === current) { clearDraft(key, text); return; }
    if (await run(build(text))) clearDraft(key, text);
  };
  /** Leave a number field: the document says whether the value fits, and its sentence is shown when it does not. */
  const commitNumber = async (key: string, text: string, current: number, build: (value: number) => Command): Promise<void> => {
    if (text.trim() === "") { setMessage("Enter a whole number before leaving this field."); return; }
    const value = Number(text);
    if (value === current) { clearDraft(key, text); return; }
    if (await run(build(value))) clearDraft(key, text);
  };
  return {
    snapshot, drafts, message, resolving, setMessage, setDraft, run, save, resolve, commitText, commitNumber,
    disabled: snapshot.readOnly !== null || snapshot.conflict !== null,
  };
}

/** The Save button, the read-only reason, a conflict with its choices, and the last message. */
export function SaveBar<Command>({ form, capabilities }: {
  readonly form: BattleDataFormBase<Command>;
  readonly capabilities: ReadonlySet<Capability>;
}): JSX.Element {
  const { snapshot, save, resolve, resolving, message, drafts } = form;
  return <>
    <p>
      <button type="button" data-editor-save="true" disabled={snapshot.saving || snapshot.readOnly !== null || snapshot.conflict !== null || Object.keys(drafts).length > 0} onClick={() => void save()}>Save</button>
      {snapshot.dirty ? " Unsaved changes." : ""}
    </p>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <section role="alert">
      <p>{snapshot.conflict.message} Nothing was saved.</p>
      <button type="button" disabled={resolving || snapshot.readOnly !== null} onClick={() => void resolve("keep-local")}>{capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null && <button type="button" disabled={resolving} onClick={() => void resolve("reload")}>Use the version on disk</button>}
    </section>}
    {message !== null && (snapshot.conflict === null || !message.startsWith(snapshot.conflict.message)) && <p role="alert">{message}</p>}
  </>;
}

export function TextRow<Command>({ form, id, label, value, hint, command }: {
  readonly form: BattleDataFormBase<Command>;
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly command: (value: string) => Command;
}): JSX.Element {
  const { drafts, setDraft, commitText, disabled, snapshot } = form;
  return <p>
    <label>{label}
      <input type="text" aria-label={label} value={drafts[id] ?? value} disabled={disabled || snapshot.saving} onInput={(event) => setDraft(id, event.currentTarget.value)} onChange={(event) => void commitText(id, event.currentTarget.value, value, command)} />
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
  const { drafts, setDraft, commitNumber, disabled, snapshot } = form;
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
  | { readonly state: "missing"; readonly path: string; readonly message: string };

/** Read the saved file a reference names, again whenever the reference or the saved assets change. A missing file is a value, never an error. */
export function useLinkedFile(fs: Pick<FileSystemService, "readProject">, projectId: string, documentPath: string, kind: AssetKind, reference: string): LinkedFile {
  const assetRevision = useContext(AssetRefreshContext);
  const [linked, setLinked] = useState<LinkedFile>({ state: "none" });
  useEffect(() => {
    let active = true;
    const trimmed = reference.trim();
    if (trimmed === "") {
      setLinked({ state: "none" });
      return () => { active = false; };
    }
    const path = referencePath(projectLayoutForDocumentPath(documentPath), kind, trimmed);
    setLinked({ state: "checking" });
    void Promise.resolve(fs.readProject(projectId, path)).then((result) => {
      if (!active) return;
      setLinked(result.ok ? { state: "found", bytes: result.value, path } : { state: "missing", path, message: result.error.message });
    }).catch((error: unknown) => {
      if (active) setLinked({ state: "missing", path, message: problem(error) });
    });
    return () => { active = false; };
  }, [fs, projectId, documentPath, kind, reference, assetRevision]);
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
  const { drafts, setDraft, commitText, run, disabled, snapshot, setMessage } = form;
  const busy = disabled || snapshot.saving;
  const origin = snapshot.identity.path;
  const choose = async (): Promise<void> => {
    const outcome = await navigation.pickAsset?.({ kind, extensions, field: `Choose ${label.toLowerCase()}` });
    if (outcome?.chosen !== true || form.snapshot.identity.path !== origin) return;
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
    {linked.state === "checking" && <p role="status">Checking {value.trim()}…</p>}
    {linked.state === "missing" && <p role="status">{linked.path} is not in the project ({linked.message}). The reference is kept as typed.</p>}
    {linked.state === "found" && children}
  </fieldset>;
}
