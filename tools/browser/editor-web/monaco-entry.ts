// Monaco is chosen by the page, not by `main.tsx` or `host-web`: importing it loads the editor, which only a browser
// page does, so the tests that import `main.tsx` under Node never load it. `page.ts` imports this before `main.tsx`.
import { createMonacoSurfaceFactory } from "@tk-reawakened/editor-ui/monaco";

(globalThis as { __tkrCodeEditor?: unknown }).__tkrCodeEditor = createMonacoSurfaceFactory({ workerUrl: "./dist/monaco-editor.worker.js" });
