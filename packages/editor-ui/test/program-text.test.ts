// docs/spec/engine/rpgcode-tooling.md#tool-10-text: queued revisions preserve exact text without retaining deleted buffers.
import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { applyTrackedChanges, trackedText, type TextTree, type TrackedText } from "../src/program-text.ts";

function reachable(revisions: readonly TrackedText[]) {
  const nodes = new Set<Exclude<TextTree, null>>();
  const blocks = new Map<number, string>();
  function visit(root: TextTree): void {
    if (root === null || nodes.has(root)) return;
    nodes.add(root);
    if (root.kind === "leaf") blocks.set(root.piece.id, root.piece.source);
    else { visit(root.left); visit(root.right); }
  }
  for (const revision of revisions) visit(revision.root);
  return { nodes: nodes.size, bytes: [...blocks.values()].reduce((sum, block) => sum + block.length * 2, 0) };
}

test("#2770 repeated large paste/delete releases payloads from live and saved revisions", () => {
  let id = 0;
  const allocate = () => ++id;
  const base = trackedText("x", allocate);
  let live = base;
  const payload = "p".repeat(256 * 1024);
  for (let round = 0; round < 32; round += 1) {
    live = applyTrackedChanges(live, [{ from: 1, to: 1, text: payload }], allocate);
    live = applyTrackedChanges(live, [{ from: 1, to: 1 + payload.length, text: "" }], allocate);
  }
  equal(live.text, "x");
  equal(reachable([base, live]).bytes, 2, "deleted 8 MiB of input is unreachable, including from the saved root");
});

test("#2771 fragmented reconstruction visits bounded payload blocks directly", () => {
  let id = 0;
  const allocate = () => ++id;
  let live = trackedText("x".repeat(1024 * 1024), allocate);
  for (let at = 1024 * 1024 - 512; at > 0; at -= 1024) {
    live = applyTrackedChanges(live, [{ from: at, to: at + 1, text: "" }], allocate);
  }
  equal(live.text, "x".repeat(1024 * 1023));
  ok(live.pieces.length <= 2048);
  for (const piece of live.pieces) ok(piece.source.length <= 1024);
});

test("#2772 queued save roots share fragmented revisions and allocate logarithmic paths", () => {
  let id = 0;
  const allocate = () => ++id;
  let live = trackedText("x".repeat(1024 * 512), allocate);
  for (let at = 1024 * 512 - 512; at > 0; at -= 1024) live = applyTrackedChanges(live, [{ from: at, to: at + 1, text: "" }], allocate);
  const initial = reachable([live]);
  const saved = [live];
  for (let index = 0; index < 128; index += 1) {
    const end = live.root!.length;
    live = applyTrackedChanges(live, [{ from: end, to: end, text: "a" }], allocate);
    saved.push(live);
  }
  const total = reachable(saved);
  ok(total.nodes - initial.nodes <= 128 * 24, `${total.nodes - initial.nodes} new nodes for 128 saved revisions`);
  equal(total.bytes - initial.bytes, 256);
  for (let index = 0; index < saved.length; index += 1) equal(saved[index]!.text.slice(-index || undefined), index === 0 ? "x".repeat(1024 * 511 + 512) : "a".repeat(index));
});

test("persistent text edits retain earlier revisions and balance under varied replacements", () => {
  let id = 0;
  let seed = 5;
  const allocate = () => ++id;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  let text = "initial";
  let live = trackedText(text, allocate);
  const saved: Array<[TrackedText, string]> = [];
  for (let step = 0; step < 500; step += 1) {
    const from = random(text.length + 1);
    const to = from + random(text.length - from + 1);
    const insert = String(step).repeat(random(5));
    saved.push([live, text]);
    text = text.slice(0, from) + insert + text.slice(to);
    live = applyTrackedChanges(live, [{ from, to, text: insert }], allocate);
    equal(live.text, text);
  }
  for (const [revision, expected] of saved) equal(revision.text, expected);
});
