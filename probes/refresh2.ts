import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
for (let i = 0; i < 8; i += 1) {
  const ui = rig.ui() as any;
  console.log(`tick=${(rig.state() as any).time.tick} refr=${ui.refreshes} chrome=${ui.chromediffs} paints=${ui.paints} lastPaint=${ui.lastpaintick}`);
  rig.tick(1);
}
