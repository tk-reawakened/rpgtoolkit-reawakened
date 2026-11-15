import {
  commandReference,
  createEditTracker,
  DEFAULT_PROGRAM_PREFERENCES,
  filterCommandReference,
  insertCommandEdit,
  insertHeaderCommand,
  type ApplyResult,
  type CommandReferenceEntry,
  type ConflictChoice,
  type ConflictResult,
  type EditTextCommand,
  type HistoryResult,
  type PendingEditWork,
  type PendingEdits,
  type ProgramCommand,
  type ProgramDocumentSnapshot,
  type ProgramPreferences,
  type SaveResult,
} from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited, LanguageConnectOptions, LanguageService } from "@tk-reawakened/platform-services";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { leaseLanguageClient, type LanguageClient, type LanguageLease } from "./language-client.ts";
import { createPlainTextSurface, type SurfaceDiagnostic, type TextChange, type TextSurface, type TextSurfaceFactory } from "./text-surface.ts";
import { useDocumentSnapshot } from "./use-document.ts";
import type { ViewDocument } from "./mount.ts";

/** The program document a view binds to. A host whose workbench owns history leaves `undo`/`redo` out. */
export interface ProgramViewDocument extends ViewDocument<ProgramDocumentSnapshot, ProgramCommand> {
  undo?(): HistoryResult | Promise<HistoryResult>;
  redo?(): HistoryResult | Promise<HistoryResult>;
}

/** The program-editor preferences in force, read by the view and told when they change. */
export interface ProgramPreferencesSource {
  get(): ProgramPreferences;
  subscribe(listener: () => void): () => void;
}

export interface ProgramViewProps {
  readonly doc: ProgramViewDocument;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
  /** Where the view reports typing it has buffered, so Save, close and revert wait for it (#2613). */
  readonly pendingEdits?: PendingEdits;
  /** The code editor; a plain text area when the host gives none or it fails to start. */
  readonly createSurface?: TextSurfaceFactory;
  /** The host's language server door; the view edits without language features when absent. */
  readonly language?: LanguageService;
  /** The running project's main file, so the server can read the project; `null` leaves documents unassessed. */
  readonly project?: LanguageConnectOptions["project"];
  readonly preferences?: ProgramPreferencesSource;
  /** The quick reference; every first-party command by default. */
  readonly reference?: readonly CommandReferenceEntry[];
  /** How long, in milliseconds, a burst of typing may pause before it becomes one edit. */
  readonly settleMs?: number;
}

interface BookmarkRow {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
}

/** LSP symbol kinds the bookmark list names (docs/spec/engine/rpgcode-tooling.md#tool-10). */
const SYMBOL_KINDS: Readonly<Record<number, string>> = { 5: "Class", 6: "Method", 8: "Field", 12: "Function", 15: "Comment", 20: "Label" };

interface SymbolNode {
  readonly name: string;
  readonly kind: number;
  readonly range: { readonly start: { readonly line: number } };
  readonly children?: readonly SymbolNode[];
}

function flatten(symbols: readonly SymbolNode[]): BookmarkRow[] {
  const rows: BookmarkRow[] = [];
  const visit = (nodes: readonly SymbolNode[]): void => {
    for (const node of nodes) {
      rows.push({ name: node.name, kind: SYMBOL_KINDS[node.kind] ?? "Symbol", line: node.range.start.line });
      if (node.children !== undefined) visit(node.children);
    }
  };
  visit(symbols);
  return rows.sort((left, right) => left.line - right.line);
}

/** The typing a burst may last before it is applied even with no pause, so the dirty mark and undo stay close to the text. */
const MAX_BURST_MS = 3000;
const SETTLE_MS = 600;
const BOOKMARK_MS = 300;

