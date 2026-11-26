import { foldPath } from "@tk-reawakened/core";

const pendingWrites = new Map<string, Promise<void>>();

/** Serialize same-editor creation and upgrade writes to one case-folded project path. */
export async function withProjectPathWriteLock<T>(projectId: string, path: string, action: () => Promise<T>): Promise<T> {
  const key = `${projectId}:${foldPath(path)}`;
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  pendingWrites.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (pendingWrites.get(key) === current) pendingWrites.delete(key);
  }
}
