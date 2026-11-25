import { deepEqual, equal, ok } from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { platformError, type FileSystemService } from "@tk-reawakened/platform-services";
import { createCheckpointGroups, type CheckpointEnvironment } from "../src/index.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
function fixture() {
  const host = createMemoryPlatformServices({ files: { "Misc/a.anm": bytes("original") } });
  let serial = 0;
  let consent = true;
  let guard: string | null = null;
  const env: CheckpointEnvironment = {
    fs: host.fs, projectId: "memory-project", hash: async (value) => createHash("sha256").update(value).digest("hex"),
    newId: () => `group-${++serial}`, time: () => "2026-11-15T00:00:00.000Z",
    guard: async () => guard, consent: async () => consent,
  };
  return { host, env, setConsent: (value: boolean) => { consent = value; }, setGuard: (value: string | null) => { guard = value; } };
}
const targets = [{ path: "Bitmap/frame.tbm", bytes: bytes("tile") }, { path: "Misc/a.anm", bytes: bytes("animation") }];

test("durable groups survive restart, restore originals and absent files, and restore the restore", async () => {
  const { host, env } = fixture();
  const result = await createCheckpointGroups(env).commit(targets); ok(result.ok);
  deepEqual(result.value.files.map((file) => file.status), ["written", "written"]);
  const restarted = createCheckpointGroups(env);
  const listed = await restarted.list(); ok(listed.ok); equal(listed.value.length, 1);
  const restore = await restarted.restore(result.value.id); ok(restore.ok);
  deepEqual(host.bytesOf("Misc/a.anm"), bytes("original")); equal(host.bytesOf("Bitmap/frame.tbm"), undefined);
  equal(restore.value.reason, "before-restore");
  const reverse = await createCheckpointGroups(env).restore(restore.value.id); ok(reverse.ok);
  deepEqual(host.bytesOf("Misc/a.anm"), bytes("animation")); deepEqual(host.bytesOf("Bitmap/frame.tbm"), bytes("tile"));
});

test("history failures stop before target writes; target failures preserve written/pending status and consented retry", async () => {
  const { host, env, setConsent } = fixture();
  host.failWrites({ code: "io-error", message: "history unavailable" });
  equal((await createCheckpointGroups(env).commit(targets)).ok, false);
  equal(host.bytesOf("Bitmap/frame.tbm"), undefined); deepEqual(host.bytesOf("Misc/a.anm"), bytes("original"));
  host.failWrites(null);
  let fail = true;
  const fs: FileSystemService = { ...host.fs, async writeProject(project, path, data) {
    if (path === "Misc/a.anm" && fail) { host.seed(path, data); return platformError("io-error", "write reported failure after partial output"); }
    return host.fs.writeProject(project, path, data);
  } };
  const groups = createCheckpointGroups({ ...env, fs });
  const committed = await groups.commit([...targets, { path: "Misc/last.anm", bytes: bytes("last") }]); ok(committed.ok);
  deepEqual(committed.value.files.map((file) => file.status), ["written", "failed", "pending"]);
  equal(host.bytesOf("Misc/last.anm"), undefined);
  fail = false; setConsent(false);
  const declined = await createCheckpointGroups({ ...env, fs }).retry(committed.value.id); ok(declined.ok); equal(declined.value.files[1]!.status, "failed");
  setConsent(true);
  const retried = await groups.retry(committed.value.id); ok(retried.ok);
  deepEqual(retried.value.files.map((file) => file.status), ["written", "written", "written"]);
});

test("torn progress after durable target write cannot corrupt capture or prevent restart recovery", async () => {
  const { host, env } = fixture();
  let targetWritten = false;
  const fs: FileSystemService = { ...host.fs, async writeProject(project, path, data) {
    if (path.includes("/progress/") && targetWritten) { host.seed(path, bytes("{torn")); return platformError("io-error", "progress failed"); }
    const result = await host.fs.writeProject(project, path, data);
    if (path === targets[0]!.path) targetWritten = true;
    return result;
  } };
  const result = await createCheckpointGroups({ ...env, fs }).commit(targets); ok(result.ok);
  equal(result.value.files[0]!.status, "failed");
  deepEqual(host.bytesOf("Bitmap/frame.tbm"), bytes("tile"));
  const restarted = createCheckpointGroups(env);
  const listed = await restarted.list(); ok(listed.ok); ok(!("error" in listed.value[0]!)); equal(listed.value[0]!.files[0]!.status, "writing");
  const restored = await restarted.restore(result.value.id); ok(restored.ok);
  equal(host.bytesOf("Bitmap/frame.tbm"), undefined); deepEqual(host.bytesOf("Misc/a.anm"), bytes("original"));
});

