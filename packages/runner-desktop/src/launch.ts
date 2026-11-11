/**
 * The player's launch resolution (entry 9.10; `docs/spec/engine/runners.md#install`).
 *
 * The order is ruled and has one implementation: `--game` or a `tkr://play` link, then `player.json` beside the
 * executable or in the application-data directory, then a package baked into the application's resources, then the
 * installed-game library. Nothing else may name a game.
 *
 * Every filesystem read is injected, so the order and its failure handling are tested without Electron, a disk or a
 * clock. `main.ts` supplies `statSync`/`readFileSync`/the library reader; the tests supply maps.
 */

import { dirname, isAbsolute, resolve } from "node:path";

/** Which rule picked the game. `library` means "nothing named one; here is the list", `none` means "and it is empty". */
export type LaunchStep = "argument" | "deep-link" | "config" | "baked" | "library" | "none";

/** One row the fallback view needs. The full entry carries hashes and settings; the listing does not. */
export type LibraryRow = {
  readonly gameId: string;
  readonly title: string;
  readonly version: string;
  readonly lastPlayedAt: string | null;
};

export type LaunchResolution =
  | { readonly step: "argument" | "deep-link" | "config" | "baked"; readonly path: string }
  | { readonly step: "library"; readonly rows: readonly LibraryRow[] }
  | { readonly step: "none"; readonly reason: string };

export type LaunchInputs = {
  /** `process.argv`; a deep link delivered by the OS is appended by the caller when it arrives. */
  readonly argv: readonly string[];
  /** The directory holding the executable, which is where a portable `player.json` sits. */
  readonly executableDir: string;
  /** The application-data directory, which holds an installed `player.json` and `library.json`. */
  readonly dataDir: string;
  /** The application's resources directory, where an export bakes `game.tpk`. */
  readonly resourcesDir: string;
  readonly isFile: (path: string) => boolean;
  readonly readJson: (path: string) => unknown;
  /** The library's rows, or `null` when there is no registry file. */
  readonly library: () => readonly LibraryRow[] | null;
  /** A source that could not be used is reported, never thrown: the next step still runs. */
  readonly onWarning?: (message: string) => void;
};

/** The reason a cold start with nothing configured shows. It names every way to choose a game. */
export const NO_GAME_REASON =
  "No game was chosen: pass --game <path>, write player.json beside the player or in its application-data directory, " +
  "bake a default package at export, or install one into the library.";

/** The value of `--name <value>`, or `null`. The last occurrence wins, as a command line's does. */
export function argumentValue(argv: readonly string[], name: string): string | null {
  let found: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) found = argv[index + 1] ?? null;
  }
  return found;
}

/**
 * The path a `tkr://play?game=…` link names, or `null`.
 *
 * Both `tkr://play?game=…` and `tkr:///?game=…` parse; the host is not checked against `play` because a platform may
 * hand the link over with its own normalisation and refusing it there would drop a legitimate launch. A link with no
 * `game` parameter is not a game launch.
 */
export function deepLinkPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "tkr:") return null;
  const named = parsed.searchParams.get("game");
  return named === null || named === "" ? null : named;
}

/** The first `tkr://` argument, or `null`. Linux and Windows deliver a deep link as an ordinary argument. */
export function deepLinkFromArgv(argv: readonly string[]): string | null {
  for (const argument of argv) {
    if (argument.startsWith("tkr://")) return argument;
  }
  return null;
}

/** A `player.json` body: `{ schema: 1, defaultGame: "<path>" }`. Anything else is ignored with a warning. */
function defaultGameFrom(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const named = record["defaultGame"];
  return typeof named === "string" && named.length > 0 ? named : null;
}

function existingFile(input: LaunchInputs, path: string): string | null {
  try {
    return input.isFile(path) ? path : null;
  } catch {
    return null;
  }
}

function configTarget(input: LaunchInputs): string | null {
  for (const directory of [input.executableDir, input.dataDir]) {
    const configPath = resolve(directory, "player.json");
    if (existingFile(input, configPath) === null) continue;
    let named: string | null;
    try {
      named = defaultGameFrom(input.readJson(configPath));
    } catch (error) {
      input.onWarning?.(`${configPath} could not be read (${error instanceof Error ? error.message : String(error)}); ignoring it`);
      continue;
    }
    if (named === null) {
      input.onWarning?.(`${configPath} names no defaultGame; ignoring it`);
      continue;
    }
    const path = isAbsolute(named) ? named : resolve(dirname(configPath), named);
    const found = existingFile(input, path);
    if (found === null) {
      input.onWarning?.(`${configPath} names ${named}, which is not a file; ignoring it`);
      continue;
    }
    return found;
  }
  return null;
}

/** Resolve which game this cold start opens. Pure: the same inputs always give the same answer. */
export function resolveLaunchTarget(input: LaunchInputs): LaunchResolution {
  const named = argumentValue(input.argv, "--game");
  if (named !== null && named !== "") {
    const path = resolve(named);
    const found = existingFile(input, path);
    if (found !== null) return { step: "argument", path: found };
    input.onWarning?.(`--game ${named} is not a file; trying the next step`);
  }

  const link = deepLinkFromArgv(input.argv);
  if (link !== null) {
    const target = deepLinkPath(link);
    if (target === null) {
      input.onWarning?.(`${link} names no game; trying the next step`);
    } else {
      const path = resolve(target);
      const found = existingFile(input, path);
      if (found !== null) return { step: "deep-link", path: found };
      input.onWarning?.(`${link} names ${target}, which is not a file; trying the next step`);
    }
  }

  const config = configTarget(input);
  if (config !== null) return { step: "config", path: config };

  const baked = existingFile(input, resolve(input.resourcesDir, "game.tpk"));
  if (baked !== null) return { step: "baked", path: baked };

  let rows: readonly LibraryRow[] | null = null;
  try {
    rows = input.library();
  } catch (error) {
    input.onWarning?.(`the library could not be read (${error instanceof Error ? error.message : String(error)}); treating it as empty`);
  }
  if (rows !== null && rows.length > 0) return { step: "library", rows };
  return { step: "none", reason: NO_GAME_REASON };
}
