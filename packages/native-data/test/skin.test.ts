import { deepEqual, equal, match, ok } from "node:assert/strict";
import test from "node:test";
import { readSkin, setSkinImage } from "../src/index.ts";

const SOURCE = `# author comment
contract: skin
version: 1.0.0-pre.1+build.2
tags: [preview]
metadata: {source: handwritten, note: 1.10}
label: "Stone keep" # retained on edit
windowImage: bitmap/old-window.png
buttonImage: 'bitmap/old-button.bmp' # existing button
pluginData:
  com.example.glow:
    version: 1.0.0
    data: {future: 1.10} # plugin residue
`;

function rejected(text: string): string[] {
  const result = readSkin(text);
  if (result.ok) throw new Error("expected the skin reader to refuse the document");
  return result.problems.map((problem) => `${problem.path}: ${problem.message}`);
}

void test("reads the required role references, optional label, and exact opened version", () => {
  const result = readSkin(SOURCE);
  ok(result.ok);
  deepEqual(result.skin, {
    contract: "skin",
    version: "1.0.0-pre.1+build.2",
    label: "Stone keep",
    windowImage: "bitmap/old-window.png",
    buttonImage: "bitmap/old-button.bmp",
  });
  equal(result.source, SOURCE);
});

void test("edits one role in place and preserves version, comments, and unowned YAML residue", () => {
  const result = setSkinImage(SOURCE, "windowImage", "bitmap/new-window.png");
  ok(result.ok);
  equal(result.text, SOURCE.replace("windowImage: bitmap/old-window.png", "windowImage: bitmap/new-window.png"));
  ok(result.text.includes("version: 1.0.0-pre.1+build.2"));
  ok(result.text.includes("metadata: {source: handwritten, note: 1.10}"));
  ok(result.text.includes("buttonImage: 'bitmap/old-button.bmp' # existing button"));
  ok(result.text.includes("data: {future: 1.10} # plugin residue"));
  const reopened = readSkin(result.text);
  ok(reopened.ok);
  equal(reopened.skin.windowImage, "bitmap/new-window.png");
});

void test("leaves the other role and every other byte unchanged when editing the button", () => {
  const result = setSkinImage(SOURCE, "buttonImage", "bitmap/new-button.gif");
  ok(result.ok);
  equal(result.text, SOURCE.replace("'bitmap/old-button.bmp'", "'bitmap/new-button.gif'"));
  const reopened = readSkin(result.text);
  ok(reopened.ok);
  equal(reopened.skin.windowImage, "bitmap/old-window.png");
  equal(reopened.skin.buttonImage, "bitmap/new-button.gif");
});

void test("refuses wrong stamp, version, missing image, unknown key, duplicate key, and invalid image references", () => {
  match(rejected(SOURCE.replace("contract: skin", "contract: actor"))[0]!, /contract.*skin/);
  match(rejected(SOURCE.replace("1.0.0-pre.1+build.2", "1.0.0-pre.2"))[0]!, /version/);
  match(rejected(SOURCE.replace("buttonImage: 'bitmap/old-button.bmp' # existing button\n", ""))[0]!, /buttonImage/);
  match(rejected(`${SOURCE}future: value\n`)[0]!, /unknown top-level key/);
  match(rejected(`${SOURCE}windowImage: bitmap/duplicate.png\n`)[0]!, /unique|duplicate|already set/);
  match(rejected(SOURCE.replace("bitmap/old-window.png", "outside/window.png"))[0]!, /windowImage/);
  match(rejected(SOURCE.replace("bitmap/old-window.png", "bitmap/window.svg"))[0]!, /windowImage/);
  for (const bad of ["bitmap/../window.png", "bitmap/./window.png", "bitmap//window.png", "bitmap/", "bitmap/a\\\\b.png", "/bitmap/window.png", "bitmapx/window.png"]) {
    match(rejected(SOURCE.replace("bitmap/old-window.png", bad))[0]!, /windowImage/, bad);
  }
});

void test("accepts nested folders and any ASCII case in the bitmap folder name and extension", () => {
  const result = readSkin(SOURCE.replace("bitmap/old-window.png", "Bitmap/Sub/Window.PNG"));
  ok(result.ok);
  equal(result.skin.windowImage, "Bitmap/Sub/Window.PNG");
  for (const bad of ["bitmap/../x.png", "bitmap/a b ", "bitmap/a\\b.png"]) ok(!setSkinImage(SOURCE, "windowImage", bad).ok, bad);
});

void test("rejects unchanged and malformed edits without changing the source", () => {
  const same = setSkinImage(SOURCE, "windowImage", "bitmap/old-window.png");
  ok(!same.ok);
  equal(same.problems[0]!.kind, "edit");
  const bad = setSkinImage(SOURCE, "buttonImage", "bitmap/button.svg");
  ok(!bad.ok);
  equal(bad.problems[0]!.kind, "edit");
  equal(readSkin(SOURCE).ok, true);
});

void test("refuses to rewrite a shared anchored reference that an alias would also change", () => {
  const shared = SOURCE.replace("windowImage: bitmap/old-window.png", "windowImage: &shared bitmap/old-window.png")
    .replace("buttonImage: 'bitmap/old-button.bmp' # existing button", "buttonImage: *shared");
  const read = readSkin(shared);
  ok(read.ok);
  equal(read.skin.buttonImage, "bitmap/old-window.png");
  const edit = setSkinImage(shared, "windowImage", "bitmap/new-window.png");
  ok(!edit.ok);
  equal(edit.problems[0]!.kind, "edit");
  match(edit.problems[0]!.message, /anchored as &shared/);
  // The button's own anchored reference is refused from the other side, too: an alias is never rewritten.
  const aliased = setSkinImage(shared.replace(/windowImage: &shared [^\n]*/, "windowImage: &shared bitmap/old-window.png"), "buttonImage", "bitmap/new-button.png");
  ok(!aliased.ok);
  match(aliased.problems[0]!.message, /cannot be safely replaced in place/);
});
