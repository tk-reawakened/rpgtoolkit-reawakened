/**
 * Load modes for the web player (docs/spec/engine/runners.md#load-modes, #offline).
 *
 * A package is always transferred and validated whole (`openPackageSource`), because the archive's safety limits, its
 * SHA-256 and its content-derived identity cannot be proved from a part of it. What the mode decides is what the player
 * *keeps* afterwards:
 *
 * - `whole`: the package's uncompressed size is at or below the threshold, so the validated archive is persisted in the
 *   durable store and later launches, offline ones included, need no network.
 * - `streaming`: the package is above the threshold, or the player was told to stream, or the store could not keep it
 *   (quota exceeded or any other store failure). Nothing is kept; assets are fetched by validated ranges on demand.
 *
 * The first launch of a streaming package still transfers the whole archive. That is the owner's ruling for issue #934
 * (OQ1): the mode bounds what stays in memory, it does not make the first launch lazy.
 */

import { PackageSourceError, type PackageSource, type PackageSourceOptions } from "./package-source.ts";
import { openPackageSource } from "./package-source.ts";

/** How the player holds a package. */
export type LoadMode = "whole" | "streaming";

/** What a caller may ask for: let the size decide, or force one mode (tests, an author's override). */
export type LoadModeRequest = "auto" | LoadMode;

/**
 * The measured threshold, in bytes: the uncompressed size of the largest corpus package (ChimeranEmpire, 32,175,677
 * bytes) rounded up to whole MiB. The documented row is `docs/spec/engine/runners.md#load-modes`, and
 * `pnpm corpus:measure --check` fails when either drifts from the corpus.
 */
export const WHOLE_PACKAGE_THRESHOLD_BYTES = 31 * 1_048_576;

/** The slice of `navigator.storage` the controller uses. */
export interface StorageManagerLike {
  /** Ask the browser to keep this origin's data under storage pressure; `true` when it agrees. */
  persist?(): Promise<boolean>;
  /** Whether the origin's data is already persistent. */
  persisted?(): Promise<boolean>;
}

/**
 * What the browser said about persistence. `unsupported` means it has no way to ask; `not-requested` means this launch
 * kept nothing, so it never asked.
 */
export type PersistState = "granted" | "denied" | "unsupported" | "not-requested" | "failed";

/** Whether the durable store accepted the package. */
export type QuotaState = "ok" | "limited" | "not-needed";

export type StorageState = {
  /** The answer to `navigator.storage.persist()`. */
  readonly persisted: PersistState;
  /** `limited` once the store refused the package for lack of quota; `not-needed` when nothing was to be kept. */
  readonly quota: QuotaState;
  /** Whether the validated archive is held in the durable store now. */
  readonly kept: boolean;
  /** The store's failure when it could not keep the package, whatever the reason; `null` otherwise. */
  readonly error: string | null;
};

export type LoadPhase = "idle" | "downloading" | "validating" | "ready" | "failed";

/** Everything a page needs to show while loading: progress, the mode and how storage fared. */
export type LoadState = {
  readonly phase: LoadPhase;
  /** `null` until the package has been validated and the mode chosen. */
  readonly mode: LoadMode | null;
  /** Bytes of the archive received and its declared size; `total` is `null` until the descriptor is checked. */
  readonly progress: { readonly received: number; readonly total: number | null };
  readonly storage: StorageState;
  /** The failure that ended the load, or `null`. An offline miss is `kind: "offline"`. */
  readonly error: PackageSourceError | null;
};

export type LoadControllerOptions = Omit<PackageSourceOptions, "onProgress"> & {
  /** Defaults to `auto`. */
  readonly mode?: LoadModeRequest;
  /** Bytes of uncompressed package at or below which `auto` keeps the package whole. Defaults to the measured threshold. */
  readonly thresholdBytes?: number;
  /** `navigator.storage`, or a stand-in. Absent means the browser cannot be asked. */
  readonly storage?: StorageManagerLike;
};

