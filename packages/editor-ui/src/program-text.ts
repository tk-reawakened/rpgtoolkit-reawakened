import type { TextChange } from "./text-surface.ts";

/** Immutable AVL rope. A revision retains a root, sharing unchanged nodes and bounded payload blocks. */
export type TextTree = TextLeaf | TextBranch | null;
interface TextLeaf {
  readonly kind: "leaf";
  readonly piece: TextPiece;
  readonly length: number;
  readonly height: number;
}
interface TextBranch {
  readonly kind: "branch";
  readonly left: Exclude<TextTree, null>;
  readonly right: Exclude<TextTree, null>;
  readonly length: number;
  readonly height: number;
}
export interface TextPiece {
  readonly id: number;
  readonly source: string;
  readonly from: number;
  readonly to: number;
}
export interface TrackedText {
  readonly root: TextTree;
  readonly text: string;
  readonly pieces: readonly TextPiece[];
}
interface DeletedRange extends PieceRange { readonly id: number; readonly next: DeletedRange | null }
export interface PendingText {
  deleted: DeletedRange | null;
  base: TrackedText;
  current: TrackedText;
}
interface PieceRange { readonly from: number; readonly to: number }
interface PiecePosition extends PieceRange { readonly index: number; readonly start: number }

const TEXT_BLOCK = 1024;
function leaf(piece: TextPiece): TextTree {
  return piece.to === piece.from ? null : { kind: "leaf", piece, length: piece.to - piece.from, height: 1 };
}
function branch(left: TextTree, right: TextTree): TextTree {
  if (left === null) return right;
  if (right === null) return left;
  return { kind: "branch", left, right, length: left.length + right.length, height: 1 + Math.max(left.height, right.height) };
}
function balance(left: Exclude<TextTree, null>, right: Exclude<TextTree, null>): TextTree {
  if (left.height > right.height + 1 && left.kind === "branch") {
    if (left.left.height >= left.right.height) return branch(left.left, branch(left.right, right));
    if (left.right.kind === "branch") return branch(branch(left.left, left.right.left), branch(left.right.right, right));
  }
  if (right.height > left.height + 1 && right.kind === "branch") {
    if (right.right.height >= right.left.height) return branch(branch(left, right.left), right.right);
    if (right.left.kind === "branch") return branch(branch(left, right.left.left), branch(right.left.right, right.right));
  }
  return branch(left, right);
}
function join(left: TextTree, right: TextTree): TextTree {
  if (left === null) return right;
  if (right === null) return left;
  if (left.height > right.height + 1 && left.kind === "branch") return balance(left.left, join(left.right, right)!);
  if (right.height > left.height + 1 && right.kind === "branch") return balance(join(left, right.left)!, right.right);
  return branch(left, right);
}
function split(root: TextTree, offset: number): [TextTree, TextTree] {
  if (root === null) return [null, null];
  if (offset <= 0) return [null, root];
  if (offset >= root.length) return [root, null];
  if (root.kind === "leaf") {
    const middle = root.piece.from + offset;
    return [leaf({ ...root.piece, to: middle }), leaf({ ...root.piece, from: middle })];
  }
  if (offset < root.left.length) {
    const [left, rest] = split(root.left, offset);
    return [left, join(rest, root.right)];
  }
  const [rest, right] = split(root.right, offset - root.left.length);
  return [join(root.left, rest), right];
}
function collect(root: TextTree, output: TextPiece[]): void {
  if (root === null) return;
  if (root.kind === "leaf") output.push(root.piece);
  else { collect(root.left, output); collect(root.right, output); }
}
function revision(root: TextTree): TrackedText {
  return {
    root,
    get pieces() { const result: TextPiece[] = []; collect(root, result); return result; },
    get text() { return textOfPieces(this.pieces); },
  };
}
function treeOf(pieces: readonly TextPiece[], from = 0, to = pieces.length): TextTree {
  if (from === to) return null;
  if (to - from === 1) return leaf(pieces[from]!);
  const middle = (from + to) >>> 1;
  return branch(treeOf(pieces, from, middle), treeOf(pieces, middle, to));
}
export function trackedText(text: string, allocate: () => number): TrackedText {
  const pieces: TextPiece[] = [];
  for (let offset = 0; offset < text.length; offset += TEXT_BLOCK) {
    // Copy each block: a sliced string must not keep a deleted multi-megabyte parent alive.
    const source = text.slice(offset, offset + TEXT_BLOCK).split("").join("");
    pieces.push({ id: allocate(), source, from: 0, to: source.length });
  }
  return revision(treeOf(pieces));
}
export function copyTracked(text: TrackedText): TrackedText { return text; }
function textOfPieces(pieces: readonly TextPiece[]): string {
  return pieces.map((piece) => piece.source.slice(piece.from, piece.to)).join("");
}
function compactPieces(pieces: TextPiece[]): void {
  let write = 0;
  for (const piece of pieces) {
    const previous = pieces[write - 1];
    if (previous !== undefined && previous.id === piece.id && previous.to === piece.from) {
      pieces[write - 1] = { ...previous, to: piece.to };
    } else { pieces[write++] = piece; }
  }
  pieces.length = write;
}
export function applyTrackedChanges(text: TrackedText, changes: readonly TextChange[], allocate: () => number, resultText?: string): TrackedText {
  let root = text.root;
  for (const change of changes) {
    const [left, tail] = split(root, change.from);
    const [, right] = split(tail, change.to - change.from);
    root = join(join(left, trackedText(change.text, allocate).root), right);
  }
  if (resultText !== undefined && (root?.length ?? 0) !== resultText.length) return trackedText(resultText, allocate);
  return revision(root);
}

