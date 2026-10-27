import {
  canon,
  canonSplitRoot,
  hashState,
  tagNonFinite,
} from "../canon/canon.ts";
import {
  createFnv1a64State,
  fnv1a64Finish,
  fnv1a64Update,
  fnv1a64UpdateAscii,
  type Fnv1a64State,
} from "../canon/fnv1a.ts";
import { applyFnvAsciiTransition, buildFnvAsciiTransition, staleFnvTransitionKeys, type FnvAsciiTransition } from "../canon/fnv1a-transition.ts";
import type { PlainData } from "../ports/plain-data.ts";
import { withoutSettings } from "../audio/model.ts";
import type { GameState } from "./state.ts";

type SurfaceHashCache = {
  before: string;
  surface: string;
  afterSurface: Fnv1a64State;
  working: Fnv1a64State;
  plan: TransitionPlan | null | false;
  transitions: Map<string, FnvAsciiTransition>;
};

const surfaceHashCaches = new WeakMap<GameState, SurfaceHashCache>();

const TRANSITION_BLOCK_SIZE = 4096;
const MAX_TRANSITION_TABLES = 2048;
type TransitionPlan = { readonly blocks: readonly string[]; cursor: number; remaining: number; evictable: string[] | null };

/** Split only once an existing surface needs hashing again. */
function transitionPlan(text: string, ascii: boolean | undefined, requireReuse: boolean, transitions: ReadonlyMap<string, FnvAsciiTransition>): TransitionPlan | false {
  if (text.length < TRANSITION_BLOCK_SIZE * 2 || ascii === false || (ascii === undefined && /[^\x00-\x7f]/.test(text))) return false;
  const blockCount = Math.ceil(text.length / TRANSITION_BLOCK_SIZE);
  // Warm common chunks first: a HUD often leaves long unchanged/blank areas
  // while its first chunk changes every frame. During canvas churn, do not
  // build tables for high-entropy data with no apparent reusable blocks.
  const samples = Math.min(16, blockCount);
  const counts = new Map<string, { count: number; index: number }>();
  let cursor = 0;
  let best = 1;
  let hasReusable = false;
  for (let i = 0; i < samples; i += 1) {
    const index = Math.floor((i + 0.5) * blockCount / samples);
    const block = text.slice(index * TRANSITION_BLOCK_SIZE, (index + 1) * TRANSITION_BLOCK_SIZE);
    if (transitions.has(block)) hasReusable = true;
    const record = counts.get(block);
    if (record === undefined) counts.set(block, { count: 1, index });
    else {
      record.count += 1;
      if (record.count > best) {
        best = record.count;
        cursor = record.index;
      }
    }
  }
  if (requireReuse && best === 1 && !hasReusable) return false;
  const blocks: string[] = [];
  for (let at = 0; at < text.length; at += TRANSITION_BLOCK_SIZE) blocks.push(text.slice(at, at + TRANSITION_BLOCK_SIZE));
  return { blocks, cursor, remaining: blocks.length, evictable: null };
}

/** Rebuild a short ASCII key from codes, not a slice of a giant state string. */
function transitionKey(block: string): string {
  const bytes = new Uint8Array(block.length);
  for (let i = 0; i < block.length; i += 1) bytes[i] = block.charCodeAt(i);
  let result = "";
  for (let i = 0; i < bytes.length; i += 1024) result += String.fromCharCode(...bytes.subarray(i, i + 1024));
  return result;
}

/** Incremental bounded preparation avoids a multi-second cold table build. */
function prepareTransition(cache: SurfaceHashCache): void {
  const plan = cache.plan;
  if (plan === null || plan === false) return;
  while (plan.remaining > 0) {
    const block = plan.blocks[plan.cursor]!;
    plan.cursor = (plan.cursor + 1) % plan.blocks.length;
    plan.remaining -= 1;
    if (cache.transitions.has(block)) continue;
    if (cache.transitions.size >= MAX_TRANSITION_TABLES) {
      plan.evictable ??= staleFnvTransitionKeys(cache.transitions, plan.blocks);
      const stale = plan.evictable.pop();
      // Every retained table is used by the current plan; keep it intact.
      if (stale === undefined) return;
      cache.transitions.delete(stale);
    }
    const key = transitionKey(block);
    cache.transitions.set(key, buildFnvAsciiTransition(block));
    return;
  }
}