test("corrupt or missing recovery bytes refuse all destructive restore writes", async () => {
  for (const missing of [false, true]) {
    const { host, env } = fixture(); const groups = createCheckpointGroups(env);
    const result = await groups.commit(targets); ok(result.ok);
    const digest = result.value.files[1]!.before!;
    const path = `.tkr-history/contents/${digest}`;
    if (missing) await host.fs.delete(path); else host.seed(path, bytes("corrupt"));
    equal((await groups.restore(result.value.id)).ok, false);
    deepEqual(host.bytesOf("Bitmap/frame.tbm"), bytes("tile")); deepEqual(host.bytesOf("Misc/a.anm"), bytes("animation"));
  }
});

test("declined collisions, aliases, directories, invalid paths and open-document refusals change no targets", async () => {
  const { host, env, setConsent, setGuard } = fixture(); const groups = createCheckpointGroups(env);
  setConsent(false); equal((await groups.commit(targets)).ok, false); equal(host.bytesOf("Bitmap/frame.tbm"), undefined);
  setConsent(true);
  for (const paths of [["Misc/A.anm", "Misc/a.anm"], ["../escape"], [".tkr-history/x"], ["Misc/a.anm/nested"]]) {
    equal((await groups.commit(paths.map((path) => ({ path, bytes: bytes("bad") })))).ok, false);
  }
  const ambiguous = createCheckpointGroups({ ...env, fs: { ...host.fs, listProject: async (project, path) => path === "Misc" ? { ok: true, value: [{ name: "a.anm", kind: "file" }, { name: "A.anm", kind: "file" }] } : host.fs.listProject(project, path) } });
  equal((await ambiguous.commit(targets)).ok, false);
  setGuard("Close the unsaved document first"); equal((await groups.commit(targets)).ok, false);
  deepEqual(host.bytesOf("Misc/a.anm"), bytes("original"));
});

test("external changes during interruption need fresh consent and a retired project cannot delete", async () => {
  const { host, env, setConsent } = fixture();
  const committed = await createCheckpointGroups(env).commit(targets); ok(committed.ok);
  let active = true;
  const fs: FileSystemService = { ...host.fs, deleteProject: (project, path) => active ? host.fs.deleteProject(project, path) : Promise.resolve(platformError("unavailable", "retired project")) };
  active = false;
  const restored = await createCheckpointGroups({ ...env, fs }).restore(committed.value.id); ok(restored.ok);
  equal(restored.value.files[0]!.status, "failed"); deepEqual(host.bytesOf("Bitmap/frame.tbm"), bytes("tile"));
  host.seed("Bitmap/frame.tbm", bytes("external")); setConsent(false); active = true;
  const retry = await createCheckpointGroups({ ...env, fs }).retry(restored.value.id); ok(retry.ok);
  equal(retry.value.files[0]!.status, "failed"); deepEqual(host.bytesOf("Bitmap/frame.tbm"), bytes("external"));
});

test("ignore changes are explicit and recoverable while group deletion only removes the selected manifest", async () => {
  const { host, env } = fixture();
  host.seed(".gitignore", bytes("existing/\n"));
  const groups = createCheckpointGroups(env);
  equal(host.bytesOf(".gitignore")?.length, bytes("existing/\n").length);
  ok((await groups.ignoreHistory()).ok);
  deepEqual(host.bytesOf(".gitignore"), bytes("existing/\n/.tkr-history/\n"));
  const list = await groups.list(); ok(list.ok); equal(list.value.length, 1);
  const restored = await groups.restore(list.value[0]!.id); ok(restored.ok);
  deepEqual(host.bytesOf(".gitignore"), bytes("existing/\n"));
  ok((await groups.deleteGroup(list.value[0]!.id)).ok);
  const remaining = await groups.list(); ok(remaining.ok); equal(remaining.value.length, 1); ok(!("error" in remaining.value[0]!)); equal(remaining.value[0]!.reason, "before-restore");
});

