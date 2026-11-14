import { listGame, type GameGroup, type Launcher, type ProjectLayout } from "@tk-reawakened/editor-model";
import type { BoardStart, FileSystemService, Launch, LaunchKind, RunHandle, RunSnapshot, RunStatus } from "@tk-reawakened/platform-services";
import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

export interface RunViewProps {
  /** Starts runs through the host's `run` service, saving first (ADR 0022 D8.2). */
  readonly launcher: Launcher;
  readonly fs: Pick<FileSystemService, "list">;
  readonly layout: ProjectLayout;
  /** The path of the document in front, offered first as the board or program to test. */
  readonly active?: string | null;
  /** Changes when the project's files may have, so the lists are read again. */
  readonly version?: unknown;
}

/** What the view lists from the project: the main files, and the files each test can name. */
interface Choices {
  readonly mains: readonly string[];
  readonly boards: readonly string[];
  readonly programs: readonly string[];
  readonly characters: readonly string[];
  readonly pictures: readonly string[];
}

const NO_CHOICES: Choices = { mains: [], boards: [], programs: [], characters: [], pictures: [] };

/** The three launches' names, the same in every host (ADR 0022 D8.1). */
const LAUNCH_LABEL: Readonly<Record<LaunchKind, string>> = {
  game: "Run game",
  board: "Test board",
  program: "Test program",
};

const STATE_LABEL: Readonly<Record<RunStatus["state"], string>> = {
  starting: "Starting",
  running: "Running",
  stalled: "Waiting for a file",
  ended: "Ended",
  failed: "Failed",
};

function filesOf(groups: readonly GameGroup[], kind: GameGroup["kind"], extension: string): string[] {
  return (groups.find((group) => group.kind === kind)?.files ?? []).map((file) => file.path).filter((path) => path.toLowerCase().endsWith(extension));
}

/** The first 12 hex digits of a hash: enough to tell two snapshots apart at a glance; the full value is in the title. */
function short(hash: string): string {
  return hash.slice(0, 12);
}

function describeLaunch(snapshot: RunSnapshot): string {
  const at = snapshot.start === null ? "" : ` at ${snapshot.start.board} (${snapshot.start.x}, ${snapshot.start.y}, layer ${snapshot.start.layer})`;
  if (snapshot.kind === "game") return "Game from its start-up";
  if (snapshot.kind === "board") return `Board test${at}`;
  return `Program test of ${snapshot.targets[1]?.path ?? "the program"} with fixture "${snapshot.fixture ?? ""}"${at}`;
}

function Snapshot({ snapshot }: { readonly snapshot: RunSnapshot }) {
  return (
    <dl class="tkr-run-snapshot" aria-label="Run snapshot">
      <dt>Launch</dt>
      <dd>{describeLaunch(snapshot)}</dd>
      {snapshot.targets.map((target) => (
        <Fragment key={target.path}>
          <dt>{target.path}</dt>
          <dd title={target.sha256}>SHA-256 {short(target.sha256)}</dd>
        </Fragment>
      ))}
      <dt>Other files</dt>
      <dd title={snapshot.manifest}>{snapshot.manifestFiles} files, manifest {short(snapshot.manifest)}</dd>
      {snapshot.party.length === 0 ? null : (
        <>
          <dt>Party</dt>
          <dd>{snapshot.party.join(", ")}</dd>
        </>
      )}
      {snapshot.fixtureSettings === null ? null : (
        <>
          <dt>Fixture font</dt>
          <dd>{snapshot.fixtureSettings.font ?? "not specified"}</dd>
          <dt>Fixture font size</dt>
          <dd>{snapshot.fixtureSettings.fontSize ?? "not specified"}</dd>
          <dt>Fixture window graphic</dt>
          <dd>{snapshot.fixtureSettings.windowGraphic ?? "not specified"}</dd>
        </>
      )}
      <dt>Seed</dt>
      <dd>{snapshot.seed}</dd>
      <dt>Runner</dt>
      <dd>{snapshot.runner}</dd>
    </dl>
  );
}

