/**
 * The host's client for the decode worker (issue #934, OQ3): `createDecodeAhead` spawns the worker and returns the
 * `DecodeAhead` the live session hands hints to.
 *
 * Everything here is nonblocking bookkeeping. `prepare` copies the caller's bytes and posts a job; the worker replies once
 * per job, in order; `image` and `audio` read what has arrived. Nothing a result carries can reach simulation state: the
 * session reads prepared pixels and samples exactly where it would otherwise decode on demand, and gets the same values.
 * A job that ends without a prepared result is a named gap, and one the worker tried and could not finish also counts as
 * failed (`DecodeStats`). If no Worker can be made at all this throws; there is no silent no-op stand-in.
 */

import type { AssetKey } from "@tk-reawakened/core";
import type { TexturePixels } from "@tk-reawakened/render-webgl2";
import type { DecodeAhead, DecodeGap, DecodeJob, DecodeReply, DecodeStats, PrepareKind, PreparedAudio } from "./decode-types.ts";

/** Where the lane serves the worker bundle `tools/browser/build.mjs` emits (`out: "decode-worker.js"`). */
export const DECODE_WORKER_URL = "/apps/decode-worker.js";

export type DecodeAheadOptions = {
  /** The audio graph's sample rate: WAV is prepared at this rate, so the sink can open it with no resample. */
  readonly outputRateHz: number;
  /** Make the worker. The default is a classic `Worker` over `workerUrl`. A test passes an in-process one. */
  readonly spawn?: () => Worker;
  /** The worker bundle's URL; defaults to `DECODE_WORKER_URL`. Ignored when `spawn` is given. */
  readonly workerUrl?: string;
};

/** The worker could not be created, so nothing can be prepared ahead. The caller decides what that means. */
export class DecodeAheadError extends Error {
  constructor(message: string, options?: { readonly cause: unknown }) {
    super(message, options);
    this.name = "DecodeAheadError";
  }
}

type Pending = { readonly key: AssetKey; readonly kind: PrepareKind };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDecodeAhead(options: DecodeAheadOptions): DecodeAhead {
  const { outputRateHz } = options;
  if (!Number.isFinite(outputRateHz) || outputRateHz <= 0) {
    throw new RangeError(`createDecodeAhead: outputRateHz must be a positive number, got ${outputRateHz}`);
  }
  let worker: Worker;
  try {
    worker = options.spawn !== undefined ? options.spawn() : new Worker(options.workerUrl ?? DECODE_WORKER_URL);
  } catch (cause) {
    throw new DecodeAheadError(`the decode worker could not be created: ${describe(cause)}`, { cause });
  }

  const seen = new Set<string>();
  const pending = new Map<number, Pending>();
  const images = new Map<AssetKey, TexturePixels>();
  const audio = new Map<AssetKey, PreparedAudio>();
  const gaps: DecodeGap[] = [];
  const waiters: { readonly ids: Set<number>; readonly resolve: () => void }[] = [];
  let nextId = 1;
  let submitted = 0;
  let completed = 0;
  let failed = 0;
  let workerError: string | null = null;
  let closed = false;

  /** A job is done, however it ended: let every `settled()` that was waiting on it go. */
  const settle = (id: number): void => {
    pending.delete(id);
    for (const waiter of [...waiters]) {
      waiter.ids.delete(id);
      if (waiter.ids.size === 0) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };

  const gap = (id: number, entry: Pending, reason: string, isFailure: boolean): void => {
    gaps.push({ key: entry.key, kind: entry.kind, reason });
    if (isFailure) failed += 1;
    settle(id);
  };

  /** The worker is gone: every job still waiting on it fails by name, and later jobs fail the same way. */
  const die = (reason: string): void => {
    if (workerError === null) workerError = reason;
    for (const [id, entry] of [...pending]) gap(id, entry, `failed: ${entry.key}: ${reason}`, true);
  };

  worker.onmessage = (event: MessageEvent<DecodeReply>): void => {
    if (closed) return;
    const reply = event.data;
    const entry = pending.get(reply.id);
    if (entry === undefined) {
      die(`the decode worker answered job ${reply.id}, which is not waiting`);
      return;
    }
    switch (reply.type) {
      case "image":
        images.set(entry.key, reply.pixels);
        completed += 1;
        settle(reply.id);
        return;
      case "audio":
        audio.set(entry.key, reply.audio);
        completed += 1;
        settle(reply.id);
        return;
      case "gap":
        gap(reply.id, entry, reply.reason, reply.failed);
        return;
      default:
        die(`the decode worker sent an unknown reply for ${entry.key}`);
    }
  };
  worker.onerror = (event: ErrorEvent): void => {
    if (!closed) die(`the decode worker failed: ${event.message === "" ? "its script did not load or threw" : event.message}`);
  };
  worker.onmessageerror = (): void => {
    if (!closed) die("the decode worker sent a message that could not be read");
  };

  return {
    prepare(key, bytes, kind): void {
      if (closed) throw new DecodeAheadError(`prepare(${key}) after close()`);
      const identity = `${kind}\u0000${key}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      submitted += 1;
      const id = nextId;
      nextId += 1;
      pending.set(id, { key, kind });
      if (workerError !== null) {
        gap(id, { key, kind }, `failed: ${key}: ${workerError}`, true);
        return;
      }
      // The caller keeps its bytes: the worker gets a copy, and the copy (not the caller's buffer) is transferred.
      const copy = bytes.slice().buffer;
      const job: DecodeJob = { type: "job", id, key, kind, outputRateHz, bytes: copy };
      try {
        worker.postMessage(job, [copy]);
      } catch (cause) {
        // postMessage only throws when the job cannot be cloned or the worker is already terminated.
        die(`the decode worker would not accept a job: ${describe(cause)}`);
      }
    },
    image: (key) => images.get(key) ?? null,
    audio: (key) => audio.get(key) ?? null,
    settled(): Promise<void> {
      if (pending.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push({ ids: new Set(pending.keys()), resolve });
      });
    },
    stats(): DecodeStats {
      return { submitted, completed, failed, gaps: [...gaps], workerError };
    },
    close(): void {
      if (closed) return;
      closed = true;
      worker.terminate();
      images.clear();
      audio.clear();
      pending.clear();
      for (const waiter of waiters.splice(0)) waiter.resolve();
    },
  };
}