test("torn capture entries remain diagnosable and deletable without hiding valid recovery groups", async () => {
  const { host, env } = fixture(); const groups = createCheckpointGroups(env);
  const committed = await groups.commit(targets); ok(committed.ok);
  host.seed(".tkr-history/groups/torn-2.json", bytes("{torn"));
  const listed = await groups.list(); ok(listed.ok);
  equal(listed.value.length, 2);
  const invalid = listed.value.find((entry) => entry.id === "torn-2"); ok(invalid);
  ok("error" in invalid); equal(invalid.path, ".tkr-history/groups/torn-2.json");
  ok(invalid.error.length > 0); equal("files" in invalid, false); equal("time" in invalid, false); equal("reason" in invalid, false);
  equal((await groups.retry("torn-2")).ok, false); equal((await groups.restore("torn-2")).ok, false);
  const restored = await groups.restore(committed.value.id); ok(restored.ok);
  deepEqual(host.bytesOf("Misc/a.anm"), bytes("original")); equal(host.bytesOf("Bitmap/frame.tbm"), undefined);
  for (const id of ["../escape", "", "torn-2.json", "nested/id", "nested\\id"]) equal((await groups.deleteGroup(id)).ok, false);
  ok(host.bytesOf(".tkr-history/groups/torn-2.json"));
  ok((await groups.deleteGroup("torn-2")).ok); equal(host.bytesOf(".tkr-history/groups/torn-2.json"), undefined);
  const remaining = await groups.list(); ok(remaining.ok); equal(remaining.value.length, 2);
  ok(remaining.value.every((entry) => !("error" in entry)));
});

test("reviewed script capture publishes every intent or none and never replays a partial batch on restart", async () => {
  const { host, env } = fixture();
  let writes = 0;
  const fs: FileSystemService = { ...host.fs, async writeProject(project, path, data) {
    if (path.startsWith(".tkr-history/contents/") && ++writes === 2) return platformError("io-error", "interrupted before capture completed");
    return await host.fs.writeProject(project, path, data);
  } };
  const batch = [{ ...targets[0]!, expectedBefore: null }, { ...targets[1]!, expectedBefore: bytes("original") }];
  const interrupted = await createCheckpointGroups({ ...env, fs }).prepareScripts(batch, "Format");
  equal(interrupted.ok, false);
  const restarted = createCheckpointGroups(env);
  const empty = await restarted.list(); ok(empty.ok); deepEqual(empty.value, []);
  const captured = await restarted.prepareScripts(batch, "Format"); ok(captured.ok);
  const id = captured.value.id;
  const afterCrash = createCheckpointGroups(env);
  // The process died after writing the first file but before recording its receipt.
  host.seed(batch[0]!.path, batch[0]!.bytes);
  host.seed(batch[1]!.path, bytes("edited externally"));
  const first = await afterCrash.preview(id, batch[0]!.path, "after"); ok(first.ok);
  const second = await afterCrash.preview(id, batch[1]!.path, "after"); ok(second.ok);
  deepEqual(first.value?.bytes, batch[0]!.bytes);
  deepEqual(second.value?.bytes, batch[1]!.bytes);
  equal((await afterCrash.retry(id)).ok, false);
  equal((await afterCrash.apply(id)).ok, false);
  deepEqual(host.bytesOf(batch[0]!.path), batch[0]!.bytes);
  const restored = await afterCrash.restore(id); ok(restored.ok);
  deepEqual(host.bytesOf(batch[0]!.path), batch[0]!.bytes, "a matching intent without a write receipt does not prove ownership");
  deepEqual(host.bytesOf(batch[1]!.path), bytes("edited externally"), "restore does not touch an unrelated edit");
  deepEqual(restored.value.files.map((file) => file.status), ["kept-uncertain", "kept-changed"]);
  const recorded = await afterCrash.registerWritten(id, batch[0]!.path, batch[0]!.bytes); ok(recorded.ok);
  const restoredWithReceipt = await afterCrash.restore(id); ok(restoredWithReceipt.ok);
  equal(host.bytesOf(batch[0]!.path), undefined, "a restore removes a matching copy once its write was recorded");
  deepEqual(restoredWithReceipt.value.files.map((file) => file.status), ["written", "kept-changed"]);
  const forced = await afterCrash.restore(id, { only: [batch[1]!.path], deleteUncertain: [batch[1]!.path] }); ok(forced.ok);
  equal(forced.value.files[0]?.status, "kept-changed");
  deepEqual(host.bytesOf(batch[1]!.path), bytes("edited externally"));
});

