import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENT_KINDS_BY_VIEW_TYPE, eventsForDocumentKind } from "../src/custom-editor.ts";

test("custom editor change notifications reach each registered view type without cross-provider leaks", () => {
  type Event = { readonly document: { readonly model: { readonly kind: string } }; readonly label: string };
  const sourceListeners: ((event: Event) => unknown)[] = [];
  const source = (listener: (event: Event) => unknown) => {
    sourceListeners.push(listener);
    return { dispose: () => { const index = sourceListeners.indexOf(listener); if (index >= 0) sourceListeners.splice(index, 1); } };
  };
  deepEqual(
    DOCUMENT_KINDS_BY_VIEW_TYPE["tkr.gameSettings"],
    ["main", "character", "item"],
    "the game-settings manifest provider owns .gam, .tem, and .itm edits",
  );
  const registrations = Object.entries(DOCUMENT_KINDS_BY_VIEW_TYPE);
  const received = new Map<string, Event[]>();
  const subscriptions = registrations.map(([viewType, kinds]) => eventsForDocumentKind(source, kinds)((event) => {
    const events = received.get(viewType) ?? [];
    events.push(event);
    received.set(viewType, events);
  }));
  const edits: Event[] = ["main", "character", "item", "board", "tileset", "tile-bitmap", "animation"]
    .map((kind) => ({ document: { model: { kind } }, label: `${kind} edit` }));

  for (const edit of edits) for (const listener of sourceListeners) listener(edit);
  // Native clips use VS Code's TextDocument, not this binary custom-document event stream.
  for (const listener of sourceListeners) listener({ document: { model: { kind: "native-clip" } }, label: "native clip edit" });

  equal(sourceListeners.length, registrations.length, "each registered view type subscribes to the shared provider event");
  for (const [viewType, kinds] of registrations) {
    deepEqual(
      received.get(viewType)?.map((event) => event.document.model.kind),
      kinds,
      `${viewType} receives only its manifest-selected document kinds`,
    );
  }
  equal([...received.values()].reduce((total, events) => total + events.length, 0), edits.length, "every document edit is delivered once");
  for (const subscription of subscriptions) subscription.dispose();
  equal(sourceListeners.length, 0);
});
