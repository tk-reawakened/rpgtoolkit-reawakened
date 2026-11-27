import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { dirtyPackagingDocuments, type PackagingInputDocument } from "../src/packaging-inputs.ts";

function document(path: string, dirty: boolean): PackagingInputDocument {
  return { identity: { path }, getSnapshot: () => ({ dirty }) };
}

test("packaging refuses while any open document has unsaved edits, naming each one", () => {
  deepEqual(dirtyPackagingDocuments([document("Main/example.gam", false), document("Prg/start.prg", false)]), []);
  deepEqual(
    dirtyPackagingDocuments([document("Main/example.gam", true), document("Prg/start.prg", false), document("Boards/town.brd", true)]),
    ["Main/example.gam", "Boards/town.brd"],
  );
  equal(dirtyPackagingDocuments([]).length, 0, "no open documents means nothing to save");
});
