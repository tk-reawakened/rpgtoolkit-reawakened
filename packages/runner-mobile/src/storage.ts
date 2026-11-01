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

/** The slice of Capacitor's `Filesystem` plugin this wrapper needs, so a test can stand in for it. */
export type MobileFilesystem = {
  /** Capacitor's `writeFile` accepts a base64-encoded string with `encoding: "base64"`. `directory: "DATA"` is the app files dir. */
  writeFile(options: { readonly path: string; readonly data: string; readonly encoding: "base64" | "utf8"; readonly directory?: "DATA"; readonly recursive?: boolean }): Promise<unknown>;
  /** Capacitor returns base64 text for a binary read when `encoding: "base64"` is requested. */
  readFile(options: { readonly path: string; readonly encoding?: "base64" | "utf8"; readonly directory?: "DATA" }): Promise<{ readonly data: string | Uint8Array }>;
  readdir(options: { readonly path: string; readonly directory?: "DATA" }): Promise<{ readonly files: readonly { readonly name: string; readonly type?: string }[] }>;
};

export type MobileHostOptions = {
  readonly filesystem: MobileFilesystem;
  /** Where a package comes from: the app's bundle on a device, or a file the player picked. */
  readonly readPackage: () => Promise<{ readonly name: string; readonly bytes: Uint8Array } | null>;
};

/** Encode bytes as a base64 string without spreading, so large saves do not blow the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(text);
}

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
      const dir = areaPath(area, safeGame);
      try {
        await filesystem.writeFile({
          path: `${dir}/${safe}`,
          data: bytesToBase64(bytes),
          encoding: "base64",
          directory: "DATA",
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
        const file = await filesystem.readFile({ path: `${areaPath(area, safeGame)}/${safe}`, encoding: "base64", directory: "DATA" });
        if (file.data instanceof Uint8Array) return file.data;
        // Capacitor returns base64 text for a binary read; decode it the way the host bridge does.
        const binary = atob(file.data);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      } catch {
        return null;
      }
    },
    async listBlobs(area, gameId) {
      const safeGame = safeRelative(gameId);
      if (safeGame === null) return [];
      const base = areaPath(area, safeGame);
      const walk = async (dir: string): Promise<string[]> => {
        let listed;
        try {
          listed = await filesystem.readdir({ path: dir, directory: "DATA" });
        } catch {
          return [];
        }
        const names: string[] = [];
        for (const entry of listed.files) {
          const child = `${dir}/${entry.name}`;
          if (entry.type === "directory") {
            for (const nested of await walk(child)) names.push(`${entry.name}/${nested}`);
          } else {
            names.push(entry.name);
          }
        }
        return names;
      };
      return (await walk(base)).sort();
    },
  };
}
