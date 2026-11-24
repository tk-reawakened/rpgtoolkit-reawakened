import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryPlatformServices, type MemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import {
  createScriptReview,
  MIGRATED_FOLDER,
  planScriptWorkflow,
  readScriptTransformAnswer,
  scriptProviderOver,
  type OpenScriptProgram,
  type ScriptTransformAnswer,
  type ScriptTransformProvider,
  type ScriptTransformQuestion,
  type ScriptWorkflowEnvironment,
  type WizardHistory,
} from "../src/index.ts";

/**
 * Story 13.16 (docs/spec/engine/rpgcode-tooling.md#tool-11-review): the plan, the per-file opt-out, cancel, the apply
 * and the failure retention, over a scripted language server. The real server is exercised against the same flow in
 * `tools/editor-vscode-test/test/script-workflow-hosts.test.ts`.
 */

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const text = (value: Uint8Array | undefined): string | undefined => (value === undefined ? undefined : String.fromCharCode(...value));

function answer(question: ScriptTransformQuestion, fields: Partial<ScriptTransformAnswer> = {}): ScriptTransformAnswer {
  return { uri: `file:///${question.path}`, transform: question.transform, status: "unchanged", text: question.text, dialect: "tk3", established: true, target: "in-place", steps: [], reviews: [], unsupported: [], ...fields };
}

/** A language server that upper-cases `MESSY` text, refuses `refuse` and fails `boom`. */
function provider(calls: ScriptTransformQuestion[] = []): ScriptTransformProvider {
  return {
    async transform(question) {
      calls.push(question);
      if (question.path.endsWith("boom.prg")) throw new Error("the server stopped");
      if (question.path.endsWith("refuse.prg")) {
        return answer(question, { status: "refused", dialect: "tk2", target: "copy", reason: { code: "unsupported-fragments", message: "has fragments" }, unsupported: [{ line: 2, code: "dialogue-quote", message: "a quote" }] });
      }
      if (question.text.includes("MESSY")) {
        return answer(question, { status: "changed", text: question.text.replaceAll("MESSY", "tidy"), steps: [{ id: "format", title: "Format", applied: true }] });
      }
      if (question.text.includes("OLD")) {
        return answer(question, { status: "changed", text: question.text.replaceAll("OLD", "new"), dialect: "tk2", target: "copy", reviews: [{ line: 1, index: "key", message: "check" }] });
      }
      return answer(question);
    },
  };
}

function project(files: Record<string, string> = {}) {
  const host = createMemoryPlatformServices({
    files: {
      "Prg/a.prg": bytes("MESSY\r\nline two\r\n"),
      "Prg/b.prg": bytes("MESSY b\n"),
      "Prg/clean.prg": bytes("clean\n"),
      "Prg/refuse.prg": bytes("one\ntwo \"q\"\n"),
      "Prg/boom.prg": bytes("boom\n"),
      "Prg/old.prg": bytes("OLD\n"),
      "Prg/compiled.prg": Uint8Array.from([0, 1, 2]),
      "Prg/sub/deep.rnc": bytes("MESSY deep\n"),
      "Boards/x.brd": bytes("MESSY not a program"),
      ".tkr-history/a.prg": bytes("MESSY history"),
      ".tkr-migrated/3.1/Prg/old.prg": bytes("MESSY previous copy"),
      ...Object.fromEntries(Object.entries(files).map(([path, value]) => [path, bytes(value)])),
    },
  });
  return host;
}

function env(host: MemoryPlatformServices, extra: Partial<ScriptWorkflowEnvironment> = {}): ScriptWorkflowEnvironment & { groups: { name: string; planned: readonly string[]; written: string[] }[]; intents: { readonly path: string; readonly bytes: Uint8Array }[] } {
  const groups: { name: string; planned: readonly string[]; written: string[] }[] = [];
  const intents: { readonly path: string; readonly bytes: Uint8Array }[] = [];
  const history: WizardHistory = {
    async begin() { throw new Error("Script reviews must not use a wizard's path-only checkpoint."); },
    async prepareScripts(name, targets) {
      groups.push({ name, planned: targets.map((target) => target.path), written: [] });
      for (const target of targets) if (target.bytes !== null) intents.push({ path: target.path, bytes: target.bytes.slice() });
      return { ok: true, groupId: `g${groups.length}` };
    },
    async written(groupId, path) {
      groups[Number(groupId.slice(1)) - 1]!.written.push(path);
      return { ok: true };
    },
  };
  return { fs: host.fs, provider: provider(), history, openPrograms: () => [], groups, intents, ...extra };
}

const states = (entries: readonly { path: string; state: string }[]): Record<string, string> => Object.fromEntries(entries.map((entry) => [entry.path, entry.state]));

