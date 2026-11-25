// The description row keeps every ending the file wrote while the author edits LF lines (story 13.10). The model is linear
// in the text, never pairs lines, and reads a repeated line's position from the caret.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { editLineText, LineHistory, lineTextOf, writtenText } from "../src/line-endings.ts";

const through = (stored: string, typed: string, caret?: number): string => writtenText(editLineText(lineTextOf(stored), typed, caret));

test("inserting, replacing and deleting lines keeps every other separator as the file wrote it", () => {
  equal(through("One\r\nTwo", "One\nInserted\nTwo"), "One\r\nInserted\r\nTwo", "an inserted line copies its neighbour's ending");
  equal(through("A\r\nB\nC", "X\nB\nC"), "X\r\nB\nC", "a replaced line keeps the separator it had");
  equal(through("A\r\nB\nC", "A\nC"), "A\r\nC", "deleting a line leaves the others' separators");
  equal(through("A\r\nB\nC", "A\nB\nZ"), "A\r\nB\nZ", "the last line keeps its absence of a separator");
  equal(through("A\r\nB\nC", "A\nB\nC\nD"), "A\r\nB\nC\nD", "a line added at the end copies the last ending");
  equal(through("one", "one\ntwo"), "one\ntwo", "a text without any ending gains a plain one");
  equal(through("A\rB", "A\nX\nB"), "A\rX\rB", "a lone carriage return is an ending too");
});

test("a repeated line is placed where the caret says the author edited (Same\\r\\nSame\\nTail)", () => {
  equal(through("Same\r\nSame\nTail", "Same\nTail", 0), "Same\nTail", "the first Same was deleted: the survivor keeps its own ending");
  equal(through("Same\r\nSame\nTail", "Same\nTail", 5), "Same\r\nTail", "the second Same was deleted: the first keeps its ending");
  equal(through("Same\r\nSame\nTail", "Same\nSame\nSame\nTail", 5), "Same\r\nSame\r\nSame\nTail", "a line inserted after the first Same copies that ending");
  equal(through("Same\r\nSame\nTail", "Same\nSame\nSame\nTail", 0), "Same\r\nSame\r\nSame\nTail", "an insertion at the very start copies the first ending");
});

test("every edit keeps the endings matched to the lines, over many random changes of a mixed text", () => {
  let seed = 7;
  const random = (limit: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % limit; };
  const words = ["Same", "x", "", "Tail", "ab"];
  const endings = ["\r\n", "\n", "\r"];
  let stored = "";
  for (let line = 0; line < 12; line += 1) stored += `${words[random(words.length)]}${line === 11 ? "" : endings[random(3)]}`;
  let model = lineTextOf(stored);
  for (let step = 0; step < 400; step += 1) {
    const text = model.text;
    const at = random(text.length + 1);
    const cut = random(Math.min(6, text.length - at + 1));
    const insert = ["", "q", "\n", "Same\n", "ab\ncd"][random(5)]!;
    const next = text.slice(0, at) + insert + text.slice(at + cut);
    model = editLineText(model, next, random(2) === 0 ? at + insert.length : undefined);
    equal(model.text, next);
    equal(model.endings.length, next.split("\n").length - 1, `an ending for every line but the last at step ${step}`);
    equal(lineTextOf(writtenText(model)).text, next, "written back it reads as the same text");
  }
});

test("a very long mixed text is edited without a pairwise comparison of its lines", () => {
  const lines = 30_000;
  let stored = "";
  for (let line = 0; line < lines; line += 1) stored += `line ${line % 7}${line === lines - 1 ? "" : line % 3 === 0 ? "\r\n" : "\n"}`;
  const model = lineTextOf(stored);
  const started = performance.now();
  const typed = model.text.split("\n");
  typed[15_000] = "changed";
  const edited = editLineText(model, typed.join("\n"));
  const dropped = editLineText(edited, typed.filter((_, index) => index !== 100).join("\n"), model.text.split("\n").slice(0, 100).join("\n").length + 1);
  const uniform = editLineText(lineTextOf("Same\n".repeat(30_000)), `${"Same\n".repeat(29_999)}changed\nSame`);
  const elapsed = performance.now() - started;
  ok(elapsed < 1_500, `three edits of 30000 lines took ${Math.round(elapsed)} ms`);
  equal(edited.endings.length, lines - 1);
  equal(edited.endings[15_000], stored.split(/\r\n|\n/)[15_000] === undefined ? "" : model.endings[15_000], "the replaced line keeps its own ending");
  equal(dropped.endings.length, lines - 2);
  deepEqual(uniform.endings.slice(-2), ["\n", "\n"]);
});

