// Electron main process for the spike: the same pages over a privileged `app://` scheme registered like the desktop
// player's (standard, secure, fetch, CORS), with context isolation and the sandbox on. Not the packaged editor: the
// repository has no desktop editor host yet, so this is Electron's runtime and scheme, not a packaged-host proof.
import { app, BrowserWindow, protocol } from "electron";
import { respond } from "./page.mjs";

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { status, type, body } = respond(new URL(request.url));
    return new Response(body, { status, headers: { "content-type": type } });
  });
  const window = new BrowserWindow({ width: 1280, height: 800, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.loadURL("app://spike/health");
});
app.on("window-all-closed", () => app.quit());
