// Preact panels behind the view-handle contract of ADR 0025 decision 4: `mountPanel(kind, el, params) -> { dispose }`.
// Every docking adapter calls only this, so the same panels run in each library. Written with `h()` (no JSX) so the
// spike needs no TypeScript or JSX configuration of its own.
import { h, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getDocument, openDocument } from "./doc-model.mjs";

/** Mount and dispose log, read by the specs to prove that views are disposed and recreated, never the document. */
export const viewLog = [];

function useDocument(doc) {
  const [snapshot, setSnapshot] = useState(doc.getSnapshot());
  useEffect(() => doc.subscribe(setSnapshot), [doc]);
  return snapshot;
}

function BoardView({ identity, viewId }) {
  const doc = getDocument(identity) ?? openDocument(identity, "Start board");
  const snapshot = useDocument(doc);
  return h(
    "section",
    { class: "spike-board", "data-view": viewId, "aria-label": `Board ${snapshot.title} (${viewId})` },
    h("p", { class: "spike-state", "data-identity": identity }, `${snapshot.title}: ${snapshot.painted} painted, revision ${snapshot.revision}${doc.dirty() ? ", unsaved" : ""}`),
    h("label", { for: `${viewId}-title` }, "Board title"),
    h("input", {
      id: `${viewId}-title`,
      value: snapshot.title,
      onChange: (event) => doc.rename(event.currentTarget.value),
    }),
    h("button", { type: "button", onClick: () => doc.paint() }, "Paint"),
    h("button", { type: "button", onClick: () => doc.undo() }, "Undo"),
    // A CSSOM style (allowed by `style-src 'self'`), so a blocked attribute style would show up as a wrong width.
    h("div", { class: "spike-bar", style: { width: `${Math.min(100, snapshot.painted * 10)}%` } }),
  );
}

function FilesView() {
  return h(
    "nav",
    { "aria-label": "Files" },
    h("ul", null, ["Main/example.gam", "Boards/start.brd", "Prg/start.prg"].map((name) => h("li", { key: name }, h("button", { type: "button" }, name)))),
  );
}

function PropertiesView() {
  return h("section", { "aria-label": "Properties" }, h("p", null, "Nothing selected."));
}

function MissingView({ kind }) {
  return h("p", { role: "note", class: "spike-missing" }, `This panel type is not available: ${kind}`);
}

const kinds = { board: BoardView, files: FilesView, properties: PropertiesView };

export function mountPanel(kind, element, params = {}) {
  const viewId = params.viewId ?? kind;
  const component = kinds[kind];
  render(component ? h(component, { ...params, viewId }) : h(MissingView, { kind }), element);
  viewLog.push({ event: "mount", kind, viewId });
  return {
    dispose() {
      render(null, element);
      viewLog.push({ event: "dispose", kind, viewId });
    },
  };
}

export const knownKind = (kind) => Object.hasOwn(kinds, kind);

/** Common probe hooks every adapter exposes as `window.spike`. */
export function exposeProbe(lib, adapter) {
  openDocument("Boards/start.brd", "Start board");
  window.spike = {
    lib,
    viewLog,
    doc: () => getDocument("Boards/start.brd").getSnapshot(),
    docViews: () => getDocument("Boards/start.brd").viewCount(),
    undoDepth: () => getDocument("Boards/start.brd").undoDepth(),
    ...adapter,
  };
  window.spikeReady = true;
}
