import { deleteLaunchSetup, launchOfSetup, readLaunchSetups, saveLaunchSetup, type LaunchSetup, type LaunchSetupEntry, type Launcher, type ProjectLayout } from "@tk-reawakened/editor-model";
import type { FileSystemService, RunHandle, RunStatus } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { RunView, type RunSetupOutcome, type RunSetupStore } from "./run-view.tsx";

/** Remembers which setup the Run button runs, per user (ADR 0022 D8.7: the user settings layer, never the project file). */
export interface RunSetupMemory {
  get(): Promise<string | null>;
  set(name: string | null): void;
}

export interface RunControlProps {
  readonly launcher: Launcher;
  readonly fs: Pick<FileSystemService, "list">;
  readonly layout: ProjectLayout;
  /** The main file of the game open in the editor; a setup without its own `main` runs it (D8.7). */
  readonly main?: string;
  readonly active?: string | null;
  readonly version?: unknown;
  /** Where setups are read and saved; without it the control only runs the game and one-off launches. */
  readonly store?: RunSetupStore;
  readonly memory?: RunSetupMemory;
  /** Told about each run this control starts, so the host can show it. */
  readonly onRun?: (handle: RunHandle) => void;
}

/** The value of the chooser's built-in entry, the normal game launch, and of its last entry, which opens a new setup. */
const GAME = "";
const ADD = "\u0000add";

/** Every `.gam` file in the project, first by path; used when the host does not say which game is open. */
async function firstMain(fs: Pick<FileSystemService, "list">): Promise<string | null> {
  const pending = [""];
  const found: string[] = [];
  while (pending.length > 0) {
    const folder = pending.pop()!;
    const listed = await fs.list(folder);
    if (!listed.ok) continue;
    for (const entry of listed.value) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "directory") pending.push(path);
      else if (entry.name.toLowerCase().endsWith(".gam")) found.push(path);
    }
  }
  return found.sort()[0] ?? null;
}

/**
 * The Run button in the workbench header (T-07, T-41; ADR 0022 D8.7). A chooser names what runs — the game from its
 * start-up or one of the project's saved setups — and ▶ Run runs it: it saves first and starts a new snapshot. "Add
 * setup…" and the edit button open the setup form over the workbench, where a launch can be run once or named and saved
 * in `.tkr/launch.json`. Stop ends the run in progress.
 */