/** Keep deletion identities (never payloads) through queued Undo/Redo rebases. */
export function changePendingText(pending: PendingText, changes: readonly TextChange[], allocate: () => number, resultText?: string): void {
  let current = pending.current;
  for (const change of changes) {
    const [, tail] = split(current.root, change.from);
    const [removed] = split(tail, change.to - change.from);
    const pieces: TextPiece[] = [];
    collect(removed, pieces);
    for (const piece of pieces) pending.deleted = { id: piece.id, from: piece.from, to: piece.to, next: pending.deleted };
    current = applyTrackedChanges(current, [change], allocate);
  }
  pending.current = resultText !== undefined && (current.root?.length ?? 0) !== resultText.length
    ? trackedText(resultText, allocate) : current;
}

function rangesById(pieces: readonly TextPiece[]): Map<number, PieceRange[]> {
  const ranges = new Map<number, PieceRange[]>();
  for (const piece of pieces) {
    const same = ranges.get(piece.id);
    if (same === undefined) ranges.set(piece.id, [{ from: piece.from, to: piece.to }]);
    else same.push({ from: piece.from, to: piece.to });
  }
  return ranges;
}

function positionsById(pieces: readonly TextPiece[]): Map<number, PiecePosition[]> {
  const positions = new Map<number, PiecePosition[]>();
  let start = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    const same = positions.get(piece.id);
    const position = { from: piece.from, to: piece.to, index, start };
    if (same === undefined) positions.set(piece.id, [position]);
    else same.push(position);
    start += piece.to - piece.from;
  }
  return positions;
}

function firstRangeEndingAfter(ranges: readonly PieceRange[], offset: number): number {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]!.to <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function piecePosition(piece: TextPiece, positions: ReadonlyMap<number, readonly PiecePosition[]>): number | null {
  const same = positions.get(piece.id);
  if (same === undefined) return null;
  for (let index = firstRangeEndingAfter(same, piece.from); index < same.length; index += 1) {
    const match = same[index]!;
    if (match.from >= piece.to) break;
    const from = Math.max(piece.from, match.from);
    if (from < Math.min(piece.to, match.to)) return match.start + from - match.from;
  }
  return null;
}