test("a project plan lists every program once with its state, and writes nothing while planning", async () => {
  const host = project();
  const calls: ScriptTransformQuestion[] = [];
  const environment = env(host, { provider: provider(calls) });
  const plan = await planScriptWorkflow(environment, "format", { kind: "project" });
  equal(plan.unavailable, null);
  deepEqual(states(plan.entries), {
    "Prg/a.prg": "ready",
    "Prg/b.prg": "ready",
    "Prg/boom.prg": "failed",
    "Prg/clean.prg": "unchanged",
    "Prg/compiled.prg": "skipped",
    "Prg/old.prg": "ready",
    "Prg/refuse.prg": "refused",
    "Prg/sub/deep.rnc": "ready",
  });
  equal(calls.length, 7, "the compiled program is never sent to the server; the history, migrated and board files are not programs");
  equal(calls.find((call) => call.path === "Prg/a.prg")?.text, "MESSY\nline two\n", "the server sees LF text");
  equal(text(host.bytesOf("Prg/a.prg")), "MESSY\r\nline two\r\n", "planning wrote nothing");
  equal(host.editedEvents.length, 0);
  const a = plan.entries.find((entry) => entry.path === "Prg/a.prg")!;
  equal(a.included, true, "a ready file starts ticked");
  deepEqual(a.diff?.filter((line) => line.kind !== "same").map((line) => `${line.kind}:${line.text}`), ["removed:MESSY", "added:tidy"]);
  const refused = plan.entries.find((entry) => entry.path === "Prg/refuse.prg")!;
  equal(refused.included, false);
  equal(refused.reason?.code, "unsupported-fragments");
  deepEqual(refused.unsupported.map((fragment) => fragment.line), [2]);
  const failed = plan.entries.find((entry) => entry.path === "Prg/boom.prg")!;
  match(failed.message ?? "", /the server stopped/);
  const old = plan.entries.find((entry) => entry.path === "Prg/old.prg")!;
  equal(old.destination, `${MIGRATED_FOLDER}/Prg/old.prg`);
  equal(old.target, "copy");
  deepEqual(old.reviews.map((review) => review.index), ["key"]);
});

test("a program open in an editor is planned from its unsaved text, and a host without a language server plans nothing", async () => {
  const host = project();
  const open: OpenScriptProgram = { path: "Prg/clean.prg", text: () => "MESSY unsaved\n", replace: async () => ({ ok: true }) };
  const plan = await planScriptWorkflow(env(host, { openPrograms: () => [open] }), "format", { kind: "program", path: "Prg/clean.prg" });
  equal(plan.entries.length, 1);
  equal(plan.entries[0]!.state, "ready");
  equal(plan.entries[0]!.open, true);
  equal(plan.entries[0]!.original, "MESSY unsaved\n");
  const none = await planScriptWorkflow(env(host, { provider: null }), "format", { kind: "project" });
  deepEqual(none.entries, []);
  match(none.unavailable ?? "", /no language server/);
  const cancelled = await planScriptWorkflow(env(host), "format", { kind: "project" }, { cancelled: () => true });
  match(cancelled.unavailable ?? "", /Cancelled\. Nothing was changed/);
});

test("the per-file opt-out: only ticked ready files are written, and the rest are reported as left out", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  equal(review.getSnapshot().selected, 4);
  review.setIncluded("Prg/b.prg", false);
  review.setIncluded("Prg/clean.prg", true);
  review.setIncluded("Prg/refuse.prg", true);
  equal(review.getSnapshot().entries.find((entry) => entry.path === "Prg/clean.prg")!.included, false, "an unchanged file cannot be ticked");
  equal(review.getSnapshot().entries.find((entry) => entry.path === "Prg/refuse.prg")!.included, false, "a refused file cannot be ticked");
  review.setIncluded("Prg/sub/deep.rnc", false);
  equal(review.getSnapshot().selected, 2);
  const outcome = await review.apply();
  deepEqual(outcome.applied.map((item) => `${item.via}:${item.path}`).sort(), ["copy:Prg/old.prg", "write:Prg/a.prg"]);
  deepEqual([...outcome.leftOut].sort(), ["Prg/b.prg", "Prg/sub/deep.rnc"]);
  deepEqual(outcome.refused, ["Prg/refuse.prg"]);
  deepEqual(outcome.failed, [], "a planning failure is not an apply failure");
  equal(text(host.bytesOf("Prg/a.prg")), "tidy\r\nline two\r\n", "the file's own CRLF line endings are kept");
  equal(text(host.bytesOf("Prg/b.prg")), "MESSY b\n", "an unticked file is untouched");
  equal(text(host.bytesOf("Prg/sub/deep.rnc")), "MESSY deep\n");
  equal(text(host.bytesOf("Prg/refuse.prg")), "one\ntwo \"q\"\n", "a refused file is untouched");
  equal(text(host.bytesOf("Prg/boom.prg")), "boom\n", "a file the server failed on is untouched");
  match(outcome.summary, /2 programs updated/);
  match(outcome.summary, /2 left out/);
  match(outcome.summary, /1 refused/);
  equal(review.getSnapshot().phase, "done");
});

