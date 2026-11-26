import type { CommandRegistry, WorkbenchCommand } from "@tk-reawakened/editor-model";
import type { SettingsService, SettingValue } from "@tk-reawakened/platform-services";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

export type FirstBoardHelpSurface = "guide" | "tip";

export interface FirstBoardTutorialProps {
  readonly host: "browser" | "vscode";
  readonly surface: FirstBoardHelpSurface;
  readonly settings: Pick<SettingsService, "get" | "set">;
  readonly commandRegistry: CommandRegistry;
  readonly canWrite: boolean;
  readonly canRun: boolean;
  readonly onClose: () => void;
  /** A startup tip is available without moving keyboard focus from the editor. */
  readonly autofocus?: boolean;
}

const STEP = "onboarding.firstBoard.step";
const TIPS = "editor.showTips";

const BACK = { id: "help.firstBoard.back", label: "Previous step" } as const;
const NEXT = { id: "help.firstBoard.next", label: "Next step" } as const;
const RESTART = { id: "help.firstBoard.restart", label: "Restart tutorial" } as const;
const CLOSE = { id: "help.firstBoard.close", label: "Close help" } as const;
const TOGGLE_TIP = { id: "help.dailyTip.toggle", label: "Show a tip when the editor opens" } as const;

export const FIRST_BOARD_ACTIONS = [BACK, NEXT, RESTART, CLOSE, TOGGLE_TIP] as const;
export type FirstBoardActionId = (typeof FIRST_BOARD_ACTIONS)[number]["id"];

export function firstBoardHelpCommands(open: (surface: FirstBoardHelpSurface) => void): readonly WorkbenchCommand[] {
  return [
    { id: "help.firstBoard", category: "Help", label: "First board tutorial", run: () => open("guide") },
    { id: "help.dailyTip", category: "Help", label: "Tip of the day", run: () => open("tip") },
  ];
}

export async function readFirstBoardTipsEnabled(settings: Pick<SettingsService, "get">): Promise<boolean> {
  try {
    const result = await settings.get("user", TIPS);
    return result.ok && result.value !== false;
  } catch {
    // Leave automatic tips off when the host cannot read preferences. Manual help explains the failure.
    return false;
  }
}

interface Step {
  readonly title: string;
  readonly browser?: string;
  readonly vscode?: string;
  readonly action: string;
  readonly tip: string;
  readonly needs?: "write" | "run";
}

const STEPS: readonly Step[] = [
  {
    title: "Create a project",
    browser: "From the browser editor’s welcome page choose New project.",
    vscode: "Press F1, search for RPG Toolkit: New project, and choose it.",
    action: "Name the game, leave the suggested main file name, and select Default tiles, Empty first character and Start-up program. Choose an empty writable folder and confirm. If you cancel the wizard no project is written; return here at the same step.",
    tip: "The starter choices are opt-in. Nothing is copied for an unticked item.",
    needs: "write",
  },
  {
    title: "Find Game and Files",
    browser: "In the workbench find Game and Files. The Game groups show assets by type; Files shows actual folders and file names.",
    vscode: "In Explorer open the Toolkit Game view for asset groups. Use the regular Explorer folder tree for Files.",
    action: "Open the game’s .gam file to see its settings. Find Tiles/starter.tst and Chrs/start.tem in the file tree. These are shared files; browsing and selection do not edit them.",
    tip: "Game groups help find the asset type, and Files shows where it actually lives.",
  },
  {
    title: "Make a board",
    browser: "In Files choose New board, or search for New Board in the command palette.",
    vscode: "Press F1 and search for RPG Toolkit: New board.",
    action: "Name the board Meadow. Choose 20 by 15 tiles, two layers and a flat square board, and confirm. If you cancel, reopen the same action without advancing this guide.",
    tip: "A board is an area your player can visit. You can make another without changing where the game starts.",
    needs: "write",
  },
  {
    title: "Choose a brush",
    action: "While Meadow is active, open the Tileset browser (press L from a focused board cell). Choose starter.tst, then select Tile 1 with the pointer or Tab, the arrow keys and Enter. Choosing a brush does not paint. If you edit the tileset art itself, every board that uses that shared tile can change.",
    tip: "Picking a brush changes your tool. Editing shared tileset art changes the source used by other boards.",
  },
  {
    title: "Paint and move around",
    action: "With the Draw tool selected, click a board cell, or use Tab to focus the grid, the arrow keys to move and Space to paint. Paint a few cells, then use Undo and Redo to see which edits belong to this board.",
    tip: "The board grid has one tab stop. Use the arrow keys to move between cells and Space to use the active tool.",
    needs: "write",
  },
  {
    title: "Look at layers",
    action: "Choose the second layer and paint a tile above the first. Open Visible layers and hide and show the first layer. Use Tab to reach the checkboxes and Space to toggle them. The current layer always stays visible; hiding a layer changes only your view, not the saved board.",
    tip: "Layer visibility is just a view choice. It never erases tiles or changes what the game loads.",
  },
  {
    title: "Set the board and player start",
    action: "Open Board properties. Under Player start set a valid Start column, Start row and Start layer (try 2, 2, 1), then choose Apply player start. Choose Set as initial board and confirm. The start marker belongs to this board; the initial board name belongs to the separate main game file.",
    tip: "A board’s player start is saved with the board. Which board opens first is saved with the game’s main file.",
    needs: "write",
  },
  {
    title: "Save, close and reopen",
    action: "Save both Meadow and the main game file using their Save actions (Ctrl+S or Cmd+S with each focused). If saving fails, read the error, keep the editor open, restore write access or resolve the conflict and retry. When saved, close and reopen the files from Files and check the tiles and start values are still there.",
    tip: "Saving the board does not save the main file. Save both after you change the initial board.",
    needs: "write",
  },
  {
    title: "Compare preview, test and startup",
    browser: "Choose New run setup next to Run, then use the Test board tab and its Test board button. You do not need to save the setup. For normal startup, select Game start-up in Run setup and press Run.",
    vscode: "In Run and Debug choose Test board and start it with F5. Use RPG Toolkit: Run Game for normal startup.",
    action: "The board picture is a preview, not a game. For Test board, choose Meadow and start.tem and give it a different position (try column 4, row 3, layer 1). It starts there without the start-up program and does not write that position into the project. Stop it, then start the game normally. When the welcome message appears, press a key in the player to enter Meadow at the saved start. The blank starter character has no artwork. No programming is required.",
    tip: "A board test uses the chosen board and position; Run game uses the project’s saved startup settings.",
    needs: "run",
  },
];

