// Monaco 0.57.0 mounted the way editor-ui would mount it: a framework-free bridge, a tiny Monarch grammar for an
// RPGCode-like program, and one of three worker set-ups chosen at build time (`__WORKER_MODE__`):
//   "classic"     MonacoEnvironment.getWorker returns `new Worker(<url>)`, a classic worker from the page's origin
//   "blob"        Monaco's default: MonacoEnvironment.getWorkerUrl, which Monaco wraps in a blob: module worker
//   "fetch-blob"  getWorker fetches the worker script and starts it from a blob: URL (what a VS Code webview needs,
//                 because its resources are served from another origin than the webview document)
// The worker script URL is `<meta name="tkr-worker">` when the page has one (a webview), else "./editor.worker.js".
// The entry that imports this module also imports Monaco itself (`monaco-core` or `monaco-full`).
import * as monaco from "monaco-editor/editor/editor.api.js";
import "./spike.css";

const probe = (window.__monaco = { workers: [], workerMessages: 0, workerErrors: [], ready: false });
// Where no probe was injected before the page ran (a VS Code webview's inner frame), record violations from here on.
if (!window.__violations) {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    window.__violations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI, sample: (event.sample || "").slice(0, 60), source: (event.sourceFile || "").split("/").pop() });
  }, true);
}

// Count every worker the page creates and whether it answers, whichever path Monaco takes.
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url, options) {
    super(url, options);
    probe.workers.push({ url: String(url).slice(0, 80), type: options?.type ?? "classic" });
    this.addEventListener("message", () => probe.workerMessages++);
    this.addEventListener("error", (event) => probe.workerErrors.push(event.message ?? "error"));
  }
};

// Replaced at build time by esbuild `define`.
const workerMode = __WORKER_MODE__;
const workerUrl = document.querySelector('meta[name="tkr-worker"]')?.content ?? "./editor.worker.js";
self.MonacoEnvironment =
  workerMode === "classic"
    ? { getWorker: (_id, label) => new Worker(workerUrl, { name: label }) }
    : workerMode === "fetch-blob"
      ? {
          getWorker: async (_id, label) => {
            const script = await (await fetch(workerUrl)).blob();
            return new Worker(URL.createObjectURL(script), { name: label });
          },
        }
      : { getWorkerUrl: () => "./editor.worker.module.js" };

monaco.languages.register({ id: "rpgcode-spike" });
monaco.languages.setMonarchTokensProvider("rpgcode-spike", {
  keywords: ["if", "else", "while", "for", "method", "return"],
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/#?[a-zA-Z_][\w$!]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/"[^"]*"/, "string"],
      [/\d+/, "number"],
    ],
  },
});
monaco.editor.defineTheme("spike", {
  base: "vs",
  inherit: true,
  rules: [{ token: "keyword", foreground: "aa00aa" }, { token: "comment", foreground: "008800" }],
  colors: {},
});

const text = [
  "// A small authored program for the spike",
  "method greet(name$)",
  "{",
  "    mwin(\"Hello \" + name$)",
  "    wait()",
  "}",
  "greet(\"world\")",
  "if (x! == 1) { greeting = 2 }",
  ...Array.from({ length: 12 }, (_, i) => `counter! = counter! + ${i}`),
].join("\n");

const editor = monaco.editor.create(document.getElementById("editor"), {
  value: text,
  language: "rpgcode-spike",
  theme: "spike",
  automaticLayout: false,
  wordBasedSuggestions: "currentDocument",
  quickSuggestions: false,
});
editor.layout({ width: 800, height: 480 });

probe.editor = editor;
probe.monaco = monaco;
probe.keybindings = () => {
  const resolver = editor._standaloneKeybindingService?._getResolver?.();
  const items = resolver?.getKeybindings?.() ?? resolver?._keybindings ?? [];
  return items
    .filter((item) => item.resolvedKeybinding && item.command)
    .map((item) => ({ key: item.resolvedKeybinding.getUserSettingsLabel(), command: item.command, when: item.when?.serialize?.() ?? null }));
};
probe.ready = true;
