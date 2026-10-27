import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
for (let i = 0; i < 120; i++) {
  rig.tick(4);
  let s: any;
  try { s = rig.state() as any; } catch { console.log("no state yet at it", i); continue; }
  const ui = rig.ui();
  if (ui && ui.mode === "command") { console.log("COMMAND at tick", s.time.tick, "iteration", i); process.exit(0); }
  if (i % 10 === 0) {
    const threads = s.vm.threads.map((t: any) => ({ id: t.id, wait: t.wait ? `${t.wait.kind}:${JSON.stringify(t.wait.reqId ?? t.wait.key ?? "")}` : "run" }));
    console.log("it", i, "tick", s.time.tick, "battle?", s.battle !== null, "uiOn", ui?.on, "threads", JSON.stringify(threads), "diag", rig.diagnostics.length);
  }
}
console.log("NOT REACHED; diag", JSON.stringify(rig.diagnostics.slice(0,5)));