function intersectPieces(piece: TextPiece, ranges: readonly PieceRange[], output: TextPiece[]): void {
  for (let index = firstRangeEndingAfter(ranges, piece.from); index < ranges.length; index += 1) {
    const range = ranges[index]!;
    if (range.from >= piece.to) break;
    const from = Math.max(piece.from, range.from);
    const to = Math.min(piece.to, range.to);
    if (from < to) output.push({ ...piece, from, to });
  }
}

function missingPieceRanges(piece: TextPiece, present: readonly PieceRange[] | undefined): PieceRange[] {
  if (present === undefined || present.length === 0) return [{ from: piece.from, to: piece.to }];
  const missing: PieceRange[] = [];
  let cursor = piece.from;
  for (let index = firstRangeEndingAfter(present, piece.from); index < present.length; index += 1) {
    const range = present[index]!;
    if (range.from >= piece.to) break;
    if (range.from > cursor) missing.push({ from: cursor, to: Math.min(range.from, piece.to) });
    cursor = Math.max(cursor, range.to);
    if (cursor >= piece.to) break;
  }
  if (cursor < piece.to) missing.push({ from: cursor, to: piece.to });
  return missing;
}

/**
 * Merge edits made against a stale surface onto the current document. Piece identities distinguish repeated text and
 * preserve unchanged islands; history-inserted pieces survive unless the surface explicitly deleted their identity.
 */
export function mergePendingText(document: TrackedText, pending: PendingText): TrackedText {
  const basePieces = pending.base.pieces;
  const currentPieces = pending.current.pieces;
  const baseRanges = rangesById(basePieces);
  const currentRanges = rangesById(currentPieces);
  const pieces: TextPiece[] = [];
  for (const piece of document.pieces) {
    const base = baseRanges.get(piece.id);
    if (base === undefined) pieces.push(piece);
    else intersectPieces(piece, currentRanges.get(piece.id) ?? [], pieces);
  }
  const deleted = new Map<number, PieceRange[]>();
  for (let range = pending.deleted; range !== null; range = range.next) {
    const list = deleted.get(range.id) ?? [];
    list.push({ from: range.from, to: range.to });
    deleted.set(range.id, list);
  }
  for (const list of deleted.values()) list.sort((a, b) => a.from - b.from);
  const retained: TextPiece[] = [];
  for (const piece of pieces) {
    // Ranges can overlap after repeated history operations; subtract their union.
    let from = piece.from;
    for (const range of deleted.get(piece.id) ?? []) {
      if (range.to <= from) continue;
      if (range.from >= piece.to) break;
      if (range.from > from) retained.push({ ...piece, from, to: range.from });
      from = Math.max(from, range.to);
    }
    if (from < piece.to) retained.push({ ...piece, from });
  }
  pieces.length = 0;
  for (const piece of retained) pieces.push(piece);
  compactPieces(pieces);

  const targetPositions = positionsById(pieces);
  const targetRanges = rangesById(pieces);
  const nextAnchor = new Array<number | null>(currentPieces.length);
  let next: number | null = null;
  for (let index = currentPieces.length - 1; index >= 0; index -= 1) {
    nextAnchor[index] = next;
    const at = piecePosition(currentPieces[index]!, targetPositions);
    if (at !== null) next = at;
  }

  let targetLength = 0;
  for (const piece of pieces) targetLength += piece.to - piece.from;
  const additions = new Map<number, TextPiece[]>();
  for (let index = 0; index < currentPieces.length; index += 1) {
    const piece = currentPieces[index]!;
    const candidates = missingPieceRanges(piece, baseRanges.get(piece.id));
    for (const candidate of candidates) {
      const addition = { ...piece, from: candidate.from, to: candidate.to };
      const missing = missingPieceRanges(addition, targetRanges.get(piece.id));
      if (missing.length === 0) continue;
      const at = nextAnchor[index] ?? targetLength;
      let atPieces = additions.get(at);
      if (atPieces === undefined) {
        atPieces = [];
        additions.set(at, atPieces);
      }
      for (const range of missing) atPieces.push({ ...piece, from: range.from, to: range.to });
    }
  }

  const anchors = [...additions.keys()].sort((left, right) => left - right);
  const merged: TextPiece[] = [];
  let anchorIndex = 0;
  let offset = 0;
  for (const piece of pieces) {
    const end = offset + piece.to - piece.from;
    let cursor = offset;
    while (anchorIndex < anchors.length && anchors[anchorIndex]! <= end) {
      const anchor = anchors[anchorIndex]!;
      const at = Math.max(anchor, offset);
      if (at > cursor) merged.push({ ...piece, from: piece.from + cursor - offset, to: piece.from + at - offset });
      for (const addition of additions.get(anchor)!) merged.push(addition);
      cursor = at;
      anchorIndex += 1;
    }
    if (cursor < end) merged.push({ ...piece, from: piece.from + cursor - offset, to: piece.to });
    offset = end;
  }
  while (anchorIndex < anchors.length) {
    for (const addition of additions.get(anchors[anchorIndex]!)!) merged.push(addition);
    anchorIndex += 1;
  }
  compactPieces(merged);
  return revision(treeOf(merged));
}

