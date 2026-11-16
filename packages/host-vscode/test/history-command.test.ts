// The VS Code History command's adapter: the shared workspace lists, previews and restores; the adapter only picks and
// reports (ADR 0022 D12.6, D12.10 item 13; #2833).
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { createDocumentWorkspace } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { runHistoryCommand } from "../src/history-command.ts";
import { handleHistoryPreviewRequest } from "../src/document-bridge.ts";
import { readFileSync } from "node:fs";

const PATH = "Main/example.gam";
const SECOND_PATH = "Boards/example.brd";
const exampleMain = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor9.gam", import.meta.url)));


test("the History command lists the active document's saved versions, previews and restores the one chosen", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const older = new Uint8Array([1, 2, 3]);
  const newer = new Uint8Array([4, 5, 6]);
  await workspace.history.keep(PATH, older, "checkpoint");
  await host.fs.writeProject("memory-project", PATH, newer);
  await workspace.history.recordSave(PATH, newer, "manual");
  const olderEntry = (await workspace.history.documentTimeline(PATH)).find((entry) => entry.reason === "checkpoint")!;
  const picks: string[][] = [];
  const previews: Uint8Array[] = [];
  const messages: string[] = [];
  await runHistoryCommand(workspace, PATH, {
    pick: async (items) => {
      picks.push(items.map((item) => item.label));
      return `entry:${olderEntry.id}`;
    },
    tell: async (message) => { messages.push(message); },
    showPreview: async (_path, bytes) => { previews.push(bytes); return true; },
  });
  equal(picks.length, 1);
  ok(picks[0]!.length >= 1);
  deepEqual(previews, [older], "the chosen (oldest) version is offered to the editor");
  deepEqual(host.bytesOf(PATH), older, "the workspace restored it");
  match(messages.at(-1)!, /Main\/example\.gam: restored/);
  match(messages.at(-1)!, /can be undone/);
  workspace.dispose();
});

test("read-only history previews settle animation-authoring requests with an explicit refusal", async () => {
  const replies: unknown[] = [];
  const preview = {
    model: {} as never,
    path: "Animations/intro.anim",
    browserSession: {} as never,
    preview: async () => ({ ok: false, message: "not a picture" }),
    browserList: async () => ({ ok: true, value: [] }),
    browserRead: async () => ({ ok: true, value: new Uint8Array() }),
    readProject: async () => ({ ok: true, value: new Uint8Array() }),
  };
  await handleHistoryPreviewRequest(preview, { type: "animation-action", requestId: "history-action-1", action: "list" }, (message) => { replies.push(message); });
  equal(replies.length, 1);
  const reply = replies[0] as { readonly type: string; readonly requestId: string; readonly result: { readonly ok: boolean; readonly error?: { readonly code: string } } };
  equal(reply.type, "animation-action-result");
  equal(reply.requestId, "history-action-1");
  equal(reply.result.ok, false);
  equal(reply.result.error?.code, "permission-denied");
});

test("with nothing in history the command says where history would be kept and changes nothing", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const messages: string[] = [];
  await runHistoryCommand(workspace, PATH, { pick: async () => { throw new Error("nothing to pick"); }, tell: async (message) => { messages.push(message); } });
  match(messages[0]!, /No history yet/);
  match(messages[0]!, /\.tkr-history\//);
  workspace.dispose();
});

test("the History command restores every file in the selected recovery group from an active document", async () => {
  const original = new Uint8Array([1, 2, 3]);
  const otherOriginal = new Uint8Array([4, 5, 6]);
  const host = createMemoryPlatformServices({ files: { [PATH]: original, [SECOND_PATH]: otherOriginal } });
  host.answerQuestions("continue");
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const created = await workspace.checkpoints.commit([
    { path: PATH, bytes: new Uint8Array([7]) },
    { path: SECOND_PATH, bytes: new Uint8Array([8]) },
  ]);
  ok(created.ok, created.ok ? "" : created.error.message);
  const messages: string[] = [];
  let offeredGroup = false;
  await runHistoryCommand(workspace, PATH, {
    pick: async (items) => {
      offeredGroup = items.some((item) => item.id === `group:${created.value.id}`);
      return `group:${created.value.id}`;
    },
    tell: async (message) => { messages.push(message); },
  });
  ok(offeredGroup, "wizard groups containing the active document are available from History");
  deepEqual(host.bytesOf(PATH), original);
  deepEqual(host.bytesOf(SECOND_PATH), otherOriginal, "selecting a group restores its other files too");
  match(messages.at(-1)!, /Recovery group restored/);
  match(messages.at(-1)!, /Boards\/example\.brd: restored/);
  workspace.dispose();
});

