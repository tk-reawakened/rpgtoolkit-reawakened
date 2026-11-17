import { BinaryReader, TILE_BITMAP_MAGIC, readTileBitmap, writeTileBitmap, type TileBitmapCell } from "@tk-reawakened/core";
import { platformError, platformOk, type PlatformResult } from "@tk-reawakened/platform-services";
import { animationCodec, createAnimationDocument, newAnimationBytes, type AnimationCommand, type AnimationDocument } from "./animation-document.ts";
import { createDocumentIdentity } from "./identity.ts";
import { createCheckpointGroups, type CheckpointEnvironment, type CheckpointGroup, type CheckpointGroups, type CheckpointTarget } from "./checkpoint-groups.ts";
import { firstDifference } from "./binary-document.ts";
import { resolveDocumentPath } from "./workspace.ts";
import { unusableName } from "./reserved-folders.ts";

export interface AnimationBitmap { readonly path: string; readonly bytes: Uint8Array }
export interface AnimationAuthoring extends Pick<CheckpointGroups, "list" | "retry" | "restore" | "ignoreHistory" | "deleteGroup"> {
  commitAnimation(command: AnimationCommand, bitmaps: readonly AnimationBitmap[]): Promise<PlatformResult<CheckpointGroup>>;
}
/** Own the TBM format/validation in the model, never in a view or host. */
export function animationTileBitmapBytes(cells: readonly string[]): Uint8Array {
  if (cells.length !== 16 || cells.some((cell) => cell === "")) throw new Error("Choose all sixteen tiles in the 4×4 composition.");
  const stored: TileBitmapCell[] = [];
  for (let x = 0; x <= 4; x++) for (let y = 0; y <= 4; y++) stored.push({ tile: x < 4 && y < 4 ? cells[x * 4 + y]! : "", r: 0, g: 0, b: 0 });
  const result = writeTileBitmap({ magic: TILE_BITMAP_MAGIC, major: 3, minor: 0, width: 4, height: 4, cells: stored, residue: new Uint8Array() });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export function validateAnimationBitmap(path: string, bytes: Uint8Array): string | null {
  if (!/^Bitmap\/[^/\\]+\.tbm$/i.test(path) || unusableName(path.slice(path.lastIndexOf("/") + 1)) !== null) return "Choose a valid .tbm name directly inside Bitmap.";
  const parsed = readTileBitmap(new BinaryReader(bytes, path));
  return parsed.ok && parsed.value.width === 4 && parsed.value.height === 4 ? null : "The animation wizard requires a valid 4×4 tile bitmap.";
}
export function animationDestination(path: string): string | null {
  return /^Misc\/[^/\\]+\.anm$/i.test(path) && unusableName(path.slice(path.lastIndexOf("/") + 1)) === null ? null : "Choose a valid .anm filename directly inside Misc.";
}
export async function createAnimationFile(env: CheckpointEnvironment, path: string): Promise<PlatformResult<CheckpointGroup>> {
  const invalid = animationDestination(path);
  if (invalid !== null) return platformError("invalid-path", invalid);
  const resolved = await resolveDocumentPath({ list: (folder) => env.fs.listProject(env.projectId, folder) }, path);
  if (!resolved.ok) return platformError("invalid-path", resolved.kind === "read" ? resolved.error.message : resolved.message);
  if (resolved.exists) {
    const existing = await env.fs.readProject(env.projectId, resolved.path);
    if (!existing.ok) return existing;
    const opened = createAnimationDocument(env.fs, createDocumentIdentity(env.projectId, resolved.path), existing.value);
    if (!opened.ok || opened.document.getSnapshot().readOnly !== null) return platformError("invalid-request", "The existing animation has no same-version writer. It cannot be replaced by this wizard.");
  }
  return createCheckpointGroups(env).commit([{ path: resolved.path, bytes: newAnimationBytes() }]);
}

/** Use accepted edits and the owning host's save, including VS Code's workbench dirty/undo protocol. */
export function createAnimationAuthoring(env: CheckpointEnvironment, doc: AnimationDocument, save: () => Promise<PlatformResult<void>>, edited: (editId: string) => void): AnimationAuthoring {
  const stage = (bytes: Uint8Array, command: AnimationCommand): PlatformResult<Uint8Array> => {
    const candidate = createAnimationDocument(env.fs, doc.identity, bytes);
    if (!candidate.ok) return platformError("invalid-request", "The animation cannot be opened for editing.");
    const applied = candidate.document.apply(command);
    if (!applied.ok) return platformError("invalid-request", applied.rejection.message);
    return platformOk(candidate.document.serialize());
  };
  const groups = createCheckpointGroups({ ...env, guard: async (path, removing, intended) => {
    const state = doc.getSnapshot();
    if (createDocumentIdentity(env.projectId, path).key === doc.identity.key && !removing && intended !== undefined && intended !== null
      && state.dirty && !state.saving && state.conflict === null && state.readOnly === null && firstDifference(doc.serialize(), intended) === null) return null;
    return env.guard(path, removing, intended);
  }, write: async (path, bytes) => {
    if (createDocumentIdentity(env.projectId, path).key !== doc.identity.key) return bytes === null ? env.fs.deleteProject(env.projectId, path) : env.fs.writeProject(env.projectId, path, bytes);
    if (bytes === null) return platformError("unavailable", `Close ${path} before removing it through recovery.`);
    const same = firstDifference(doc.serialize(), bytes) === null;
    if ((!same && doc.getSnapshot().dirty) || doc.getSnapshot().saving || doc.getSnapshot().conflict !== null) return platformError("unavailable", `Save or resolve ${path} before replacing its contents.`);
    if (same) return save();
    const decoded = animationCodec.read(bytes, path);
    if (!decoded.ok) return platformError("invalid-request", decoded.error.message);
    const model = decoded.value;
    const command: AnimationCommand = { type: "replace-animation", width: model.width, height: model.height, delay: model.delay, frames: model.frames };
    const checked = stage(doc.serialize(), command);
    if (!checked.ok) return checked;
    if (firstDifference(checked.value, bytes) !== null) return platformError("unavailable", `Close ${path} before restoring a different format or opaque file contents.`);
    const result = doc.apply(command);
    if (!result.ok) return platformError("invalid-request", result.rejection.message);
    edited(result.editId);
    return save();
  } });
  return { ...groups, async commitAnimation(command, bitmaps) {
    if (!animationCodec.isCommand(command)) return platformError("invalid-request", "Invalid animation command.");
    if (doc.getSnapshot().readOnly !== null || doc.getSnapshot().dirty) return platformError("unavailable", "Save your animation edits before confirming the wizard. Read-only animations cannot be changed.");
    const targets: CheckpointTarget[] = [];
    for (const bitmap of bitmaps) {
      const invalid = validateAnimationBitmap(bitmap.path, bitmap.bytes);
      if (invalid !== null) return platformError("invalid-request", invalid);
      targets.push(bitmap);
    }
    const staged = stage(doc.serialize(), command);
    if (!staged.ok) return staged;
    targets.push({ path: doc.identity.path, bytes: staged.value });
    return groups.commit(targets);
  } };
}