/** The live parts of one mounted view, held outside render so a keystroke never re-creates the code editor. */
interface Control {
  surface: TextSurface | null;
  buffer: TextChange[];
  burstStart: number;
  timer: ReturnType<typeof setTimeout> | null;
  bookmarkTimer: ReturnType<typeof setTimeout> | null;
  lsp: { readonly client: LanguageClient; readonly uri: string; version: number; sent: string } | null;
}

let viewsMade = 0;
/** window/showMessage has no document URI. Attribute a refusal only when one view is formatting. */
const formattingRequests = new WeakMap<LanguageClient, Set<object>>();

/**
 * The RPGCode program editor (T-40, story 11.7). The document is the one copy of the text; the code editor is a surface
 * that shows it. Typing is buffered into one edit per burst and handed to the document; undo, redo, the header and the
 * command insertion go to the document and come back to the surface. The language server is a helper: if it is absent or
 * stops, the text still edits, undoes, saves and reopens (docs/spec/engine/rpgcode-tooling.md#tool-10).
 */
export function ProgramView({ doc, capabilities, onEdited, pendingEdits, createSurface, language, project, preferences, reference, settleMs }: ProgramViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-program-${viewsMade}`;
  });
  const control = useRef<Control>({ surface: null, buffer: [], burstStart: 0, timer: null, bookmarkTimer: null, lsp: null });
  const host = useRef<HTMLDivElement>(null);
  const tracker = useMemo(() => createEditTracker(), []);
  const commandQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedCommands = useRef(0);
  const enqueueCommand = <T,>(operation: () => Promise<T>): Promise<T> => {
    queuedCommands.current += 1;
    const result = commandQueue.current.then(operation);
    commandQueue.current = result.then(
      () => { queuedCommands.current -= 1; },
      () => { queuedCommands.current -= 1; },
    );
    return result;
  };
  const latest = useRef({ doc, snapshot, onEdited });
  latest.current = { doc, snapshot, onEdited };

  const [prefs, setPrefs] = useState<ProgramPreferences>(() => preferences?.get() ?? DEFAULT_PROGRAM_PREFERENCES);
  const [message, setMessage] = useState<string | null>(null);
  const [languageNote, setLanguageNote] = useState<string | null>(null);
  const [languageStatus, setLanguageStatus] = useState<string | null>(null);
  const [surfaceNote, setSurfaceNote] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [bookmarks, setBookmarks] = useState<readonly BookmarkRow[]>([]);
  const [problems, setProblems] = useState(0);
  const [showReference, setShowReference] = useState(true);
  const [showBookmarks, setShowBookmarks] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<CommandReferenceEntry | null>(null);
  const [resolving, setResolving] = useState(false);
  const entries = useMemo(() => reference ?? commandReference(), [reference]);
  const visible = useMemo(() => filterCommandReference(entries, query), [entries, query]);
  const readOnly = snapshot.readOnly !== null;
  const settle = settleMs ?? SETTLE_MS;

  // --- text identity: the surface follows the document, and typing becomes commands -----------------------------------

  const sendToServer = (): void => {
    const lsp = control.current.lsp;
    const surface = control.current.surface;
    if (lsp === null || surface === null) return;
    const text = surface.getText();
    if (text === lsp.sent) return;
    lsp.version += 1;
    lsp.sent = text;
    lsp.client.notify("textDocument/didChange", { textDocument: { uri: lsp.uri, version: lsp.version }, contentChanges: [{ text }] });
    scheduleBookmarks();
  };

  const refreshBookmarks = (): void => {
    const lsp = control.current.lsp;
    if (lsp === null) return;
    void lsp.client
      .request<readonly SymbolNode[] | null>("textDocument/documentSymbol", { textDocument: { uri: lsp.uri } })
      .then((symbols) => {
        if (control.current.lsp === lsp) setBookmarks(flatten(symbols ?? []));
      }, () => undefined);
  };

  /** After typing the outline is asked for once the typing pauses; the server has the new text already. */
  const scheduleBookmarks = (): void => {
    const ctl = control.current;
    if (ctl.lsp === null) return;
    clearTimeout(ctl.bookmarkTimer ?? undefined);
    ctl.bookmarkTimer = setTimeout(() => {
      ctl.bookmarkTimer = null;
      refreshBookmarks();
    }, BOOKMARK_MS);
  };

  /** Give the surface the document's text when the surface is not holding typing the document has yet to take. */
  const syncFromDocument = (force: boolean): void => {
    const ctl = control.current;
    const surface = ctl.surface;
    if (surface === null) return;
    if (!force && (ctl.buffer.length > 0 || tracker.busy())) return;
    const text = latest.current.doc.getSnapshot().text;
    if (surface.getText() !== text) surface.setText(text);
    surface.setReadOnly(latest.current.doc.getSnapshot().readOnly !== null);
    sendToServer();
  };

  const refused = (reason: string): void => {
    control.current.buffer.length = 0;
    setMessage(reason);
    syncFromDocument(true);
  };

  /** Hand the buffered typing to the document as one edit. Tracking starts now, so Save and close wait for the answer. */
  const flush = (): void => {
    const ctl = control.current;
    clearTimeout(ctl.timer ?? undefined);
    ctl.timer = null;
    if (ctl.buffer.length === 0) return;
    const edits = ctl.buffer.splice(0);
    const end = tracker.begin();
    const label = "Typing";
    let outcome: ApplyResult | Promise<ApplyResult>;
    try {
      outcome = latest.current.doc.apply({ type: "edit-text", edits, label });
    } catch (error) {
      outcome = Promise.reject(error);
    }
    void Promise.resolve(outcome)
      .then(
        (result) => {
          if (result.ok) {
            setMessage(null);
            latest.current.onEdited({ document: latest.current.doc.identity.key, editId: result.editId, label });
          } else {
            refused(result.rejection.message);
          }
        },
        (error: unknown) => refused(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        end();
        setTyping(control.current.buffer.length > 0);
      });
  };

  const work = useMemo<PendingEditWork>(() => ({
    busy: () => control.current.buffer.length > 0 || tracker.busy() || queuedCommands.current > 0,
    idle: async () => {
      await commandQueue.current;
      flush();
      await tracker.idle();
    },
  }), [tracker]);
  useEffect(() => pendingEdits?.register(work), [pendingEdits, work]);

  /** Apply a command made by the view itself (header, command insertion) after the typing before it. */
  const applyTextCommand = async (command: EditTextCommand): Promise<boolean> => {
    const end = tracker.begin();
    try {
      const result = await latest.current.doc.apply(command);
      if (!result.ok) {
        setMessage(result.rejection.message);
        return false;
      }
      setMessage(null);
      latest.current.onEdited({ document: latest.current.doc.identity.key, editId: result.editId, label: command.label ?? "Edit text" });
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      end();
    }
  };

  const history = (which: "undo" | "redo"): Promise<void> => enqueueCommand(async () => {
    flush();
    await tracker.idle();
    const step = which === "undo" ? latest.current.doc.undo : latest.current.doc.redo;
    if (step === undefined) return;
    try {
      const result = await step.call(latest.current.doc);
      setMessage(result.ok ? null : `Nothing to ${which}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    syncFromDocument(true);
  });

  const save = (): Promise<SaveResult | null> => enqueueCommand(async () => {
    flush();
    await tracker.idle();
    const result = await latest.current.doc.save();
    if (!result.ok) setMessage(result.failure.message);
    else setMessage(null);
    return result;
  });

  // --- the code editor --------------------------------------------------------------------------------------------------

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    const ctl = control.current;
    const start = latest.current.snapshot;
    const surfaceHost = {
      text: start.text,
      readOnly: start.readOnly !== null,
      name: `${ids}/${latest.current.doc.identity.path}`,
      preferences: prefs,
      onChange(changes: readonly TextChange[]) {
        if (ctl.buffer.length === 0) ctl.burstStart = Date.now();
        ctl.buffer.push(...changes);
        setTyping(true);
        sendToServer();
        clearTimeout(ctl.timer ?? undefined);
        ctl.timer = setTimeout(flush, Date.now() - ctl.burstStart >= MAX_BURST_MS ? 0 : settle);
      },
      onUndo() {
        if (latest.current.doc.undo === undefined) return false;
        void history("undo");
        return true;
      },
      onRedo() {
        if (latest.current.doc.redo === undefined) return false;
        void history("redo");
        return true;
      },
      onSave() {
        void save();
      },
      onBlur: flush,
      onEscape() {
        setFocusMode(false);
      },
    };
    let surface: TextSurface;
    try {
      surface = (createSurface ?? createPlainTextSurface)(element, surfaceHost);
    } catch (error) {
      // A code editor that cannot start leaves a plain text area: editing never depends on it.
      setSurfaceNote(`The code editor could not start (${error instanceof Error ? error.message : String(error)}), so a plain text area is shown. Colouring and call tips are unavailable.`);
      element.replaceChildren();
      surface = createPlainTextSurface(element, surfaceHost);
    }
    ctl.surface = surface;
    return () => {
      clearTimeout(ctl.timer ?? undefined);
      ctl.timer = null;
      // Typing buffered at disposal still reaches the document: closing a view never discards text (ADR 0022 D3.7).
      flush();
      surface.dispose();
      ctl.surface = null;
    };
  }, [doc, createSurface]);

  // The document changed (undo, revert, an external reload, our own edit): the surface follows.
  useEffect(() => {
    syncFromDocument(false);
  }, [snapshot.text, snapshot.readOnly]);

  useEffect(() => {
    if (preferences === undefined) return undefined;
    const apply = (): void => {
      const next = preferences.get();
      setPrefs(next);
      control.current.surface?.setPreferences(next);
    };
    apply();
    return preferences.subscribe(apply);
  }, [preferences]);

  // --- the language server ----------------------------------------------------------------------------------------------

  useEffect(() => {
    setLanguageStatus(null);
    if (language === undefined) {
      setLanguageNote("Language features are not available in this host. You can still edit and save.");
      return undefined;
    }
    setLanguageNote(null);
    const ctl = control.current;
    let cancelled = false;
    let lease: LanguageLease | null = null;
    const stops: Array<() => void> = [];
    void leaseLanguageClient(language, project ?? null).then((leased) => {
      const surface = ctl.surface;
      if (cancelled || surface === null) {
        if (leased.ok) leased.lease.release();
        return;
      }
      if (!leased.ok) {
        setLanguageNote(`Language features are unavailable: ${leased.message} You can still edit and save.`);
        return;
      }
      lease = leased.lease;
      const client = leased.lease.client;
      const uri = client.uriOf(latest.current.doc.identity.path);
      const text = surface.getText();
      ctl.lsp = { client, uri, version: 1, sent: text };
      client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "rpgcode", version: 1, text } });
      const viewToken = {};
      const request = <T,>(method: string, params: Readonly<Record<string, unknown>>): Promise<T> => {
        const formatting = method === "textDocument/formatting" || method === "textDocument/rangeFormatting" || method === "textDocument/onTypeFormatting";
        if (formatting) {
          let active = formattingRequests.get(client);
          if (active === undefined) {
            active = new Set();
            formattingRequests.set(client, active);
          }
          active.add(viewToken);
        }
        return client.request<T>(method, { textDocument: { uri }, ...params }).then(
          (result) => result,
          (error: unknown) => {
            setLanguageStatus(`Language request ${method} failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
          },
        ).finally(() => {
          if (!formatting) return;
          const active = formattingRequests.get(client);
          active?.delete(viewToken);
          if (active?.size === 0) formattingRequests.delete(client);
        });
      };
      stops.push(client.onNotification("window/showMessage", (params) => {
        const message = params as { readonly type?: number; readonly message?: string };
        const active = formattingRequests.get(client);
        if (active?.size !== 1 || !active.has(viewToken) || (message.type !== 1 && message.type !== 2) || !message.message) return;
        setLanguageStatus(message.message);
      }));
      surface.setLanguage({ uri, capabilities: client.capabilities, request });
      stops.push(client.onNotification("textDocument/publishDiagnostics", (params) => {
        const published = params as { readonly uri?: string; readonly diagnostics?: readonly SurfaceDiagnostic[] };
        if (published.uri !== uri) return;
        setProblems(published.diagnostics?.filter((item) => item.severity === undefined || item.severity <= 2).length ?? 0);
        ctl.surface?.setDiagnostics(published.diagnostics ?? []);
      }));
      stops.push(client.onClose((reason) => {
        ctl.lsp = null;
        ctl.surface?.setLanguage(null);
        ctl.surface?.setDiagnostics([]);
        setBookmarks([]);
        setProblems(0);
        setLanguageStatus(null);
        setLanguageNote(`Language features stopped: ${reason} You can still edit and save.`);
      }));
      sendToServer();
      refreshBookmarks();
    });
    return () => {
      cancelled = true;
      clearTimeout(ctl.bookmarkTimer ?? undefined);
      ctl.bookmarkTimer = null;
      const lsp = ctl.lsp;
      ctl.lsp = null;
      for (const stop of stops) stop();
      if (lsp !== null) {
        try {
          lsp.client.notify("textDocument/didClose", { textDocument: { uri: lsp.uri } });
        } catch {
          // The server is already gone.
        }
      }
      ctl.surface?.setLanguage(null);
      ctl.surface?.setDiagnostics([]);
      lease?.release();
    };
  }, [language, project?.main ?? null, doc, createSurface]);

  // --- commands ---------------------------------------------------------------------------------------------------------

  const insertHeader = (): void => {
    const command = insertHeaderCommand(prefs.headerTemplate, latest.current.doc.identity.path);
    if (command === null) {
      setMessage("The header template is empty, so there is nothing to insert. Change it in the editor preferences.");
      return;
    }
    void enqueueCommand(async () => {
      flush();
      await tracker.idle();
      return applyTextCommand(command);
    }).then((done) => {
      if (done) syncFromDocument(true);
    });
  };

  const insertCommand = (entry: CommandReferenceEntry): void => {
    void enqueueCommand(async () => {
      flush();
      await tracker.idle();
      const surface = control.current.surface;
      if (surface === null) return;
      const selection = surface.getSelection();
      const { command, select } = insertCommandEdit(entry, selection.from, selection.to);
      if (await applyTextCommand(command)) {
        syncFromDocument(true);
        surface.select(select.from, select.to);
      }
    });
  };

  const resolve = (choice: ConflictChoice): void => {
    setResolving(true);
    void Promise.resolve()
      .then(() => latest.current.doc.resolveConflict(choice))
      .then(async (result: ConflictResult) => {
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        setMessage(null);
        if (choice === "keep-local" && capabilities.has("conflictAutoSave")) await latest.current.doc.save().catch(() => undefined);
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setResolving(false));
  };

  const conflict = snapshot.conflict;
  const stateText = snapshot.saving ? "Saving…" : snapshot.dirty || typing ? "Unsaved changes" : "All changes saved";
  const bookmarkId = `${ids}-bookmarks`;
  const referenceId = `${ids}-reference`;

  return (
    <section class={`tkr-program${focusMode ? " tkr-program--focus" : ""}`} aria-label={`Program ${snapshot.identity.path}`}>
      {focusMode ? (
        <button type="button" class="tkr-program-exit-focus" onClick={() => setFocusMode(false)}>
          Exit distraction-free mode (Esc)
        </button>
      ) : (
        <>
          <h2 class="tkr-program-heading">{snapshot.identity.path}</h2>
          <div class="tkr-program-toolbar" role="toolbar" aria-label="Program tools">
            <button type="button" class="tkr-program-save" disabled={readOnly} onClick={() => void save()}>Save</button>
            <button type="button" class="tkr-program-header" disabled={readOnly} onClick={insertHeader}>Insert header</button>
            <button type="button" class="tkr-program-toggle-bookmarks" aria-pressed={showBookmarks} aria-controls={bookmarkId} onClick={() => setShowBookmarks(!showBookmarks)}>Bookmarks</button>
            <button type="button" class="tkr-program-toggle-reference" aria-pressed={showReference} aria-controls={referenceId} onClick={() => setShowReference(!showReference)}>Command reference</button>
            <button type="button" class="tkr-program-focus" onClick={() => { setFocusMode(true); control.current.surface?.focus(); }}>Distraction-free</button>
          </div>
          {snapshot.readOnly === null ? null : <p class="tkr-program-readonly" role="note">Read only: {snapshot.readOnly.message}</p>}
          {capabilities.has("fileWatch") ? null : (
            <p class="tkr-program-host-note">This host cannot watch files, so a change another program makes to this file is found when you save, and is never saved over.</p>
          )}
          {conflict === null ? null : (
            <div class="tkr-program-conflict" role="group" aria-label="Changed on disk">
              <p role="alert">{conflict.message}</p>
              <button type="button" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
                {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
              </button>
              {capabilities.has("conflictReload") && conflict.externalTitle !== null ? (
                <button type="button" disabled={resolving} onClick={() => resolve("reload")}>Use the version on disk</button>
              ) : null}
            </div>
          )}
          <p class="tkr-program-state" role="status">
            {stateText}
            {problems > 0 ? ` · ${problems} ${problems === 1 ? "problem" : "problems"}` : ""}
          </p>
          {message === null ? null : <p class="tkr-program-message" role="alert">{message}</p>}
          {surfaceNote === null && languageNote === null && languageStatus === null ? null : (
            <p class="tkr-program-language-note" role="status">{surfaceNote ?? ""} {languageNote ?? ""} {languageStatus ?? ""}</p>
          )}
        </>
      )}
      <div class="tkr-program-body">
        {focusMode || !showBookmarks ? null : (
          <nav id={bookmarkId} class="tkr-program-bookmarks" aria-label="Bookmarks: functions, labels and comments">
            {bookmarks.length === 0 ? (
              <p class="tkr-program-empty">{languageNote === null ? "No functions, labels or comments yet." : "Bookmarks need the language features."}</p>
            ) : (
              <ul>
                {bookmarks.map((row) => (
                  <li key={`${row.line}:${row.name}`}>
                    <button type="button" onClick={() => control.current.surface?.revealLine(row.line)}>
                      <span class="tkr-program-bookmark-kind">{row.kind}</span> {row.name} <span class="tkr-program-bookmark-line">line {row.line + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}
        <div class="tkr-program-text" ref={host} />
        {focusMode || !showReference ? null : (
          <aside id={referenceId} class="tkr-program-reference" aria-label="Command reference">
            <label>
              Find a command
              <input type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
            </label>
            <p class="tkr-program-reference-hint">Double-click a command to insert it at the cursor.</p>
            <ul class="tkr-program-reference-list">
              {visible.map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    aria-pressed={chosen?.name === entry.name}
                    disabled={readOnly}
                    title={entry.summary ?? entry.syntax}
                    onClick={() => setChosen(entry)}
                    onDblClick={() => insertCommand(entry)}
                  >
                    <code>{entry.syntax}</code>
                  </button>
                </li>
              ))}
            </ul>
            {chosen === null ? null : (
              <div class="tkr-program-reference-detail">
                <p><strong>{chosen.name}</strong>{chosen.aliasOf === null ? "" : ` (another spelling of ${chosen.aliasOf})`}</p>
                <p>{chosen.summary ?? "No description yet."}</p>
                <button type="button" class="tkr-program-insert" disabled={readOnly} onClick={() => insertCommand(chosen)}>Insert {chosen.name}</button>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