export function RunControl({ launcher, fs, layout, main, active = null, version, store, memory, onRun }: RunControlProps) {
  const [entries, setEntries] = useState<readonly LaunchSetupEntry[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState(GAME);
  const [editing, setEditing] = useState<{ readonly initial: LaunchSetup | null } | null>(null);
  const [run, setRun] = useState<RunHandle | null>(() => launcher.current());
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const mounted = useRef(true);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => () => { mounted.current = false; }, []);

  useEffect(() => {
    if (store === undefined) return undefined;
    let current = true;
    void readLaunchSetups(store.fs).then((read) => {
      if (!current) return;
      setEntries(read.ok ? read.entries : []);
      setFileProblem(read.ok ? null : read.problem);
    });
    return () => { current = false; };
  }, [store, version, reads]);

  useEffect(() => {
    let current = true;
    void memory?.get().then((name) => { if (current && name !== null) setSelected(name); });
    return () => { current = false; };
  }, [memory]);

  useEffect(() => {
    if (run === null) return undefined;
    setStatus(run.status());
    const listener = run.onStatus(setStatus);
    return () => listener.dispose();
  }, [run]);

  const choose = (name: string): void => {
    setSelected(name);
    memory?.set(name === GAME ? null : name);
  };
  const chosen = entries.find((entry) => entry.name === selected) ?? null;
  // A remembered setup that is gone or unusable falls back to the game, so ▶ always does something sensible.
  const setup = chosen?.setup ?? null;
  const runName = setup === null ? "Game start-up" : setup.name;

  const started = (handle: RunHandle): void => {
    setRun(handle);
    onRun?.(handle);
  };
  const runChosen = async (): Promise<void> => {
    setBusy(true);
    setRefusal(null);
    const open = main ?? await firstMain(fs);
    if (open === null) {
      if (mounted.current) { setBusy(false); setRefusal("This project has no main (.gam) file."); }
      return;
    }
    const outcome = await launcher.launch(setup === null
      ? { kind: "game", main: open, projectFolder: layout.projectFolder }
      : launchOfSetup(setup, { main: open, projectFolder: layout.projectFolder }));
    if (!mounted.current) return;
    setBusy(false);
    if (outcome.ok) started(outcome.handle);
    else setRefusal(outcome.message);
  };

  const openForm = (initial: LaunchSetup | null): void => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing({ initial });
  };
  const closeForm = (outcome: RunSetupOutcome): void => {
    setEditing(null);
    opener.current?.focus();
    if (outcome.kind === "saved") choose(outcome.setup);
    if (outcome.kind === "deleted") choose(GAME);
    if (outcome.kind === "launched") {
      if (outcome.setup !== null) choose(outcome.setup);
      started(outcome.handle);
    }
    if (outcome.kind !== "cancelled") setReads((count) => count + 1);
  };

  const running = run !== null && status !== null && status.state !== "ended" && status.state !== "failed";
  const gameReason = launcher.unavailable(setup?.kind ?? "game");
  return (
    <div class="tkr-run-control" role="group" aria-label="Run">
      <select
        class="tkr-run-choice"
        aria-label="Run setup"
        value={setup === null ? GAME : selected}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === ADD) {
            event.currentTarget.value = setup === null ? GAME : selected;
            openForm(null);
          } else choose(value);
        }}
      >
        <option value={GAME}>Game start-up</option>
        {entries.map((entry, index) => (
          <option key={`${index}:${entry.name}`} value={entry.name} disabled={entry.setup === null} title={entry.problem ?? undefined}>
            {entry.setup === null ? `${entry.name} (unavailable: ${entry.problem})` : entry.name}
          </option>
        ))}
        <option value={ADD}>Add setup…</option>
      </select>
      <button
        type="button"
        class="tkr-run-start"
        aria-label="Run"
        title={gameReason ?? `Run ${runName}`}
        disabled={busy || gameReason !== null}
        onClick={() => void runChosen()}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
        Run
      </button>
      <button type="button" class="tkr-run-edit" aria-label={setup === null ? "New run setup" : `Edit ${setup.name}`} title={setup === null ? "New run setup…" : `Edit ${setup.name}…`} onClick={() => openForm(setup)}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11.5V14h2.5l7.4-7.4-2.5-2.5zM13.7 4.8a.7.7 0 0 0 0-1l-1.5-1.5a.7.7 0 0 0-1 0l-1.1 1.1 2.5 2.5z" fill="currentColor" /></svg>
      </button>
      {running ? <button type="button" class="tkr-run-stop" onClick={() => run.stop()}>Stop</button> : null}
      {busy ? <span class="tkr-run-busy" role="status">Saving and starting…</span> : null}
      {refusal === null ? null : <span class="tkr-run-refusal" role="alert">{refusal}</span>}
      {fileProblem === null ? null : <span class="tkr-run-refusal" role="alert">{fileProblem}</span>}
      {editing === null ? null : (
        <div
          class="tkr-picker-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={editing.initial === null ? "New run setup" : `Run setup ${editing.initial.name}`}
          onKeyDown={(event) => { if (event.key === "Escape") closeForm({ kind: "cancelled" }); }}
        >
          <div class="tkr-run-dialog">
            <RunView
              launcher={launcher}
              fs={fs}
              layout={layout}
              active={active}
              version={version}
              initial={editing.initial}
              {...(store === undefined ? {} : {
                store,
                onSave: async (saved: LaunchSetup, replacing: string | null) => {
                  const result = await saveLaunchSetup(store.fs, saved, replacing ?? undefined);
                  return result.ok ? null : result.message;
                },
                onDelete: async (name: string) => {
                  const result = await deleteLaunchSetup(store.fs, name);
                  return result.ok ? null : result.message;
                },
              })}
              onDone={closeForm}
            />
          </div>
        </div>
      )}
    </div>
  );
}
