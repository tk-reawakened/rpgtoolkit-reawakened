import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
for (let i = 0; i < 10; i += 1) {
  const s = rig.state() as any;
  const ui = rig.ui()!;
  const f = rig.frame();
  let hash = 0;
  for (let k = 0; k < f.rgba.length; k += 97) hash = (hash * 31 + f.rgba[k]!) | 0;
  console.log(`tick=${s.time.tick} draws=${ui.draws} paints=${ui.paints} refr=${ui.refreshes} animKeys=${Object.keys(ui.anim ?? {}).length} meta=${JSON.stringify((ui.anim ?? {})["hero_rest.anm"])} hash=${hash}`);
  rig.tick(1);
}