function updateSurfaceHash(cache: SurfaceHashCache, text: string, ascii: boolean | undefined): void {
  if (cache.plan === false) {
    if (ascii === true) fnv1a64UpdateAscii(text, cache.afterSurface);
    else fnv1a64Update(text, cache.afterSurface);
    return;
  }
  if (cache.plan === null) {
    if (ascii === false || (ascii === undefined && /[^\x00-\x7f]/.test(text))) fnv1a64Update(text, cache.afterSurface);
    else fnv1a64UpdateAscii(text, cache.afterSurface);
    return;
  }
  for (const block of cache.plan.blocks) {
    const transition = cache.transitions.get(block);
    if (transition === undefined) fnv1a64UpdateAscii(block, cache.afterSurface);
    else applyFnvAsciiTransition(transition, cache.afterSurface);
  }
}

type CanonicalSurfaceCache = {
  metadata: string;
  bitmaps: readonly string[];
  field: string;
  ascii: boolean;
};
const canonicalSurfaces = new WeakMap<object, CanonicalSurfaceCache>();
type CanonicalBitmap = { b64: string; quoted: string; ascii: boolean };
const canonicalBitmaps = new WeakMap<object, CanonicalBitmap>();

function quotedBitmap(bitmap: object, b64: string): CanonicalBitmap {
  const cached = canonicalBitmaps.get(bitmap);
  if (cached !== undefined && cached.b64 === b64) return cached;
  const safeAscii = !/[^\x20-\x21\x23-\x5b\x5d-\x7e]/.test(b64);
  const quoted = safeAscii ? '"' + b64 + '"' : canon(b64);
  const result = { b64, quoted, ascii: safeAscii || !/[^\x00-\x7f]/.test(quoted) };
  canonicalBitmaps.set(bitmap, result);
  return result;
}

/** Reject exotic or accessor properties; the normal canonicalizer handles them. */
function dataFields(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return null;
  const fields: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return null;
    fields[key] = descriptor.value;
  }
  return fields;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function numberEntries(value: unknown): readonly (readonly [string, number])[] | null {
  const fields = dataFields(value);
  if (fields === null) return null;
  const result: Array<readonly [string, number]> = [];
  for (const key of Object.keys(fields).sort()) {
    const item = fields[key];
    if (!finite(item)) return null;
    result.push([key, item]);
  }
  return result;
}

/**
 * Reuse the canonical surface field only for its ordinary all-plain shape.
 * Metadata and each immutable b64 string are checked on every call, including
 * direct writes that do not increment rev. Other shapes use full canon.
 */
function cachedSurfaceField(value: unknown): string | undefined {
  const fields = dataFields(value);
  if (fields === null || value === null || typeof value !== "object") return undefined;
  const keys = Object.keys(fields).sort().join(",");
  if (keys !== "colours,entries,nextId,slots" && keys !== "colours,entries,nextId,renderNow,slots") return undefined;
  if (!finite(fields["nextId"]) || (Object.hasOwn(fields, "renderNow") && !finite(fields["renderNow"]))) return undefined;
  const entries = dataFields(fields["entries"]);
  const slots = numberEntries(fields["slots"]);
  const colours = numberEntries(fields["colours"]);
  if (entries === null || slots === null || colours === null) return undefined;
  const metadataEntries: unknown[] = [];
  const bitmaps: string[] = [];
  const fragments: Array<{ key: string; entry: Record<string, unknown>; bitmap: Record<string, unknown>; bitmapObject: object }> = [];
  for (const key of Object.keys(entries).sort()) {
    const entry = dataFields(entries[key]);
    if (entry === null || Object.keys(entry).sort().join(",") !== "bitmap,id,rev" || !finite(entry["id"]) || !finite(entry["rev"])) return undefined;
    const bitmap = dataFields(entry["bitmap"]);
    if (bitmap === null || Object.keys(bitmap).sort().join(",") !== "b64,h,t,w"
      || typeof bitmap["b64"] !== "string" || typeof bitmap["t"] !== "string"
      || !finite(bitmap["w"]) || !finite(bitmap["h"])) return undefined;
    const bitmapObject = entry["bitmap"];
    if (bitmapObject === null || typeof bitmapObject !== "object") return undefined;
    fragments.push({ key, entry, bitmap, bitmapObject });
    bitmaps.push(bitmap["b64"]);
    metadataEntries.push([key, entry["id"], entry["rev"], bitmap["w"], bitmap["h"], bitmap["t"]]);
  }
  const metadata = JSON.stringify([fields["nextId"], Object.hasOwn(fields, "renderNow"), fields["renderNow"] ?? null, metadataEntries, slots, colours]);
  const cached = canonicalSurfaces.get(value);
  if (cached !== undefined && cached.metadata === metadata && cached.bitmaps.length === bitmaps.length
    && bitmaps.every((bitmap, index) => bitmap === cached.bitmaps[index])) return cached.field;
  let ascii = !/[^\x00-\x7f]/.test(metadata);
  const entryFields = fragments.map(({ key, entry, bitmap, bitmapObject }) => {
    const encoded = quotedBitmap(bitmapObject, bitmap["b64"] as string);
    ascii = ascii && encoded.ascii;
    return canon(key)
      + ':{"bitmap":{"b64":' + encoded.quoted
      + ',"h":' + canon(bitmap["h"] as number) + ',"t":' + canon(bitmap["t"] as string)
      + ',"w":' + canon(bitmap["w"] as number) + '},"id":' + canon(entry["id"] as number)
      + ',"rev":' + canon(entry["rev"] as number) + '}';
  });
  const renderNow = Object.hasOwn(fields, "renderNow") ? ',"renderNow":' + canon(fields["renderNow"] as number) : "";
  const field = '"surfaces":{"colours":' + canon(fields["colours"] as PlainData)
    + ',"entries":{' + entryFields.join(",") + '},"nextId":' + canon(fields["nextId"] as number)
    + renderNow + ',"slots":' + canon(fields["slots"] as PlainData) + '}';
  canonicalSurfaces.set(value, { metadata, bitmaps, field, ascii });
  return field;
}

