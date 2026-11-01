/**
 * The prefetch planner (docs/spec/engine/runners.md#prefetch, docs/spec/engine/audio-media.md#audio-prefetch).
 *
 * The **core** decides what a runner should fetch and decode ahead; a runner never parses a board to guess. The plan is
 * three tiers — `now`, `next`, `always` — computed from facts the engine already holds, and it is a pure function of
 * them so the same board always produces the same hints in the same order (G3).
 *
 * A hint **never blocks, never changes state, never appears in a state or draw hash and never earns a reply**
 * ([#prefetch]). The wire record is `{ kind: "prefetch", reqId, hints }` with hints `{ tier, key }`; the engine sends it
 * when a board is entered, deduplicated and only when it differs from the last plan it sent.
 *
 * What each tier holds (the table on the runner page, audio's share from `#audio-prefetch`):
 *
 * | Tier | Facts this planner reads |
 * |---|---|
 * | `now` | the current board's `backgroundMusic`; the default bank when that music is a MIDI |
 * | `next` | the music of boards reachable by the board's edge `links`; the battle background's `music`, `menuMoveSound`, `menuChooseSound`, `readySound` and `cantDoSound` |
 * | `always` | the main file's `cursorMoveSound`, `cursorSelectSound` and `cursorCancelSound`; the default bank |
 */

import type { AssetKey } from "../ports/keys.ts";

/** The three tiers the runner page names ([runners.md#prefetch]). */
export type PrefetchTier = "now" | "next" | "always";

/** One hint: a tier and the asset a runner should fetch. */
export type PrefetchHint = {
  readonly tier: PrefetchTier;
  readonly key: AssetKey;
};

/** The battle background's five sound fields (`docs/spec/formats/battle-data.md#fight-background-bkg`). */
export type BattleBackgroundSounds = {
  readonly music: string;
  readonly menuMoveSound: string;
  readonly menuChooseSound: string;
  readonly readySound: string;
  readonly cantDoSound: string;
};

/** The facts one plan is computed from, already resolved to asset keys by the caller. */
export type PrefetchFacts = {
  /** The current board's music, as a resolved key or `null` when it names nothing. */
  readonly boardMusic: AssetKey | null;
  /** Whether `boardMusic` is a MIDI, which is what makes the bank part of the `now` tier. */
  readonly boardMusicIsMidi: boolean;
  /** The music of boards reachable by edge links or a literal `send(...)`, in board order. */
  readonly linkedBoardMusic: readonly (AssetKey | null)[];
  /** The current board's battle background sounds, or `null` when the board names no background. */
  readonly battle: BattleBackgroundSounds | null;
  /** The main file's three menu sounds. */
  readonly main: {
    readonly cursorMoveSound: AssetKey | null;
    readonly cursorSelectSound: AssetKey | null;
    readonly cursorCancelSound: AssetKey | null;
  };
  /** The game's configured `defaultSoundFont`, if any. */
  readonly defaultBank: AssetKey | null;
};

const TIER_ORDER: readonly PrefetchTier[] = ["now", "next", "always"];

/**
 * Compute the plan. A key appears once, in the earliest tier it belongs to (a board's music that is also a linked
 * board's music is a `now` hint), and the list is ordered by tier, then by key, so the same facts always produce the
 * same list.
 */
export function planPrefetch(facts: PrefetchFacts): readonly PrefetchHint[] {
  const tiers: Record<PrefetchTier, Set<AssetKey>> = { now: new Set(), next: new Set(), always: new Set() };

  if (facts.boardMusic !== null) tiers.now.add(facts.boardMusic);
  if (facts.boardMusicIsMidi && facts.defaultBank !== null) tiers.now.add(facts.defaultBank);

  for (const music of facts.linkedBoardMusic) if (music !== null) tiers.next.add(music);
  if (facts.battle !== null) {
    for (const reference of [facts.battle.music, facts.battle.menuMoveSound, facts.battle.menuChooseSound, facts.battle.readySound, facts.battle.cantDoSound]) {
      if (reference !== "") tiers.next.add(reference as AssetKey);
    }
  }

  for (const sound of [facts.main.cursorMoveSound, facts.main.cursorSelectSound, facts.main.cursorCancelSound]) {
    if (sound !== null) tiers.always.add(sound);
  }
  if (facts.defaultBank !== null) tiers.always.add(facts.defaultBank);

  // Deduplicated across tiers, keeping the earliest tier a key appears in: `now` outranks `next`, which outranks
  // `always`, so a runner that fetches per tier never fetches one file twice.
  const seen = new Set<AssetKey>();
  const plan: PrefetchHint[] = [];
  for (const tier of TIER_ORDER) {
    for (const key of [...tiers[tier]].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push({ tier, key });
    }
  }
  return plan;
}

/** A hint's stable one-line form, for comparing one plan with the last plan sent. */
export function prefetchSignature(plan: readonly PrefetchHint[]): string {
  return plan.map((hint) => `${hint.tier}:${hint.key}`).join("|");
}

/** The keys of one tier, in plan order: what a consumer fetches for that tier alone. */
export function prefetchTier(plan: readonly PrefetchHint[], tier: PrefetchTier): readonly AssetKey[] {
  return plan.filter((hint) => hint.tier === tier).map((hint) => hint.key);
}
