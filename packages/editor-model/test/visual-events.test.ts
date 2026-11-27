import { deepEqual, equal, match, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyUiEffect, compileInline, createGameState } from "@tk-reawakened/core";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { createDocumentIdentity } from "../src/identity.ts";
import { openProgramDocument, programCodec } from "../src/program-document.ts";
import {
  addShowMessage,
  addVisualTemplate,
  applyVisualEventAction,
  deleteVisualEvent,
  editShowMessage,
  editVisualCondition,
  editVisualEvent,
  moveVisualEvent,
  nudgeVisualEvent,
  placedVisualEvents,
  projectVisualProgram,
  reorderVisualEvent,
  VISUAL_EVENT_TEMPLATES,
  type VisualEventEditResult,
  type VisualProgramProjection,
} from "../src/visual-events.ts";

const bytes = (source: string): Uint8Array => Uint8Array.from(source, (character) => character.charCodeAt(0));
const sourceOf = (source: string, edit: { readonly from: number; readonly to: number; readonly text: string }): string =>
  source.slice(0, edit.from) + edit.text + source.slice(edit.to);
const applied = (source: string, result: VisualEventEditResult): string => {
  ok(result.ok, result.ok ? "" : result.reason);
  return result.ok ? sourceOf(source, result.edit) : source;
};
const eventAt = (projection: VisualProgramProjection, index: number) => {
  const card = projection.regions.filter((region) => region.type !== "opaque")[index];
  if (card === undefined) throw new Error(`expected card ${index}`);
  return card;
};

test("projects only tokenizer-bounded message sequences and preserves opaque code", () => {
  const source = '// hand-written\nmwin("Welcome.")\nwait()\nmwincls()\nvisits = visits + 1\n';
  const projection = projectVisualProgram(source);
  equal(projection.regions.length, 3);
  deepEqual(projection.regions[0], { type: "opaque", text: "// hand-written\n", from: 0, to: 16, line: 1 });
  const card = projection.regions[1]!;
  equal(card.type, "show-message");
  if (card.type === "show-message") {
    equal(card.message, "Welcome.");
    equal(applied(source, editShowMessage(projection, card.from, "Hello!")), source.replace('mwin("Welcome.")', 'mwin("Hello!")'));
    equal(applied(source, deleteVisualEvent(projection, card.from)), "// hand-written\nvisits = visits + 1\n");
  }
});

test("keeps comments, lookalikes, and continued statements opaque", () => {
  const source = '/*\nmwin("not code")\nwait()\nmwincls()\n*/\nfoo _\nmwin("continued")\nwait()\nmwincls()';
  equal(projectVisualProgram(source).regions.some((region) => region.type === "show-message"), false);
  const continued = 'x = _\ndelay(1)\nwait()\n';
  deepEqual(projectVisualProgram(continued).regions.filter((region) => region.type !== "opaque").map((region) => region.type === "event" ? region.templateId : region.type), ["wait-key"]);
});

test("treats LEX-8 backslashes as literal characters and rejects unsupported message values", () => {
  const projection = projectVisualProgram('mwin("path\\name")\nwait()\nmwincls()');
  const card = projection.regions[0]!;
  equal(card.type, "show-message");
  if (card.type === "show-message") {
    equal(card.message, "path\\name");
    equal(applied(projection.source, editShowMessage(projection, card.from, "new\\path")), 'mwin("new\\path")\nwait()\nmwincls()');
    equal(editShowMessage(projection, card.from, 'say "hi"').ok, false);
    equal(editShowMessage(projection, card.from, "two\nlines").ok, false);
    equal(editShowMessage(projection, card.from, "snowman ☃").ok, false);
  }
});

