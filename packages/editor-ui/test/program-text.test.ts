// docs/spec/engine/rpgcode-tooling.md#tool-10-text: queued revisions preserve exact text without retaining deleted buffers.
import { test } from "node:test";
import { equal, ok } from "node:assert/strict";
import { applyTrackedChanges, changePendingText, mergePendingText, trackedTextChanges, trackedText, type TextTree, type TrackedText, type PendingText } from "../src/program-text.ts";

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
  const pending: PendingText = { base, current: base, deleted: null };
  const payload = "p".repeat(256 * 1024);
  for (let round = 0; round < 32; round += 1) {
    changePendingText(pending, [{ from: 1, to: 1, text: payload }], allocate);
    changePendingText(pending, [{ from: 1, to: 1 + payload.length, text: "" }], allocate);
  }
  equal(pending.current.text, "x");
  equal(pending.deleted, null, "transient paste/deletes leave no tombstones");
  equal(reachable([pending.base, pending.current]).bytes, 2, "deleted 8 MiB of input is unreachable, including from the saved root");
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
  let live = trackedText("x".repeat(1024 * 128), allocate);
  for (let at = 1024 * 128 - 512; at > 0; at -= 1024) live = applyTrackedChanges(live, [{ from: at, to: at + 1, text: "" }], allocate);
  const initial = reachable([live]);
  const saved = [live];
  for (let index = 0; index < 128; index += 1) {
    const end = live.root!.length;
    const edited = applyTrackedChanges(live, [{ from: end, to: end, text: "a" }], allocate);
    live = mergePendingText(live, { base: live, current: edited, deleted: null });
    saved.push(live);
  }
  const total = reachable(saved);
  ok(total.nodes - initial.nodes <= 128 * 24, `${total.nodes - initial.nodes} new nodes for 128 saved revisions`);
  equal(total.bytes - initial.bytes, 256);
  for (let index = 0; index < saved.length; index += 1) equal(saved[index]!.text.slice(-index || undefined), index === 0 ? "x".repeat(1024 * 128 - 128) : "a".repeat(index));
});

test("persistent text edits retain earlier revisions and balance under varied replacements", () => {
  let id = 0;
  let seed = 5;
  const allocate = () => ++id;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  let text = "initial";
  let live = trackedText(text, allocate);
  const saved: Array<[TrackedText, string]> = [];
  const balanced = (root: TextTree): void => {
    if (root === null) return;
    if (root.kind === "leaf") { equal(root.height, 1); equal(root.length, root.piece.to - root.piece.from); return; }
    ok(Math.abs(root.left.height - root.right.height) <= 1);
    equal(root.height, 1 + Math.max(root.left.height, root.right.height));
    equal(root.length, root.left.length + root.right.length);
    balanced(root.left); balanced(root.right);
  };
  for (let step = 0; step < 500; step += 1) {
    const from = random(text.length + 1);
    const to = from + random(text.length - from + 1);
    const insert = String(step).repeat(random(5));
    saved.push([live, text]);
    text = text.slice(0, from) + insert + text.slice(to);
    live = applyTrackedChanges(live, [{ from, to, text: insert }], allocate);
    equal(live.text, text);
    balanced(live.root);
  }
  for (const [revision, expected] of saved) equal(revision.text, expected);
});


test("#2771 flushing separated edits materializes each revision only once", () => {
  let id = 0;
  const allocate = () => ++id;
  const before = trackedText("x".repeat(32 * 1024), allocate);
  let after = before;
  for (let index = 0; index < 32; index += 1) {
    const from = index * 1024 + 512;
    after = applyTrackedChanges(after, [{ from, to: from + 1, text: "y" }], allocate);
  }
  let reads = 0;
  const observed = (value: TrackedText): TrackedText => ({
    root: value.root,
    get pieces() { return value.pieces; },
    get text() { reads += 1; return value.text; },
  });
  const changes = trackedTextChanges(observed(before), observed(after));
  equal(reads, 2);
  equal(changes.length, 32);
  let applied = before.text;
  for (const change of changes) applied = applied.slice(0, change.from) + change.text + applied.slice(change.to);
  equal(applied, after.text);
});


test("text revisions preserve UTF-16 code units across block boundaries", () => {
  let id = 0;
  const allocate = () => ++id;
  const before = trackedText("x".repeat(1023) + "😀e\u0301" + "y".repeat(1024), allocate);
  const after = applyTrackedChanges(before, [{ from: 1024, to: 1028, text: "\udc00a\u0301" }], allocate);
  const merged = mergePendingText(before, { base: before, current: after, deleted: null });
  equal(merged.text, after.text);
  let text = before.text;
  for (const edit of trackedTextChanges(before, merged)) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  equal(text, "x".repeat(1023) + "\ud83d\udc00a\u0301" + "y".repeat(1023));
});

test("#2769 replacements stay before restored suffixes even with a surviving next anchor", () => {
  let id = 0;
  const allocate = () => ++id;
  const base = trackedText("qxT", allocate);
  const restored = applyTrackedChanges(base, [{ from: 2, to: 2, text: "a" }], allocate);
  const pending: PendingText = { base, current: base, deleted: null };
  changePendingText(pending, [{ from: 1, to: 2, text: "z" }], allocate);
  equal(mergePendingText(restored, pending).text, "qzaT");
});

test("#2772 merged save revisions share unchanged interior islands", () => {
  let id = 0;
  const allocate = () => ++id;
  let live = trackedText("x".repeat(512 * 1024), allocate);
  const saved = [live];
  const initial = reachable(saved);
  for (let index = 0; index < 32; index += 1) {
    const edited = applyTrackedChanges(live, [{ from: live.root!.length, to: live.root!.length, text: "b" }, { from: 0, to: 0, text: "a" }], allocate);
    live = mergePendingText(live, { base: live, current: edited, deleted: null });
    saved.push(live);
  }
  ok(reachable(saved).nodes - initial.nodes <= 32 * 48);
  equal(live.text, "a".repeat(32) + "x".repeat(512 * 1024) + "b".repeat(32));
});

test("#2768 net-zero replacement retains position across a history-restored suffix", () => {
  let id = 0;
  const allocate = () => ++id;
  const base = trackedText("qxT", allocate);
  const restored = applyTrackedChanges(base, [{ from: 2, to: 2, text: "a" }], allocate);
  const pending: PendingText = { base, current: base, deleted: null };
  changePendingText(pending, [{ from: 1, to: 2, text: "y" }, { from: 1, to: 2, text: "x" }], allocate);
  equal(mergePendingText(restored, pending).text, "qxaT");
});
