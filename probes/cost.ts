import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
let ops = 0; let composeOps = 0; let paintOps = 0;
const rig = bootUiRig({
  stanceDelayTicks: 1,
  observers: { postStep: () => { ops += 1; const u = rig.ui() as any; if (u?.incompose === 1) composeOps += 1; if (u?.inpaint === 1) paintOps += 1; } },
} as never);
rig.until(() => rig.ui()?.mode === "command", 400);
ops = 0; composeOps = 0; paintOps = 0;
const t0 = (rig.state() as any).time.tick;
rig.tick(10);
const s = rig.state() as any;
console.log(`ticks ${t0}->${s.time.tick} totalOps=${ops} composeOps=${composeOps} paintOps=${paintOps}`);
console.log("ui", JSON.stringify({ sig: String((rig.ui() as any).staticsig).slice(0, 40) }));