/**
 * The state hash of a whole game state (AD-11): `hashState` of the tree
 * without `audio.settings`. The script volume settings are not game state a
 * replay compares (docs/spec/engine/audio-media.md#audio-core-pins item 7), so
 * they never enter the hash; a snapshot still carries them.
 *
 * Canonical surface fragments are reused after checking their metadata and
 * immutable b64 values, including writes that do not increment rev. An exact
 * prefix cache skips FNV work when both the prefix and surfaces are unchanged.
 * Other shapes fall back to the ordinary canonicalizer.
 */
export function hashGameState(state: GameState): string {
  const { stepCounters: _stepCounters, ...vm } = state.vm;
  const projected = { ...state, vm, audio: withoutSettings(state.audio) };
  const tagged = tagNonFinite(projected) as PlainData;
  let ascii: boolean | undefined;
  const parts = canonSplitRoot(tagged, "surfaces", (value) => {
    const field = cachedSurfaceField(value);
    if (field !== undefined && value !== null && typeof value === "object") ascii = canonicalSurfaces.get(value)?.ascii;
    return field;
  });
  if (!parts.hasSelected) return hashState(tagged);

  let cache = surfaceHashCaches.get(state);
  if (cache === undefined) {
    cache = {
      before: "",
      surface: "",
      afterSurface: createFnv1a64State(),
      working: createFnv1a64State(),
      plan: null,
      transitions: new Map(),
    };
    surfaceHashCaches.set(state, cache);
  }

  const surfaceChanged = cache.surface !== parts.selected;
  const prefixChanged = cache.before !== parts.before;
  if (surfaceChanged) cache.plan = cache.surface === "" ? null : transitionPlan(parts.selected, ascii, true, cache.transitions);
  else if (prefixChanged && (cache.plan === null || (cache.plan === false && ascii === true))) cache.plan = transitionPlan(parts.selected, ascii, false, cache.transitions);
  if (prefixChanged || surfaceChanged) {
    cache.before = parts.before;
    cache.surface = parts.selected;
    cache.afterSurface = createFnv1a64State();
    fnv1a64Update("{", cache.afterSurface);
    if (parts.before !== "") {
      fnv1a64Update(parts.before, cache.afterSurface);
      fnv1a64Update(",", cache.afterSurface);
    }
    updateSurfaceHash(cache, parts.selected, ascii);
  }

  cache.working.high = cache.afterSurface.high;
  cache.working.low = cache.afterSurface.low;
  if (parts.after !== "") {
    fnv1a64Update(",", cache.working);
    fnv1a64Update(parts.after, cache.working);
  }
  if (prefixChanged || surfaceChanged) prepareTransition(cache);
  fnv1a64Update("}", cache.working);
  return fnv1a64Finish(cache.working);
}