test("adds a canonical sequence as one EOF edit and refuses unsafe source", () => {
  const projection = projectVisualProgram("// keep\n");
  equal(applied(projection.source, addShowMessage(projection, "Hello")), '// keep\nmwin("Hello")\nwait()\nmwincls()\n');
  equal(addShowMessage(projectVisualProgram("", true)).ok, false);
  const malformed = projectVisualProgram("broken @ source");
  equal(malformed.lexicalError, true);
  equal(malformed.regions.length, 1);
  equal(addShowMessage(malformed).ok, false);
  equal(addShowMessage(projectVisualProgram("if (true) {\n")).ok, false);
  equal(addShowMessage(projectVisualProgram("x = 1 _\n")).ok, false);
  equal(addShowMessage(projectVisualProgram("x = 1 _")).ok, false);
  equal(addShowMessage(projectVisualProgram("// an _ is only trivia")).ok, true);
  equal(addShowMessage(projectVisualProgram("\n")).ok, true);
  equal(addShowMessage(projectVisualProgram("x = 1; y = 2 _\n")).ok, false);
  equal(addShowMessage(projectVisualProgram("x = (1")).ok, false);
});

test("refuses stale or missing card positions", () => {
  const original = projectVisualProgram('mwin("A")\nwait()\nmwincls()');
  const card = original.regions[0]!;
  const missing = projectVisualProgram('mwin("B")\nwait()\nother()');
  equal(editShowMessage(missing, card.from, "C").ok, false);
  equal(deleteVisualEvent(original, card.from + 1).ok, false);
  equal(addVisualTemplate(original, "delay", 3).ok, false);
});

test("card TextEdits preserve mixed line endings through the program codec", () => {
  const source = '// keep\r\nmwin("A")\nwait()\r\nmwincls()\r\nvisits = visits + 1';
  const read = programCodec.read(bytes(source), "Prg/test.prg");
  ok(read.ok);
  if (!read.ok) return;
  const projection = projectVisualProgram(read.value.text);
  const card = projection.regions.find((region) => region.type === "show-message");
  if (card === undefined || card.type !== "show-message") throw new Error("expected projected card");
  const change = editShowMessage(projection, card.from, "B");
  ok(change.ok);
  if (!change.ok) return;
  const next = programCodec.apply(read.value, { type: "edit-text", edits: [change.edit] });
  const written = programCodec.write(next);
  ok(written.ok);
  if (written.ok) equal(new TextDecoder("windows-1252").decode(written.value), source.replace('mwin("A")', 'mwin("B")'));
  deepEqual(projectVisualProgram(read.value.text).regions.map((region) => region.type), ["opaque", "show-message", "opaque"]);
});

test("a failed save keeps the visual edit in shared document history", async () => {
  const path = "Prg/tracer.prg";
  const source = 'mwin("before")\nwait()\nmwincls()';
  const host = createMemoryPlatformServices({ files: { [path]: bytes(source) } });
  const opened = await openProgramDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  if (!opened.ok) return;
  const doc = opened.document;
  const projection = projectVisualProgram(doc.getSnapshot().text);
  const card = projection.regions.find((region) => region.type === "show-message");
  if (card === undefined || card.type !== "show-message") throw new Error("expected projected card");
  const changed = editShowMessage(projection, card.from, "after");
  ok(changed.ok);
  if (!changed.ok) return;
  const result = doc.apply({ type: "edit-text", edits: [changed.edit], label: "Edit Show message" });
  ok(result.ok);
  if (!result.ok) return;
  equal(doc.getSnapshot().text, 'mwin("after")\nwait()\nmwincls()');
  host.failWrites({ code: "io-error", message: "disk full" });
  equal((await doc.save()).ok, false);
  equal(doc.getSnapshot().dirty, true);
  equal(doc.getSnapshot().text, 'mwin("after")\nwait()\nmwincls()');
  deepEqual(host.bytesOf(path), bytes(source));
  ok(doc.undo(result.editId).ok);
  equal(doc.getSnapshot().text, source);
});

// supported templates (TOOL-12 admission) ------------------------------------------------------------------------

test("every T-45 category has a template and each template's output reads back as the same card", () => {
  deepEqual([...new Set(VISUAL_EVENT_TEMPLATES.map((template) => template.category))].sort(),
    ["Control", "Display", "Fight", "Info", "Input", "Items", "Player", "Text", "Variables"]);
  for (const template of VISUAL_EVENT_TEMPLATES) {
    const empty = projectVisualProgram("");
    const source = applied("", addVisualTemplate(empty, template.id));
    const projection = projectVisualProgram(source);
    const cards = projection.regions.filter((region) => region.type !== "opaque");
    equal(cards.length, 1, `${template.id}: ${JSON.stringify(source)}`);
    const card = cards[0]!;
    if (template.kind === "condition") {
      equal(card.type, "condition");
      if (card.type === "condition") equal(card.condition, template.defaults[0]);
      continue;
    }
    equal(card.type, "event", template.id);
    if (card.type !== "event") continue;
    equal(card.templateId, template.id);
    deepEqual(card.values, template.defaults);
    // Saving the card unchanged is a byte-for-byte no-op: the saved form is the card's own form.
    equal(applied(source, editVisualEvent(projection, card.from, card.values)), source, template.id);
  }
});

