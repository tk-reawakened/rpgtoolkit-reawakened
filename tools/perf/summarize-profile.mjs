// summarize-profile: self and inclusive time per function from a V8 `.cpuprofile`.
//
//   node tools/perf/summarize-profile.mjs <file.cpuprofile> [top=30]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The top `top` functions by self time and by inclusive time, as printable text. */
export function summarizeProfile(profile, top = 30) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const sampled = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const id = profile.samples[index];
    sampled.set(id, (sampled.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0));
  }
  const total = [...sampled.values()].reduce((sum, value) => sum + value, 0);
  const label = (node) => `${node.callFrame.functionName || "(anonymous)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber + 1}`;
  const self = new Map();
  const inclusive = new Map();
  for (const [id, time] of sampled) {
    const key = label(byId.get(id));
    self.set(key, (self.get(key) ?? 0) + time);
    const seen = new Set();
    for (let current = id; current !== undefined; current = parent.get(current)) {
      const name = label(byId.get(current));
      if (seen.has(name)) continue;
      seen.add(name);
      inclusive.set(name, (inclusive.get(name) ?? 0) + time);
    }
  }
  const table = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([key, time]) => `${(100 * time / total).toFixed(1).padStart(5)}%  ${(time / 1000).toFixed(0).padStart(6)}ms  ${key}`).join("\n");
  return `sampled ${(total / 1000).toFixed(0)}ms\n--- self ---\n${table(self)}\n--- inclusive ---\n${table(inclusive)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, top = "30"] = process.argv.slice(2);
  if (file === undefined) throw new Error("usage: node tools/perf/summarize-profile.mjs <file.cpuprofile> [top]");
  console.log(summarizeProfile(JSON.parse(readFileSync(file, "utf8")), Number(top)));
}