test("two breaks stay two: an emptied line between a lone CR and a lone LF does not read back as one CRLF", () => {
  const model = lineTextOf("A\rB\nC");
  const emptied = editLineText(model, "A\n\nC");
  const written = writtenText(emptied);
  equal(written, "A\r\rC", "the second break is written like the first");
  equal(lineTextOf(written).text, "A\n\nC", "three lines read back as three lines");
  equal(through("A\rB\nC", "A\nC"), "A\rC", "deleting the whole line keeps the first break as it was");
  equal(writtenText(editLineText(lineTextOf("A\r\n\nC"), "A\n\nC")), "A\r\n\nC", "a genuine CRLF followed by an empty line is left alone");
});

test("an Undo back to the stored text restores that text's own endings", () => {
  const history = new LineHistory("A\r\nB\nC");
  const deleted = history.follow("AB\nC", 1);
  equal(writtenText(deleted), "AB\nC", "the surviving break is the one that was after B");
  const undone = history.follow("A\nB\nC", 1, "undo");
  equal(writtenText(undone), "A\r\nB\nC", "the bytes the file held, not rebuilt from the deletion");
  equal(writtenText(new LineHistory("A\r\nB\nC").follow("A\nB\nC")), "A\r\nB\nC", "a text that did not change keeps the stored endings");
});

test("undo and redo distinguish recurring displayed text by their positions", () => {
  const history = new LineHistory("A\r\nB\nC");
  history.follow("A\nB\nCx", 6);
  history.follow("AB\nCx", 1);
  const reinserted = history.follow("A\nB\nCx", 2);
  equal(writtenText(reinserted), "A\nB\nCx");
  equal(writtenText(history.follow("AB\nCx", 1, "undo")), "AB\nCx");
  equal(writtenText(history.follow("A\nB\nCx", 6, "undo")), "A\r\nB\nCx");
  equal(writtenText(history.follow("AB\nCx", 1, "redo")), "AB\nCx");
  equal(writtenText(history.follow("A\nB\nCx", 2, "redo")), "A\nB\nCx");
});

test("grouped Undo and Redo recover mixed separators beyond the previous size-based history limit", () => {
  const tail = "x".repeat(1_100_000);
  const history = new LineHistory(`A\r\nB\n${tail}`);
  history.follow(`A\nB\n${tail}1`);
  history.follow(`AB\n${tail}1`, 1);
  history.follow(`AB\n${tail}12`);
  history.follow(`AB\n${tail}123`);
  history.follow(`AB\n${tail}1234`);
  equal(writtenText(history.follow(`A\nB\n${tail}1`, 2, "undo")), `A\r\nB\n${tail}1`, "restore an intermediate edit, not just the stored text");
  equal(writtenText(history.follow(`AB\n${tail}1234`, 1, "redo")), `AB\n${tail}1234`, "redo the deletion and the grouped typing");
});

test("accepting a rewritten separator updates only that native history position", () => {
  const history = new LineHistory("A\rB\nC");
  history.follow("A\n\nC", 2);
  history.follow("A\nX\nC", 3);
  const empty = history.follow("A\n\nC", 2, "undo");
  equal(writtenText(empty), "A\r\rC", "the writer keeps two line breaks");
  history.stage()().accept();
  deepEqual(history.line.endings, ["\r", "\r"]);
  equal(writtenText(history.follow("A\nB\nC", 3, "undo")), "A\rB\nC", "Undo restores the earlier bytes");
  deepEqual(history.follow("A\n\nC", 2, "redo").endings, ["\r", "\r"], "Redo restores the accepted breaks");
  equal(writtenText(history.follow("A\nX\nC", 3, "redo")), "A\rX\nC", "the already recorded next state keeps its bytes");
  history.follow("A\n\nC", 2, "undo");
  equal(writtenText(history.follow("A\nY\nC", 3)), "A\rY\rC", "new drafts use the accepted separators");
});

test("a queued submission inherits separators only from earlier accepted submissions", () => {
  const history = new LineHistory("A\rB\nC");
  history.follow("A\n\nC", 2);
  const blank = history.stage()();
  history.follow("A\nX\nC", 3);
  const queued = history.stage();
  equal(queued().text, "A\rX\nC", "while the blank line is not accepted, its pending encoding is not inherited");
  blank.accept();
  equal(queued().text, "A\rX\rC", "after acknowledgement the queued gesture uses the accepted separators");
  equal(writtenText(history.follow("A\n\nC", 2, "undo")), "A\r\rC");
  equal(writtenText(history.follow("A\nB\nC", 3, "undo")), "A\rB\nC");
});
