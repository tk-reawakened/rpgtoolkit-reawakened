/**
 * When a native scene's assets must be read again in VS Code. Text changes are debounced; a save reads at once.
 */
const TERRAIN_ASSET = /\.(?:tkrtst|tkrtle|tkrpack|bmp|gif|jpe?g|png)$/i;

export function isTerrainAssetPath(path: string): boolean {
  return TERRAIN_ASSET.test(path);
}

export interface TerrainAssetRefreshTrigger {
  /** A change in `path`: re-read once after the typing pause, but only for a scene asset. */
  edited(path: string): void;
  /** A save of `path`: re-read now, cancelling the pending pause, but only for a scene asset. */
  saved(path: string): void;
  /** Whether a debounced read is waiting (for tests and for a clean dispose). */
  readonly pending: boolean;
  dispose(): void;
}

export function createTerrainAssetRefreshTrigger(reload: () => void, delayMs = 250): TerrainAssetRefreshTrigger {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  return {
    edited(path) {
      if (!isTerrainAssetPath(path)) return;
      cancel();
      timer = setTimeout(() => { timer = undefined; reload(); }, delayMs);
    },
    saved(path) {
      if (!isTerrainAssetPath(path)) return;
      cancel();
      reload();
    },
    get pending() { return timer !== undefined; },
    dispose: cancel,
  };
}

/** Runs overlapping asset reads latest-wins; a ready handshake can wait for the newest read without blocking on an older one. */
export function createLatestRead<T>(read: () => Promise<T>, publish: (value: T) => void): {
  read(): Promise<T>;
  waitForLatest(): Promise<T>;
} {
  let generation = 0;
  let latest: Promise<T> | null = null;
  let signalChanged: () => void = () => {};
  let changed = new Promise<void>((resolve) => { signalChanged = resolve; });
  const start = (): Promise<T> => {
    signalChanged();
    changed = new Promise<void>((resolve) => { signalChanged = resolve; });
    const mine = ++generation;
    const current = Promise.resolve().then(read).then((value) => {
      if (mine === generation) publish(value);
      return value;
    });
    latest = current;
    return current;
  };
  const waitForLatest = async (): Promise<T> => {
    if (latest === null) return start();
    while (latest !== null) {
      const current: Promise<T> = latest;
      const currentChange = changed;
      const outcome = await Promise.race([
        current.then((value) => ({ kind: "value" as const, value }), (error: unknown) => ({ kind: "error" as const, error })),
        currentChange.then(() => ({ kind: "changed" as const })),
      ]);
      if (outcome.kind === "changed" || current !== latest) continue;
      if (outcome.kind === "error") throw outcome.error;
      return outcome.value;
    }
    return start();
  };
  return { read: start, waitForLatest };
}
