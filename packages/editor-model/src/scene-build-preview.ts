import type { DirectoryEntry } from "@tk-reawakened/platform-services";
import { previewBoard, type BoardPreview, type BoardPreviewOptions, type PreviewStorage } from "./board-preview.ts";
import { buildScene, type SceneBuildInputs, type SceneBuildProblem } from "./scene-build.ts";

export type SceneBuildPreview =
  | { readonly ok: true; readonly preview: Extract<BoardPreview, { readonly ok: true }>; readonly notes: readonly SceneBuildProblem[] }
  | { readonly ok: false; readonly problems: readonly SceneBuildProblem[] };

/** Preview the exact generated board and art without writing any project files. */
export async function previewSceneBuild(storage: PreviewStorage, projectId: string, inputs: SceneBuildInputs, options: BoardPreviewOptions = {}): Promise<SceneBuildPreview> {
  const built = await buildScene(inputs);
  if (!built.ok) return built;
  const outputFiles = new Map(built.outputs.map((output) => [output.path, output.bytes]));
  const generatedEntries = new Map<string, Map<string, DirectoryEntry>>();
  for (const path of outputFiles.keys()) {
    const segments = path.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const parent = segments.slice(0, i).join("/");
      const name = segments[i]!;
      let entries = generatedEntries.get(parent);
      if (entries === undefined) { entries = new Map(); generatedEntries.set(parent, entries); }
      entries.set(name, { name, kind: i === segments.length - 1 ? "file" : "directory" });
    }
  }
  const overlay: PreviewStorage = {
    async list(path) {
      const disk = await storage.list(path);
      const added = generatedEntries.get(path);
      if (!disk.ok && (added === undefined || disk.error.code !== "not-found")) return disk;
      const entries = new Map((disk.ok ? disk.value : []).map((entry) => [entry.name, entry]));
      for (const entry of added?.values() ?? []) entries.set(entry.name, entry);
      return { ok: true, value: [...entries.values()] };
    },
    async readProject(id, path) {
      const generated = id === projectId ? outputFiles.get(path) : undefined;
      return generated === undefined ? storage.readProject(id, path) : { ok: true, value: generated };
    },
  };
  const boardPath = `${inputs.scenePath.slice(0, -7)}.brd`;
  const board = outputFiles.get(boardPath);
  if (board === undefined) return { ok: false, problems: [{ path: boardPath, message: "The build did not produce its board." }] };
  const preview = await previewBoard(overlay, projectId, board, options);
  return preview.ok ? { ok: true, preview, notes: built.notes } : { ok: false, problems: [{ path: boardPath, message: preview.message }] };
}
