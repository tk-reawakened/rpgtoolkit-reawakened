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
    // The package the app carries in the webDir (`dist/public`). On a device the Capacitor WebView serves it by
    // fetch; in browser tests the static host does not serve it there, so the host's filesystem stub supplies it.
    readPackage: async () => {
      try {
        const response = await fetch("/public/game.tpk");
        if (response.ok) return { name: "game.tpk", bytes: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        // fall through to the filesystem stub used in browser tests
      }
      try {
        const file = await filesystem.readFile({ path: "public/game.tpk", encoding: "base64", directory: "DATA" });
        const text = typeof file.data === "string" ? file.data : "";
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
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
