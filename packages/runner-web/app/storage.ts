// The storage lane's page: the real load controller over real OPFS staging and a real OPFS package store, plus the real
// IndexedDB blob host, driven by Playwright (tools/browser/tests/storage.spec.ts). It plays no game; it proves what the
// player's storage tiers do in a browser.
//
//   storage.html?package=fixtures/packages/demo.tpk[&mode=streaming|whole|auto][&quota=1][&persist=grant|deny][&read=<entry>]

import { loadPackage } from "@tk-reawakened/core";
import { runSaveLoadLaunch, type SaveLoadLaunch } from "@tk-reawakened/runner-harness";
import { createBlobHost, createIndexedDbBlobBackend, type BlobHost } from "../src/blob-host.ts";
import { createLoadController, type LoadState, type StorageManagerLike } from "../src/load-mode.ts";
import { createOpfsPackageStore, createOpfsStaging } from "../src/opfs-store.ts";
import { PackageSourceError, type DurablePackageStore, type PackageSourceStats } from "../src/package-source.ts";

type StorageReport = {
  readonly state: LoadState;
  readonly gameId: string;
  readonly main: string;
  readonly mainBytes: number;
  readonly entries: number;
  readonly read: { readonly path: string; readonly bytes: number; readonly sum: number } | null;
  readonly stats: PackageSourceStats;
  readonly error: null;
};

declare global {
  interface Window {
    __storage?: StorageReport | { readonly error: string; readonly kind: string | null };
    /** The blob host and cache probes the spec drives after load. */
    __blobs?: {
      readonly write: (gameId: string, path: string, values: readonly number[]) => Promise<boolean>;
      readonly read: (gameId: string, path: string) => Promise<readonly number[] | null>;
      readonly list: (gameId: string) => Promise<readonly string[]>;
      readonly state: BlobHost["state"];
      readonly cacheNames: () => Promise<readonly string[]>;
      readonly cacheUrls: () => Promise<readonly string[]>;
      readonly runSaveLoadLaunch: (url?: string) => Promise<{ readonly gameId: string; readonly launch: SaveLoadLaunch }>;
    };
  }
}

const params = new URLSearchParams(location.search);

function sum(bytes: Uint8Array): number {
  let total = 0;
  for (const byte of bytes) total = (total + byte) % 1_000_000_007;
  return total;
}

/** The OPFS package store, refusing every put as a full origin would, when the page was asked to (`quota=1`). */
function fullStore(inner: DurablePackageStore): DurablePackageStore {
  return {
    readRange: (sha256, start, end) => inner.readRange(sha256, start, end),
    discard: (sha256) => inner.discard(sha256),
    async put() {
      const error = new DOMException("The quota has been exceeded.", "QuotaExceededError");
      throw error;
    },
  };
}

async function main(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const pack = params.get("package");
  if (pack !== null) {
    const descriptor = await (await fetch(`/${pack}.json`)).json();
    const store = createOpfsPackageStore(root);
    const persist = params.get("persist");
    const storage: StorageManagerLike =
      persist === "deny" ? { persist: async () => false, persisted: async () => false }
      : persist === "grant" ? { persist: async () => true, persisted: async () => false }
      : navigator.storage;
    const controller = createLoadController({
      url: `/${pack}`,
      descriptor,
      staging: createOpfsStaging(root),
      durable: params.get("quota") === "1" ? fullStore(store) : store,
      storage,
      mode: (params.get("mode") as "auto" | "whole" | "streaming" | null) ?? "auto",
    });
    try {
      const source = await controller.load();
      const wanted = params.get("read");
      const entry = wanted === null ? undefined : source.entry(wanted);
      const bytes = entry === undefined ? null : await source.read(entry.path);
      window.__storage = {
        state: controller.state(),
        gameId: source.gameId,
        main: source.main,
        mainBytes: source.peek(source.main)?.length ?? 0,
        entries: source.entries.length,
        read: bytes === null || entry === undefined ? null : { path: entry.path, bytes: bytes.length, sum: sum(bytes) },
        stats: source.stats(),
        error: null,
      };
    } catch (cause) {
      window.__storage = { error: String(cause), kind: cause instanceof PackageSourceError ? cause.kind : null };
    }
  }

  const host = createBlobHost({ backend: await createIndexedDbBlobBackend(indexedDB, "tkr-storage-lane"), storage: navigator.storage });
  window.__blobs = {
    write: (gameId, path, values) => host.write("saves", gameId, path, Uint8Array.from(values)),
    read: async (gameId, path) => {
      const bytes = await host.read("saves", gameId, path);
      return bytes === null ? null : [...bytes];
    },
    list: (gameId) => host.list("saves", gameId),
    state: host.state,
    cacheNames: () => caches.keys(),
    cacheUrls: async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls.sort();
    },
    runSaveLoadLaunch: async (url = "/packages/core/test/fixtures/saveload/saveload.tpk") => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      const loaded = loadPackage({ kind: "tpk", name: "saveload.tpk", bytes: new Uint8Array(await response.arrayBuffer()) });
      if (!loaded.ok) throw new Error(loaded.error.message);
      const files = new Map<string, Uint8Array>();
      for (const file of loaded.value.files) files.set(file.path, file.bytes);
      return runSaveLoadLaunch({ files, host });
    },
  };
  document.title = "storage ready";
}

main().catch((cause: unknown) => {
  window.__storage = { error: String(cause), kind: null };
  document.title = "storage failed";
});
