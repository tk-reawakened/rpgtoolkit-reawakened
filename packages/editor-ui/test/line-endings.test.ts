// The description row keeps every ending the file wrote while the author edits LF lines (story 13.10). The model is linear
// in the text, never pairs lines, and reads a repeated line's position from the caret.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { editLineText, lineTextOf, writtenText } from "../src/line-endings.ts";

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
