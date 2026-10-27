import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
import { fnv1a64 } from "/Users/jensen/.omp/wt/514/packages/core/src/index.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
for (let i = 0; i < 16; i += 1) {
  const ui = rig.ui() as any;
  console.log(`tick=${(rig.state() as any).time.tick} probe=${ui.sigprobe} anims=${Object.keys(ui.anim ?? {}).length} meta=${JSON.stringify((ui.anim ?? {})["hero_rest.anm"])} hash=${fnv1a64(rig.frame().rgba).slice(0, 6)}`);
  rig.tick(1);
}