test("a Toolkit 2.x conversion is written as a copy and never over its original", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "update", { kind: "program", path: "Prg/old.prg" }));
  const outcome = await review.apply();
  equal(text(host.bytesOf("Prg/old.prg")), "OLD\n", "the Toolkit 2.x original is untouched");
  equal(text(host.bytesOf(`${MIGRATED_FOLDER}/Prg/old.prg`)), "new\n");
  deepEqual(outcome.applied, [{ path: "Prg/old.prg", destination: `${MIGRATED_FOLDER}/Prg/old.prg`, via: "copy" }]);
  match(outcome.summary, /1 converted copy written to \.tkr-migrated\/3\.1; use the copies in a separately migrated 3\.1 project\. This project and the originals are unchanged/);
  deepEqual(environment.groups.map((group) => group.planned), [[`${MIGRATED_FOLDER}/Prg/old.prg`]], "the copy it replaces was checkpointed first");
});

test("closed files are checkpointed before they are written; an open editor gets one undoable edit and is not saved", async () => {
  const host = project();
  let editorText = "MESSY open\n";
  const edits: { label: string; text: string }[] = [];
  const open: OpenScriptProgram = { path: "Prg/b.prg", text: () => editorText, replace: async (label, next) => { edits.push({ label, text: next }); editorText = next; return { ok: true }; } };
  const environment = env(host, { openPrograms: () => [open] });
  const plan = await planScriptWorkflow(environment, "format", { kind: "project" });
  const review = createScriptReview(environment, plan);
  for (const entry of plan.entries) if (entry.path !== "Prg/a.prg" && entry.path !== "Prg/b.prg") review.setIncluded(entry.path, false);
  const outcome = await review.apply();
  deepEqual(outcome.applied.map((item) => `${item.via}:${item.path}`).sort(), ["edit:Prg/b.prg", "write:Prg/a.prg"]);
  deepEqual(edits, [{ label: "Format (reviewed)", text: "tidy open\n" }]);
  equal(text(host.bytesOf("Prg/b.prg")), "MESSY b\n", "the open file's bytes on disk are the editor's to save");
  deepEqual(environment.groups.map((group) => ({ name: group.name, planned: group.planned, written: group.written })), [{ name: "Format (reviewed)", planned: ["Prg/a.prg"], written: ["Prg/a.prg"] }]);
});

test("cancel writes nothing, records nothing and cannot be undone by a later apply", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  const before = text(host.bytesOf("Prg/a.prg"));
  equal(review.cancel(), true);
  equal(review.getSnapshot().phase, "cancelled");
  const outcome = await review.apply();
  deepEqual(outcome.applied, []);
  equal(text(host.bytesOf("Prg/a.prg")), before);
  equal(host.editedEvents.length, 0);
  deepEqual(environment.groups, [], "no checkpoint was recorded");
});

test("a file that changed since the plan is not written, and the others still are", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  await host.fs.write("Prg/a.prg", bytes("MESSY edited elsewhere\n"));
  const outcome = await review.apply();
  deepEqual(outcome.failed.map((item) => item.path), ["Prg/a.prg"]);
  match(outcome.failed[0]!.message, /changed since the review|changed while the review was open/);
  equal(text(host.bytesOf("Prg/a.prg")), "MESSY edited elsewhere\n", "the newer file is kept");
  equal(text(host.bytesOf("Prg/b.prg")), "tidy b\n");
  equal(review.getSnapshot().phase, "reviewing", "the review stays open so the failure can be seen");
});

test("a failed write is retained with its reason, and a retry applies exactly the files that failed", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  review.setIncluded("Prg/sub/deep.rnc", false);
  review.setIncluded("Prg/old.prg", false);
  host.failWrites({ kind: "io", message: "disk is read-only" } as never);
  const first = await review.apply();
  equal(first.failed.length, 2);
  match(first.failed[0]!.message, /disk is read-only/);
  equal(text(host.bytesOf("Prg/a.prg")), "MESSY\r\nline two\r\n", "a failed write leaves the file as it was");
  equal(review.getSnapshot().phase, "reviewing", "the review stays open so the failure can be read");
  deepEqual(review.getSnapshot().entries.filter((entry) => entry.path === "Prg/a.prg" || entry.path === "Prg/b.prg").map((entry) => [entry.path, entry.state, entry.included]), [["Prg/a.prg", "ready", true], ["Prg/b.prg", "ready", true]], "a failed file keeps its place and stays selected for a retry");
  host.failWrites(null);
  const second = await review.apply();
  deepEqual(second.applied.map((item) => item.path).sort(), ["Prg/a.prg", "Prg/b.prg"]);
  equal(text(host.bytesOf("Prg/a.prg")), "tidy\r\nline two\r\n");
  equal(review.getSnapshot().phase, "done");
});

