import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { readFileSync } from "node:fs";
GlobalRegistrator.register();
const { createFolderProject } = await import("@tk-reawakened/host-web/testing");
const { MemoryDirectory } = await import("./conformance/memory-directory.ts");
const gam = new Uint8Array(readFileSync("../../docs/spec/examples/game/Main/example.gam"));
const b = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const root = new MemoryDirectory("project", { refuse: false, refuseNames: undefined, hold: null, tick: 0 });
root.put("Main/example.gam", gam);
root.put("Prg/messy.prg", b("x = 1\n"));
const dialogs = { async ask(q) { console.log("ASK", q.message); return "continue"; }, async pickSavePath() { return null; } };
const web = createFolderProject(root, { id: "probe", name: "Probe" }, { dialogs });
const fs = web.services.fs;
for (const m of ["list","read","write","createFolder","stat","delete","rename","listProject","readProject","writeProject","statProject","deleteProject"]) {
  const orig = fs[m].bind(fs);
  fs[m] = async (...args) => { console.log("fs." + m, JSON.stringify(args[0])); const r = await orig(...args); console.log("  ->", m, r.ok ? "ok" : "ERR " + r.error?.message); return r; };
}
console.log("begin...");
const result = await Promise.race([web.workspace.checkpoints.begin(["Prg/messy.prg"], "probe").then(r => JSON.stringify(r)), new Promise(r => setTimeout(() => r("PENDING"), 3000))]);
console.log("RESULT", result);
process.exit(0);
