import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { eventsForDocumentKind } from "../src/custom-editor.ts";

test("custom editor change notifications reach only the matching registered document kind", () => {
  type Event = { readonly document: { readonly model: { readonly kind: string } }; readonly label: string };
  const sourceListeners: ((event: Event) => unknown)[] = [];
  const source = (listener: (event: Event) => unknown) => {
    sourceListeners.push(listener);
    return { dispose: () => { const index = sourceListeners.indexOf(listener); if (index >= 0) sourceListeners.splice(index, 1); } };
  };
  const kinds = ["main", "board", "tileset", "tile-bitmap", "animation"] as const;
  const received = new Map<string, Event[]>();
  const subscriptions = kinds.map((kind) => eventsForDocumentKind(source, kind)((event) => {
    const events = received.get(kind) ?? [];
    events.push(event);
    received.set(kind, events);
  }));
  const edits: Event[] = kinds.map((kind) => ({ document: { model: { kind } }, label: `${kind} edit` }));

  for (const edit of edits) for (const listener of sourceListeners) listener(edit);

  equal(sourceListeners.length, kinds.length, "each registered view type subscribes to the shared provider event");
  for (const edit of edits) deepEqual(received.get(edit.document.model.kind), [edit], `${edit.document.model.kind} is delivered once to its matching view type`);
  equal([...received.values()].reduce((total, events) => total + events.length, 0), kinds.length, "no notification leaks across view types");
  for (const subscription of subscriptions) subscription.dispose();
  equal(sourceListeners.length, 0);
});