test("if the recovery checkpoint cannot be recorded nothing is written to disk", async () => {
  const host = project();
  const history: WizardHistory = { begin: async () => { throw new Error("Not a wizard"); }, prepareScripts: async () => ({ ok: false, message: "history is full" }), written: async () => ({ ok: true }) };
  const environment = env(host, { history });
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  const outcome = await review.apply();
  equal(outcome.applied.length, 0);
  ok(outcome.failed.length >= 3);
  match(outcome.failed[0]!.message, /recovery checkpoint could not be recorded: history is full\. Nothing was written/);
  equal(text(host.bytesOf("Prg/a.prg")), "MESSY\r\nline two\r\n");
});

test("a result too large to compare is never applied", async () => {
  const big = `${"line\n".repeat(2500)}`;
  const host = project({ "Prg/big.prg": big });
  const environment = env(host, { provider: { transform: async (question) => answer(question, { status: "changed", text: question.text.replaceAll("line", "LINE") }) } });
  const plan = await planScriptWorkflow(environment, "format", { kind: "program", path: "Prg/big.prg" });
  equal(plan.entries[0]!.state, "failed");
  match(plan.entries[0]!.message ?? "", /too large to show a comparison/);
});

test("answers are checked at the boundary and a provider refuses an answer to another question", async () => {
  const good: ScriptTransformAnswer = { uri: "file:///a.prg", transform: "format", status: "unchanged", text: "", dialect: "tk3", established: true, target: "in-place", steps: [], reviews: [], unsupported: [] };
  deepEqual(readScriptTransformAnswer(good), good);
  for (const bad of [null, {}, { ...good, status: "maybe" }, { ...good, target: "elsewhere" }, { ...good, steps: [{ id: 1 }] }, { ...good, unsupported: [{ line: "2", code: "x", message: "y" }] }, { ...good, text: 5 }]) {
    equal(readScriptTransformAnswer(bad), null);
  }
  const wrong = scriptProviderOver(async () => ({ ...good, transform: "cleanup" }), (path) => `file:///${path}`);
  await wrong.transform({ transform: "format", path: "a.prg", text: "", indentWidth: 4 }).then(
    () => { throw new Error("should refuse"); },
    (error: Error) => match(error.message, /answered cleanup to a format question/),
  );
  const garbage = scriptProviderOver(async () => "nope", (path) => path);
  await garbage.transform({ transform: "format", path: "a.prg", text: "", indentWidth: 4 }).then(
    () => { throw new Error("should refuse"); },
    (error: Error) => match(error.message, /not a script transform result/),
  );
});

test("a destination another program changed while the review was open is never overwritten", async () => {
  const host = project();
  let releaseCheckpoint!: () => void;
  let checkpointStarted!: () => void;
  const checkpoint = new Promise<void>((resolve) => { checkpointStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
  const history: WizardHistory = {
    async begin() { throw new Error("Not a wizard"); },
    async prepareScripts() { checkpointStarted(); await gate; return { ok: true, groupId: "g1" }; },
    async written() { return { ok: true }; },
  };
  const environment = env(host, { history });
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "update", { kind: "program", path: "Prg/old.prg" }));
  const applying = review.apply();
  await checkpoint;
  // The checkpoint's question is on screen: meanwhile the copy this run would replace is rewritten by hand.
  await host.fs.write(`${MIGRATED_FOLDER}/Prg/old.prg`, bytes("written elsewhere\n"));
  releaseCheckpoint();
  const outcome = await applying;
  equal(text(host.bytesOf(`${MIGRATED_FOLDER}/Prg/old.prg`)), "written elsewhere\n", "the newer copy is kept");
  deepEqual(outcome.failed.map((item) => item.path), ["Prg/old.prg"]);
  match(outcome.failed[0]!.message, /changed since the review|changed while the review was open/);
});