test("all templates together generate runnable RPGCode that the fixture pins and the compiler accepts", () => {
  let source = "";
  for (const template of VISUAL_EVENT_TEMPLATES) source = applied(source, addVisualTemplate(projectVisualProgram(source), template.id));
  source = applied(source, addShowMessage(projectVisualProgram(source), "Welcome back."));
  const fixture = readFileSync(new URL("../../script-tools/test/fixtures/veb-supported-templates.prg", import.meta.url), "utf8");
  equal(fixture.replaceAll("\r\n", "\n"), source);
  const program = compileInline(source);
  deepEqual(program.notices, []);
  const projection = projectVisualProgram(source);
  equal(projection.regions.every((region) => region.type !== "opaque"), true, "nothing the builder wrote is opaque");
  equal(projection.regions.length, VISUAL_EVENT_TEMPLATES.length + 1);
});

test("typed fields refuse values the command does not accept, with a reason naming the field and unit", () => {
  const source = applied("", addVisualTemplate(projectVisualProgram(""), "text"));
  const projection = projectVisualProgram(source);
  const card = eventAt(projection, 0);
  const refuse = (values: readonly (string | number)[], pattern: RegExp): void => {
    const result = editVisualEvent(projection, card.from, values);
    equal(result.ok, false);
    if (!result.ok) ok(pattern.test(result.reason), result.reason);
  };
  refuse([0, 1, "t"], /X must be at least 1 \(font-size cells/);
  refuse([1, Number.NaN, "t"], /Y must be a number/);
  refuse([1, 1, 'a"b'], /Text must be Windows-1252 text/);
  refuse([1, 1, "snow ☃"], /Text must be Windows-1252 text/);
  refuse(["1", 1, "t"], /X must be a number/);
  refuse([1, 1], /do not match/);
  const delay = projectVisualProgram(applied("", addVisualTemplate(projectVisualProgram(""), "delay")));
  equal(editVisualEvent(delay, eventAt(delay, 0).from, [-1]).ok, false);
  const fight = projectVisualProgram(applied("", addVisualTemplate(projectVisualProgram(""), "fight")));
  equal(editVisualEvent(fight, eventAt(fight, 0).from, [1.5, "a.bkg"]).ok, false, "skill is a whole number");
  equal(editVisualEvent(fight, eventAt(fight, 0).from, [1, "   "]).ok, false, "an asset reference cannot be blank");
  const assign = projectVisualProgram(applied("", addVisualTemplate(projectVisualProgram(""), "set-variable")));
  equal(editVisualEvent(assign, eventAt(assign, 0).from, ["9lives", 1]).ok, false);
  equal(applied(assign.source, editVisualEvent(assign, eventAt(assign, 0).from, ["hp", -2.5])), "hp = -2.5");
  const size = projectVisualProgram(applied("", addVisualTemplate(projectVisualProgram(""), "font-size")));
  equal(editVisualEvent(size, eventAt(size, 0).from, [300]).ok, false);
});

test("asset fields carry the folder kind and extensions the shared picker needs", () => {
  const bitmap = VISUAL_EVENT_TEMPLATES.find((template) => template.id === "bitmap")!;
  equal(bitmap.fields[0]!.type, "asset");
  equal(bitmap.fields[0]!.asset?.kind, "bitmaps");
  const fight = VISUAL_EVENT_TEMPLATES.find((template) => template.id === "fight")!;
  equal(fight.fields[1]!.asset?.kind, "backgrounds");
  const item = VISUAL_EVENT_TEMPLATES.find((template) => template.id === "give-item")!;
  deepEqual(item.fields[0]!.asset, { kind: "items", extensions: [".itm"] });
  const projection = projectVisualProgram('bitmap("Sub\\pic.png")\n');
  equal(eventAt(projection, 0).type, "event");
  equal(projectVisualProgram('bitmap("")\n').regions.some((region) => region.type === "event"), false);
});

// conditions and waits ---------------------------------------------------------------------------------------------

test("a simple condition edits its header only and keeps the body, and an else chain stays opaque", () => {
  const source = '// a\nif (gold > 10) {\n    mwin("Rich")  // body\n    x = 1\n}\ndelay(2)\n';
  const projection = projectVisualProgram(source);
  const condition = eventAt(projection, 0);
  equal(condition.type, "condition");
  if (condition.type !== "condition") return;
  equal(condition.condition, "gold > 10");
  equal(condition.body, '    mwin("Rich")  // body\n    x = 1\n');
  equal(applied(source, editVisualCondition(projection, condition.from, 'name == "Ada"')), source.replace("gold > 10", 'name == "Ada"'));
  equal(editVisualCondition(projection, condition.from, "gold > 10 && x").ok, false);
  equal(editVisualCondition(projection, condition.from, "a\n== 1").ok, false);
  equal(editVisualCondition(projection, condition.from, 'a == "☃"').ok, false);
  const single = projectVisualProgram("if (i == 1) {\n}\n");
  equal(applied(single.source, editVisualCondition(single, 0, "j == 2")), "if (j == 2) {\n}\n");
  equal(applied(source, deleteVisualEvent(projection, condition.from)), "// a\ndelay(2)\n");
  const chain = projectVisualProgram("if (x == 1) {\n    a()\n}\nelse {\n    b()\n}\n");
  equal(chain.regions.every((region) => region.type === "opaque"), true);
  const nested = projectVisualProgram("function f() {\n    delay(1)\n    if (x == 1) {\n    }\n}\n");
  equal(nested.regions.every((region) => region.type === "opaque"), true, "only top-level statements become cards");
});

test("a wait card and a delay card edit as typed cards and keep indentation", () => {
  const source = "  delay(2)\nwait()\n";
  const projection = projectVisualProgram(source);
  equal(applied(source, editVisualEvent(projection, 0, [3.5])), "  delay(3.5)\nwait()\n");
  const wait = eventAt(projection, 1);
  equal(wait.type === "event" && wait.templateId, "wait-key");
  equal(applied(source, deleteVisualEvent(projection, wait.from)), "  delay(2)\n");
});

// order, insertion and opaque preservation -------------------------------------------------------------------------

test("reorder swaps adjacent cards, keeps the last line unterminated, and never crosses opaque code", () => {
  const source = 'delay(1)\nwait()\n// note\nfight(1, "a.bkg")\nbitmap("t.png")';
  const projection = projectVisualProgram(source);
  equal(applied(source, reorderVisualEvent(projection, eventAt(projection, 0).from, "down")), 'wait()\ndelay(1)\n// note\nfight(1, "a.bkg")\nbitmap("t.png")');
  equal(applied(source, reorderVisualEvent(projection, eventAt(projection, 3).from, "up")), 'delay(1)\nwait()\n// note\nbitmap("t.png")\nfight(1, "a.bkg")');
  equal(reorderVisualEvent(projection, eventAt(projection, 1).from, "down").ok, false, "opaque comment lies between");
  equal(reorderVisualEvent(projection, eventAt(projection, 0).from, "up").ok, false, "nothing above the first card");
  const sequence = projectVisualProgram('mwin("A")\nwait()\nmwincls()\ndelay(1)\n');
  const mixed = reorderVisualEvent(sequence, 0, "down");
  equal(mixed.ok, false, "a three-line card cannot swap with a one-line card: line endings follow the line");
  if (!mixed.ok) match(mixed.reason, /same number of lines/);
  const block = projectVisualProgram("if (a == 1) {\n    b()\n}\ndelay(1)\n");
  equal(reorderVisualEvent(block, 0, "down").ok, false, "a block never swaps with a one-line card");
  const equalLines = projectVisualProgram('delay(1)\ngetgp(gold)\n');
  equal(applied(equalLines.source, reorderVisualEvent(equalLines, 0, "down")), "getgp(gold)\ndelay(1)\n");
});

test("a card's identity is its own statement text, so only its own edit renames it", () => {
  const ids = (source: string): readonly string[] =>
    projectVisualProgram(source).regions.filter((region) => region.type === "event").map((region) => region.type === "event" ? region.id : "");
  equal(ids('text(2, 2, "A")\n')[0] === ids('text(3, 2, "A")\n')[0], false, "its own placement edit is a new identity; the pane matches the card by offset and command instead");
  equal(ids('text(2, 2, "A")\n')[0], ids('delay(1)\ntext(2, 2, "A")\n')[1], "an insert of another command does not rename it");
  equal(ids('text(2, 2, "A")\n')[0], ids('text(9, 9, "B")\ntext(2, 2, "A")\n')[1], "nor does a same-command card with other text");
  equal(ids('text(2, 2, "A")\n')[0] === ids('text(2, 2, "A")\ntext(2, 2, "A")\n')[0], false, "an identical neighbour changes the count, so the survivor is a new card");
});

test("an elseif chain is never one card: removing it must not delete another branch", () => {
  const chain = 'if (a == 1) {\n    one()\n}\nelseif (b == 2) {\n    two()\n}\n';
  equal(projectVisualProgram(chain).regions.some((region) => region.type === "condition"), false);
  const braced = 'if (a == 1) {\n    one()\n}\nelse {\n    two()\n}\n';
  equal(projectVisualProgram(braced).regions.some((region) => region.type === "condition"), false);
  const lone = projectVisualProgram('if (a == 1) {\n    one()\n}\n');
  equal(lone.regions.some((region) => region.type === "condition"), true, "a lone if is still a card");
});

test("an empty condition body covers two lines, so an unequal swap with it is refused", () => {
  const empty = projectVisualProgram('if (a == 1) {\n}\ndelay(1)\n');
  const card = empty.regions.find((region) => region.type === "condition");
  if (card === undefined || card.type !== "condition") throw new Error("expected a condition card");
  equal(reorderVisualEvent(empty, card.from, "down").ok, false, "two lines cannot swap with one");
  const withMessage = projectVisualProgram('if (a == 1) {\n}\nmwin("x")\nwait()\nmwincls()\n');
  const block = withMessage.regions.find((region) => region.type === "condition");
  if (block === undefined) throw new Error("expected a condition card");
  equal(reorderVisualEvent(withMessage, block.from, "down").ok, false, "an empty body is two lines, not three");
  const pair = 'if (a == 1) {\r\n}\r\nif (b == 2) {\r\n}\r\n';
  const read = programCodec.read(bytes(pair), "Prg/blocks.prg");
  ok(read.ok);
  if (!read.ok) return;
  const projection = projectVisualProgram(read.value.text);
  const first = projection.regions.find((region) => region.type === "condition");
  if (first === undefined) throw new Error("expected two condition cards");
  const swap = reorderVisualEvent(projection, first.from, "down");
  ok(swap.ok, swap.ok ? "" : swap.reason);
  if (!swap.ok) return;
  const written = programCodec.write(programCodec.apply(read.value, { type: "edit-text", edits: [swap.edit] }));
  ok(written.ok);
  if (written.ok) equal(new TextDecoder("windows-1252").decode(written.value), 'if (b == 2) {\r\n}\r\nif (a == 1) {\r\n}\r\n', "equal line counts keep every line ending");
});

test("a statement that continues from the line above never owns a card", () => {
  // The parser owns "\`gold = …\`" as one statement, so its second line is not a card of its own.
  const continued = 'gold =\n  getgp(gold)\ndelay(1)\n';
  const projection = projectVisualProgram(continued);
  deepEqual(projection.regions.filter((region) => region.type === "event").map((region) => region.type === "event" ? region.templateId : ""), ["delay"]);
  equal(deleteVisualEvent(projection, projection.source.indexOf("getgp")).ok, false);
  const parenthesised = 'bitmap(\n  "t.png")\nwait()\n';
  deepEqual(projectVisualProgram(parenthesised).regions.filter((region) => region.type === "event").length, 1);
});

test("a quoted parenthesis and a leading-dot number are recognised conditions and round-trip", () => {
  const source = 'if (name == "(x)") {\n    b()\n}\n';
  const projection = projectVisualProgram(source);
  const card = projection.regions.find((region) => region.type === "condition");
  if (card === undefined || card.type !== "condition") throw new Error("expected a condition card");
  equal(card.condition, 'name == "(x)"');
  const single = projectVisualProgram('if (a > 0.5) {\n}\n');
  const singleCard = single.regions.find((region) => region.type === "condition");
  if (singleCard === undefined || singleCard.type !== "condition") throw new Error("expected a condition card");
  equal(applied(single.source, editVisualCondition(single, singleCard.from, 'name == "(y)"')), 'if (name == "(y)") {\n}\n');
  // `.5` is not RPGCode source (the lexer reads `.` as a member operator), so neither side may accept it.
  equal(projectVisualProgram('if (a > .5) {\n}\n').regions.some((region) => region.type === "condition"), false);
  equal(editVisualCondition(single, singleCard.from, "a > .5").ok, false);
  equal(projectVisualProgram('if (a > 0.5) {}\n').regions.some((region) => region.type === "condition"), false, "a one-line block is not a card");
});

test("a reserved word or a command name is never an assignment card", () => {
  for (const source of ["true = 1\n", "delay = 1\n", "wait = 2\n", "null = 0\n", "if = 3\n"]) {
    equal(projectVisualProgram(source).regions.some((region) => region.type === "event"), false, JSON.stringify(source));
  }
  equal(applied("hp = 1\n", editVisualEvent(projectVisualProgram("hp = 1\n"), 0, ["hp", 5])), "hp = 5\n");
});

test("a command is inserted before a chosen card or at the program start without touching other lines", () => {
  const source = "// top\ndelay(1)\n// tail\n";
  const projection = projectVisualProgram(source);
  const card = eventAt(projection, 0);
  equal(applied(source, addVisualTemplate(projection, "wait-key", card.from)), "// top\nwait()\ndelay(1)\n// tail\n");
  equal(applied(source, addVisualTemplate(projection, "wait-key", 0)), "wait()\n// top\ndelay(1)\n// tail\n");
  equal(applied(source, addShowMessage(projection, "Hi", card.from)), '// top\nmwin("Hi")\nwait()\nmwincls()\ndelay(1)\n// tail\n');
  equal(addVisualTemplate(projection, "wait-key", 3).ok, false, "mid-comment offset");
  equal(applied(source, applyVisualEventAction(projection, { type: "add-template", templateId: "delay" })), "// top\ndelay(1)\n// tail\ndelay(1)\n");
  equal(addVisualTemplate(projection, "unknown").ok, false);
});

test("edits, moves, reorders and deletes change only the touched card; opaque bytes are identical", () => {
  const opaque1 = "// intro\r\nfunction greet(n) {\r\n  delay(9)\r\n}\r\n";
  const opaque2 = "visits = visits + 1 // keep me\r\nx = _\r\n  2\r\n";
  const read = programCodec.read(bytes(`${opaque1}text(2, 3, "HP")\r\ndelay(1)\r\n${opaque2}wait()\r\n`), "Prg/x.prg");
  ok(read.ok);
  if (!read.ok) return;
  const text = read.value.text;
  const projection = projectVisualProgram(text);
  const opaqueTexts = projection.regions.filter((region) => region.type === "opaque").map((region) => region.text);
  equal(opaqueTexts.length, 2);
  const results = [
    moveVisualEvent(projection, eventAt(projection, 0).from, 9, 4),
    nudgeVisualEvent(projection, eventAt(projection, 0).from, 1, 0),
    editVisualEvent(projection, eventAt(projection, 1).from, [5]),
    reorderVisualEvent(projection, eventAt(projection, 0).from, "down"),
    deleteVisualEvent(projection, eventAt(projection, 2).from),
    addVisualTemplate(projection, "fight", eventAt(projection, 2).from),
  ];
  for (const result of results) {
    const after = applied(text, result);
    for (const kept of opaqueTexts) ok(after.includes(kept), `opaque source survives byte for byte: ${JSON.stringify(kept)}`);
    deepEqual(projectVisualProgram(after).regions.filter((region) => region.type === "opaque").map((region) => region.text), opaqueTexts);
  }
  equal(text.includes("\r"), false, "the model works on LF-only text; the codec restores each line's own ending");
});

// canvas placement -----------------------------------------------------------------------------------------------------

test("placement reads and edits a card's own coordinates and a fontsize card sets the cell", () => {
  const source = 'text(2, 3, "HP")\nfontsize(16)\ntext(2, 3, "HP")\npixeltext(40, 50, "px")\nbitmap("t.png")\n';
  const projection = projectVisualProgram(source);
  const placed = placedVisualEvents(projection);
  deepEqual(placed.map((item) => [item.label, item.x, item.y, item.cell, item.pixelX, item.pixelY, item.text]), [
    ["Draw text", 2, 3, 8, 8, 16, "HP"],
    ["Draw text", 2, 3, 16, 16, 32, "HP"],
    ["Draw text at pixels", 40, 50, 1, 40, 50, "px"],
  ]);
  const first = placed[0]!;
  equal(applied(source, nudgeVisualEvent(projection, first.from, 1, 0)), source.replace('text(2, 3, "HP")', 'text(3, 3, "HP")'), "one column right, as TOOL-12's example");
  equal(nudgeVisualEvent(projection, first.from, 0, -10).ok, false, "range: the first row is 1");
  equal(nudgeVisualEvent(projection, first.from, -10, 0).ok, false, "range: the first cell is 1");
  equal(applied(source, nudgeVisualEvent(projection, placed[2]!.from, -10, 10)), source.replace("pixeltext(40, 50", "pixeltext(30, 60"));
  equal(applied(source, moveVisualEvent(projection, first.from, 2.5, 3)), source.replace('text(2, 3, "HP")', 'text(2.5, 3, "HP")'));
  equal(moveVisualEvent(projection, eventAt(projection, 4).from, 1, 1).ok, false, "a bitmap has no screen position");
});

test("the placement a canvas edit generates draws where the card says, through the real text command", () => {
  const source = 'fontsize(18)\ntext(2, 3, "HP")\n';
  const projection = projectVisualProgram(source);
  const moved = applied(source, nudgeVisualEvent(projection, eventAt(projection, 1).from, 1, 0));
  equal(moved, 'fontsize(18)\ntext(3, 3, "HP")\n');
  const run = (program: string) => {
    const state = createGameState({ seed: 0 });
    for (const line of program.trim().split("\n")) {
      const fontsize = /^fontsize\((\d+)\)$/.exec(line);
      const draw = /^text\(([\d.]+), ([\d.]+), "(.*)"\)$/.exec(line);
      if (fontsize !== null) applyUiEffect(state, "fontsize", [Number(fontsize[1])]);
      if (draw !== null) applyUiEffect(state, "text", [Number(draw[1]), Number(draw[2]), draw[3]!]);
    }
    return (state.ui.draws ?? []).map((entry) => [entry.x, entry.y]);
  };
  deepEqual(run(source), [[18, 36]]);
  deepEqual(run(moved), [[36, 36]]);
  const [placed] = placedVisualEvents(projectVisualProgram(moved));
  deepEqual([placed!.pixelX, placed!.pixelY], [36, 36], "the canvas and the engine agree on the origin");
});

test("a canvas edit is one undo step in the shared document and restores the same program text", async () => {
  const path = "Prg/layout.prg";
  const source = '// keep\ntext(2, 3, "HP")\n';
  const host = createMemoryPlatformServices({ files: { [path]: bytes(source) } });
  const opened = await openProgramDocument(host.fs, createDocumentIdentity("memory-project", path));
  ok(opened.ok);
  if (!opened.ok) return;
  const doc = opened.document;
  const projection = projectVisualProgram(doc.getSnapshot().text);
  const change = nudgeVisualEvent(projection, eventAt(projection, 0).from, 10, 1);
  ok(change.ok);
  if (!change.ok) return;
  const result = doc.apply({ type: "edit-text", edits: [change.edit], label: "Nudge visual event" });
  ok(result.ok);
  if (!result.ok) return;
  equal(doc.getSnapshot().text, '// keep\ntext(12, 4, "HP")\n');
  ok(doc.undo(result.editId).ok);
  equal(doc.getSnapshot().text, source);
  equal(doc.getSnapshot().dirty, false);
});
