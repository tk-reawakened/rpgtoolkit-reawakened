/**
 * The mobile wrapper's host services (entry 9.12; `docs/spec/engine/runners.md#mobile`).
 *
 * The wrapper **MUST NOT** fork the player: it is the same `runner-web` build, the same renderer, the same input path and
 * the same asset source, with a platform service behind them. This module is that service and nothing else — the four
 * calls the desktop preload exposes, implemented over an injectable filesystem so the same object runs under Capacitor's
 * `Filesystem` plugin on a device and under a plain stub in a test.
 *
 * The blob keys are AD-17's: `saves` and `files`, each keyed by the game's `GameId`, exactly as the desktop host lays them
 * out. A path that escapes its area is refused, on every platform the same way.
 */

import { Directory } from "@capacitor/filesystem";
import type { FilesystemPlugin } from "@capacitor/filesystem";

/** The Capacitor calls this wrapper needs, kept injectable for tests. */
export type MobileFilesystem = Pick<FilesystemPlugin, "writeFile" | "readFile" | "readdir">;

/** Capacitor's native plugin stores binary writes as base64 strings, never as raw Uint8Array values. */
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function decodeBinary(data: string | Blob): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const DATA_DIRECTORY = Directory.Data;

export type MobileHostOptions = {
  readonly filesystem: MobileFilesystem;
  /** Where a package comes from: the app's bundle on a device, or a file the player picked. */
  readonly readPackage: () => Promise<{ readonly name: string; readonly bytes: Uint8Array } | null>;
};

/** Refuse a path that is absolute or climbs out of its area, before any platform call sees it. */
export function safeRelative(path: string): string | null {
  const normalised = path.replaceAll("\\", "/");
  if (normalised === "" || normalised.startsWith("/") || /^[A-Za-z]:/.test(normalised)) return null;
  if (normalised.split("/").some((segment) => segment === ".." || segment === "")) return null;
  return normalised;
}

/** The area's directory inside the app's own storage. */
function areaPath(area: "saves" | "files", gameId: string): string {
  return `${area}/${gameId}`;
}

/**
 * The four-call host the shared page takes (`PlayerHost`). A failure is `null`/`false`, never a throw, because the page
 * treats an absent save as absent rather than as a crash.
 */
export function createMobileHost(options: MobileHostOptions): {
  openPackage(): Promise<{ readonly name: string; readonly bytes: Uint8Array } | null>;
  writeBlob(area: "saves" | "files", gameId: string, path: string, bytes: Uint8Array): Promise<boolean>;
  readBlob(area: "saves" | "files", gameId: string, path: string): Promise<Uint8Array | null>;
  listBlobs(area: "saves" | "files", gameId: string): Promise<string[]>;
} {
  const { filesystem } = options;
  return {
    openPackage: options.readPackage,
    async writeBlob(area, gameId, path, bytes) {
      const safe = safeRelative(path);
      const safeGame = safeRelative(gameId);
      if (safe === null || safeGame === null) return false;
      try {
        await filesystem.writeFile({
          path: `${areaPath(area, safeGame)}/${safe}`,
          directory: DATA_DIRECTORY,
          data: encodeBase64(bytes),
          recursive: true,
        });
        return true;
      } catch {
        return false;
      }
    },
    async readBlob(area, gameId, path) {
      const safe = safeRelative(path);
      const safeGame = safeRelative(gameId);
      if (safe === null || safeGame === null) return null;
      try {
        const file = await filesystem.readFile({
          path: `${areaPath(area, safeGame)}/${safe}`,
          directory: DATA_DIRECTORY,
        });
        return await decodeBinary(file.data);
      } catch {
        return null;
      }
    },
    async listBlobs(area, gameId) {
      const safeGame = safeRelative(gameId);
      if (safeGame === null) return [];
      try {
        const root = areaPath(area, safeGame);
        const files: string[] = [];
        const visit = async (directoryPath: string, relativePath: string): Promise<void> => {
          const listed = await filesystem.readdir({ path: directoryPath, directory: DATA_DIRECTORY });
          for (const entry of listed.files) {
            const entryPath = relativePath === "" ? entry.name : `${relativePath}/${entry.name}`;
            if (entry.type === "directory") {
              await visit(`${directoryPath}/${entry.name}`, entryPath);
            } else {
              files.push(entryPath);
            }
          }
        };
        await visit(root, "");
        return files.sort();
      } catch {
        return [];
      }
    },
  };
}
