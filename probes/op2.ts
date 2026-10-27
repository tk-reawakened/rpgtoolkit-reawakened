import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
let ops = 0;
const hot = new Map<string, number>();
const rig = bootUiRig({
  stanceDelayTicks: 1,
  observers: { postStep: (op: any) => { ops += 1; const k = `${String(op.pos?.line ?? 0)}`; hot.set(k, (hot.get(k) ?? 0) + 1); } },
} as never);
rig.until(() => rig.ui()?.mode === "command", 400);
let lastRefr = (rig.ui() as any).refreshes;
hot.clear(); ops = 0;
for (let i = 0; i < 10; i += 1) {
  rig.tick(1);
  const ui = rig.ui() as any;
  if (ui.refreshes !== lastRefr) {
    console.log(`refresh #${ui.refreshes} at tick ${(rig.state() as any).time.tick}: ops since last refresh = ${ops} paints=${ui.paints}`);
    console.log("  hot", JSON.stringify([...hot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)));
    lastRefr = ui.refreshes; ops = 0; hot.clear();
  }
}
