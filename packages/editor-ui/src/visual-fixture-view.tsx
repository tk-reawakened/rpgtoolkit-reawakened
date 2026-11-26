import { useEffect, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";
import type { ApplyResult, ProgramCommand } from "@tk-reawakened/editor-model";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import {
  appendFixtureCase,
  fixtureSource,
  projectVisualFixtureSource,
  replaceFixtureLine,
  type VisualFixtureDefinition,
} from "./visual-fixture-projection.ts";

export interface VisualFixtureDocument {
  readonly identity: { readonly key: string };
  getSnapshot(): { readonly text: string; readonly readOnly: unknown | null };
  subscribe(listener: () => void): () => void;
  apply(command: ProgramCommand): ApplyResult | Promise<ApplyResult>;
}

/** A board's placement mode, so the start fields can say tiles (1-based) or pixels (0-based). */
export interface BoardCoordinates {
  readonly mode: "pixel" | "tile";
  readonly width: number;
  readonly height: number;
}

export interface VisualFixtureViewProps {
  readonly doc: VisualFixtureDocument;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly onRun?: (seed: number) => void;
  /** Reads the fixture board's coordinate mode; without it the start fields accept both modes. */
  readonly boardCoordinates?: (boardPath: string) => Promise<BoardCoordinates | null>;
}

interface ActionRow { readonly action: string; readonly ticks: number }
const ASSERTION_PATHS = "player.tileX player.tileY player.x player.y player.layer player.facing board";

function parseActionList(value: string): ActionRow[] | null {
  const rows: ActionRow[] = [];
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(up|down|left|right|confirm|cancel|menu)\s*,\s*(\d+)$/i.exec(trimmed);
    if (match === null) return null;
    const ticks = Number(match[2]);
    if (!Number.isInteger(ticks) || ticks < 1 || ticks > 1_000) return null;
    rows.push({ action: match[1]!.toLowerCase(), ticks });
  }
  return rows.length > 0 ? rows : null;
}

function validProjectPath(value: string, extension: string): boolean {
  return value.length > 0 && value.length <= 255 && value.toLowerCase().endsWith(extension)
    && !value.includes("\n") && !value.includes("\r") && !value.includes("\0")
    && !value.startsWith("/") && !/^[A-Za-z]:/.test(value)
    && !value.replaceAll("\\", "/").split("/").includes("..");
}

