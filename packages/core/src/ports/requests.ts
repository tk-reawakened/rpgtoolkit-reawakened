/**
 * Host requests: the core's only path to the host (AD-5, AD-17).
 *
 * Requests leave through `TickReport.requests`. Every one carries a
 * core-assigned `reqId` and is either blocking (time freezes; `advance`
 * returns `loading` and consumes no ticks) or stream (music and video bytes;
 * never touches state). Every request that needs a reply has a matching
 * `InputEvent` reply (see `input.ts`).
 */

import type { Bytes, PortData } from "./bytes.ts";
import type { PrefetchHint } from "../prefetch/plan.ts";
import type { AssetKey } from "./keys.ts";

/** The two sandboxed storage areas a blob key can name (AD-17). */
export type BlobArea = "saves" | "files";

/** A sandboxed file key, case-folded in core (AD-17). */
export type BlobKey = {
  readonly area: BlobArea;
  readonly path: string;
};

/** Ask the runner for an asset by canonical key (AD-5). Blocking. */
export type AssetRequest = {
  readonly kind: "asset";
  readonly reqId: number;
  readonly key: AssetKey;
};

/** Ask the runner to load a blob (AD-5). Blocking. */
export type LoadBlobRequest = {
  readonly kind: "loadBlob";
  readonly reqId: number;
  readonly blob: BlobKey;
};

/** Ask the runner to persist a blob (AD-5, AD-17). Blocking. */
export type SaveBlobRequest = {
  readonly kind: "saveBlob";
  readonly reqId: number;
  readonly blob: BlobKey;
  readonly bytes: Bytes;
};

/** Ask the runner for the names in a storage area (AD-5, AD-17). Blocking. */
export type ListBlobsRequest = {
  readonly kind: "listBlobs";
  readonly reqId: number;
  readonly area: BlobArea;
};

/** Call into the sandboxed E-99 extension mechanism (AD-17). */
export type ExtensionCallRequest = {
  readonly kind: "extension.call";
  readonly reqId: number;
  readonly name: string;
  readonly args: readonly PortData[];
};

/** Ask the runner to quit the game (AD-17). */
export type QuitRequest = {
  readonly kind: "quit";
  readonly reqId: number;
};

/**
 * Ask the runner to fetch and decode ahead ([runners.md#prefetch]). Stream, never blocking: no reply exists, state and the
 * draw and state hashes never read it, and a host that discards hints changes no pixel, no sound and no hash.
 */
export type PrefetchRequest = {
  readonly kind: "prefetch";
  readonly reqId: number;
  readonly hints: readonly PrefetchHint[];
};

/** Ask the runner to open an `https:` URL, after asking the user (AD-17). */
export type OpenUrlRequest = {
  readonly kind: "openUrl";
  readonly reqId: number;
  readonly url: string;
};

/** Ask the runner to play a video asset (AD-17). Stream. */
export type PlayVideoRequest = {
  readonly kind: "playVideo";
  readonly reqId: number;
  readonly key: AssetKey;
  readonly presentation: "full" | "small";
};

/** The one published request union (AD-17). */
export type RunnerRequest =
  | AssetRequest
  | LoadBlobRequest
  | SaveBlobRequest
  | ListBlobsRequest
  | ExtensionCallRequest
  | QuitRequest
  | OpenUrlRequest
  | PlayVideoRequest
  | PrefetchRequest;