test("a program opened after the plan is not written behind its editor, and a failed checkpoint stops every file", async () => {
  const host = project();
  const environment = env(host);
  const plan = await planScriptWorkflow(environment, "format", { kind: "project" });
  const openedLater: OpenScriptProgram = { path: "Prg/a.prg", text: () => "MESSY opened\n", replace: async () => ({ ok: true }) };
  const committed = createScriptReview(env(host, { openPrograms: () => [openedLater] }), plan);
  const first = await committed.apply();
  ok(first.failed.some((item) => item.path === "Prg/a.prg" && /opened in an editor during the review/.test(item.message)));
  equal(text(host.bytesOf("Prg/a.prg")), "MESSY\r\nline two\r\n", "the editor's file is untouched");

  const refusedHistory: WizardHistory = { begin: async () => { throw new Error("Not a wizard"); }, prepareScripts: async () => ({ ok: false, message: "history is full" }), written: async () => ({ ok: true }) };
  const second = project();
  const open: OpenScriptProgram = { path: "Prg/a.prg", text: () => "MESSY open\n", replace: async () => ({ ok: true }) };
  const tied = createScriptReview(env(second, { history: refusedHistory, openPrograms: () => [open] }), await planScriptWorkflow(env(second, { openPrograms: () => [open] }), "format", { kind: "project" }));
  const outcome = await tied.apply();
  deepEqual(outcome.applied, [], "an open editor is not edited when the run's checkpoint was refused");
  ok(outcome.failed.some((item) => /recovery checkpoint could not be recorded/.test(item.message)));
});

test("under a project root, the server is asked with root-relative paths and copies land inside the project", async () => {
  const host = createMemoryPlatformServices({
    files: {
      "Game/Main/example.gam": bytes("gam"),
      "Game/Prg/old.prg": bytes("OLD\n"),
      "Game/Prg/tidy.prg": bytes("tidy\n"),
      "Elsewhere/Prg/outside.prg": bytes("MESSY outside\n"),
    },
  });
  const asked: ScriptTransformQuestion[] = [];
  const environment = env(host, { provider: provider(asked), root: "Game" });
  const plan = await planScriptWorkflow(environment, "update", { kind: "project" });
  deepEqual(plan.entries.map((entry) => entry.path), ["Game/Prg/old.prg", "Game/Prg/tidy.prg"], "only the project root is scanned");
  deepEqual(asked.map((question) => question.path), ["Prg/old.prg", "Prg/tidy.prg"], "the server's inventory is relative to its own root");
  const copy = plan.entries.find((entry) => entry.path === "Game/Prg/old.prg")!;
  equal(copy.destination, "Game/.tkr-migrated/3.1/Prg/old.prg");
  const review = createScriptReview(environment, plan);
  review.setIncluded("Game/Prg/tidy.prg", false);
  const outcome = await review.apply();
  deepEqual(outcome.applied.map((item) => item.destination), ["Game/.tkr-migrated/3.1/Prg/old.prg"]);
  equal(text(host.bytesOf("Game/.tkr-migrated/3.1/Prg/old.prg")), "new\n");
  equal(text(host.bytesOf("Game/Prg/old.prg")), "OLD\n");
});

test("recovery records the entire batch's reviewed bytes before the first target write", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview({
    ...environment,
    fs: { ...host.fs, write: async (path, data) => {
      deepEqual(environment.groups.map((group) => group.planned), [["Prg/a.prg", "Prg/b.prg"]]);
      deepEqual(environment.intents.map((item) => [item.path, text(item.bytes)]), [["Prg/a.prg", "tidy\r\nline two\r\n"], ["Prg/b.prg", "tidy b\n"]]);
      return await host.fs.write(path, data);
    } },
  }, await planScriptWorkflow(environment, "format", { kind: "project" }));
  review.setIncluded("Prg/old.prg", false);
  review.setIncluded("Prg/sub/deep.rnc", false);
  deepEqual((await review.apply()).failed, []);
  const intent = environment.intents.find((item) => item.path === "Prg/a.prg");
  ok(intent !== undefined, "the intended content was recorded");
  // The recorded intent is exactly the bytes that were written, with the file's own CRLF endings.
  deepEqual([...intent.bytes], [...host.bytesOf("Prg/a.prg")!]);
  equal(text(intent.bytes), "tidy\r\nline two\r\n");
});

test("a host whose history cannot record intent before writing writes nothing, rather than risking an unrecoverable write", async () => {
  const host = project();
  const history: WizardHistory = { begin: async () => ({ ok: true, groupId: "g1" }), written: async () => ({ ok: true }) };
  const environment = env(host, { history });
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "program", path: "Prg/a.prg" }));
  const outcome = await review.apply();
  deepEqual(outcome.applied, []);
  match(outcome.failed[0]!.message, /cannot record the reviewed checkpoint/);
  equal(text(host.bytesOf("Prg/a.prg")), "MESSY\r\nline two\r\n");
});

