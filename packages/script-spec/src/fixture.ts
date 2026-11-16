/**
 * The fixture definition of a creator test (TOOL-5 creator-test operations,
 * docs/spec/engine/rpgcode-tooling.md#tool-5-creator-api). This module reads the RPGCode dictionary into plain data
 * and enforces every type, limit and path rule the accepted contract states; nothing here touches the engine.
 */

/** A failure that becomes the located native error `spec.bad-fixture` (or `spec.fixture-load` when a file is missing). */
export class FixtureError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "FixtureError";
    this.code = code;
  }
}

export type FixtureStart = { readonly x: number; readonly y: number; readonly layer: number };

/** A validated fixture definition: exactly what the contract names, with its limits already applied. */
export type FixtureDefinition = {
  readonly board: string;
  readonly party: readonly string[];
  readonly start: FixtureStart;
  readonly facing: string | null;
  readonly stats: Readonly<Record<string, number>>;
  readonly inventory: Readonly<Record<string, number>>;
  readonly gold: number;
  readonly variables: Readonly<Record<string, number | string>>;
  readonly seed: number | null;
  readonly files: readonly string[];
};
export type FixtureDeclaration = {
  readonly group: number;
  readonly definition: FixtureDefinition;
  readonly line: number;
  readonly column: number;
};

const FACINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const STAT_KEYS = ["hp", "maxhp", "smp", "maxsmp", "fp", "dp"] as const;
const KEYS = new Set(["board", "party", "x", "y", "layer", "facing", "stats", "inventory", "gold", "variables", "seed", "files"]);
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}[!$]?$/;
const MAX_JSON = 16 * 1024;

/** The plain-data value a fixture definition may hold, as the native reads it out of the RPGCode dictionary. */
export type Plain = number | string | boolean | null | readonly Plain[] | { readonly [key: string]: Plain };

function bad(message: string): never {
  throw new FixtureError("spec.bad-fixture", `specFixture: ${message}`);
}

/** A project path as the fixture rules allow it: `/` or `\`, no drive, no leading separator, no `..` segment. */
export function fixturePath(value: unknown, what: string, extension: string | null = null): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) bad(`${what} must be a path of 1 to 255 characters`);
  const text = value.replaceAll("\\", "/");
  if (/^[A-Za-z]:/.test(text) || text.startsWith("/")) bad(`${what} must be relative to the project folder`);
  if (text.split("/").some((part) => part === ".." || part === "")) bad(`${what} must not contain ".." or an empty segment`);
  if (/["\r\n\u0000]/.test(text)) bad(`${what} contains a character the fixture cannot represent`);
  if (extension !== null && !text.toLowerCase().endsWith(extension)) bad(`${what} must end ${extension}`);
  return text;
}

function whole(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    bad(`${what} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function record(value: unknown, what: string): Record<string, Plain> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) bad(`${what} must be a dictionary`);
  return value as Record<string, Plain>;
}

/** A bounded list (a dictionary holding `length` and `"0"`…`"<length - 1>"`) as an array. */
export function listEntries(value: unknown, what: string, maxLength = 256): readonly Plain[] {
  const members = record(value, what);
  const length = members["length"];
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maxLength) bad(`${what} must be a list of at most ${maxLength} entries`);
  const entries: Plain[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = members[String(index)];
    if (entry === undefined) bad(`${what} must be a list`);
    entries.push(entry);
  }
  return entries;
}


/** Validate one fixture definition read from the RPGCode dictionary (plain data, no snapshot text). */
export function readFixture(input: unknown): FixtureDefinition {
  const definition = record(input, "the definition");
  for (const key of Object.keys(definition)) {
    if (!KEYS.has(key)) bad(`"${key}" is not a fixture field`);
  }
  if (typeof input === "object" && input !== null && new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_JSON) bad(`the definition is over ${MAX_JSON} bytes`);
  const board = fixturePath(definition["board"], "board", ".brd");
  const party = listEntries(definition["party"], "party", 5).map((member) => fixturePath(member, "a party member", ".tem"));
  if (party.length === 0) bad("party must hold 1 to 5 character files");
  const folded = new Set(party.map((member) => member.toLowerCase()));
  const start: FixtureStart = {
    x: whole(definition["x"], "x", 0, 1_000_000),
    y: whole(definition["y"], "y", 0, 1_000_000),
    layer: definition["layer"] === undefined ? 1 : whole(definition["layer"], "layer", 1, 1_000_000),
  };
  let facing: string | null = null;
  if (definition["facing"] !== undefined) {
    const text = typeof definition["facing"] === "string" ? definition["facing"].toUpperCase() : "";
    if (!FACINGS.includes(text as (typeof FACINGS)[number])) bad(`facing must be one of ${FACINGS.join(", ")}`);
    facing = text;
  }
  const stats: Record<string, number> = {};
  if (definition["stats"] !== undefined) {
    const members = record(definition["stats"], "stats");
    const names = Object.keys(members);
    if (names.length > 6) bad("stats holds at most 6 entries");
    for (const name of names) {
      if (!STAT_KEYS.includes(name as (typeof STAT_KEYS)[number])) bad(`"${name}" is not a stat`);
      stats[name] = whole(members[name], `stats.${name}`, 0, 1_000_000);
    }
  }
  const inventory: Record<string, number> = Object.create(null) as Record<string, number>;
  if (definition["inventory"] !== undefined) {
    const members = record(definition["inventory"], "inventory");
    const names = Object.keys(members);
    if (names.length > 32) bad("inventory holds at most 32 entries");
    for (const name of names) inventory[fixturePath(name, "an inventory item")] = whole(members[name], `inventory.${name}`, 1, 99);
  }
  const gold = definition["gold"] === undefined ? 0 : whole(definition["gold"], "gold", 0, 1_000_000);
  const variables: Record<string, number | string> = {};
  if (definition["variables"] !== undefined) {
    const members = record(definition["variables"], "variables");
    const names = Object.keys(members);
    if (names.length > 64) bad("variables holds at most 64 entries");
    for (const name of names) {
      if (!VARIABLE_NAME.test(name)) bad(`"${name}" is not a variable name`);
      const value = members[name];
      if (typeof value === "string") {
        if (value.length > 255) bad(`variables.${name} is over 255 characters`);
        if (name.endsWith("!")) bad(`variables.${name} must hold a number`);
        variables[name] = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        if (name.endsWith("$")) bad(`variables.${name} must hold a string`);
        variables[name] = value;
      } else {
        bad(`variables.${name} must be a finite number or a string`);
      }
    }
  }
  const seed = definition["seed"] === undefined ? null : whole(definition["seed"], "seed", 0, 4_294_967_295);
  const files = definition["files"] === undefined ? [] : listEntries(definition["files"], "files").map((file) => fixturePath(file, "a files entry"));
  if (new Set(files.map((file) => file.toLowerCase())).size !== files.length) bad("files entries must be distinct");
  return { board, party, start, facing, stats, inventory, gold, variables, seed, files };
}

