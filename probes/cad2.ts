import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
import { fnv1a64 } from "/Users/jensen/.omp/wt/514/packages/core/src/index.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
for (let i = 0; i < 6; i += 1) {
  const ui = rig.ui() as any;
  const s = rig.state() as any;
  const threads = s.vm.threads.map((t: any) => t.wait ? `${t.id}:${t.wait.kind}` : `${t.id}:${t.status}`).join(" ");
  console.log(`tick=${s.time.tick} threads=[${threads}] tickfield=${ui.lastpaintick} framesig=? hash=${fnv1a64(rig.frame().rgba).slice(0, 6)}`);
  rig.tick(1);
}