const DAY_MS = 86_400_000;

export function firstBoardTipOfTheDay(): string {
  return STEPS[Math.floor(Date.now() / DAY_MS) % STEPS.length]!.tip;
}

function action(definition: (typeof FIRST_BOARD_ACTIONS)[number], run: WorkbenchCommand["run"], disabled = false): WorkbenchCommand {
  return { ...definition, category: "Help", run, disabled };
}
const readingError = "Could not read your tutorial preferences. Close and reopen the help to try again.";

export function FirstBoardTutorial({ host, surface, settings, commandRegistry, canWrite, canRun, onClose, autofocus = true }: FirstBoardTutorialProps) {
  const guide = surface === "guide";
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(1);
  const [tip] = useState(firstBoardTipOfTheDay);
  const [tipsEnabled, setTipsEnabled] = useState(true);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false);
  const moved = useRef(false);

  useEffect(() => {
    let active = true;
    const read = async (): Promise<void> => {
      try {
        const result = await settings.get("user", guide ? STEP : TIPS);
        if (!active) return;
        if (!result.ok) { setError(readingError); return; }
        const value = result.value;
        if (!guide) setTipsEnabled(value !== false);
        else if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= STEPS.length) setStep(value);
        setReady(true);
      } catch {
        if (active) setError(readingError);
      }
    };
    void read();
    return () => { active = false; };
  }, [guide, settings]);

  useLayoutEffect(() => {
    if (ready && (autofocus || moved.current)) heading.current?.focus();
  }, [autofocus, ready, step]);

  const write = async (id: string, value: SettingValue, apply: () => void): Promise<void> => {
    if (!ready || writing.current) return;
    writing.current = true;
    setPending(true);
    setError("");
    try {
      const result = await settings.set("user", id, value);
      if (result.ok) apply();
      else setError(`Could not save your preference: ${result.error.message}`);
    } catch {
      setError("Could not save your preference. Try again.");
    } finally {
      writing.current = false;
      setPending(false);
    }
  };
  const move = (next: number): Promise<void> => write(STEP, next, () => {
    moved.current = true;
    setStep(next);
  });
  const disabled = !ready || pending;
  useLayoutEffect(() => commandRegistry.registerMany([
    action(BACK, () => move(step - 1), !guide || disabled || step === 1),
    action(NEXT, () => move(step + 1), !guide || disabled || step === STEPS.length),
    action(RESTART, () => move(1), !guide || disabled || step === 1),
    action(CLOSE, onClose),
    action(TOGGLE_TIP, () => write(TIPS, !tipsEnabled, () => setTipsEnabled(!tipsEnabled)), guide || disabled),
  ]), [commandRegistry, guide, disabled, step, tipsEnabled, settings, onClose]);
  const info = STEPS[step - 1]!;

  return (
    <section class="tkr-first-board-help" aria-labelledby={headingId} onKeyDown={(event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        commandRegistry.execute(CLOSE.id);
      }
    }}>
      <header><strong>{guide ? "First board tutorial" : "Tip of the day"}</strong>
        <button type="button" onClick={() => commandRegistry.execute(CLOSE.id)}>{CLOSE.label}</button>
      </header>
      {error !== "" && <p role="alert">{error}</p>}
      {!ready && error === "" && <p role="status">Reading your tutorial preferences…</p>}
      {guide ? <>
        <h2 id={headingId} tabIndex={-1} ref={heading}>Step {step} of {STEPS.length}: {info.title}</h2>
        <p>Do the step in the editor, then return here. Tab and Enter operate the guide; Escape closes it without changing the project.</p>
        {info[host] !== undefined && <p>{info[host]}</p>}
        <p>{info.action}</p>
        {info.needs === "write" && !canWrite && <p role="status">This step needs a writable project folder. Choose or open one before making project changes.</p>}
        {info.needs === "run" && !canRun && <p role="status">No player is available in this editor session. Open a supported browser editor or VS Code project to compare the runs.</p>}
        <nav aria-label="Tutorial steps">
          <button type="button" disabled={disabled || step === 1} onClick={() => commandRegistry.execute(BACK.id)}>{BACK.label}</button>
          <button type="button" disabled={disabled || step === STEPS.length} onClick={() => commandRegistry.execute(NEXT.id)}>{NEXT.label}</button>
          <button type="button" disabled={disabled || step === 1} onClick={() => commandRegistry.execute(RESTART.id)}>{RESTART.label}</button>
        </nav>
      </> : <>
        <h2 id={headingId} tabIndex={-1} ref={heading}>A tip for today</h2>
        <p>{tip}</p>
        <label><input type="checkbox" checked={tipsEnabled} disabled={disabled} onChange={(event) => {
          event.currentTarget.checked = tipsEnabled;
          commandRegistry.execute(TOGGLE_TIP.id);
        }} />{TOGGLE_TIP.label}</label>
      </>}
    </section>
  );
}
