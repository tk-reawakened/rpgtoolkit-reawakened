import { writeFileSync } from "node:fs";
import { bootUiRig, encodePng } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
rig.until(() => rig.ui()?.mode === "command", 2000);
rig.tick(6);
const f = rig.frame();
writeFileSync("/tmp/probe/command-new.png", encodePng(f.w, f.h, f.rgba));
console.log("wrote /tmp/probe/command-new.png");
