/**
 * The mobile player page (entry 9.12): the **same** shared page as the desktop shell, run against the mobile host.
 *
 * The wrapper adds no renderer, input path or asset source of its own; on a device the host is Capacitor's `Filesystem`,
 * and the package is the one the app carries or the player picked. Nothing here knows it is on a phone.
 */

import { bootPlayerPage } from "@tk-reawakened/runner-web";
import { createMobileHost, type MobileFilesystem } from "../src/storage.ts";

declare global {
  interface Window {
    __mobile?: unknown;
    Capacitor?: { Plugins?: { Filesystem?: MobileFilesystem } };
  }
}

void (async () => {
  const filesystem = window.Capacitor?.Plugins?.Filesystem;
  if (filesystem === undefined) {
    window.__mobile = { error: "the Capacitor Filesystem plugin is absent; this page runs inside the wrapper" };
    return;
  }
  const host = createMobileHost({
    filesystem,
    // The package the app carries: `capacitor.config.json` puts the built page and the package in `dist/`.
    readPackage: async () => {
      try {
        const file = await filesystem.readFile({ path: "public/game.tpk" });
        const bytes = file.data instanceof Uint8Array
          ? file.data
          : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
        return { name: "game.tpk", bytes };
      } catch {
        return null;
      }
    },
  });
  const report = await bootPlayerPage(host);
  window.__mobile = report;
  document.title = `mobile: ${report.error ?? report.stateHash}`;
})();
