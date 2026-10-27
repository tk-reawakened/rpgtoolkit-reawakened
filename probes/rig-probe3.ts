import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
rig.until(() => { const ui = rig.ui(); return ui !== null && ui.mode === "command"; }, 1500);
const dump = (l: string) => { const s = rig.state() as any; console.log(l, "tick", s.time.tick, "keys", JSON.stringify(s.input.keys), "claims", JSON.stringify(s.engine.claims), "cursor", rig.ui()!.cursor); };
dump("before");
rig.press("DOWN", 1); dump("after press 1 tick");
rig.tick(1); dump("tick+1");
rig.tick(1); dump("tick+2");
rig.tick(1); dump("tick+3");
const s = rig.state() as any;
console.log(JSON.stringify(s.vm.threads.map((t: any) => ({ id: t.id, wait: t.wait, frames: t.frames.length }))).slice(0, 1500));
console.log("diag", JSON.stringify(rig.diagnostics));
for (let i = 0; i < 4; i++) { rig.tick(1); const ui = rig.ui() as any; console.log("sig", String(ui.signature).slice(0, 120), "| now frames", (rig.state() as any).vm.threads[1].frames.length, "ip", JSON.stringify((rig.state() as any).vm.threads[1].frames.map((f:any)=>[f.program?.name ?? f.program?.kind, f.ip]))); }