/** Return compact, right-to-left replacements between two piece-identified revisions. */
export function trackedTextChanges(before: TrackedText, after: TrackedText): TextChange[] {
  if (before.text === after.text) return [];
  const afterPieces = after.pieces;
  const targetPositions = new Map<number, Array<PiecePosition & { readonly start: number }>>();
  let targetOffset = 0;
  for (let index = 0; index < afterPieces.length; index += 1) {
    const piece = afterPieces[index]!;
    const same = targetPositions.get(piece.id);
    const position = { from: piece.from, to: piece.to, index, start: targetOffset };
    if (same === undefined) targetPositions.set(piece.id, [position]);
    else same.push(position);
    targetOffset += piece.to - piece.from;
  }

  const matches: Array<{ readonly from: number; readonly to: number; readonly length: number }> = [];
  let sourceOffset = 0;
  for (const piece of before.pieces) {
    const same = targetPositions.get(piece.id);
    if (same !== undefined) {
      for (let index = firstRangeEndingAfter(same, piece.from); index < same.length; index += 1) {
        const position = same[index]!;
        if (position.from >= piece.to) break;
        const from = Math.max(piece.from, position.from);
        const to = Math.min(piece.to, position.to);
        if (from >= to) continue;
        const match = {
          from: sourceOffset + from - piece.from,
          to: position.start + from - position.from,
          length: to - from,
        };
        const previous = matches.at(-1);
        if (previous !== undefined && previous.from + previous.length === match.from && previous.to + previous.length === match.to) {
          matches[matches.length - 1] = { ...previous, length: previous.length + match.length };
        } else {
          matches.push(match);
        }
      }
    }
    sourceOffset += piece.to - piece.from;
  }

  const gaps: Array<{ readonly from: number; readonly to: number; readonly targetFrom: number; readonly targetTo: number }> = [];
  let from = 0;
  let to = 0;
  for (const match of matches) {
    if (match.from < from || match.to < to) continue;
    if (match.from > from || match.to > to) gaps.push({ from, to: match.from, targetFrom: to, targetTo: match.to });
    from = match.from + match.length;
    to = match.to + match.length;
  }
  if (from < before.text.length || to < after.text.length) {
    gaps.push({ from, to: before.text.length, targetFrom: to, targetTo: after.text.length });
  }
  return gaps.reverse().map((gap) => ({
    from: gap.from,
    to: gap.to,
    text: after.text.slice(gap.targetFrom, gap.targetTo),
  }));
}

