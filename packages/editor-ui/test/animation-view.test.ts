import { createHash } from "node:crypto";
import { platformError, platformOk } from "@tk-reawakened/platform-services";
import { after, before, test } from "node:test";
import { deepEqual, equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createAnimationAuthoring, createDocumentIdentity, newAnimationBytes, openAnimationDocument, spriteGifPreview } from "@tk-reawakened/editor-model";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createBrowserSession } from "../dist/brush.js";
import type { AnimationViewDocument } from "../src/animation-view.tsx";
import type { ViewHandle } from "../src/mount.ts";
import type { mount as mountEditor } from "../src/index.ts";

const PATH = "Misc/walk.anm";
const IDENTITY = createDocumentIdentity("memory-project", PATH);
let mount!: typeof mountEditor;
let act!: (callback: () => void | Promise<void>) => void | Promise<void>;

before(async () => {
  GlobalRegistrator.register();
  // Load UI only after DOM registration: module initialization requires browser globals.
  ({ act } = await import("preact/test-utils"));
  ({ mount } = await import("@tk-reawakened/editor-ui"));
});
after(() => GlobalRegistrator.unregister());

async function settleUntil(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !done(); turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
  ok(done(), "the animation editor did not settle");
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  if (found === undefined) throw new Error(`No button named ${text}`);
  return found;
}

test("the sorted-image wizard inserts frames in display order, initializes the first frame and saves reopenable bytes", async () => {
  const gif = new Uint8Array(readFileSync(new URL("../../core/test/fixtures/authored/gif-anim89a.gif", import.meta.url)));
  const host = createMemoryPlatformServices({ files: {
    [PATH]: newAnimationBytes(),
    "Bitmap/z.gif": gif,
    "Bitmap/a.gif": gif,
  } });
  const opened = await openAnimationDocument(host.fs, IDENTITY);
  ok(opened.ok);
  const model = opened.document;
  const view: AnimationViewDocument = {
    kind: model.kind,
    identity: model.identity,
    getSnapshot: () => model.getSnapshot(),
    subscribe: (listener) => model.subscribe(listener),
    apply: (command) => model.apply(command),
    save: () => model.save(),
    resolveConflict: (choice) => model.resolveConflict(choice),
  };
  const session = createBrowserSession();
  const root = document.createElement("div");
  document.body.append(root);
  let handle: ViewHandle | undefined;
  await act(() => {
    handle = mount(root, {
      animationAuthoring: createAnimationAuthoring({ fs: host.fs, projectId: IDENTITY.projectId,
        hash: async (bytes) => createHash("sha256").update(bytes).digest("hex"), newId: () => "image-wizard", time: () => "2026-11-15", guard: async () => null, consent: async () => true,
      }, model, async () => { const result = await model.save(); return result.ok ? platformOk(undefined) : platformError("io-error", result.failure.message); }, () => undefined),
      document: view,
      services: host,
      browser: { session, fs: host.fs, layout: { projectFolder: "" } },
    });
  });
  try {
    const imageSummary = [...root.querySelectorAll("summary")].find((summary) => summary.textContent === "Build from sorted Bitmap images");
    ok(imageSummary);
    await act(() => imageSummary.click());
    await settleUntil(() => root.querySelectorAll('.tkr-animation-wizards input[type="checkbox"]').length === 2);
    const labels = [...root.querySelectorAll('.tkr-animation-wizards label')].map((label) => label.textContent ?? "");
    ok(labels.findIndex((label) => label.includes("a.gif")) < labels.findIndex((label) => label.includes("z.gif")), "the project image list is sorted by reference");
    for (const checkbox of root.querySelectorAll<HTMLInputElement>('.tkr-animation-wizards input[type="checkbox"]')) {
      await act(() => checkbox.click());
    }
    await act(() => button(root, "Insert selected sorted images").click());
    await settleUntil(() => model.getSnapshot().frames.length === 2 && !model.getSnapshot().dirty);

    const snapshot = model.getSnapshot();
    deepEqual(snapshot.frames.map((frame) => frame.image), ["a.gif", "z.gif"]);
    const firstPreview = spriteGifPreview(gif, "Bitmap/a.gif")?.frames[0];
    ok(firstPreview !== undefined);
    deepEqual(snapshot.frames[0]?.transparent, { r: firstPreview.rgba[0], g: firstPreview.rgba[1], b: firstPreview.rgba[2] });
    equal(snapshot.width, firstPreview.width);
    equal(snapshot.height, firstPreview.height);

    const stored = await host.fs.read(PATH);
    ok(stored.ok);
    const reopened = await openAnimationDocument(host.fs, IDENTITY);
    ok(reopened.ok);
    deepEqual(reopened.document.serialize(), stored.value);
    deepEqual(reopened.document.getSnapshot().frames, snapshot.frames);
  } finally {
    handle?.dispose();
    root.remove();
  }
});

test("immediate save settles queued frame metadata without blur and retains edits through reopen", async () => {
  const host = createMemoryPlatformServices({ files: { [PATH]: newAnimationBytes() } });
  const opened = await openAnimationDocument(host.fs, IDENTITY); ok(opened.ok);
  const model = opened.document;
  ok(model.apply({ type: "insert-animation-frame", index: 0, frame: { image: "a.gif", sound: "", transparent: { r: 0, g: 0, b: 0 } } }).ok);
  await model.save();
  let release: (() => void) | undefined;
  let delayed = true;
  const view: AnimationViewDocument = {
    kind: model.kind, identity: model.identity, getSnapshot: () => model.getSnapshot(), subscribe: (listener) => model.subscribe(listener),
    apply: async (command) => { if (delayed) { delayed = false; await new Promise<void>((resolve) => { release = resolve; }); } return model.apply(command); },
    save: () => model.save(), resolveConflict: (choice) => model.resolveConflict(choice),
  };
  const root = document.createElement("div"); document.body.append(root);
  let handle: ViewHandle | undefined;
  await act(() => { handle = mount(root, { document: view, services: host }); });
  try {
    const field = (label: string) => [...root.querySelectorAll("label")].find((entry) => entry.textContent?.trim() === label)?.querySelector("input");
    const red = field("red"), blue = field("blue"), sound = field("Sound reference"); ok(red); ok(blue); ok(sound);
    await act(() => {
      red.value = "17"; red.dispatchEvent(new Event("input", { bubbles: true }));
      blue.value = "23"; blue.dispatchEvent(new Event("input", { bubbles: true }));
      sound.value = "step.wav"; sound.dispatchEvent(new Event("input", { bubbles: true }));
      button(root, "Save").click();
    });
    await settleUntil(() => release !== undefined);
    equal(model.getSnapshot().frames[0]!.sound, "");
    await act(() => release!());
    await settleUntil(() => model.getSnapshot().frames[0]!.sound === "step.wav" && !model.getSnapshot().dirty);
    const reopened = await openAnimationDocument(host.fs, IDENTITY); ok(reopened.ok);
    deepEqual(reopened.document.getSnapshot().frames[0], { image: "a.gif", sound: "step.wav", transparent: { r: 17, g: 0, b: 23 } });
  } finally { handle?.dispose(); root.remove(); }
});
