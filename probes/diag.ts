import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
rig.until(() => rig.ui()?.mode === "command", 400);
console.log("diag", JSON.stringify(rig.diagnostics.slice(0, 4)));
