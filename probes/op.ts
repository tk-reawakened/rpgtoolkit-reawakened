import { bootUiRig } from "/Users/jensen/.omp/wt/514/packages/core/test/battle-ui-rig.ts";

const counts = new Map<string, number>();
const lines = new Map<string, number>();
const rig = bootUiRig({
  observers: {
    postStep: (op: any) => {
      counts.set(op.op, (counts.get(op.op) ?? 0) + 1);
      const pos = op.pos ?? {};
      const key = `${String(pos.file ?? "?")}:${String(pos.line ?? 0)}`;
      lines.set(key, (lines.get(key) ?? 0) + 1);
    },
  },
} as never);
rig.until(() => rig.ui()?.mode === "command", 400);
counts.clear(); lines.clear();
const t0 = (rig.state() as any).time.tick;
rig.tick(3);
console.log("ticks", t0, "->", (rig.state() as any).time.tick, "refreshes", rig.ui()!.refreshes);
console.log("ops", JSON.stringify([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)));
console.log("hot lines", JSON.stringify([...lines.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)));