export interface LoadController {
  readonly state: () => LoadState;
  /** Call `listener` after every state change; returns the way to stop. */
  readonly subscribe: (listener: (state: LoadState) => void) => () => void;
  /** Open, validate and keep or stream the package. Resolves once with the ready source; rejects with a `PackageSourceError`. */
  readonly load: () => Promise<PackageSource>;
}

const NO_STORAGE: StorageState = { persisted: "not-requested", quota: "not-needed", kept: false, error: null };

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
}

export function createLoadController(options: LoadControllerOptions): LoadController {
  const request = options.mode ?? "auto";
  const threshold = options.thresholdBytes ?? WHOLE_PACKAGE_THRESHOLD_BYTES;
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new RangeError(`runner-web: the load threshold must be a non-negative whole number of bytes, got ${String(threshold)}`);
  }
  if (request !== "auto" && request !== "whole" && request !== "streaming") {
    throw new RangeError(`runner-web: unknown load mode ${String(request)}`);
  }
  let state: LoadState = { phase: "idle", mode: null, progress: { received: 0, total: null }, storage: NO_STORAGE, error: null };
  const listeners = new Set<(state: LoadState) => void>();
  let started: Promise<PackageSource> | null = null;
  const publish = (next: Partial<LoadState>): void => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };

  /** Ask the browser to keep the origin's data, recording its answer rather than swallowing it. */
  async function requestPersistence(): Promise<PersistState> {
    const storage = options.storage;
    if (storage === undefined || typeof storage.persist !== "function") return "unsupported";
    try {
      if (typeof storage.persisted === "function" && (await storage.persisted())) return "granted";
      return (await storage.persist()) ? "granted" : "denied";
    } catch {
      return "failed";
    }
  }

  async function run(): Promise<PackageSource> {
    publish({ phase: "downloading", progress: { received: 0, total: null } });
    let source: PackageSource;
    try {
      const { mode: _mode, thresholdBytes: _threshold, storage: _storage, ...sourceOptions } = options;
      source = await openPackageSource({
        ...sourceOptions,
        onProgress: (received, total) => {
          publish({ phase: received >= total ? "validating" : "downloading", progress: { received, total } });
        },
      });
    } catch (cause) {
      const error = cause instanceof PackageSourceError ? cause : new PackageSourceError("http", describe(cause), { cause });
      publish({ phase: "failed", error });
      throw error;
    }

    // `auto` compares what the package costs uncompressed (the sum of its declared sizes) with the threshold: at or
    // below, keeping it whole costs no more than the measured corpus did.
    const wantsWhole = request === "whole" || (request === "auto" && source.totalUncompressedSize <= threshold);
    if (!wantsWhole) {
      await source.stream();
      publish({ phase: "ready", mode: "streaming", storage: { ...NO_STORAGE, persisted: "not-requested" } });
      return source;
    }

    // Persistence first, so a refusal to keep is reported next to the answer it may be explained by.
    const persisted = await requestPersistence();
    try {
      await source.keep();
      publish({ phase: "ready", mode: "whole", storage: { persisted, quota: "ok", kept: true, error: null } });
      return source;
    } catch (cause) {
      // Whatever the store could not keep is streamed instead: the page still boots, and the state says why it did not
      // keep the package. A failure that is not the store's (the archive stopped matching, the network went) is the
      // load's failure.
      if (!(cause instanceof PackageSourceError) || (cause.kind !== "quota" && cause.kind !== "durable")) {
        const error = cause instanceof PackageSourceError ? cause : new PackageSourceError("http", describe(cause), { cause });
        await source.close();
        publish({ phase: "failed", error });
        throw error;
      }
      await source.stream();
      publish({
        phase: "ready",
        mode: "streaming",
        storage: { persisted, quota: cause.kind === "quota" ? "limited" : "ok", kept: false, error: cause.message },
      });
      return source;
    }
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load() {
      started ??= run();
      return started;
    },
  };
}
