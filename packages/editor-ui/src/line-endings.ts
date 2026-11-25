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

/**
 * `model` after the author changed its text to `next`. `caret` is the caret offset the editor left after the change; with
 * it, everything after the caret is taken as unchanged, which is how a deletion or an insertion of a repeated line is
 * placed where the author made it. Without it, the change is the smallest range that explains the new text.
 */
export function editLineText(model: LineText, next: string, caret?: number): LineText {
  const old = model.text;
  if (next === old) return model;
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
  const replaced = next.slice(lineStart, next.length - (lineEnd === -1 ? 0 : old.length - lineEnd));
  const replacement = replaced.split("\n").length;
  const endings = model.endings;
  const kept = lastLine - firstLine;
  const fallback = endings[firstLine] ?? endings[firstLine - 1] ?? endings.at(-1) ?? "\n";
  const inner: string[] = [];
  for (let index = 0; index < replacement - 1; index += 1) inner.push(index < kept ? endings[firstLine + index]! : inner.at(-1) ?? fallback);
  const trailing = lastLine < endings.length ? [endings[lastLine]!] : [];
  return { text: next, endings: [...endings.slice(0, firstLine), ...inner, ...trailing, ...endings.slice(lastLine + 1)] };
}

/** The most text a history keeps (in characters); the stored version is always kept. */
const HISTORY_CHARACTERS = 4_000_000;

/**
 * A text's states while it is edited, so the author's Undo (the textarea's own, which puts back an earlier text) restores
 * the endings that text had instead of rebuilding them from the edit that followed: delete the first break of a mixed
 * description and press Ctrl+Z, and the file's original bytes come back, not a normalised copy. The history is bounded in
 * characters; the stored version is never dropped.
 */
export class LineHistory {
  readonly stored: LineText;
  #line: LineText;
  readonly #seen = new Map<string, LineText>();
  #characters = 0;

  constructor(stored: string) {
    this.stored = lineTextOf(stored);
    this.#line = this.stored;
    this.#remember(this.stored);
  }

  /** The text as last followed. */
  get line(): LineText {
    return this.#line;
  }

  /** Recover separator metadata on native Undo/Redo; ordinary edits use their own caret even if the text recurs. */
  follow(text: string, caret?: number, historyEdit = false): LineText {
    if (text === this.#line.text) return this.#line;
    const known = historyEdit ? this.#seen.get(text) : undefined;
    this.#line = known ?? editLineText(this.#line, text, caret);
    if (known === undefined && text !== this.stored.text) this.#remember(this.#line);
    return this.#line;
  }

  #remember(line: LineText): void {
    if (this.#seen.delete(line.text)) this.#characters -= line.text.length;
    this.#seen.set(line.text, line);
    this.#characters += line.text.length;
    for (const [text] of this.#seen) {
      if (this.#characters <= HISTORY_CHARACTERS || this.#seen.size <= 1) break;
      if (text === this.stored.text || text === this.#line.text) continue;
      this.#seen.delete(text);
      this.#characters -= text.length;
    }
  }
}
