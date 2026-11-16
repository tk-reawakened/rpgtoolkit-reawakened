// The VS Code History command's adapter: the shared workspace lists, previews and restores; the adapter only picks and
// reports (ADR 0022 D12.6, D12.10 item 13; #2833).
import { deepEqual, equal, match, ok } from "node:assert/strict";
import { test } from "node:test";
import { createDocumentWorkspace } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { runHistoryCommand } from "../src/history-command.ts";
import { handleHistoryPreviewRequest } from "../src/document-bridge.ts";
import { readFileSync } from "node:fs";
import { BinaryReader, readMainFile, writeMainFile } from "@tk-reawakened/core";

const PATH = "Main/example.gam";
const exampleMain = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/versions/main/main_minor9.gam", import.meta.url)));
const titleOf = (bytes: Uint8Array): string => {
  const read = readMainFile(new BinaryReader(bytes, PATH));
  return read.ok ? read.value.gameTitle : "";
};

test("the History command lists the active document's saved versions, previews and restores the one chosen", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  const opened = await workspace.open(PATH);
  ok(opened.ok);
  ok(opened.document.apply({ type: "set-game-title", title: "Later" }).ok);
  ok((await opened.document.save("manual")).ok);
  const picks: string[][] = [];
  const previews: string[] = [];
  const messages: string[] = [];
  await runHistoryCommand(workspace, PATH, {
    pick: async (items) => { picks.push(items.map((item) => item.label)); return items.at(-1)!.id; },
    tell: async (message) => { messages.push(message); },
    showPreview: async (path, bytes) => { previews.push(`${path}:${titleOf(bytes)}`); return true; },
  });
  equal(picks.length, 1);
  equal(picks[0]!.length, 2, "the version before the first save, then the save");
  match(picks[0]![0]!, /saved/);
  deepEqual(previews, [`${PATH}:${titleOf(exampleMain)}`], "the chosen (oldest) version is offered to the editor");
  equal(titleOf(host.bytesOf(PATH)!), titleOf(exampleMain), "the workspace restored it");
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

test("the History command lists and restores canonical wizard recovery groups", async () => {
  const parsed = readMainFile(new BinaryReader(exampleMain, PATH));
  ok(parsed.ok);
  const encoded = writeMainFile({ ...parsed.value, gameTitle: "Created by a wizard" });
  ok(encoded.ok);
  const createdBytes = encoded.value;
  const host = createMemoryPlatformServices({ files: { [PATH]: exampleMain } });
  const workspace = createDocumentWorkspace({ projectId: "memory-project", services: host });
  host.answerQuestions("continue");
  const created = await workspace.checkpoints.commit([{ path: PATH, bytes: createdBytes }]);
  ok(created.ok, created.ok ? "" : created.error.message);
  const messages: string[] = [];
  const choices: string[] = [];
  await runHistoryCommand(workspace, null, {
    pick: async (items) => {
      choices.push(...items.map((item) => item.id));
      return `group:${created.value.id}`;
    },
    tell: async (message) => { messages.push(message); },
  });
  ok(choices.includes(`group:${created.value.id}`), "wizard groups are available from the project History command");
  equal(titleOf(host.bytesOf(PATH)!), titleOf(exampleMain), "the selected group's before bytes are restored");
  match(messages.at(-1)!, /Recovery group restored/);
  workspace.dispose();
});
