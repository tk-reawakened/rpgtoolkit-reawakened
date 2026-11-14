/**
 * The desktop host bridge (entry 9.11; launch resolution added by entry 9.10): the shared player page's calls and no
 * more, so the page keeps one asset source and one input path as it does in the browser (runners.md#mobile's "must not
 * fork" rule binds every wrapper).
 */

import { contextBridge, ipcRenderer } from "electron";

import type { LaunchInfo } from "@tk-reawakened/runner-web";
import type { DesktopDebugOptions } from "./debug-options.ts";

export type DesktopHost = {
  /**
   * The game this launch opens, as bytes; `gameId` names a library entry the page offered and is omitted for the ruled
   * order. `null` when the resolution names no game, and a refusal rejects with its reason.
   */
  openPackage(gameId?: string): Promise<{ readonly name: string; readonly bytes: Uint8Array; readonly descriptor: unknown } | null>;
  /** Which rule named the game, the rows to offer, and the sentence that says why nothing opened. */
  launchInfo(): Promise<LaunchInfo>;
  /** This run's overlay override and whether the diagnostics strip was asked for (E-05, main-file row 58). */
  debug(): Promise<DesktopDebugOptions>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  listBlobs(area: "saves" | "files", gameId: string): Promise<string[]>;
  /** Hand a measurement report to the main process, which writes it where `--report` names. */
  report(value: unknown): Promise<boolean>;
  /** Close the desktop player through Electron's ordered application teardown. */
  quit(): Promise<boolean>;
};

contextBridge.exposeInMainWorld("desktop", {
  openPackage: (gameId?: string) => ipcRenderer.invoke("desktop:launch", gameId ?? null),
  launchInfo: () => ipcRenderer.invoke("desktop:launch.info"),
  debug: () => ipcRenderer.invoke("desktop:debug"),
  readBlob: (area, gameId, path) => ipcRenderer.invoke("desktop:blob.read", area, gameId, path),
  writeBlob: (area, gameId, path, bytes) => ipcRenderer.invoke("desktop:blob.write", area, gameId, path, bytes),
  listBlobs: (area, gameId) => ipcRenderer.invoke("desktop:blob.list", area, gameId),
  report: (value) => ipcRenderer.invoke("desktop:report", value),
  quit: () => ipcRenderer.invoke("desktop:quit"),
} satisfies DesktopHost);
