import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDocumentIdentity, openNativeClipDocument, type NativeClipCommand } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import type { NativeClipViewDocument } from "../src/native-clip-view.tsx";
import type { mount as mountEditor } from "../src/index.ts";

let mount: typeof mountEditor;
let act: (callback: () => void | Promise<void>) => void | Promise<void>;
before(async () => {
  // The UI reads browser globals at module initialization, so register the DOM before loading it.
  GlobalRegistrator.register();
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

test("a later scalar or colour draft survives an earlier Apply acknowledgment", async () => {
  const path = "Misc/walk.tkranm";
  const text = "contract: animation-clip\nversion: 1.0.0-pre.1\ncanvas: {width: 32, height: 32}\ndelay: 0.1\ncolourKey: {r: 255, g: 0, b: 0}\nframes:\n  - image: bitmap/walk.png\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(text) } });
  const opened = await openNativeClipDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const model = opened.document;
  let release: (() => void) | undefined;
  const view: NativeClipViewDocument = {
    kind: model.kind, identity: model.identity,
    getSnapshot: () => model.getSnapshot(), subscribe: (listener) => model.subscribe(listener),
    apply: (command: NativeClipCommand) => new Promise((resolve) => { release = () => resolve(model.apply(command)); }),
    save: () => model.save(), resolveConflict: (choice) => model.resolveConflict(choice),
  };
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: view, services: host });
  const inputs = root.querySelectorAll<HTMLInputElement>("input");
  const delay = inputs[2]!;
  const red = inputs[3]!;
  const button = (label: string) => {
    const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    ok(found);
    return found;
  };
  const type = async (input: HTMLInputElement, value: string) => {
    await act(() => { input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  try {
    await type(delay, "0.25");
    await act(() => button("Apply delay").click());
    await type(delay, "0.3");
    ok(release);
    await act(async () => { release!(); await Promise.resolve(); });
    equal(model.getSnapshot().clip.delay, 0.25);
    equal(delay.value, "0.3");

    await type(red, "128");
    await act(() => button("Set colour key").click());
    await type(red, "129");
    ok(release);
    await act(async () => { release!(); await Promise.resolve(); });
    equal(model.getSnapshot().clip.colourKey?.r, 128);
    equal(red.value, "129");
  } finally {
    handle.dispose();
    root.remove();
  }
});

test("native clip UI applies a field edit without changing plugin source", async () => {
  const path = "Misc/plugin.tkranm";
  const source = "contract: animation-clip\nversion: 1.0.0-pre.1\ncanvas: {width: 32, height: 32}\ndelay: 0.15 # timing\nframes:\n  - image: bitmap/walk.png\npluginData: # keep this block\n  com.example.weather:\n    version: 1.0.0\n    data: {wind: 1.10, futureKnob: \"leave: exact\"} # opaque\n";
  const host = createMemoryPlatformServices({ files: { [path]: new TextEncoder().encode(source) } });
  const opened = await openNativeClipDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  const root = document.createElement("div");
  document.body.append(root);
  const handle = mount(root, { document: opened.document, services: host });
  const delay = root.querySelectorAll<HTMLInputElement>("input[type=number]")[2]!;
  const button = (label: string) => {
    const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    ok(found);
    return found;
  };
  try {
    await act(() => {
      delay.value = "0.2";
      delay.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => button("Apply delay").click());
    const edited = source.replace("delay: 0.15", "delay: 0.2");
    deepEqual(opened.document.serialize(), new TextEncoder().encode(edited));
    ok((await opened.document.save()).ok);
    deepEqual(host.bytesOf(path), new TextEncoder().encode(edited));
  } finally {
    handle.dispose();
    root.remove();
  }
});
