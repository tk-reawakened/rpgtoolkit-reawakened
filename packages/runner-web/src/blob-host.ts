/**
 * The web player's durable blob host: `saveBlob` / `loadBlob` / `listBlobs` (AD-17) over a key-value backend, isolated by
 * `area` and `GameId` (docs/spec/engine/runners.md#offline).
 *
 * Save bytes live in IndexedDB, never in Cache Storage, so a service worker can neither read nor cache a save. A refused
 * write is reported, not swallowed: the host's `state()` says whether the store was full (`quota: "limited"`) and what
 * the browser answered when asked to keep the origin's data (`persisted`), and a write that did not land returns `false`
 * to the engine, which tells the game its save failed.
 *
 * The path a host receives is already relative to the `GameId` (`createLiveSession` strips the `<GameId>/` prefix once),
 * so this host never strips again: a relative path that happens to start with the same text is a different file.
 */

import type { PersistState, StorageManagerLike } from "./load-mode.ts";

/** The two blob areas AD-17 names. */
export type BlobArea = "saves" | "files";

/** A key-value store the host sits on. Keys are plain ASCII strings. */
export interface BlobBackend {
  get(key: string): Promise<Uint8Array | null>;
  /** Store a copy. A full store rejects with a `QuotaExceededError`. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Every key that starts with `prefix`, in code-unit order. */
  keys(prefix: string): Promise<readonly string[]>;
}

export type BlobHostState = {
  /** The browser's answer to `navigator.storage.persist()`, once asked. */
  readonly persisted: PersistState;
  /** `limited` once any write was refused for lack of quota. It stays `limited`: a later small write succeeding does not mean the store has room. */
  readonly quota: "ok" | "limited";
  /** The last write or read failure, or `null`. */
  readonly lastError: string | null;
  readonly writes: number;
  readonly failedWrites: number;
};

export interface BlobHost {
  read(area: BlobArea, gameId: string, path: string): Promise<Uint8Array | null>;
  write(area: BlobArea, gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  list(area: BlobArea, gameId: string): Promise<readonly string[]>;
  state(): BlobHostState;
  /** Ask the browser to keep the origin's data, recording the answer. Safe to call more than once. */
  requestPersistence(): Promise<PersistState>;
}

export type BlobHostOptions = {
  readonly backend: BlobBackend;
  /** `navigator.storage`, or a stand-in. Absent means the browser cannot be asked. */
  readonly storage?: StorageManagerLike;
};

const KEY_VERSION = "tkr1";

function isQuotaError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "QuotaExceededError";
}

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

/**
 * The key prefix of one game's blobs in one area. Each part is percent-encoded, so no `area`, `gameId` or path can
 * produce another game's prefix: `a/b` as a game id is `a%2Fb`, which no other id encodes to.
 */
export function blobPrefix(area: BlobArea, gameId: string): string {
  return `${KEY_VERSION}/${encodeURIComponent(area)}/${encodeURIComponent(gameId)}/`;
}

export function createBlobHost(options: BlobHostOptions): BlobHost {
  const { backend } = options;
  let persisted: PersistState = "not-requested";
  let quota: "ok" | "limited" = "ok";
  let lastError: string | null = null;
  let writes = 0;
  let failedWrites = 0;
  let asking: Promise<PersistState> | null = null;

  const requestPersistence = (): Promise<PersistState> => {
    asking ??= (async () => {
      const storage = options.storage;
      if (storage === undefined || typeof storage.persist !== "function") return (persisted = "unsupported");
      try {
        if (typeof storage.persisted === "function" && (await storage.persisted())) return (persisted = "granted");
        return (persisted = (await storage.persist()) ? "granted" : "denied");
      } catch (cause) {
        lastError = describe(cause);
        return (persisted = "failed");
      }
    })();
    return asking;
  };

  return {
    async read(area, gameId, path) {
      try {
        return await backend.get(blobPrefix(area, gameId) + encodeURIComponent(path));
      } catch (cause) {
        // A read that fails is not an absent save: the engine is told "no such blob" only by `null`, so a failure is
        // thrown for the pump to report instead of looking like an empty slot.
        lastError = describe(cause);
        throw cause;
      }
    },
    async write(area, gameId, path, bytes) {
      writes += 1;
      // Persistence is asked on the first write, where the browser can tie it to something the player did.
      await requestPersistence();
      try {
        await backend.put(blobPrefix(area, gameId) + encodeURIComponent(path), bytes);
        return true;
      } catch (cause) {
        failedWrites += 1;
        lastError = describe(cause);
        if (isQuotaError(cause)) quota = "limited";
        return false;
      }
    },
    async list(area, gameId) {
      const prefix = blobPrefix(area, gameId);
      try {
        return (await backend.keys(prefix)).map((key) => decodeURIComponent(key.slice(prefix.length))).sort();
      } catch (cause) {
        lastError = describe(cause);
        throw cause;
      }
    },
    state: () => ({ persisted, quota, lastError, writes, failedWrites }),
    requestPersistence,
  };
}

/** An in-memory backend, for tests and for a page with no IndexedDB. It holds copies, and `capacity` (bytes) makes it refuse like a full store. */
export function createMemoryBlobBackend(capacity = Number.POSITIVE_INFINITY): BlobBackend & { readonly keysHeld: () => readonly string[] } {
  const held = new Map<string, Uint8Array>();
  let used = 0;
  return {
    async get(key) {
      const bytes = held.get(key);
      return bytes === undefined ? null : Uint8Array.from(bytes);
    },
    async put(key, bytes) {
      const previous = held.get(key)?.length ?? 0;
      if (used - previous + bytes.length > capacity) {
        const error = new Error("the blob store is full");
        error.name = "QuotaExceededError";
        throw error;
      }
      used += bytes.length - previous;
      held.set(key, Uint8Array.from(bytes));
    },
    async keys(prefix) {
      return [...held.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    keysHeld: () => [...held.keys()].sort(),
  };
}

const STORE = "blobs";

function awaitRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** The IndexedDB backend: one object store of ArrayBuffers, keyed by the host's string key. */
export async function createIndexedDbBlobBackend(factory: IDBFactory, name: string): Promise<BlobBackend> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = factory.open(name, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(STORE);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("IndexedDB could not be opened"));
    opening.onblocked = () => reject(new Error("IndexedDB is blocked by another connection"));
  });
  return {
    async get(key) {
      const value = await awaitRequest(database.transaction(STORE, "readonly").objectStore(STORE).get(key));
      return value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    },
    put(key, bytes) {
      return new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, "readwrite");
        // A copy: the caller's buffer may be reused or detached once the engine has its reply.
        transaction.objectStore(STORE).put(bytes.slice().buffer, key);
        transaction.oncomplete = () => resolve();
        // A quota failure surfaces on the transaction, not the request.
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      });
    },
    async keys(prefix) {
      // Keys are percent-encoded ASCII, so U+FFFF is above every key that shares the prefix.
      const found = await awaitRequest(
        database.transaction(STORE, "readonly").objectStore(STORE).getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)),
      );
      return found.filter((key): key is string => typeof key === "string").sort();
    },
  };
}
