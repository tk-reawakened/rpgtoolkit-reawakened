import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
const snap = () => { const u = rig.ui() as any; return { refr: u.refreshes ?? 0, box: u.boxcalls ?? 0, bar: u.barcalls ?? 0, words: u.wordscalls ?? 0, charge: u.chargecalls ?? 0, pass: u.passcalls ?? 0, draws: u.draws ?? 0 }; };
let last = snap();
for (let i = 0; i < 8; i += 1) {
  rig.tick(1);
  const now = snap();
  console.log(`tick=${(rig.state() as any).time.tick} d_refr=${now.refr - last.refr} d_box=${now.box - last.box} d_bar=${now.bar - last.bar} d_words=${now.words - last.words} d_charge=${now.charge - last.charge} d_pass=${now.pass - last.pass} d_draws=${now.draws - last.draws}`);
  last = now;
}
