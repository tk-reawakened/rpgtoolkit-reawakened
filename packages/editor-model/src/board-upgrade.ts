import { BOARD_DETECT_OFFSET, BOARD_MAX_CELLS, boardGrid, decodeBoard, foldPath, coordLayout, stackedToRotated, writeBoard, type Board } from "@tk-reawakened/core";
import { platformError, platformOk, type DialogService, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";
import { decodeShade, encodeShade } from "./board-document.ts";

export type BoardCoordinateUpgrade = "stacked-to-rotated" | "tile-to-pixel";

export interface BoardUpgradePlan {
  readonly board: Board;
  readonly title: string;
  readonly summary: string;
}

export type BoardUpgradePlanResult =
  | { readonly ok: true; readonly value: BoardUpgradePlan }
  | { readonly ok: false; readonly message: string };

/** Plan a one-way coordinate conversion without mutating the open board. */
export function planBoardCoordinateUpgrade(board: Board, upgrade: BoardCoordinateUpgrade): BoardUpgradePlanResult {
  const pixelFlag = board.coordType & 4;
  if (upgrade === "tile-to-pixel") {
    if (pixelFlag !== 0) return { ok: false, message: "This board already uses pixel coordinates." };
    const converted = { ...board, coordType: board.coordType | 4 };
    return {
      ok: true,
      value: {
        board: converted,
        title: "Convert tile coordinates to pixels",
        summary: "Changes the board's script coordinate unit to pixels. Board object positions are already stored in pixels; scripts and their literal text are unchanged.",
      },
    };
  }

  if (coordLayout(board.coordType) !== "iso-stacked") {
    return { ok: false, message: "Only iso-stacked boards can be converted to iso-rotated coordinates." };
  }

  const oldGrid = boardGrid(board.sizeX, board.sizeY, board.coordType);
  const rotatedCoordType = (board.coordType & ~1) | 2;
  const nextGrid = boardGrid(board.sizeX, board.sizeY, rotatedCoordType);
  const oldCellsPerLayer = oldGrid.width * oldGrid.height;
  const cellsPerLayer = nextGrid.width * nextGrid.height;
  const sourceCells = oldCellsPerLayer * board.sizeL;
  const destinationCells = cellsPerLayer * board.sizeL;
  if (!Number.isSafeInteger(destinationCells) || destinationCells > BOARD_MAX_CELLS) {
    return { ok: false, message: `The rotated grid would hold ${destinationCells} cells, beyond the board limit ${BOARD_MAX_CELLS}.` };
  }
  if (!Number.isSafeInteger(sourceCells) || board.tileMatrix.length !== sourceCells) {
    return { ok: false, message: "The source tile stream has cells that cannot be mapped exactly to the rotated grid." };
  }
  const tileMatrix = new Array<number>(destinationCells).fill(0);
  for (let layer = 0; layer < board.sizeL; layer += 1) {
    for (let y = 1; y <= oldGrid.height; y += 1) {
      for (let x = 1; x <= oldGrid.width; x += 1) {
        const rotated = stackedToRotated(x, y, board.sizeX);
        const from = layer * oldCellsPerLayer + (y - 1) * oldGrid.width + x - 1;
        const to = layer * cellsPerLayer + (rotated.y - 1) * nextGrid.width + rotated.x - 1;
        if (rotated.x < 1 || rotated.x > nextGrid.width || rotated.y < 1 || rotated.y > nextGrid.height) {
          return { ok: false, message: `The stacked tile at column ${x}, row ${y} cannot be represented on the rotated grid.` };
        }
        tileMatrix[to] = board.tileMatrix[from]!;
      }
    }
  }
  const tileRuns = encodeTileRuns(tileMatrix);
  if (tileRuns === null) return { ok: false, message: "The rotated tile stream needs more run records than the board format can store." };

  const shadeLayers: Board["shadeLayers"][number][] = [];
  for (const layer of board.shadeLayers) {
    const decoded = decodeShade(layer, oldCellsPerLayer);
    if (decoded === null) return { ok: false, message: "The board's shading records do not match its stacked grid; no conversion was made." };
    const rotated = new Int32Array(cellsPerLayer * 3);
    for (let y = 1; y <= oldGrid.height; y += 1) {
      for (let x = 1; x <= oldGrid.width; x += 1) {
        const toPoint = stackedToRotated(x, y, board.sizeX);
        const from = ((y - 1) * oldGrid.width + x - 1) * 3;
        const to = ((toPoint.y - 1) * nextGrid.width + toPoint.x - 1) * 3;
        rotated[to] = decoded[from]!;
        rotated[to + 1] = decoded[from + 1]!;
        rotated[to + 2] = decoded[from + 2]!;
      }
    }
    shadeLayers.push({ ...layer, records: encodeShade(rotated, cellsPerLayer) });
  }

  const converted: Board = {
    ...board,
    coordType: rotatedCoordType,
    tileMatrix,
    tileRuns,
    shadeLayers,
  };
  return {
    ok: true,
    value: {
      board: converted,
      title: "Convert iso-stacked to iso-rotated",
      summary: `Maps ${oldCellsPerLayer} tile and shade cells per layer into a ${nextGrid.width} × ${nextGrid.height} rotated grid. Board-pixel positions for vectors, programs, items, images, lights and the player start remain unchanged; script text is untouched.`,
    },
  };
}

function encodeTileRuns(cells: readonly number[]): Board["tileRuns"] | null {
  const runs: Board["tileRuns"][number][] = [];
  for (let at = 0; at < cells.length;) {
    const lutIndex = cells[at]!;
    let end = at + 1;
    while (end < cells.length && cells[end] === lutIndex && end - at < 32_768) end += 1;
    if (runs.length === 32_768) return null;
    const count = end - at;
    runs.push({ lutIndex, count, marker: count > 1 });
    at = end;
  }
  return runs;
}
 
export type BoardUpgradeOperation = BoardCoordinateUpgrade | "pre-vector";

export interface BoardUpgradeCopyOptions {
  readonly fs: Pick<FileSystemService, "readProject" | "listProject" | "statProject" | "writeProject">;
  readonly dialogs: Pick<DialogService, "ask" | "pickSavePath">;
  readonly projectId: string;
  readonly boardPath: string;
  readonly operation: BoardUpgradeOperation;
  readonly hasPendingEdits: () => boolean;
  /** Exclusive destination creator where the host provides one; null explicitly selects the disclosed fallback. */
  readonly createExclusive: ((destination: string, bytes: Uint8Array) => Promise<PlatformResult<void>>) | null;
}

/** Preview and write an upgraded board as a new file; never edits the source document. */
export async function upgradeBoardCopy(options: BoardUpgradeCopyOptions): Promise<PlatformResult<string | null>> {
  const { fs, dialogs, projectId, boardPath, operation, hasPendingEdits, createExclusive } = options;
  if (!/^(?:game\/[^/]+\/)?boards\/(?:[^/]+\/)*[^/]+\.brd$/i.test(boardPath)
    || /[\\:\u0000-\u001f\u007f]/.test(boardPath)
    || boardPath.split("/").some((part) => part === "." || part === "..")) {
    return platformError("invalid-path", `Upgrade requires a .brd file under Boards/ or Game/<game>/Boards/: ${boardPath}`);
  }
  if (hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
  const source = await fs.readProject(projectId, boardPath);
  if (!source.ok) return platformError(source.error.code, `Could not read ${boardPath}: ${source.error.message}`);
  const decoded = decodeBoard(source.value);
  if (!decoded.ok) return platformError("invalid-request", `${boardPath}: ${decoded.error.message}`);

  let board: Board;
  let title: string;
  let summary: string;
  if (operation === "pre-vector") {
    if (source.value[BOARD_DETECT_OFFSET] !== 0 || decoded.value.layout !== "pre-vector") {
      return platformError("invalid-request", `${boardPath} is not a supported binary pre-vector board; text boards and unsupported layouts cannot be upgraded.`);
    }
    board = decoded.value.board;
    title = "Upgrade pre-vector board";
    summary = `${board.sizeX} × ${board.sizeY} tiles across ${board.sizeL} layer(s), ${board.tileMatrix.length} stored tile cells, ${board.vectors.length} vectors, ${board.programs.length} programs, ${board.sprites.length} sprites, and ${board.shadeLayers.length} shading layer(s). Creates a minor-4 board with documented conversions; the original ${boardPath} is retained.`;
  } else {
    if (decoded.value.layout !== "vector") {
      return platformError("invalid-request", `Upgrade ${boardPath} to the vector layout before changing its coordinates.`);
    }
    const originalBoard = decoded.value.board;
    const planned = planBoardCoordinateUpgrade(originalBoard, operation);
    if (!planned.ok) return platformError("invalid-request", `${boardPath}: ${planned.message}`);
    ({ board, title, summary } = planned.value);
    summary = `Board ${originalBoard.sizeX} × ${originalBoard.sizeY}, ${originalBoard.sizeL} layer(s), ${originalBoard.tileMatrix.length} tile cells, ${originalBoard.tileRuns.length} tile runs, ${originalBoard.vectors.length} vectors, ${originalBoard.programs.length} programs, ${originalBoard.sprites.length} sprites, and ${originalBoard.shadeLayers.length} shade layers. ${summary}`;
  }

  const encoded = writeBoard(board);
  if (!encoded.ok) return platformError("invalid-request", `${boardPath}: ${encoded.error.message}`);
  const warnings = decoded.warnings.length === 0 ? "No conversion warnings." : `Warnings: ${decoded.warnings.join("; ")}`;
  const creationNotice = createExclusive === null
    ? "Destination creation is non-atomic on this host: same-editor upgrades are serialized, but another process can create the path between check and write."
    : "Destination creation uses an exclusive host operation; an existing destination is never replaced.";
  const answer = await dialogs.ask({
    message: `${title}: ${boardPath}?`,
    detail: `${summary} ${warnings} ${creationNotice} The source file will not be changed.`,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "preview", label: "Choose copy destination…" }],
    cancel: "cancel",
  });
  if (answer !== "preview") return platformOk(null);

  const suggested = boardPath.replace(/\.brd$/i, operation === "pre-vector" ? ".upgraded.brd" : operation === "stacked-to-rotated" ? ".rotated.brd" : ".pixels.brd");
  const picked = await dialogs.pickSavePath({ document: boardPath, suggested });
  if (picked === null) return platformOk(null);
  if (hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
  if (!/^(?:game\/[^/]+\/)?boards\/(?:[^/]+\/)*[^/]+\.brd$/i.test(picked)
    || /[\\:\u0000-\u001f\u007f]/.test(picked)
    || picked.split("/").some((part) => part === "." || part === "..")) {
    return platformError("invalid-path", `Choose a project board path ending in .brd: ${picked}`);
  }
  const sourceRoot = boardRoot(boardPath);
  const pickedRoot = boardRoot(picked);
  if (sourceRoot === null || pickedRoot === null || foldPath(sourceRoot) !== foldPath(pickedRoot)) {
    return platformError("invalid-request", "Save the upgraded copy under the same game's Boards folder so its asset references remain valid.");
  }
  const destination = sourceRoot + picked.slice(pickedRoot.length);
  if (foldPath(destination) === foldPath(boardPath)) {
    return platformError("invalid-request", "An upgrade must be saved as a separate board; the original was not changed.");
  }
  return serializeDestination(`${projectId}:${foldPath(destination)}`, async () => {
    if (hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
    const current = await fs.readProject(projectId, boardPath);
    if (!current.ok) return platformError(current.error.code, `Could not recheck ${boardPath}: ${current.error.message}`);
    if (!sameBytes(source.value, current.value)) {
      return platformError("invalid-request", `${boardPath} changed while the upgrade was being reviewed. Review the current file and try again.`);
    }
    const parent = destination.split("/").slice(0, -1).join("/");
    const basename = destination.split("/").at(-1)!;
    const entries = await fs.listProject(projectId, parent);
    if (!entries.ok) return platformError(entries.error.code, `Could not check destination folder ${parent}: ${entries.error.message}`);
    const collision = entries.value.find((entry) => foldPath(entry.name) === foldPath(basename));
    if (collision !== undefined) return platformError("already-exists", `${parent}/${collision.name} already exists. Upgrades never replace files.`);
    const existing = await fs.statProject(projectId, destination);
    if (existing.ok) return platformError("already-exists", `${destination} already exists. Upgrades never replace files.`);
    if (existing.error.code !== "not-found") return platformError(existing.error.code, `Could not check ${destination}: ${existing.error.message}`);
    if (hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
    const finalSource = await fs.readProject(projectId, boardPath);
    if (!finalSource.ok) return platformError(finalSource.error.code, `Could not recheck ${boardPath}: ${finalSource.error.message}`);
    if (!sameBytes(source.value, finalSource.value)) return platformError("invalid-request", `${boardPath} changed before the copy was written.`);
    const written = createExclusive === null
      ? await fs.writeProject(projectId, destination, encoded.value)
      : await createExclusive(destination, encoded.value);
    return written.ok ? platformOk(destination) : platformError(written.error.code, `Could not write ${destination}: ${written.error.message}`);
  });
}

const destinationLocks = new Map<string, Promise<void>>();

async function serializeDestination<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = destinationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  destinationLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (destinationLocks.get(key) === current) destinationLocks.delete(key);
  }
}

function boardRoot(path: string): string | null {
  return /^(?:game\/[^/]+\/)?boards\//i.exec(path)?.[0] ?? null;
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}
