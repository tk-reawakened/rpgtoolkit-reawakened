import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";
let ops = 0; let bucket = -1; const hot = new Map<string, number>();
const buckets: { n: number; ops: number; top: string[] }[] = [];
const rig = bootUiRig({
  stanceDelayTicks: 1,
  observers: {
    postStep: (op: any) => {
      const u = rig.ui() as any;
      const n = u?.refresn ?? 0; if (n === 0 && bucket === -1) { bucket = 0; }
      if (n !== bucket) {
        if (bucket >= 0) buckets.push({ n: bucket, ops, top: [...hot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`) });
        bucket = n; ops = 0; hot.clear();
      }
      ops += 1;
      const line = String(op.pos?.line ?? 0);
      hot.set(line, (hot.get(line) ?? 0) + 1);
    },
  },
} as never);
rig.until(() => rig.ui()?.mode === "command", 400);
buckets.length = 0; bucket = -1; ops = 0; hot.clear();
rig.tick(8);
for (const b of buckets.slice(-5)) console.log("after refresh#", b.n, "ops=", b.ops, "hot=", b.top.join(" "));
