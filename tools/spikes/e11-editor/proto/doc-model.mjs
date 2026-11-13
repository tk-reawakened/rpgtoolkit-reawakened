// A framework-free stand-in for an editor-model document (ADR 0022 D2/D3, D7.1): bytes are not modelled, only what the
// docking proof needs to see — one identity, a command stack with undo, a dirty flag, and any number of views that
// subscribe to it. The dock never holds this object; a panel receives the identity and looks the document up.

const documents = new Map();

export function openDocument(identity, title) {
  let doc = documents.get(identity);
  if (doc) return doc;
  let snapshot = { identity, title, painted: 0, revision: 0, savedRevision: 0 };
  const undo = [];
  const listeners = new Set();
  const emit = () => {
    for (const listener of [...listeners]) listener(snapshot);
  };
  const apply = (next, label) => {
    undo.push({ before: snapshot, label });
    snapshot = { ...next, revision: snapshot.revision + 1 };
    emit();
  };
  doc = {
    identity,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    viewCount: () => listeners.size,
    paint: () => apply({ ...snapshot, painted: snapshot.painted + 1 }, "Paint tile"),
    rename: (title) => apply({ ...snapshot, title }, "Rename board"),
    undo() {
      const entry = undo.pop();
      if (!entry) return false;
      snapshot = { ...entry.before, revision: snapshot.revision + 1 };
      emit();
      return true;
    },
    undoDepth: () => undo.length,
    dirty: () => snapshot.painted !== 0 || snapshot.title !== title,
  };
  documents.set(identity, doc);
  return doc;
}

export const getDocument = (identity) => documents.get(identity);
export const allDocuments = () => [...documents.values()];
