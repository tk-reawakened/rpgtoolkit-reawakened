import { BinaryReader, coordLayout, foldPath, pixelToTile, readBoard, readMainFile, stripTypeFolder, toSlashes, usesPixelCoordinates } from "@tk-reawakened/core";
import { platformError, platformOk, prepareBoardLaunch, type BoardLaunch, type FileSystemService, type PlatformResult } from "@tk-reawakened/platform-services";
import { resolveDocumentPath } from "./workspace.ts";

const safePath = (path: string): boolean => path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !/^[A-Za-z]:/.test(path)
  && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** Launch the saved scene's compiled board, not the main file's configured startup board.
 * Board starts are stored in pixels; board tests use the destination board's coordinate mode
 * (docs/spec/engine/main-loop-and-startup.md#reawakened-board-test-startup).
 */
export async function buildTerrainSceneLaunch(options: {
  readonly fs: Pick<FileSystemService, "list" | "read">;
  readonly main: string;
  readonly projectFolder: string;
  readonly scenePath: string;
}): Promise<PlatformResult<BoardLaunch>> {
  const { fs, main, projectFolder, scenePath } = options;
  if (!safePath(main) || (projectFolder !== "" && !safePath(projectFolder)) || !safePath(scenePath) || !/\.tkrscn$/i.test(scenePath)) {
    return platformError("invalid-path", "The main, project folder and scene must use project-relative paths.");
  }
  const boardPath = `${scenePath.slice(0, -7)}.brd`;
  const boardRoot = projectFolder === "" ? "Boards/" : `${projectFolder}/Boards/`;
  if (!foldPath(boardPath).startsWith(foldPath(boardRoot))) {
    return platformError("invalid-path", `Play requires the scene to be under ${boardRoot}.`);
  }
  const resolve = async (path: string): Promise<PlatformResult<string>> => {
    if (!safePath(path)) return platformError("invalid-path", `Invalid project path ${path}.`);
    const result = await resolveDocumentPath(fs, path);
    if (!result.ok) return result.kind === "read" ? { ok: false, error: result.error } : platformError("invalid-path", result.message);
    return result.exists ? platformOk(result.path) : platformError("not-found", `File ${path} was not found in the project.`);
  };
  const mainPath = await resolve(main);
  if (!mainPath.ok) return mainPath;
  const mainBytes = await fs.read(mainPath.value);
  if (!mainBytes.ok) return mainBytes;
  const parsedMain = readMainFile(new BinaryReader(mainBytes.value, mainPath.value));
  if (!parsedMain.ok) return platformError("invalid-request", `Cannot read ${mainPath.value}: ${parsedMain.error.message}`);
  const reference = toSlashes(parsedMain.value.initChar);
  if (!safePath(reference)) return platformError("invalid-path", "The main file must name a valid initial character.");
  const character = stripTypeFolder("characters", reference);
  if (!safePath(character) || !/\.tem$/i.test(character)) return platformError("invalid-path", "The initial character must name a .tem file.");
  const prefix = projectFolder === "" ? "" : `${projectFolder}/`;
  const party = await resolve(`${prefix}Chrs/${character}`);
  if (!party.ok) return party;
  const board = await resolve(boardPath);
  if (!board.ok) return board;
  const boardBytes = await fs.read(board.value);
  if (!boardBytes.ok) return boardBytes;
  const parsedBoard = readBoard(new BinaryReader(boardBytes.value, board.value));
  if (!parsedBoard.ok) return platformError("invalid-request", `Cannot read ${board.value}: ${parsedBoard.error.message}`);
  const compiled = parsedBoard.value;
  const start = compiled.properties.start;
  const position = usesPixelCoordinates(compiled.coordType) ? start : pixelToTile(coordLayout(compiled.coordType), compiled.sizeX, start.x, start.y);
  const launch: BoardLaunch = { kind: "board", main: mainPath.value, projectFolder, start: { board: board.value, x: position.x, y: position.y, layer: start.layer }, party: [party.value] };
  const checked = prepareBoardLaunch(launch);
  return checked.ok ? platformOk(launch) : checked;
}
