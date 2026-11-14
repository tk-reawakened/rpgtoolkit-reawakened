/**
 * The closing suite, run inside a page (entry 9.14): boot every game of `golden/closing/plan.json` through the real
 * engine in this host, compare the records with the committed baseline, PNGs and ledger, and report the same verdict the
 * headless runner prints.
 *
 * One implementation for the PWA page and the desktop measurement page, so "Node and Chromium agree" is not two checks
 * that happen to be written twice: both call `checkClosingSuite`, the same function `pnpm closing` calls.
 */

import {
  checkClosingSuite,
  parseClosingPlan,
  runClosingGame,
  type ClosingFiles,
  type ClosingGameRecord,
  type ClosingBatchTrace,
  type ClosingGameRun,
} from "@tk-reawakened/runner-harness";

export type ClosingGameReport = {
  readonly name: string;
  readonly record: ClosingGameRecord;
  /** A disagreement between the plan's three tick batchings, or an empty list. */
  readonly batchProblems: readonly string[];
  readonly batchTickHashes: readonly ClosingBatchTrace[];
};

export type ClosingPageReport = {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly games: readonly ClosingGameReport[];
};

/**
 * Prefetch what the check needs, run every game, then compare. `readPng` may be asynchronous because a page fetches its
 * PNGs; the comparison itself is synchronous, so the pixels are gathered before it runs.
 */
export async function runClosingCheck(options: {
  readonly planText: string;
  readonly baselineText: string | undefined;
  readonly ledgerText: string | undefined;
  readonly load: (name: string) => Promise<ClosingFiles>;
  readonly bundled: ClosingFiles;
  readonly readPng: (path: string) => Promise<Uint8Array | undefined>;
}): Promise<ClosingPageReport> {
  const plan = parseClosingPlan(options.planText);
  const runs: ClosingGameRun[] = [];
  for (const game of plan.games) runs.push(runClosingGame(plan, game, await options.load(game.name), options.bundled));

  // Every committed PNG the run claims, fetched once. A missing file stays missing, and the check names it.
  const pngs = new Map<string, Uint8Array>();
  for (const run of runs) {
    for (const path of run.images.keys()) {
      const bytes = await options.readPng(path);
      if (bytes !== undefined) pngs.set(path, bytes);
    }
  }

  const check = checkClosingSuite(plan, runs, options.baselineText, (path) => pngs.get(path), options.ledgerText);
  return {
    ok: check.ok,
    lines: check.lines,
    games: runs.map((run) => ({ name: run.name, record: run.record, batchProblems: run.batchProblems, batchTickHashes: run.batchTickHashes })),
  };
}

export type ClosingArtifactHost = "browser" | "desktop";

function hostAppsPath(host: ClosingArtifactHost, file: string): string {
  return `/apps/${host}/${file}`;
}

/** The build-written list of each fetched game's files (`apps/<host>/closing-files.json`). */
export type ClosingManifest = { readonly schema: 1; readonly games: Readonly<Record<string, readonly string[]>> };

/**
 * A loader over the build-written manifest: one ordinary static fetch per file, so a PWA page and the desktop shell read
 * the same tree the headless runner reads. A missing game or file is an error naming what the build did not see.
 */
export function closingManifestLoader(
  base: string,
  manifest: ClosingManifest,
  host: ClosingArtifactHost = "browser",
): (name: string) => Promise<ClosingFiles> {
  return async (name) => {
    const listed = manifest.games[name];
    if (listed === undefined) throw new Error(`${name} is not in ${hostAppsPath(host, "closing-files.json")}; run pnpm fixtures:fetch and rebuild`);
    const entries = await Promise.all(listed.map(async (path) => {
      const response = await fetch(`${base}/fixtures/legacy/${name}/${path.split("/").map(encodeURIComponent).join("/")}`);
      if (!response.ok) throw new Error(`${name}/${path} answered ${response.status}`);
      return { path, bytes: new Uint8Array(await response.arrayBuffer()) };
    }));
    return new Map(entries.map((entry) => [entry.path, entry.bytes])) as ClosingFiles;
  };
}

/** Fetch the manifest itself; `{}` when the build has not written it. */
export async function fetchClosingManifest(base = "", host: ClosingArtifactHost = "browser"): Promise<ClosingManifest> {
  const response = await fetch(`${base}${hostAppsPath(host, "closing-files.json")}`);
  if (!response.ok) return { schema: 1, games: {} };
  const parsed = await response.json() as ClosingManifest;
  return { schema: 1, games: parsed.games ?? {} };
}

/**
 * The bundled assets, fetched one static file at a time from the build-written list. `/api/bundled` is the lane's API and
 * does not exist over `app://`, so the shared path is the static one: both hosts then hand the engine the same keys.
 */
export async function closingBundled(base = "", host: ClosingArtifactHost = "browser"): Promise<ClosingFiles> {
  const listed = (await (await fetch(`${base}${hostAppsPath(host, "bundled.json")}`)).json()) as { readonly files: readonly string[] };
  const entries = await Promise.all(listed.files.map(async (path) => {
    const response = await fetch(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!response.ok) throw new Error(`bundled ${path} answered ${response.status}`);
    return [path, new Uint8Array(await response.arrayBuffer())] as const;
  }));
  return new Map(entries) as ClosingFiles;
}

export type PackagedClosingReport = {
  readonly ok: boolean;
  readonly batchProblems: readonly string[];
  readonly frames: number;
  readonly error?: string;
};

/**
 * Run `demo` from its distribution package and require the record the folder load produced. This is the packaged
 * single-file load in a page: one game, two ways in, the same hashes.
 */
export async function packagedDemoRecord(options: {
  readonly planText: string;
  readonly bundled: ClosingFiles;
  readonly reference: readonly ClosingGameReport[];
  /** The host's package reader; `distributionPackage` in both pages, injected so this module has no import cycle. */
  readonly packageFiles: (name: string, bytes: Uint8Array) => ClosingFiles;
}): Promise<PackagedClosingReport | undefined> {
  const response = await fetch("/fixtures/packages/demo.tpk");
  if (!response.ok) return undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    const plan = parseClosingPlan(options.planText);
    const demo = plan.games.find((game) => game.name === "demo");
    if (demo === undefined) throw new Error("the plan no longer lists demo");
    const run = runClosingGame(plan, demo, options.packageFiles("demo.tpk", bytes), options.bundled);
    const folder = options.reference.find((game) => game.name === "demo");
    const same = folder !== undefined && JSON.stringify(folder.record) === JSON.stringify(run.record);
    return {
      ok: same && run.batchProblems.length === 0,
      batchProblems: run.batchProblems,
      frames: run.record.frames.length,
      ...(same ? {} : { error: "the packaged demo produced a different record from the folder load" }),
    };
  } catch (error) {
    return { ok: false, batchProblems: [], frames: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Fetch one suite input as text, treating a 404 as absent so the check can name what is missing. */
export async function fetchOptionalText(path: string): Promise<string | undefined> {
  const response = await fetch(path);
  return response.ok ? await response.text() : undefined;
}

/** Fetch one suite input as bytes, treating a 404 as absent. */
export async function fetchOptionalBytes(path: string): Promise<Uint8Array | undefined> {
  const response = await fetch(path);
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
}
