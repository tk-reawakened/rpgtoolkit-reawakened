import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
rig.until(() => { const ui = rig.ui(); return ui !== null && ui.mode === "command"; }, 1500);
const dump = (l: string) => { const s = rig.state() as any; console.log(l, "tick", s.time.tick, "keys", JSON.stringify(s.input.keys.map((k:any)=>k.seq+k.name)), "claims", JSON.stringify(s.engine.claims), "cursor", rig.ui()!.cursor, "mode", rig.ui()!.mode); };
dump("start");
rig.press("DOWN", 14); dump("DOWN");
rig.press("ENTER", 14); dump("ENTER");
rig.tick(12); dump("+12");
