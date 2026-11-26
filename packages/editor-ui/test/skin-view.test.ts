import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openNativeSkinDocument } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { mount as mountEditor } from "../src/index.ts";

let mount: typeof mountEditor;
let act: (callback: () => void | Promise<void>) => void | Promise<void>;
before(async () => {
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

test("skin view gives each image role an independent picker, labels its editor-only preview, and applies one undoable edit", async () => {
  const path = "Misc/stone.tkrskin";
  const source = "# preserved\ncontract: skin\nversion: 1.0.0-pre.1\nlabel: Stone keep\nwindowImage: bitmap/old-window.png\nbuttonImage: bitmap/old-button.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeSkinDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const requests: string[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, {
    document: opened.document,
    services: host,
    navigation: { pickAsset: async (request) => {
      requests.push(request.field);
      return { chosen: true, reference: request.field === "the skin's window graphic" ? "new-window.png" : "new-button.png" };
    } },
  });
  const button = (name: string): HTMLButtonElement => {
    const found = root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    ok(found, `missing ${name}`);
    return found;
  };
  try {
    ok(root.textContent?.includes("Preview only: the engine does not use skins yet"));
    equal(root.querySelectorAll("fieldset").length, 2);
    await act(() => button("Choose window graphic image…").click());
    for (let step = 0; step < 8; step += 1) await act(async () => { await Promise.resolve(); });
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/new-window.png");
    equal(opened.document.getSnapshot().skin.buttonImage, "bitmap/old-button.png");
    deepEqual(requests, ["the skin's window graphic"]);
    ok(opened.document.undo().ok);
    equal(opened.document.getSnapshot().skin.windowImage, "bitmap/old-window.png");
  } finally {
    handle.dispose();
    root.remove();
  }
});
