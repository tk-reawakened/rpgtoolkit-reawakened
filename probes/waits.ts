import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
const rig = bootUiRig();
rig.until(() => rig.ui()?.mode === "command", 400);
for (let i = 0; i < 6; i += 1) {
  const s = rig.state() as any;
  const threads = s.vm.threads.map((t: any) => t.wait ? `${t.id}:${t.wait.kind}${t.wait.reqId !== undefined ? ":" + t.wait.reqId : ""}` : `${t.id}:${t.status}`);
  console.log(`tick=${s.time.tick} mode=${(rig.ui() as any).mode} threads=[${threads.join(" ")}]`);
  rig.tick(1);
}
