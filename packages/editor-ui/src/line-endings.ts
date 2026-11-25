/**
 * A multi-line text kept the way a file wrote it while an author edits it as LF lines (a textarea gives no other form).
 * Each line keeps the ending the file used after it, so editing one line never rewrites the others, even in a file that
 * mixes `\r\n`, `\n` and `\r`.
 *
 * Every edit is applied as one change to a range of lines. The range is read from the text before and after the edit, and
 * from where the caret was left when the editor knows it: a repeated line (`Same\r\nSame\nTail`) is ambiguous by text
 * alone, but the caret says which of the two was removed. No step compares lines pairwise: the work is linear in the text
 * for each edit, so a very long text cannot freeze the form.
 */
export interface LineText {
  /** The text with `\n` for every line break, as shown. */
  readonly text: string;
  /** The ending the file wrote after each line but the last. */
  readonly endings: readonly string[];
}

const BREAKS = /\r\n|\n|\r/g;

/** The lines of `stored` with their own endings. */
export function lineTextOf(stored: string): LineText {
  return { text: stored.replace(BREAKS, "\n"), endings: stored.match(BREAKS) ?? [] };
}

/**
 * The text as the file writes it. Two breaks stay two: an empty line between a lone `\r` and a lone `\n` would read back
 * as one `\r\n`, so the second break is written as the first was, and the line count the author sees does not change.
 */
export function writtenText(model: LineText): string {
  const lines = model.text.split("\n");
  let written = "";
  let previous = "";
  for (let index = 0; index < lines.length; index += 1) {
    if (index === lines.length - 1) { written += lines[index]!; break; }
    let ending = model.endings[index]!;
    if (lines[index] === "" && previous === "\r" && ending === "\n") ending = "\r";
    written += `${lines[index]!}${ending}`;
    previous = ending;
  }
  return written;
}

function commonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left.charCodeAt(length) === right.charCodeAt(length)) length += 1;
  return length;
}

function commonSuffix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left.charCodeAt(left.length - 1 - length) === right.charCodeAt(right.length - 1 - length)) length += 1;
  return length;
}

function lineBreaksIn(text: string, from: number, to: number): number {
  let count = 0;
  for (let at = text.indexOf("\n", from); at !== -1 && at < to; at = text.indexOf("\n", at + 1)) count += 1;
  return count;
}

interface LineEdit {
  readonly start: number;
  readonly removed: string;
  readonly inserted: string;
  readonly firstEnding: number;
  readonly removedEndings: readonly string[];
  readonly insertedEndings: readonly string[];
}

function spliceEndings(endings: readonly string[], first: number, remove: number, insert: readonly string[]): readonly string[] {
  return remove === 0 && insert.length === 0 ? endings : [...endings.slice(0, first), ...insert, ...endings.slice(first + remove)];
}

/**
 * `model` after the author changed its text to `next`. `caret` is the caret offset the editor left after the change; with
 * it, everything after the caret is taken as unchanged, which is how a deletion or an insertion of a repeated line is
 * placed where the author made it. Without it, the change is the smallest range that explains the new text.
 */
export function editLineText(model: LineText, next: string, caret?: number): LineText {
  if (next === model.text) return model;
  const edit = describeEdit(model, next, caret);
  return { text: next, endings: replayEndings(model.endings, edit, false) };
}

function describeEdit(model: LineText, next: string, caret?: number): LineEdit {
  const old = model.text;
  let suffix = commonSuffix(old, next);
  if (caret !== undefined && Number.isInteger(caret) && caret >= 0 && caret <= next.length) {
    const tail = next.length - caret;
    if (tail <= suffix) suffix = tail;
  }
  let prefix = Math.min(commonPrefix(old, next), old.length - suffix, next.length - suffix);
  let oldEnd = old.length - suffix;
  const newEnd = next.length - suffix;
  // Without a caret a pure insertion or deletion can be read at either end of the repeated characters around it (`\nB`
  // or `B\n` for the line B). Slide it forward to start at a line start when that reads the same text, so a whole line
  // added or removed is that line and not the break before it.
  if (caret === undefined && (oldEnd === prefix || newEnd === prefix)) {
    const removed = oldEnd - prefix;
    const added = newEnd - prefix;
    let at = prefix;
    while (at > 0 && old[at - 1] !== "\n") {
      const same = added === 0 ? at + removed < old.length && old[at] === old[at + removed] : at + added < next.length && next[at] === next[at + added];
      if (!same) break;
      at += 1;
    }
    if (at === 0 || old[at - 1] === "\n") { prefix = at; oldEnd = at + removed; }
  }
  const firstLine = lineBreaksIn(old, 0, prefix);
  const lastLine = firstLine + lineBreaksIn(old, prefix, oldEnd);
  const lineStart = prefix === 0 ? 0 : old.lastIndexOf("\n", prefix - 1) + 1;
  const lineEnd = old.indexOf("\n", oldEnd);
  const replacementEnd = next.length - (lineEnd === -1 ? 0 : old.length - lineEnd);
  const replacementBreaks = lineBreaksIn(next, lineStart, replacementEnd);
  const endings = model.endings;
  const kept = lastLine - firstLine;
  // The separator after the replaced lines stays in place, as does the common prefix within the changed range.
  const same = Math.min(kept, replacementBreaks);
  const fallback = endings[firstLine + same - (same > 0 ? 1 : 0)] ?? endings[firstLine - 1] ?? "\n";
  return {
    start: prefix,
    removed: old.slice(prefix, oldEnd),
    inserted: next.slice(prefix, next.length - (old.length - oldEnd)),
    firstEnding: firstLine + same,
    removedEndings: endings.slice(firstLine + same, lastLine),
    insertedEndings: Array<string>(replacementBreaks - same).fill(fallback),
  };
}

