import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
import { readStepCounters } from "/Users/jensen/.omp/wt/514/packages/core/src/index.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
const total = () => Object.values(readStepCounters(rig.state().vm)).reduce((a: number, b: any) => a + b, 0) as number;
for (let i = 0; i < 8; i += 1) {
  const before = total();
  const t0 = (rig.state() as any).time.tick;
  rig.tick(1);
  const s = rig.state() as any;
  const ui = rig.ui()!;
  console.log(`tick ${t0}->${s.time.tick} steps=${total() - before} refr=${ui.refreshes} draws=${ui.draws} lastPaint=${ui.lastPaintTick}`);
}
