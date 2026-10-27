import { writeFileSync } from "node:fs";
import { bootUiRig, encodePng } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
const t = performance.now();
rig.until((s) => { const ui = rig.ui(); return ui !== null && ui.mode === "command"; }, 1500);
console.log("ticks", rig.state().time.tick, "in", Math.round(performance.now() - t), "ms; diagnostics", JSON.stringify(rig.diagnostics.slice(0, 8)));
rig.tick(8); const f = rig.frame();
writeFileSync("/tmp/probe/frame-command.png", encodePng(f.w, f.h, f.rgba));
console.log("charges", JSON.stringify(rig.charges()), "requested", rig.requested.length);
