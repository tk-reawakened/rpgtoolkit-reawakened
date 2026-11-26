/**
 * When the browser scene editor mounts relative to its inventory reads (#3561). Startup and a reactivation can overlap:
 * the later read supersedes the earlier one, and the editor must still mount once, after the read that wins. A read that
 * failed mounts nothing, and a later read (a refresh) may mount then.
 */
export interface TerrainSceneMount {
  /** The startup read. */
  start(): Promise<void>;
  /** A reactivation's re-read: supersedes any read still in flight and mounts if the editor is not mounted yet. */
  refresh(): Promise<void>;
  readonly mounted: boolean;
}

export function createTerrainSceneMount(load: () => Promise<boolean>, mount: () => void): TerrainSceneMount {
  let reads = 0;
  let mounted = false;
  const run = async (): Promise<void> => {
    const mine = ++reads;
    const ok = await load();
    // Only the newest read may act: an older one that finishes late is about inputs the newer read already replaced.
    if (!ok || mine !== reads || mounted) return;
    mounted = true;
    mount();
  };
  return { start: run, refresh: run, get mounted() { return mounted; } };
}
