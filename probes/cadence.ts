import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
import { fnv1a64 } from "/Users/jensen/.omp/wt/514/packages/core/src/index.ts";
const rig = bootUiRig({ stanceDelayTicks: 1 });
rig.until(() => rig.ui()?.mode === "command", 400);
const h = () => fnv1a64(rig.frame().rgba);
const seen: string[] = [h()];
for (let i = 0; i < 6; i += 1) { rig.tick(1); seen.push(h()); }
console.log("idle hashes", seen.map((x) => x.slice(0, 6)).join(" "));
console.log("changes", seen.filter((x, i) => i > 0 && x !== seen[i - 1]).length, "of 6 ticks");