test("a reviewed checkpoint never accepts receipts for another spelling or restores a renamed alias", async () => {
  const { host, env } = fixture();
  const groups = createCheckpointGroups(env);
  const path = "Misc/a.anm";
  const alias = "Misc/A.anm";
  const reviewed = bytes("reviewed");
  equal((await groups.prepareScripts([{ path: alias, bytes: reviewed }], "Format")).ok, false);
  const group = await groups.prepareScripts([{ path, bytes: reviewed }], "Format"); ok(group.ok);
  host.seed(path, reviewed);
  equal((await groups.registerWritten(group.value.id, alias, reviewed)).ok, false);
  ok((await groups.registerWritten(group.value.id, path, reviewed)).ok);
  ok((await host.fs.rename(path, alias)).ok);
  const restored = await groups.restore(group.value.id); ok(restored.ok);
  equal(restored.value.files[0]?.status, "kept-changed");
  deepEqual(restored.value.files.map(({ before, after }) => [before, after]), [[null, null]]);
  deepEqual(host.bytesOf(alias), reviewed);
});

test("Undo Restore ignores a generated copy refused by the late open-file guard", async () => {
  const { host, env } = fixture();
  const path = "Prg/generated.prg";
  const rendered = bytes("output");
  let guardCallsAfterSource = 0;
  const groups = createCheckpointGroups({ ...env, async guard(candidate, removing) {
    if (candidate === path && removing && ++guardCallsAfterSource === 3) return `${candidate} opened before removal.`;
    return null;
  } });
  const source = await groups.prepareScripts([{ path, bytes: rendered }], "Update older syntax"); ok(source.ok);
  host.seed(path, rendered);
  ok((await groups.registerWritten(source.value.id, path, rendered)).ok);
  const restored = await groups.restore(source.value.id); ok(restored.ok);
  equal(guardCallsAfterSource, 3);
  equal(restored.value.files[0]?.status, "failed");
  ok(restored.value.files[0]?.before !== null, "the failed row retains the intended transfer for diagnosis");
  host.seed(path, bytes("new work after refusal"));
  const reverse = await createCheckpointGroups(env).restore(restored.value.id); ok(reverse.ok);
  equal(reverse.value.files[0]?.status, "kept-changed");
  deepEqual(host.bytesOf(path), bytes("new work after refusal"));
});

test("Undo Restore does not reverse a pending checkpoint reopened before the first dispatch", async () => {
  const { host, env } = fixture();
  const path = "Prg/generated.prg";
  const rendered = bytes("output");
  let reached!: () => void;
  let abandon!: () => void;
  const pending = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { abandon = resolve; });
  let calls = 0;
  const running = createCheckpointGroups({ ...env, async guard(candidate, removing) {
    if (candidate === path && removing && ++calls === 2) {
      reached();
      await gate;
      return "Original restore interrupted before dispatch.";
    }
    return null;
  } });
  const source = await running.prepareScripts([{ path, bytes: rendered }], "Update older syntax"); ok(source.ok);
  host.seed(path, rendered);
  ok((await running.registerWritten(source.value.id, path, rendered)).ok);
  const original = running.restore(source.value.id);
  await pending;
  try {
    // Use fresh adapter identity and reload the on-disk manifest, with no in-process operation state.
    const reopened = createCheckpointGroups({ ...env, fs: { ...env.fs } });
    const listed = await reopened.list(); ok(listed.ok);
    const captured = listed.value.find((entry) => "files" in entry && entry.reason === "before-restore");
    ok(captured !== undefined && "files" in captured && captured.files[0]?.status === "pending");
    host.seed(path, bytes("new work after interruption"));
    const reverse = await reopened.restore(captured.id); ok(reverse.ok);
    equal(reverse.value.files[0]?.status, "kept-changed");
    deepEqual(host.bytesOf(path), bytes("new work after interruption"));
  } finally {
    abandon();
    await original;
  }
});