test("a copy changed between the review and Apply is not overwritten", async () => {
  const host = project();
  const environment = env(host);
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "update", { kind: "program", path: "Prg/old.prg" }));
  await host.fs.write(`${MIGRATED_FOLDER}/Prg/old.prg`, bytes("changed during review\n"));
  const outcome = await review.apply();
  deepEqual(outcome.failed.map((item) => item.path), ["Prg/old.prg"]);
  equal(text(host.bytesOf(`${MIGRATED_FOLDER}/Prg/old.prg`)), "changed during review\n");
});

test("under a project root the host is given a workspace path for its URI, while the server gets its own root-relative one", async () => {
  const host = createMemoryPlatformServices({ files: { "Game/Main/example.gam": bytes("gam"), "Game/Prg/old.prg": bytes("OLD\n") } });
  const seen: { readonly path: string; readonly workspacePath?: string; readonly uri: string }[] = [];
  const inner = provider();
  const provider2 = scriptProviderOver(async (params) => {
    // The server-side path travels in the request text's identity; the URI is the host's mapping of the workspace path.
    return await inner.transform({ transform: params.transform, path: "Prg/old.prg", text: params.text, indentWidth: params.indentWidth, workspacePath: "Game/Prg/old.prg" });
  }, (path) => { seen.push({ path, uri: `tkr://${path}` }); return `tkr://${path}`; });
  const environment = env(host, { provider: provider2, root: "Game", projectMainUri: "tkr://Game/Main/example.gam" });
  const plan = await planScriptWorkflow(environment, "update", { kind: "project" });
  equal(plan.entries[0]!.destination, "Game/.tkr-migrated/3.1/Prg/old.prg");
  ok(seen.some((item) => item.path === "Game/Prg/old.prg" && item.uri === "tkr://Game/Prg/old.prg"), "the URI is built from the workspace path");
});

for (const event of ["closed source bytes", "open source text", "open destination"] as const) {
  test(`migration refuses a copy when folder creation races with ${event}`, async () => {
    const host = project();
    const path = "Prg/old.prg";
    const destination = `${MIGRATED_FOLDER}/${path}`;
    let sourceText = "OLD\n";
    const open: OpenScriptProgram[] = event === "open source text" ? [{ path, text: () => sourceText, replace: async () => ({ ok: true }) }] : [];
    const environment = env(host, { openPrograms: () => open, fs: {
      ...host.fs,
      async createFolder(folder) {
        if (event === "closed source bytes") host.seed(path, bytes("OLD\r\n"));
        else if (event === "open source text") sourceText = "OLD and unsaved\n";
        else open.push({ path: destination, text: () => "newer unsaved copy", replace: async () => ({ ok: true }) });
        return await host.fs.createFolder(folder);
      },
    } });
    const review = createScriptReview(environment, await planScriptWorkflow(environment, "update", { kind: "program", path }));
    const outcome = await review.apply();
    deepEqual(outcome.applied, []);
    deepEqual(outcome.failed.map((item) => item.path), [path]);
    equal(text(host.bytesOf(destination)), "MESSY previous copy");
    deepEqual(environment.groups[0]?.written, []);
  });
}

test("an apply cannot continue after checkpoint confirmation switches the selected project", async () => {
  const host = project();
  let current = true;
  const history: WizardHistory = {
    async begin() { throw new Error("Not a wizard"); },
    async prepareScripts() { current = false; return { ok: true, groupId: "g1" }; },
    async written() { throw new Error("Unexpected write"); },
  };
  let edits = 0;
  const environment = env(host, {
    history,
    isProjectCurrent: () => current,
    openPrograms: () => [{ path: "Prg/a.prg", text: () => "MESSY open", replace: async () => { edits++; return { ok: true }; } }],
  });
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  const outcome = await review.apply();
  deepEqual(outcome.applied, []);
  equal(outcome.failed.length, review.getSnapshot().selected);
  ok(outcome.failed.length > 0 && outcome.failed.every(({ message }) => message.includes("selected project changed")));
  equal(edits, 0);
  equal(text(host.bytesOf("Prg/b.prg")), "MESSY b\n");
});