function replayEndings(endings: readonly string[], edit: LineEdit, undo: boolean): readonly string[] {
  const remove = undo ? edit.insertedEndings : edit.removedEndings;
  const insert = undo ? edit.removedEndings : edit.insertedEndings;
  return spliceEndings(endings, edit.firstEnding, remove.length, insert);
}

function withEndings(edit: LineEdit, before: readonly string[], after: readonly string[]): LineEdit {
  let first = 0;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (first < oldEnd && first < newEnd && before[first] === after[first]) first += 1;
  while (oldEnd > first && newEnd > first && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
  return { ...edit, firstEnding: first, removedEndings: before.slice(first, oldEnd), insertedEndings: after.slice(first, newEnd) };
}

/**
 * Exact text and separator changes alongside the textarea's native history. Large descriptions do not age out of this
 * history: only the current text and the changed ranges are kept. Undo/Redo may group several browser input events, so
 * walk the changed ranges until the browser's resulting text matches. Equal texts at different positions can still have
 * different separators.
 */
export class LineHistory {
  readonly #edits: LineEdit[] = [];
  #cursor = 0;
  #line: LineText;

  constructor(stored: string) {
    this.#line = lineTextOf(stored);
  }

  get line(): LineText {
    return this.#line;
  }

  /** The caller confirmed `stored` was accepted for this state. Keep any separator changes the writer made. */
  accept(stored: string): LineText {
    const { text, endings } = this.#line;
    if (!text.includes("\n\n") || !endings.includes("\r")) return this.#line;
    const written = stored.match(BREAKS) ?? [];
    if (!written.some((ending, index) => ending !== endings[index])) return this.#line;
    // Rebase both edges of this state. Its neighbours keep their bytes and native Undo/Redo does not gain a step.
    const prior = this.#edits[this.#cursor - 1];
    if (prior !== undefined) this.#edits[this.#cursor - 1] = withEndings(prior, replayEndings(endings, prior, true), written);
    const next = this.#edits[this.#cursor];
    if (next !== undefined) this.#edits[this.#cursor] = withEndings(next, written, replayEndings(endings, next, false));
    this.#line = { text, endings: written };
    return this.#line;
  }

  /** The browser may group keystrokes. Match the resulting text in the direction of travel, not across both stacks. */
  follow(text: string, caret?: number, historyEdit?: "undo" | "redo"): LineText {
    const current = this.line;
    if (historyEdit !== undefined) {
      const undo = historyEdit === "undo";
      const step = undo ? -1 : 1;
      let candidate = current.text;
      for (let index = this.#cursor + (undo ? -1 : 0); index >= 0 && index < this.#edits.length; index += step) {
        const edit = this.#edits[index]!;
        const remove = undo ? edit.inserted : edit.removed;
        const insert = undo ? edit.removed : edit.inserted;
        candidate = candidate.slice(0, edit.start) + insert + candidate.slice(edit.start + remove.length);
        if (candidate !== text) continue;
        let endings = current.endings;
        const target = index + (undo ? 0 : 1);
        while (this.#cursor !== target) {
          if (undo) this.#cursor -= 1;
          endings = replayEndings(endings, this.#edits[this.#cursor]!, undo);
          if (!undo) this.#cursor += 1;
        }
        this.#line = { text, endings };
        return this.#line;
      }
    }
    if (current.text === text) return current;
    this.#edits.length = this.#cursor;
    const edit = describeEdit(current, text, caret);
    this.#edits.push(edit);
    this.#cursor += 1;
    this.#line = { text, endings: replayEndings(current.endings, edit, false) };
    return this.#line;
  }
}
