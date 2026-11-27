import { assetKey, BinaryReader, boardPixelSize, coordLayout, readBoard, usesPixelCoordinates } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { fixtureWorldLookupPaths } from "@tk-reawakened/script-spec";
import type { BoardCoordinates } from "./visual-fixture-view.tsx";

type FixtureFileSystem = Pick<FileSystemService, "list" | "read">;
type FileLookup = { readonly kind: "found"; readonly bytes: Uint8Array } | { readonly kind: "missing" } | { readonly kind: "failed" };
type SearchState = { bestPath: string | null; failed: boolean };

async function findCandidate(fs: FixtureFileSystem, keys: readonly string[], directory: string, depth: number, state: SearchState): Promise<void> {
  if (state.failed) return;
  const listed = await fs.list(directory);
  if (!listed.ok) {
    if (listed.error.code !== "not-found") state.failed = true;
    return;
  }
  const isFile = depth === keys.length - 1;
  for (const entry of listed.value) {
    if (assetKey(entry.name) !== keys[depth]) continue;
    if (entry.kind !== (isFile ? "file" : "directory")) continue;
    const candidate = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (isFile) {
      if (state.bestPath === null || candidate < state.bestPath) state.bestPath = candidate;
    } else {
      await findCandidate(fs, keys, candidate, depth + 1, state);
    }
  }
}

async function readProjectFile(fs: FixtureFileSystem, path: string): Promise<FileLookup> {
  const keys = assetKey(path).split("/");
  const state: SearchState = { bestPath: null, failed: false };
  await findCandidate(fs, keys, "", 0, state);
  if (state.failed) return { kind: "failed" };
  if (state.bestPath === null) return { kind: "missing" };
  const result = await fs.read(state.bestPath);
  if (!result.ok) return result.error.code === "not-found" ? { kind: "missing" } : { kind: "failed" };
  return { kind: "found", bytes: result.value };
}

/** Resolve board bounds with the same `.tkr-tests/` overlay precedence as the saved-test runner. */
export async function resolveVisualFixtureBoardCoordinates(fs: FixtureFileSystem, path: string): Promise<BoardCoordinates | null> {
  if (!/\.brd$/i.test(path)) return null;
  let candidates: readonly string[];
  try {
    candidates = fixtureWorldLookupPaths(path);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    const file = await readProjectFile(fs, candidate);
    if (file.kind === "missing") continue;
    if (file.kind === "failed") return null;
    const parsed = readBoard(new BinaryReader(file.bytes));
    if (!parsed.ok) return null;
    const coordType = parsed.value.coordType;
    if (usesPixelCoordinates(coordType)) {
      const size = boardPixelSize(coordLayout(coordType), parsed.value.sizeX, parsed.value.sizeY);
      return { mode: "pixel", width: size.width, height: size.height };
    }
    return { mode: "tile", width: parsed.value.sizeX, height: parsed.value.sizeY };
  }
  return null;
}
