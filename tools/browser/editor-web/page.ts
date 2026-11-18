// The standalone editor page's entry: the code editor first, then the page. Modules run in import order.
import "./monaco-entry.ts";
import "./main.tsx";

// A separate scope and cache keep the editor's shell independent of the embedded player.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./service-worker.js").catch((error: unknown) => {
    console.warn("The editor could not prepare its offline shell.", error);
  });
}