test("same-path main replacement during checkpoint consent prevents both buffer edits and disk writes", async () => {
  const host = project();
  const main = "Main/game.gam";
  const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../docs/spec/examples/versions/main/${name}`, import.meta.url)));
  host.seed(main, fixture("main_minor9.gam"));
  const ordinary = env(host);
  let edits = 0;
  const environment = env(host, {
    projectMainPath: main,
    isProjectCurrent: () => true,
    history: {
      ...ordinary.history!,
      async prepareScripts() {
        host.seed(main, fixture("main_tk2_text.gam"));
        return { ok: true, groupId: "g1" };
      },
    },
    openPrograms: () => [{ path: "Prg/a.prg", text: () => "MESSY open", replace: async () => { edits++; return { ok: true }; } }],
  });
  const plan = await planScriptWorkflow(environment, "format", { kind: "project" });
  const review = createScriptReview(environment, plan);
  review.setIncluded("Prg/old.prg", false);
  const outcome = await review.apply();
  deepEqual(outcome.applied, []);
  ok(outcome.failed.length >= 2 && outcome.failed.every(({ message }) => message.includes("selected project changed")));
  equal(edits, 0);
  equal(text(host.bytesOf("Prg/b.prg")), "MESSY b\n");
});

test("an existing destination with different case is never checkpointed under one name and written under another", async () => {
  const host = createMemoryPlatformServices({ files: {
    "Prg/old.prg": bytes("OLD\n"), ".TKR-MIGRATED/3.1/Prg/old.prg": bytes("Keep this copy"),
  } });
  const environment = env(host);
  const plan = await planScriptWorkflow(environment, "update", { kind: "project" });
  equal(plan.entries[0]?.state, "failed");
  match(plan.entries[0]?.message ?? "", /different stored spelling.*\.TKR-MIGRATED/);
  deepEqual((await createScriptReview(environment, plan).apply()).applied, []);
  deepEqual(environment.groups, []);
  equal(text(host.bytesOf(".TKR-MIGRATED/3.1/Prg/old.prg")), "Keep this copy");
});

test("case-colliding sources are refused instead of presenting one open buffer as two programs", async () => {
  const host = createMemoryPlatformServices({ files: { "Prg/Main.prg": bytes("MESSY\n") } });
  const calls: ScriptTransformQuestion[] = [];
  let edited = false;
  const environment = env(host, {
    fs: { ...host.fs, list: (path) => path === "Prg"
      ? Promise.resolve({ ok: true, value: [{ name: "Main.prg", kind: "file" }, { name: "main.prg", kind: "file" }] })
      : host.fs.list(path) },
    provider: provider(calls),
    openPrograms: () => [{ path: "Prg/Main.prg", text: () => "MESSY open", replace: async () => { edited = true; return { ok: true }; } }],
  });
  const plan = await planScriptWorkflow(environment, "format", { kind: "project" });
  deepEqual(states(plan.entries), { "Prg/Main.prg": "failed", "Prg/main.prg": "failed" });
  ok(plan.entries.every((entry) => entry.message?.includes("differ only in case")));
  deepEqual(calls, []);
  deepEqual((await createScriptReview(environment, plan).apply()).applied, []);
  equal(edited, false);
});

test("a compiled program open as native text is skipped before consulting the provider", async () => {
  const host = project();
  const calls: ScriptTransformQuestion[] = [];
  const environment = env(host, {
    provider: provider(calls),
    openPrograms: () => [{ path: "Prg/compiled.prg", text: () => "MESSY", replace: async () => { throw new Error("must not edit"); } }],
  });
  const plan = await planScriptWorkflow(environment, "format", { kind: "program", path: "Prg/compiled.prg" });
  equal(plan.entries[0]?.state, "skipped");
  deepEqual(calls, []);
  deepEqual((await createScriptReview(environment, plan).apply()).applied, []);
});

test("a receipt failure reports the successful write and does not retry it alongside a refused write", async () => {
  const host = project();
  const normal = env(host);
  const writes: string[] = [];
  let failOther = true;
  const environment = env(host, {
    history: { ...normal.history!, async written(_group, path) {
      if (path === "Prg/a.prg") throw new Error("receipt storage stopped");
      return { ok: true };
    } },
    fs: { ...host.fs, async write(path, data) {
      writes.push(path);
      if (path === "Prg/b.prg" && failOther) return { ok: false, error: { code: "io-error", message: "target write refused" } };
      return await host.fs.write(path, data);
    } },
  });
  const review = createScriptReview(environment, await planScriptWorkflow(environment, "format", { kind: "project" }));
  review.setIncluded("Prg/old.prg", false);
  review.setIncluded("Prg/sub/deep.rnc", false);
  const first = await review.apply();
  deepEqual(first.applied.map(({ path }) => path), ["Prg/a.prg"]);
  deepEqual(first.failed.map(({ path }) => path), ["Prg/b.prg"]);
  match(first.recoveryWarnings[0]?.message ?? "", /was written.*receipt storage stopped/);
  equal(text(host.bytesOf("Prg/a.prg")), "tidy\r\nline two\r\n");
  equal(review.getSnapshot().selected, 1);
  failOther = false;
  const retried = await review.apply();
  deepEqual(retried.failed, []);
  deepEqual(retried.applied.map(({ path }) => path), ["Prg/a.prg", "Prg/b.prg"]);
  deepEqual(retried.recoveryWarnings, first.recoveryWarnings);
  deepEqual(writes, ["Prg/a.prg", "Prg/b.prg", "Prg/b.prg"]);
});

for (const swap of ["directory-during-consent", "file-during-read"] as const) {
  test(`migration refuses a same-byte symbolic link (${swap}) before an unsafe filesystem operation`, async () => {
    const host = project();
    const destination = `${MIGRATED_FOLDER}/Prg/old.prg`;
    const redirected = "Elsewhere/unrelated.prg";
    const original = host.bytesOf(destination)!;
    host.seed(redirected, original);
    let linked = false;
    let folderCalls = 0;
    let writeCalls = 0;
    const linkParent = swap === "directory-during-consent" ? "" : `${MIGRATED_FOLDER}/Prg`;
    const linkName = swap === "directory-during-consent" ? ".tkr-migrated" : "old.prg";
    const standard = env(host);
    const environment = env(host, {
      history: {
        ...standard.history!,
        async prepareScripts() {
          if (swap === "directory-during-consent") linked = true;
          return { ok: true, groupId: "g1" };
        },
      },
      fs: {
        ...host.fs,
        async list(path) {
          const entries = await host.fs.list(path);
          if (!entries.ok || path !== linkParent || !linked) return entries;
          return { ok: true, value: entries.value.map((entry) => entry.name === linkName ? { ...entry, kind: "link" } : entry) };
        },
        async read(path) {
          if (path === destination && swap === "file-during-read" && folderCalls > 0) linked = true;
          return await host.fs.read(path === destination && linked ? redirected : path);
        },
        async createFolder(path) {
          folderCalls++;
          return await host.fs.createFolder(path);
        },
        async write(path, value) {
          writeCalls++;
          return await host.fs.write(path === destination && linked ? redirected : path, value);
        },
      },
    });
    const plan = await planScriptWorkflow(environment, "update", { kind: "program", path: "Prg/old.prg" });
    equal(plan.entries[0]?.state, "ready");
    const outcome = await createScriptReview(environment, plan).apply();
    equal(linked, true);
    equal(folderCalls, swap === "directory-during-consent" ? 0 : 1);
    equal(writeCalls, 0);
    deepEqual(outcome.applied, []);
    match(outcome.failed[0]?.message ?? "", /symbolic link/);
    deepEqual(host.bytesOf(redirected), original);
    deepEqual(host.bytesOf(destination), original);
  });
}

for (const race of ["open-main", "closed-main", "closed-source", "copy-destination"] as const) {
  test(`review apply resamples bytes changed during the final path listing (${race})`, async () => {
    const host = project();
    const copy = race === "copy-destination";
    const source = copy ? "Prg/old.prg" : "Prg/a.prg";
    const destination = copy ? `${MIGRATED_FOLDER}/${source}` : source;
    const parent = destination.slice(0, destination.lastIndexOf("/"));
    const main = "Main/game.gam";
    const mainFixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../docs/spec/examples/versions/main/${name}`, import.meta.url)));
    host.seed(main, mainFixture("main_minor9.gam"));
    let arm = false;
    let sampled = false;
    let writes = 0;
    let edits = 0;
    let arrived!: () => void;
    let release!: () => void;
    const listing = new Promise<void>((resolve) => { arrived = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const usual = env(host);
    const environment = env(host, {
      ...(copy ? {} : { projectMainPath: main }),
      openPrograms: () => race === "open-main" ? [{ path: source, text: () => "MESSY open", replace: async () => { edits++; return { ok: true }; } }] : [],
      history: { ...usual.history!, async prepareScripts() { arm = true; return { ok: true, groupId: "g1" }; } },
      fs: {
        ...host.fs,
        async read(path) {
          const data = await host.fs.read(path);
          if (arm && path === destination) sampled = true;
          return data;
        },
        async list(path) {
          if (arm && sampled && path === parent) {
            arm = false;
            arrived();
            await gate;
          }
          return await host.fs.list(path);
        },
        async write(path, data) { writes++; return await host.fs.write(path, data); },
      },
    });
    const plan = await planScriptWorkflow(environment, copy ? "update" : "format", { kind: "program", path: source });
    equal(plan.entries[0]?.state, "ready");
    if (race === "open-main") arm = true;
    const applying = createScriptReview(environment, plan).apply();
    await listing;
    const replaceMain = race.endsWith("-main");
    const modified = replaceMain ? mainFixture("main_tk2_text.gam") : bytes("Externally replaced\n");
    const changed = replaceMain ? main : destination;
    host.seed(changed, modified);
    release();
    const outcome = await applying;
    equal(writes + edits, 0);
    deepEqual(outcome.applied, []);
    match(outcome.failed[0]?.message ?? "", replaceMain ? /selected project changed/ : /changed/);
    deepEqual(host.bytesOf(changed), modified);
  });
}
