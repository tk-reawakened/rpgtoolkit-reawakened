import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
import { readStepCounters } from "/Users/jensen/.omp/wt/514/packages/core/src/index.ts";
const rig = bootUiRig();
rig.until(() => { const ui = rig.ui(); return ui !== null && ui.mode === "command"; }, 1500);
const total = () => Object.values(readStepCounters(rig.state().vm)).reduce((a: number, b: any) => a + b, 0) as number;
let last = total(); const start = rig.state().time.tick;
let sigAt = -1; const sig0 = String((rig.ui() as any).signature);
for (let i = 0; i < 40; i++) { rig.tick(1); const now = total(); const sig = String((rig.ui() as any).signature); console.log("tick", rig.state().time.tick - start, "steps", now - last, sig !== sig0 ? "SIG" : ""); last = now; if (sig !== sig0 && sigAt < 0) sigAt = i; if (i > sigAt + 3 && sigAt >= 0) break; }