function textValue(value: string): string | number {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

function fullSourceEdit(source: string, text: string): ProgramCommand {
  let from = 0;
  while (from < source.length && from < text.length && source[from] === text[from]) from += 1;
  let oldEnd = source.length;
  let newEnd = text.length;
  while (oldEnd > from && newEnd > from && source[oldEnd - 1] === text[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  return { type: "edit-text", edits: [{ from, to: oldEnd, text: text.slice(from, newEnd) }], label: "Edit visual fixture" };
}

/** TOOL-12 projection for *.spec.prg. This view edits only recognised calls and leaves other source opaque. */
export function VisualFixtureView({ doc, onEdited, onRun, boardCoordinates }: VisualFixtureViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const source = snapshot.text;
  const projection = projectVisualFixtureSource(source);
  const [board, setBoard] = useState(projection.fixture?.definition.board ?? "");
  const [party, setParty] = useState(projection.fixture?.definition.party.join(", ") ?? "");
  const [x, setX] = useState(String(projection.fixture?.definition.x ?? 1));
  const [y, setY] = useState(String(projection.fixture?.definition.y ?? 1));
  const [layer, setLayer] = useState(String(projection.fixture?.definition.layer ?? 1));
  const [facing, setFacing] = useState(projection.fixture?.definition.facing ?? "E");
  const [caseName, setCaseName] = useState("");
  const [actions, setActions] = useState("right, 35");
  const [path, setPath] = useState("player.tileX");
  const [expected, setExpected] = useState("2");
  const [seed, setSeed] = useState(String(projection.fixture?.definition.seed ?? 0));
  const [waitTicks, setWaitTicks] = useState("60");
  const [waitForValue, setWaitForValue] = useState(false);
  const [coordinates, setCoordinates] = useState<BoardCoordinates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fixtureBoard = projection.fixture?.definition.board ?? "";
  useEffect(() => {
    const definition = projectVisualFixtureSource(source).fixture?.definition;
    setBoard(definition?.board ?? "");
    setParty(definition?.party.join(", ") ?? "");
    setX(String(definition?.x ?? 1));
    setY(String(definition?.y ?? 1));
    setLayer(String(definition?.layer ?? 1));
    setFacing(definition?.facing ?? "E");
    setSeed(String(definition?.seed ?? 0));
  }, [source]);
  useEffect(() => {
    let current = true;
    setCoordinates(null);
    if (boardCoordinates === undefined || fixtureBoard.length === 0) return () => { current = false; };
    void boardCoordinates(fixtureBoard).then((value) => {
      if (current) setCoordinates(value);
    }).catch(() => {
      if (current) setCoordinates(null);
    });
    return () => { current = false; };
  }, [fixtureBoard, boardCoordinates]);

  async function apply(source: string, text: string): Promise<boolean> {
    if (doc.getSnapshot().text !== source) {
      setError("The source changed in the text editor. The fixture view has been refreshed; retry the edit.");
      return false;
    }
    if (source === text) {
      setError(null);
      return true;
    }
    const result = await doc.apply(fullSourceEdit(source, text));
    if (!result.ok) {
      setError(result.rejection.message);
      return false;
    }
    onEdited({ document: doc.identity.key, editId: result.editId, label: "Edit visual fixture" });
    setError(null);
    return true;
  }

  async function saveFixture(event: Event): Promise<void> {
    event.preventDefault();
    const paths = party.split(",").map((entry) => entry.trim()).filter(Boolean);
    const startX = Number(x);
    const startY = Number(y);
    const startLayer = Number(layer);
    const startSeed = Number(seed);
    if (!validProjectPath(board, ".brd") || paths.length < 1 || paths.length > 5 || paths.some((item) => !validProjectPath(item, ".tem")) || new Set(paths).size !== paths.length) {
      setError("Use one project-relative .brd and one to five distinct project-relative .tem character paths.");
      return;
    }
    if (![startX, startY, startLayer].every(Number.isSafeInteger) || startX < 0 || startY < 0 || startLayer < 1) {
      setError("Start coordinates must be whole numbers; tiles are 1-based and pixels are 0-based, and the layer is at least 1.");
      return;
    }
    if (coordinates !== null) {
      const inside = coordinates.mode === "pixel"
        ? startX < coordinates.width && startY < coordinates.height && startX >= 0 && startY >= 0
        : startX >= 1 && startX <= coordinates.width && startY >= 1 && startY <= coordinates.height;
      if (!inside) {
        setError(coordinates.mode === "pixel"
          ? `This pixel board places the party from 0 to ${coordinates.width - 1} across and 0 to ${coordinates.height - 1} down.`
          : `This tile board places the party from 1 to ${coordinates.width} across and 1 to ${coordinates.height} down.`);
        return;
      }
    }
    if (!Number.isSafeInteger(startSeed) || startSeed < 0 || startSeed > 4_294_967_295) {
      setError("Seed must be a whole number from 0 to 4,294,967,295.");
      return;
    }
    if (!("N NE E SE S SW W NW".split(" ").includes(facing.toUpperCase()))) {
      setError("Facing must be one of N, NE, E, SE, S, SW, W or NW.");
      return;
    }
    const definition: VisualFixtureDefinition = {
      ...(projection.fixture?.definition ?? {}),
      board,
      party: paths,
      x: startX,
      y: startY,
      layer: startLayer,
      facing: facing.toUpperCase(),
      seed: startSeed,
    };
    const call = fixtureSource(definition);
    const current = doc.getSnapshot().text;
    const currentProjection = projectVisualFixtureSource(current);
    if (currentProjection.fixture !== null) {
      const leading = /^\s*/.exec(current.slice(currentProjection.fixture.from, currentProjection.fixture.to))?.[0] ?? "";
      await apply(current, replaceFixtureLine(current, currentProjection.fixture.from, currentProjection.fixture.to, `${leading}${call}`));
    } else {
      const newline = current.includes("\r\n") ? "\r\n" : "\n";
      const lineStart = currentProjection.insert.from;
      await apply(current, `${current.slice(0, lineStart)}${call}${newline}${current.slice(lineStart)}`);
    }
  }

  async function addCase(event: Event): Promise<void> {
    event.preventDefault();
    const current = doc.getSnapshot().text;
    const currentProjection = projectVisualFixtureSource(current);
    if (currentProjection.fixture === null) {
      setError("Choose a fixture board and party before adding a player action case.");
      return;
    }
    const rows = parseActionList(actions);
    if (caseName.trim().length === 0 || rows === null) {
      setError("Give the case a name and list one or more actions as action, ticks (1–1,000) on separate lines.");
      return;
    }
    if (!ASSERTION_PATHS.split(" ").includes(path)) {
      setError("Choose a supported player-position or board assertion path.");
      return;
    }
    const maxWait = Number(waitTicks);
    if (!Number.isInteger(maxWait) || maxWait < 0 || maxWait > 1_000) {
      setError("Wait ticks must be a whole number from 0 to 1,000.");
      return;
    }
    const value = textValue(expected);
    if (typeof value === "number" && !Number.isFinite(value)) {
      setError("Expected value must be finite text or a finite number.");
      return;
    }
    let next: string;
    try {
      next = appendFixtureCase(current, { name: caseName.trim(), actions: rows, assertPath: path, expected: value, waitTicks: maxWait, waitForValue, insert: currentProjection.insert });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The case could not be written.");
      return;
    }
    if (await apply(current, next)) setCaseName("");
  }

  const xLabel = coordinates?.mode === "pixel"
    ? `Start pixel X (0–${coordinates.width - 1})`
    : coordinates?.mode === "tile" ? `Start tile X (1–${coordinates.width})` : "Start X (tile, or pixels on pixel boards)";
  const yLabel = coordinates?.mode === "pixel"
    ? `Start pixel Y (0–${coordinates.height - 1})`
    : coordinates?.mode === "tile" ? `Start tile Y (1–${coordinates.height})` : "Start Y (tile, or pixels on pixel boards)";
  return (
    <section class="tkr-visual-fixtures" aria-label="Visual test fixture editor" data-tkr-editor="Visual test fixtures">
      <h2>Visual test fixture</h2>
      <p>Cards project only recognised TOOL-5 calls from this <code>*.spec.prg</code>. Other RPGCode stays in the source unchanged. Save this file, then run the saved tests with the existing TOOL-5 runner.</p>
      {onRun === undefined ? null : <button type="button" onClick={() => {
        const runSeed = Number(seed);
        if (!Number.isSafeInteger(runSeed) || runSeed < 0 || runSeed > 4_294_967_295) {
          setError("Seed must be a whole number from 0 to 4,294,967,295.");
          return;
        }
        onRun(runSeed);
      }}>Save and run saved tests</button>}
      <form onSubmit={(event) => { void saveFixture(event); }}>
        <fieldset disabled={snapshot.readOnly !== null}>
          <legend>Starting scene</legend>
          <label>Board project path <input required value={board} onInput={(event) => setBoard((event.currentTarget as HTMLInputElement).value)} placeholder="Boards/wall.brd" /></label>
          <label>Party character paths, comma separated <input required value={party} onInput={(event) => setParty((event.currentTarget as HTMLInputElement).value)} placeholder="Chrs/Hero.tem" /></label>
          <label>{xLabel} <input required type="number" min="0" step="1" value={x} onInput={(event) => setX((event.currentTarget as HTMLInputElement).value)} /></label>
          <label>{yLabel} <input required type="number" min="0" step="1" value={y} onInput={(event) => setY((event.currentTarget as HTMLInputElement).value)} /></label>
          <label>Layer <input required type="number" min="1" step="1" value={layer} onInput={(event) => setLayer((event.currentTarget as HTMLInputElement).value)} /></label>
          <label>Seed <input required type="number" min="0" max="4294967295" step="1" value={seed} onInput={(event) => setSeed((event.currentTarget as HTMLInputElement).value)} /></label>
          <label>Facing <select value={facing} onChange={(event) => setFacing((event.currentTarget as HTMLSelectElement).value)}>{"N NE E SE S SW W NW".split(" ").map((value) => <option value={value}>{value}</option>)}</select></label>
          <button type="submit">Save fixture card to source</button>
        </fieldset>
      </form>
      <p>Other fixture fields a card cannot show, such as gold, stats, inventory, variables and file allowances, stay in the source untouched.</p>
      {projection.fixture === null ? <p>No recognised fixture call yet.</p> : <p>Fixture at source line {projection.fixture.line}: <code>{projection.fixture.definition.board}</code>, start ({projection.fixture.definition.x}, {projection.fixture.definition.y}).</p>}
      <form onSubmit={(event) => { void addCase(event); }}>
        <fieldset disabled={snapshot.readOnly !== null}>
          <legend>Ordered player action list and assertion</legend>
          <label>Case name <input required value={caseName} onInput={(event) => setCaseName((event.currentTarget as HTMLInputElement).value)} /></label>
          <label>Actions, one <code>action, ticks</code> per line <textarea required rows={4} value={actions} onInput={(event) => setActions((event.currentTarget as HTMLTextAreaElement).value)} /></label>
          <label>Assert state path <select value={path} onChange={(event) => setPath((event.currentTarget as HTMLSelectElement).value)}>{ASSERTION_PATHS.split(" ").map((value) => <option value={value}>{value}</option>)}</select></label>
          <label>Wait up to ticks <input required type="number" min="0" max="1000" step="1" value={waitTicks} onInput={(event) => setWaitTicks((event.currentTarget as HTMLInputElement).value)} /></label>
          <label><span>Wait for the value before asserting</span> <input type="checkbox" checked={waitForValue} onChange={(event) => setWaitForValue((event.currentTarget as HTMLInputElement).checked)} /></label>
          <label>Expected value <input required value={expected} onInput={(event) => setExpected((event.currentTarget as HTMLInputElement).value)} /></label>
          <button type="submit">Add case to source</button>
        </fieldset>
      </form>
      <p>A case is written inside the <code>describe</code> that owns the fixture, so a group-scoped fixture keeps its cases in scope.</p>
      {projection.cases.length === 0 ? <p>No recognised action cases yet.</p> : <ol aria-label="Saved action lists">{projection.cases.map((item) => <li key={`${item.startLine}:${item.name}`}><strong>{item.name}</strong> <span>{item.actions.map((entry) => `${entry.action} for ${entry.ticks} ticks`).join(" → ") || "no recognised actions"}</span></li>)}</ol>}
      {projection.opaque.length === 0 ? null : <details><summary>Unchanged source lines ({projection.opaque.length})</summary><pre>{projection.opaque.map((line) => line.text).join("\n")}</pre></details>}
      {error === null ? null : <p role="alert">{error}</p>}
      {snapshot.readOnly !== null ? <p role="status">This compiled program is read-only.</p> : null}
    </section>
  );
}