function StatusLine({ status }: { readonly status: RunStatus }) {
  const detail = status.state === "stalled" && status.stalledOn !== null
    ? `: ${status.stalledOn}`
    : status.message === null ? "" : `: ${status.message}`;
  const where = status.board === null ? "" : `, on ${status.board}`;
  return (
    <>
      <p class="tkr-run-state">{`${STATE_LABEL[status.state]}${detail} (tick ${status.tick}${where})`}</p>
      {status.diagnostics.length === 0 ? null : (
        <ul class="tkr-run-diagnostics" aria-label="Run problems">
          {status.diagnostics.map((diagnostic, index) => (
            <li key={index}>{`${diagnostic.file === "" ? "" : `${diagnostic.file}${diagnostic.line > 0 ? `:${diagnostic.line}` : ""}: `}${diagnostic.message} (${diagnostic.code})`}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Select({ label, value, options, onChange, none }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
  readonly none?: string;
}) {
  return (
    <label class="tkr-run-field">
      {label}
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {none === undefined ? null : <option value="">{none}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

/** The party, in the order the characters are listed; the first chosen leads. */
function PartySelect({ value, options, onChange }: { readonly value: readonly string[]; readonly options: readonly string[]; readonly onChange: (value: string[]) => void }) {
  return (
    <label class="tkr-run-field">
      Party
      <select multiple onChange={(event) => onChange([...event.currentTarget.selectedOptions].map((option) => option.value))}>
        {options.map((option) => <option key={option} value={option} selected={value.includes(option)}>{option}</option>)}
      </select>
    </label>
  );
}

function Position({ value, onChange }: { readonly value: Omit<BoardStart, "board">; readonly onChange: (value: Omit<BoardStart, "board">) => void }) {
  const field = (name: "x" | "y" | "layer", label: string) => (
    <label class="tkr-run-field">
      {label}
      <input type="number" min={1} step={1} value={value[name]} onInput={(event) => onChange({ ...value, [name]: Number(event.currentTarget.value) })} />
    </label>
  );
  return (
    <>
      {field("x", "Column")}
      {field("y", "Row")}
      {field("layer", "Layer")}
    </>
  );
}

/**
 * The Run panel (T-07, T-41; ADR 0022 D8): three launches that stay distinct — run the game from its start-up, test one
 * board at a chosen position with a chosen party, and test one program under a fixture. Each launch the host cannot do is
 * disabled with the host's reason. A launch saves first; the run's snapshot and status are shown until the next one, and
 * a later edit never changes a running game: running again is a new snapshot.
 */
export function RunView({ launcher, fs, layout, active = null, version }: RunViewProps) {
  const [choices, setChoices] = useState<Choices>(NO_CHOICES);
  const [main, setMain] = useState("");
  const [board, setBoard] = useState("");
  const [boardAt, setBoardAt] = useState({ x: 1, y: 1, layer: 1 });
  const [boardParty, setBoardParty] = useState<string[]>([]);
  const [program, setProgram] = useState("");
  const [fixtureBoard, setFixtureBoard] = useState("");
  const [fixtureAt, setFixtureAt] = useState({ x: 1, y: 1, layer: 1 });
  const [fixtureParty, setFixtureParty] = useState<string[]>([]);
  const [font, setFont] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [windowGraphic, setWindowGraphic] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [run, setRun] = useState<RunHandle | null>(null);
  const [status, setStatus] = useState<RunStatus | null>(null);

  useEffect(() => {
    let current = true;
    void Promise.all([fs.list("Main"), listGame(fs, layout)]).then(([listedMains, listed]) => {
      if (!current) return;
      const mains = listedMains.ok ? listedMains.value.filter((entry) => entry.kind === "file" && entry.name.toLowerCase().endsWith(".gam")).map((entry) => `Main/${entry.name}`).sort() : [];
      setChoices({
        mains,
        boards: filesOf(listed.groups, "boards", ".brd"),
        programs: filesOf(listed.groups, "programs", ".prg"),
        characters: filesOf(listed.groups, "characters", ".tem"),
        pictures: filesOf(listed.groups, "bitmaps", ""),
      });
    });
    return () => { current = false; };
  }, [fs, layout, version]);

  // A choice that is gone from the project falls back to the first that is there; the document in front is offered first.
  const pick = (value: string, options: readonly string[]): string => options.includes(value) ? value : options[0] ?? "";
  const activeBoard = active !== null && choices.boards.includes(active) ? active : null;
  const activeProgram = active !== null && choices.programs.includes(active) ? active : null;
  const chosenMain = pick(main, choices.mains);
  const chosenBoard = board === "" && activeBoard !== null ? activeBoard : pick(board, choices.boards);
  const chosenProgram = program === "" && activeProgram !== null ? activeProgram : pick(program, choices.programs);

  useEffect(() => {
    if (run === null) return undefined;
    setStatus(run.status());
    const listener = run.onStatus(setStatus);
    return () => listener.dispose();
  }, [run]);

  const launch = (request: Launch): void => {
    setBusy(true);
    setRefusal(null);
    void launcher.launch(request).then((outcome) => {
      setBusy(false);
      if (!outcome.ok) {
        setRefusal(outcome.message);
        return;
      }
      setRun(outcome.handle);
    });
  };
  const base = { main: chosenMain, projectFolder: layout.projectFolder };
  const noMain = chosenMain === "" ? "This project has no main file in Main/." : null;

  const section = (kind: LaunchKind, description: string, body: ComponentChildren, missing: string | null, request: () => Launch) => {
    const reason = launcher.unavailable(kind) ?? noMain ?? missing;
    const id = `tkr-run-${kind}-reason`;
    return (
      <fieldset class="tkr-run-launch">
        <legend>{LAUNCH_LABEL[kind]}</legend>
        <p>{description}</p>
        {body}
        <button type="button" disabled={busy || reason !== null} aria-describedby={reason === null ? undefined : id} onClick={() => launch(request())}>
          {LAUNCH_LABEL[kind]}
        </button>
        {reason === null ? null : <p id={id} class="tkr-run-unavailable">{reason}</p>}
      </fieldset>
    );
  };

  const finished = status === null || status.state === "ended" || status.state === "failed";
  return (
    <section class="tkr-run" aria-label="Run">
      <h2 class="tkr-run-heading">Run</h2>
      {choices.mains.length > 1 ? <Select label="Game" value={chosenMain} options={choices.mains} onChange={setMain} /> : null}
      {section(
        "game",
        "Plays the game from its start-up, as a player would see it.",
        null,
        null,
        () => ({ kind: "game", ...base }),
      )}
      {section(
        "board",
        "Starts the game on one board, at the position and with the party you choose, without the start-up.",
        <>
          <Select label="Board" value={chosenBoard} options={choices.boards} onChange={setBoard} />
          <Position value={boardAt} onChange={setBoardAt} />
          <PartySelect value={boardParty} options={choices.characters} onChange={setBoardParty} />
        </>,
        chosenBoard === "" ? "This project has no boards to test." : null,
        () => ({ kind: "board", ...base, start: { board: chosenBoard, ...boardAt }, party: boardParty }),
      )}
      {section(
        "program",
        "Runs one program on its own, with the test settings below instead of the rest of the game.",
        <>
          <Select label="Program" value={chosenProgram} options={choices.programs} onChange={setProgram} />
          <Select label="Start board" value={fixtureBoard} options={choices.boards} onChange={setFixtureBoard} none="No board" />
          {fixtureBoard === "" ? null : <Position value={fixtureAt} onChange={setFixtureAt} />}
          <PartySelect value={fixtureParty} options={choices.characters} onChange={setFixtureParty} />
          <label class="tkr-run-field">
            Font
            <input type="text" value={font} onInput={(event) => setFont(event.currentTarget.value)} />
          </label>
          <label class="tkr-run-field">
            Font size
            <input type="number" min={1} step={1} value={fontSize} onInput={(event) => setFontSize(event.currentTarget.value)} />
          </label>
          <Select label="Message window picture" value={windowGraphic} options={choices.pictures} onChange={setWindowGraphic} none="None" />
        </>,
        chosenProgram === "" ? "This project has no programs to test." : null,
        () => ({
          kind: "program",
          ...base,
          program: chosenProgram,
          fixture: {
            id: "Run panel test settings",
            party: fixtureParty,
            ...(font === "" ? {} : { font }),
            ...(fontSize === "" ? {} : { fontSize: Number(fontSize) }),
            ...(windowGraphic === "" ? {} : { windowGraphic }),
            ...(fixtureBoard === "" ? {} : { start: { board: fixtureBoard, ...fixtureAt } }),
          },
        }),
      )}
      {busy ? <p role="status">Saving and starting…</p> : null}
      {refusal === null ? null : <p class="tkr-run-refusal" role="alert">{refusal}</p>}
      {run === null || status === null ? null : (
        <div class="tkr-run-current" role="status" aria-label="Current run">
          <StatusLine status={status} />
          <Snapshot snapshot={run.snapshot} />
          {finished ? null : <button type="button" onClick={() => run.stop()}>Stop</button>}
        </div>
      )}
    </section>
  );
}
