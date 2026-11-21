// docs/spec/formats/native-tileset.md#built-in-terrain-matcher
const BITS = { n: 1, e: 2, s: 4, w: 8, nw: 16, ne: 32, se: 64, sw: 128 } as const;
const DIAGONALS = [[9, 16], [3, 32], [6, 64], [12, 128]] as const;

type Neighbour = keyof typeof BITS;
type Variant = { readonly tile: string; readonly weight: number };
type RuleChoice = { readonly use: { readonly tile: string }; readonly variants?: never }
  | { readonly use?: never; readonly variants: readonly Variant[] };
export type TerrainRule = RuleChoice & {
  readonly id: string;
  readonly when: Readonly<Partial<Record<Neighbour, "same" | "other">>>;
};
export type TerrainRecipe = {
  readonly neighbours: "cardinal-4" | "blob-8";
  readonly coverage: "partial" | "complete";
  readonly seed?: number;
  readonly rules: readonly TerrainRule[];
};

type Weighted = { readonly variants: readonly Variant[]; readonly weight: number };
type Choice = string | Weighted;
type TerrainProblem =
  | { readonly code: "terrain-rule-ambiguous"; readonly mask: number; readonly rules: readonly [string, string] }
  | { readonly code: "terrain-rule-unsatisfiable" | "terrain-rule-invalid-weights"; readonly rule: string }
  | { readonly code: "terrain-pattern-uncovered"; readonly count: number };
export type TerrainMatcher = {
  readonly ok: true;
  readonly uncovered: number;
  readonly choose: (sameMask: number, floor: string, x: number, y: number) => string | null;
};
export type TerrainMatcherResult = TerrainMatcher | { readonly ok: false; readonly problems: readonly TerrainProblem[] };

function activeBits(cardinal: number, diagonal: boolean): number {
  let active = 15;
  if (diagonal) for (const [sides, bit] of DIAGONALS) {
    if ((cardinal & sides) === sides) active |= bit;
  }
  return active;
}

function hashU32(hash: number, value: number): number {
  for (let shift = 0; shift < 32; shift += 8) hash = Math.imul(hash ^ ((value >>> shift) & 255), 16_777_619);
  return hash;
}

function variantHash(floor: string, seed: number, x: number, y: number, mask: number): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < floor.length; i += 1) hash = Math.imul(hash ^ floor.charCodeAt(i), 16_777_619);
  hash = Math.imul(hash, 16_777_619); // separator after the ASCII floor ID
  hash = hashU32(hashU32(hashU32(hash, seed), x), y);
  return Math.imul(hash ^ mask, 16_777_619) >>> 0;
}

/** Compile once per recipe; use the same match table for validation and selection. */
export function compileTerrainMatcher(recipe: TerrainRecipe): TerrainMatcherResult {
  const diagonal = recipe.neighbours === "blob-8";
  const rules: { id: string; named: number; same: number; choice: Choice; matched: boolean }[] = [];
  const problems: TerrainProblem[] = [];
  for (const rule of recipe.rules) {
    let named = 0;
    let same = 0;
    for (const [direction, value] of Object.entries(rule.when)) {
      const bit = BITS[direction as Neighbour];
      named |= bit;
      if (value === "same") same |= bit;
    }
    let choice: Choice;
    if (rule.use !== undefined) choice = rule.use.tile;
    else {
      let weight = 0;
      for (const variant of rule.variants) {
        if (!Number.isInteger(variant.weight) || variant.weight < 1) { weight = 0; break; }
        weight += variant.weight;
      }
      if (weight === 0 || weight > 0xFFFF_FFFF) {
        problems.push({ code: "terrain-rule-invalid-weights", rule: rule.id });
        continue;
      }
      choice = { variants: rule.variants, weight };
    }
    rules.push({ id: rule.id, named, same, choice, matched: false });
  }
  const table: (Choice | undefined)[] = Array(256);
  let uncovered = 0;
  for (let mask = 0; mask < 256; mask += 1) {
    const active = activeBits(mask, diagonal);
    if ((mask & active) !== mask) continue;
    let first: (typeof rules)[number] | undefined;
    for (const rule of rules) {
      if ((rule.named & active) !== rule.named || (mask & rule.named) !== rule.same) continue;
      rule.matched = true;
      if (first === undefined) first = rule;
      else problems.push({ code: "terrain-rule-ambiguous", mask, rules: [first.id, rule.id] });
    }
    if (first === undefined) uncovered += 1;
    else table[mask] = first.choice;
  }
  for (const rule of rules) if (!rule.matched) problems.push({ code: "terrain-rule-unsatisfiable", rule: rule.id });
  if (uncovered !== 0 && recipe.coverage === "complete") problems.push({ code: "terrain-pattern-uncovered", count: uncovered });
  if (problems.length !== 0) return { ok: false, problems };

  const seed = recipe.seed ?? 0;
  return {
    ok: true, uncovered,
    choose(sameMask, floor, x, y) {
      const mask = sameMask & activeBits(sameMask, diagonal);
      const choice = table[mask];
      if (choice === undefined) return null;
      if (typeof choice === "string") return choice;
      let slot = variantHash(floor, seed, x, y, mask) % choice.weight;
      for (const variant of choice.variants) {
        if (slot < variant.weight) return variant.tile;
        slot -= variant.weight;
      }
      throw new Error("terrain matcher weight invariant violated");
    },
  };
}
