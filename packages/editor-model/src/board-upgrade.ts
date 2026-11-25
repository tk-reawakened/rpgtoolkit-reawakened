import { boardGrid, decodeBoard, foldPath, coordLayout, stackedToRotated, writeBoard, type Board } from "@tk-reawakened/core";
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
  const cellsPerLayer = nextGrid.width * nextGrid.height;
  const tileMatrix = new Array<number>(cellsPerLayer * board.sizeL).fill(0);
  const oldCellsPerLayer = oldGrid.width * oldGrid.height;
  for (let layer = 0; layer < board.sizeL; layer += 1) {
    for (let y = 1; y <= oldGrid.height; y += 1) {
      for (let x = 1; x <= oldGrid.width; x += 1) {
        const rotated = stackedToRotated(x, y, board.sizeX);
        const from = layer * oldCellsPerLayer + (y - 1) * oldGrid.width + x - 1;
        const to = layer * cellsPerLayer + (rotated.y - 1) * nextGrid.width + rotated.x - 1;
        if (rotated.x < 1 || rotated.x > nextGrid.width || rotated.y < 1 || rotated.y > nextGrid.height || from >= board.tileMatrix.length) {
          return { ok: false, message: `The stacked tile at column ${x}, row ${y} cannot be represented on the rotated grid.` };
        }
        tileMatrix[to] = board.tileMatrix[from]!;
      }
    }
  }

  const tileRuns = encodeTileRuns(tileMatrix);
  const shadeLayers = [];
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

function encodeTileRuns(cells: readonly number[]): Board["tileRuns"] {
  const runs: Board["tileRuns"][number][] = [];
  for (let at = 0; at < cells.length;) {
    const lutIndex = cells[at]!;
    let end = at + 1;
    while (end < cells.length && cells[end] === lutIndex && end - at < 32_768) end += 1;
    const count = end - at;
    runs.push({ lutIndex, count, marker: count > 1 });
    at = end;
  }
  return runs;
}
export type BoardUpgradeOperation = BoardCoordinateUpgrade | "pre-vector";

export interface BoardUpgradeCopyOptions {
  readonly fs: Pick<FileSystemService, "readProject" | "statProject" | "writeProject">;
  readonly dialogs: Pick<DialogService, "ask" | "pickSavePath">;
  readonly projectId: string;
  readonly boardPath: string;
  readonly operation: BoardUpgradeOperation;
  readonly hasPendingEdits: () => boolean;
}

/** Preview and write an upgraded board as a new file; never edits the source document. */
export async function upgradeBoardCopy(options: BoardUpgradeCopyOptions): Promise<PlatformResult<string | null>> {
  const { fs, dialogs, projectId, boardPath, operation, hasPendingEdits } = options;
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
    if (decoded.value.layout !== "pre-vector") {
      return platformError("invalid-request", `${boardPath} is not a supported pre-vector board; no copy was created.`);
    }
    board = decoded.value.board;
    title = "Upgrade pre-vector board";
    summary = `Creates a minor-4 board with the documented tile, vector, program, shading and position conversions. The original ${boardPath} is retained.`;
  } else {
    if (decoded.value.layout !== "vector") {
      return platformError("invalid-request", `Upgrade ${boardPath} to the vector layout before changing its coordinates.`);
    }
    const planned = planBoardCoordinateUpgrade(decoded.value.board, operation);
    if (!planned.ok) return platformError("invalid-request", `${boardPath}: ${planned.message}`);
    ({ board, title, summary } = planned.value);
  }

  const encoded = writeBoard(board);
  if (!encoded.ok) return platformError("invalid-request", `${boardPath}: ${encoded.error.message}`);
  const warnings = decoded.warnings.length === 0 ? "No conversion warnings." : `Warnings: ${decoded.warnings.join("; ")}`;
  const answer = await dialogs.ask({
    message: `${title}: ${boardPath}?`,
    detail: `${summary} ${warnings} The source file will not be changed.`,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "preview", label: "Choose copy destination…" }],
    cancel: "cancel",
  });
  if (answer !== "preview") return platformOk(null);

  const suggested = boardPath.replace(/\.brd$/i, operation === "pre-vector" ? ".upgraded.brd" : operation === "stacked-to-rotated" ? ".rotated.brd" : ".pixels.brd");
  const destination = await dialogs.pickSavePath({ document: boardPath, suggested });
  if (destination === null) return platformOk(null);
  if (!/^(?:game\/[^/]+\/)?boards\/(?:[^/]+\/)*[^/]+\.brd$/i.test(destination)
    || /[\\:\u0000-\u001f\u007f]/.test(destination)
    || destination.split("/").some((part) => part === "." || part === "..")) {
    return platformError("invalid-path", `Choose a project board path ending in .brd: ${destination}`);
  }
  if (foldPath(destination) === foldPath(boardPath)) {
    return platformError("invalid-request", "An upgrade must be saved as a separate board; the original was not changed.");
  }
  if (hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);

  const current = await fs.readProject(projectId, boardPath);
  if (!current.ok) return platformError(current.error.code, `Could not recheck ${boardPath}: ${current.error.message}`);
  if (!sameBytes(source.value, current.value)) {
    return platformError("invalid-request", `${boardPath} changed while the upgrade was being reviewed. Review the current file and try again.`);
  }
  const existing = await fs.statProject(projectId, destination);
  if (existing.ok) return platformError("already-exists", `${destination} already exists. Upgrades never replace files.`);
  if (existing.error.code !== "not-found") return platformError(existing.error.code, `Could not check ${destination}: ${existing.error.message}`);
  const written = await fs.writeProject(projectId, destination, encoded.value);
  return written.ok ? platformOk(destination) : platformError(written.error.code, `Could not write ${destination}: ${written.error.message}`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}
