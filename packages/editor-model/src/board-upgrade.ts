import { BOARD_DETECT_OFFSET, BOARD_MAX_CELLS, boardGrid, decodeBoard, foldPath, coordLayout, stackedToRotated, writeBoard, type Board } from "@tk-reawakened/core";
import { decodeShade, encodeShade, type SetBoardFieldsCommand } from "./board-document.ts";
import { platformError, platformOk, type DialogService, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";
import { withProjectPathWriteLock } from "./project-path-write-lock.ts";

export type BoardCoordinateUpgrade = "stacked-to-rotated" | "tile-to-pixel";

export interface BoardUpgradePlan {
  readonly board: Board;
  readonly title: string;
  readonly summary: string;
  /** A bounded, board-specific mapping preview for the confirmation dialog. */
  readonly preview: string;
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
        preview: `Coordinate flag ${board.coordType} → ${converted.coordType}. Tile cells, board-pixel object positions, and script literals remain unchanged.`,
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
  if (!Number.isSafeInteger(oldCellsPerLayer) || oldCellsPerLayer < 1 || oldCellsPerLayer > BOARD_MAX_CELLS
    || !Number.isSafeInteger(cellsPerLayer) || cellsPerLayer < 1 || cellsPerLayer > BOARD_MAX_CELLS) {
    return { ok: false, message: `The stacked or rotated per-layer grid exceeds the board limit ${BOARD_MAX_CELLS}.` };
  }
  const sourceCells = oldCellsPerLayer * board.sizeL;
  const destinationCells = cellsPerLayer * board.sizeL;
  if (!Number.isSafeInteger(destinationCells) || destinationCells > BOARD_MAX_CELLS) {
    return { ok: false, message: `The rotated grid would hold ${destinationCells} cells, beyond the board limit ${BOARD_MAX_CELLS}.` };
  }
  if (!Number.isSafeInteger(sourceCells) || board.tileMatrix.length !== sourceCells) {
    return { ok: false, message: "The source tile stream has cells that cannot be mapped exactly to the rotated grid." };
  }
  const tileMatrix = new Array<number>(destinationCells).fill(0);
  const previewMoves: string[] = [];
  let occupiedTiles = 0;
  for (let layer = 0; layer < board.sizeL; layer += 1) {
    for (let y = 1; y <= oldGrid.height; y += 1) {
      for (let x = 1; x <= oldGrid.width; x += 1) {
        const rotated = stackedToRotated(x, y, board.sizeX);
        const from = layer * oldCellsPerLayer + (y - 1) * oldGrid.width + x - 1;
        const to = layer * cellsPerLayer + (rotated.y - 1) * nextGrid.width + rotated.x - 1;
        if (rotated.x < 1 || rotated.x > nextGrid.width || rotated.y < 1 || rotated.y > nextGrid.height) {
          return { ok: false, message: `The stacked tile at column ${x}, row ${y} cannot be represented on the rotated grid.` };
        }
        const lutIndex = board.tileMatrix[from]!;
        tileMatrix[to] = lutIndex;
        if (lutIndex !== 0) {
          occupiedTiles += 1;
          if (previewMoves.length < 16) previewMoves.push(`L${layer + 1} (${x},${y}) tile ${lutIndex} → (${rotated.x},${rotated.y})`);
        }
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
  const outputRows = Array.from({ length: Math.min(8, nextGrid.height) }, (_, row) =>
    Array.from({ length: Math.min(8, nextGrid.width) }, (_, column) => tileMatrix[row * nextGrid.width + column] ?? 0).join(" ")).join(" / ");
  return {
    ok: true,
    value: {
      board: converted,
      title: "Convert iso-stacked to iso-rotated",
      summary: `Maps ${oldCellsPerLayer} tile and shade cells per layer into a ${nextGrid.width} × ${nextGrid.height} rotated grid. Board-pixel positions for vectors, programs, items, images, lights and the player start remain unchanged; script text is untouched.`,
      preview: `Tile mapping (first ${Math.min(16, occupiedTiles)} of ${occupiedTiles} occupied cells): ${previewMoves.length === 0 ? "no occupied tile cells" : previewMoves.join("; ")}. Output tile rows, layer 1 (up to 8×8): ${outputRows}. Output shade records begin: ${converted.shadeLayers[0]?.records.slice(0, 4).map(({ runCount, r, g, b }) => `${runCount}:${r},${g},${b}`).join("; ") ?? "none"}.`,
    },
  };
}
/** A single undoable model edit for a coordinate conversion opened from a copy of the original bytes. */
export function createBoardCoordinateUpgradeCommand(bytes: Uint8Array, operation: BoardCoordinateUpgrade): { readonly ok: true; readonly value: SetBoardFieldsCommand } | { readonly ok: false; readonly message: string } {
  const decoded = decodeBoard(bytes);
  if (!decoded.ok) return { ok: false, message: decoded.error.message };
  if (decoded.value.layout !== "vector") return { ok: false, message: "Coordinate upgrades require a vector board." };
  const planned = planBoardCoordinateUpgrade(decoded.value.board, operation);
  if (!planned.ok) return planned;
  const converted = planned.value.board;
  const fields = operation === "tile-to-pixel"
    ? { coordType: converted.coordType }
    : { coordType: converted.coordType, tileMatrix: converted.tileMatrix, tileRuns: converted.tileRuns, shadeLayers: converted.shadeLayers };
  return { ok: true, value: { type: "set-board-fields", fields } };
}

function encodeTileRuns(cells: readonly number[]): Board["tileRuns"] | null {
  const runs: Board["tileRuns"][number][] = [];
  for (let at = 0; at < cells.length;) {
    const lutIndex = cells[at]!;
    let end = at + 1;
    while (end < cells.length && cells[end] === lutIndex && end - at < 32_768) end += 1;
    if (runs.length >= BOARD_MAX_CELLS) return null;
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
  readonly hasPendingEdits: () => boolean | Promise<boolean>;
  /** Fast state check after the last settled view and final source read; it does not wait on another view round. */
  readonly hasPendingEditsNow?: () => boolean;
  /** Refuse a destination already represented by an open or cached editor document. */
  readonly isDestinationOpen?: (destination: string) => boolean;
  /** The owning game's resolved Boards folder; required by hosts when path components are ambiguous. */
  readonly boardsRoot?: string;
  /** Ensure the selected copy destination remains within the source's owning game. */
  readonly isDestinationOwnedBySource?: (destination: string) => boolean | Promise<boolean>;
  readonly createExclusive: ((destination: string, bytes: Uint8Array) => Promise<PlatformResult<void>>) | null;
}

/** Preview and write an upgraded board as a new file; never edits the source document. */
export async function upgradeBoardCopy(options: BoardUpgradeCopyOptions): Promise<PlatformResult<{ readonly destination: string; readonly bytes: Uint8Array } | null>> {
  const { fs, dialogs, projectId, boardPath, operation, hasPendingEdits, hasPendingEditsNow, boardsRoot, createExclusive, isDestinationOpen, isDestinationOwnedBySource } = options;
  if (!/^(?:game\/(?:[^/]+\/)+)?boards\/(?:[^/]+\/)*[^/]+\.brd$/i.test(boardPath)
    || /[\\:\u0000-\u001f\u007f]/.test(boardPath)
    || boardPath.split("/").some((part) => part === "." || part === "..")) {
    return platformError("invalid-path", `Upgrade requires a .brd file under Boards/ or a nested Game/<project>/Boards/ folder: ${boardPath}`);
  }
  const sourceRoot = (boardsRoot ?? boardRoot(boardPath))?.replace(/\/+$/, "");
  if (sourceRoot === undefined || sourceRoot === null || !foldPath(boardPath).startsWith(`${foldPath(sourceRoot)}/`)) {
    return platformError("invalid-path", `Could not determine the owning game's Boards folder for ${boardPath}.`);
  }
  if (await hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
  const source = await fs.readProject(projectId, boardPath);
  if (!source.ok) return platformError(source.error.code, `Could not read ${boardPath}: ${source.error.message}`);
  const decoded = decodeBoard(source.value);
  if (!decoded.ok) return platformError("invalid-request", `${boardPath}: ${decoded.error.message}`);

  let board: Board;
  let title: string;
  let summary: string;
  let preview: string;
  if (operation === "pre-vector") {
    if (source.value[BOARD_DETECT_OFFSET] !== 0 || decoded.value.layout !== "pre-vector") {
      return platformError("invalid-request", `${boardPath} is not a supported binary pre-vector board; text boards and unsupported layouts cannot be upgraded.`);
    }
    board = decoded.value.board;
    title = "Upgrade pre-vector board";
    summary = `${board.sizeX} × ${board.sizeY} tiles across ${board.sizeL} layer(s), ${board.tileMatrix.length} stored tile cells, ${board.vectors.length} vectors, ${board.programs.length} programs, ${board.sprites.length} sprites, and ${board.shadeLayers.length} shading layer(s). Creates a minor-4 board with documented conversions; the original ${boardPath} is retained.`;
    preview = `Board-specific input: ${board.sizeX} × ${board.sizeY} tiles, ${board.sizeL} layers, ${board.tileMatrix.length} stored tile cells, ${board.vectors.length} vectors, ${board.programs.length} program slots, ${board.sprites.length} sprite slots, ${board.shadeLayers.length} shading layers.`;
  } else {
    if (decoded.value.layout !== "vector") {
      return platformError("invalid-request", `Upgrade ${boardPath} to the vector layout before changing its coordinates.`);
    }
    const originalBoard = decoded.value.board;
    const planned = planBoardCoordinateUpgrade(originalBoard, operation);
    if (!planned.ok) return platformError("invalid-request", `${boardPath}: ${planned.message}`);
    ({ board, title, summary, preview } = planned.value);
    summary = `Board ${originalBoard.sizeX} × ${originalBoard.sizeY}, ${originalBoard.sizeL} layer(s), ${originalBoard.tileMatrix.length} tile cells, ${originalBoard.tileRuns.length} tile runs, ${originalBoard.vectors.length} vectors, ${originalBoard.programs.length} programs, ${originalBoard.sprites.length} sprites, and ${originalBoard.shadeLayers.length} shade layers. ${summary}`;
  }

  const encoded = writeBoard(board);
  if (!encoded.ok) return platformError("invalid-request", `${boardPath}: ${encoded.error.message}`);
  const copyBytes = operation === "pre-vector" ? encoded.value : source.value;
  if (operation === "pre-vector") {
    const converted = decodeBoard(copyBytes);
    if (!converted.ok) return platformError("invalid-request", `${boardPath}: converted preview could not be decoded: ${converted.error.message}`);
    const output = converted.value.board;
    const firstVector = output.vectors[0];
    const firstProgram = output.programs[0];
    const firstSprite = output.sprites[0];
    preview = `Minor-4 output: first tile cells [${output.tileMatrix.slice(0, 8).join(", ")}]; vector 1 points [${firstVector?.points.slice(0, 4).map(({ x, y }) => `${x},${y}`).join("; ") ?? "none"}]; program 1 "${firstProgram?.program ?? "none"}" points [${firstProgram?.points.slice(0, 4).map(({ x, y }) => `${x},${y}`).join("; ") ?? "none"}]; sprite 1 ${firstSprite === undefined ? "none" : `${firstSprite.itemFile} at ${firstSprite.x},${firstSprite.y}, layer ${firstSprite.layer}`}; shade records [${output.shadeLayers[0]?.records.slice(0, 4).map(({ runCount, r, g, b }) => `${runCount}:${r},${g},${b}`).join("; ") ?? "none"}].`;
  }
  const warnings = decoded.warnings.length === 0 ? "No conversion warnings." : `Warnings: ${decoded.warnings.join("; ")}`;
  const creationNotice = createExclusive === null
    ? "This host uses a disclosed non-atomic single-user fallback: same-editor upgrades are serialized, but an external process may create the destination after the check and this write could replace that file."
    : "Destination creation uses an exclusive host operation; an existing destination is never replaced.";
  const answer = await dialogs.ask({
    message: `${title}: ${boardPath}?`,
    detail: `${summary} Preview: ${preview} ${warnings} ${creationNotice} The source file will not be changed.${operation === "pre-vector" ? "" : " The original board is copied first; the accepted conversion is one undoable edit on the copy."}`,
    choices: [{ id: "cancel", label: "Cancel" }, { id: "preview", label: "Choose copy destination…" }],
    cancel: "cancel",
  });
  if (answer !== "preview") return platformOk(null);

  const suggested = boardPath.replace(/\.brd$/i, operation === "pre-vector" ? ".upgraded.brd" : operation === "stacked-to-rotated" ? ".rotated.brd" : ".pixels.brd");
  const picked = await dialogs.pickSavePath({ document: boardPath, suggested });
  if (picked === null) return platformOk(null);
  if (await hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
  if (!/^(?:game\/(?:[^/]+\/)+)?boards\/(?:[^/]+\/)*[^/]+\.brd$/i.test(picked)
    || /[\\:\u0000-\u001f\u007f]/.test(picked)
    || picked.split("/").some((part) => part === "." || part === "..")) {
    return platformError("invalid-path", `Choose a project board path ending in .brd: ${picked}`);
  }
  if (!foldPath(picked).startsWith(`${foldPath(sourceRoot)}/`)) {
    return platformError("invalid-request", "Save the upgraded copy under the same game's Boards folder so its asset references remain valid.");
  }
  const destination = sourceRoot + picked.slice(sourceRoot.length);
  if (foldPath(destination) === foldPath(boardPath)) {
    return platformError("invalid-request", "An upgrade must be saved as a separate board; the original was not changed.");
  }
  return withProjectPathWriteLock(projectId, destination, async () => {
    if (await hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
    const current = await fs.readProject(projectId, boardPath);
    if (!current.ok) return platformError(current.error.code, `Could not recheck ${boardPath}: ${current.error.message}`);
    if (!sameBytes(source.value, current.value)) {
      return platformError("invalid-request", `${boardPath} changed while the upgrade was being reviewed. Review the current file and try again.`);
    }
    const resolution = await resolveDestinationPath(fs, projectId, destination);
    if (!resolution.ok) return platformError(resolution.error.code, resolution.error.message);
    if (resolution.value.collision !== null) {
      return platformError("already-exists", `${resolution.value.collision} conflicts with the destination (existing file, ambiguous case-folded path, or non-directory ancestor). Upgrades never replace files.`);
    }
    const resolvedDestination = resolution.value.path;
    if (foldPath(resolvedDestination) === foldPath(boardPath)) {
      return platformError("invalid-request", "An upgrade must be saved as a separate board; the original was not changed.");
    }
    if (isDestinationOpen?.(resolvedDestination) === true) return platformError("invalid-request", `${resolvedDestination} is already open or cached in this editor. Close it and retry the upgrade.`);
    if (isDestinationOwnedBySource !== undefined && !(await isDestinationOwnedBySource(resolvedDestination))) {
      return platformError("invalid-request", "Save the upgraded copy inside the source board's owning game. Its asset references must stay valid.");
    }
    const existing = await fs.statProject(projectId, resolvedDestination);
    if (existing.ok) return platformError("already-exists", `${resolvedDestination} already exists. Upgrades never replace files.`);
    if (existing.error.code !== "not-found") return platformError(existing.error.code, `Could not check ${resolvedDestination}: ${existing.error.message}`);
    if (await hasPendingEdits()) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
    const finalResolution = await resolveDestinationPath(fs, projectId, resolvedDestination);
    if (!finalResolution.ok) return platformError(finalResolution.error.code, finalResolution.error.message);
    if (finalResolution.value.collision !== null) {
      return platformError("already-exists", `${finalResolution.value.collision} conflicts with the destination (existing file, ambiguous case-folded path, or non-directory ancestor). Upgrades never replace files.`);
    }
    const finalDestination = finalResolution.value.path;
    if (isDestinationOpen?.(finalDestination) === true) return platformError("invalid-request", `${finalDestination} is already open or cached in this editor. Close it and retry the upgrade.`);
    const finalExisting = await fs.statProject(projectId, finalDestination);
    if (finalExisting.ok) return platformError("already-exists", `${finalDestination} already exists. Upgrades never replace files.`);
    if (finalExisting.error.code !== "not-found") return platformError(finalExisting.error.code, `Could not check ${finalDestination}: ${finalExisting.error.message}`);
    const finalSource = await fs.readProject(projectId, boardPath);
    if (!finalSource.ok) return platformError(finalSource.error.code, `Could not recheck ${boardPath}: ${finalSource.error.message}`);
    if (!sameBytes(source.value, finalSource.value)) return platformError("invalid-request", `${boardPath} changed before the copy was written.`);
    if (hasPendingEditsNow?.() === true) return platformError("invalid-request", `Save or discard pending edits to ${boardPath} before upgrading it.`);
    const written = createExclusive === null
      ? await fs.writeProject(projectId, finalDestination, copyBytes)
      : await createExclusive(finalDestination, copyBytes);
    return written.ok ? platformOk({ destination: finalDestination, bytes: copyBytes.slice() }) : platformError(written.error.code, `Could not write ${finalDestination}: ${written.error.message}`);
  });
}
async function resolveDestinationPath(
  fs: Pick<FileSystemService, "listProject">,
  projectId: string,
  path: string,
): Promise<PlatformResult<{ readonly path: string; readonly collision: string | null }>> {
  const requested = path.split("/");
  const resolved: string[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const segment = requested[index]!;
    const entries = await fs.listProject(projectId, resolved.join("/"));
    if (!entries.ok) {
      if (entries.error.code === "not-found") {
        return platformOk({ path: [...resolved, ...requested.slice(index)].join("/"), collision: null });
      }
      return platformError(entries.error.code, `Could not check destination folder ${resolved.join("/") || "."}: ${entries.error.message}`);
    }
    const matches = entries.value.filter((entry) => foldPath(entry.name) === foldPath(segment));
    if (matches.length > 1) {
      const ambiguousPath = [...resolved, segment].join("/");
      return platformOk({ path: ambiguousPath, collision: `${ambiguousPath} matches multiple case-folded entries` });
    }
    const match = matches[0];
    if (match === undefined) return platformOk({ path: [...resolved, ...requested.slice(index)].join("/"), collision: null });
    const matchedPath = [...resolved, match.name].join("/");
    if (index === requested.length - 1 || match.kind !== "directory") {
      return platformOk({ path: matchedPath, collision: matchedPath });
    }
    resolved.push(match.name);
  }
  return platformOk({ path: resolved.join("/"), collision: null });
}



function boardRoot(path: string): string | null {
  const parts = path.split("/");
  const indexes = parts.flatMap((part, index) => part.toLowerCase() === "boards" ? [index] : []);
  if (indexes.length !== 1) return null;
  const index = indexes[0];
  if (index === undefined || (index !== 0 && (parts[0]?.toLowerCase() !== "game" || index < 2))) return null;
  return parts.slice(0, index + 1).join("/");
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}
