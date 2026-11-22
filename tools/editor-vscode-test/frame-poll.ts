/** One frame the page showed, and what the caller's probe said about it. */
export interface FrameReport<F, T> {
  readonly frame: F;
  readonly value: T;
}

/** What one bounded frame poll found: the accepted reports, and everything that detached while it looked. */
export interface FramePollOutcome<F, T> {
  readonly reports: readonly FrameReport<F, T>[];
  /** Each frame (or the page) that vanished between enumeration and a query, with the error; never swallowed. */
  readonly detached: readonly string[];
}

export interface FramePollOptions<F, T> {
  /** What was being looked for, for the deadline diagnostic, e.g. `Native read-only History frame`. */
  readonly label: string;
  /** The frames on the page right now. Throwing a detachment means "enumerate again", not "fail". */
  readonly frames: () => readonly F[];
  /** Name one frame for a diagnostic. */
  readonly describe: (frame: F) => string;
  /** Answer for one frame, or `null` when it is not the one looked for. A detachment means "enumerate again". */
  readonly probe: (frame: F) => Promise<T | null>;
  /** Whether this attempt's reports are the state looked for. */
  readonly accept: (reports: readonly FrameReport<F, T>[]) => boolean;
  readonly timeoutMs?: number;
  readonly intervals?: readonly number[];
  /** Injected in unit tests so a deadline is proven without waiting on the wall clock. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVALS: readonly number[] = [100, 250, 500, 1_000];

/**
 * Whether a Playwright failure is a frame or page that went away between enumeration and a query. A preview webview
 * can be replaced at any moment, so the poll re-enumerates and tries again inside the same deadline (#3257).
 */
export function isFrameDetachment(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /frame (?:was|has been) detached/i.test(message)
    || /target (?:page|frame), context or browser has been closed/i.test(message)
    || /execution context was destroyed/i.test(message)
    || /cannot find context with specified id/i.test(message)
    || /navigating frame was detached/i.test(message);
}

function noteDetachment(detached: Map<string, number>, message: string): void {
  detached.set(message, (detached.get(message) ?? 0) + 1);
}

function describeSafely<F>(describe: (frame: F) => string, frame: F): string {
  try {
    return describe(frame);
  } catch {
    return "<frame already gone>";
  }
}

function reportsBecause<F, T>(describe: (frame: F) => string, reports: readonly FrameReport<F, T>[]): string {
  if (reports.length === 0) return "no frame matched";
  return reports.map((report) => {
    let value: string;
    try {
      value = JSON.stringify(report.value);
    } catch {
      value = "<unprintable>";
    }
    return `${describeSafely(describe, report.frame)} => ${value ?? "null"}`;
  }).join("; ");
}

/**
 * Poll every frame on the page until `accept` holds, re-enumerating after a detachment instead of aborting. A frame
 * that is replaced between enumeration and its probe is recorded and skipped; a probe error that is not a detachment
 * still fails at once, so a real fault is never mistaken for churn. At the deadline the error names the frames that
 * detached and the last state seen, so a proof that still fails says what was detached.
 */
export async function pollPageFrames<F, T>(options: FramePollOptions<F, T>): Promise<FramePollOutcome<F, T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervals = options.intervals ?? DEFAULT_INTERVALS;
  const now = options.now ?? ((): number => Date.now());
  // `Promise.withResolvers` is ES2024 and this tool project compiles against ES2022's library.
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const deadline = now() + timeoutMs;
  const detached = new Map<string, number>();
  let attempt = 0;
  for (;;) {
    let frames: readonly F[];
    try {
      frames = options.frames();
    } catch (error) {
      if (!isFrameDetachment(error)) throw error;
      noteDetachment(detached, `the page's frames could not be listed: ${error instanceof Error ? error.message : String(error)}`);
      frames = [];
    }
    const reports: FrameReport<F, T>[] = [];
    for (const frame of frames) {
      let value: T | null;
      try {
        value = await options.probe(frame);
      } catch (error) {
        if (!isFrameDetachment(error)) throw error;
        noteDetachment(detached, `${describeSafely(options.describe, frame)} detached during its probe: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (value !== null) reports.push({ frame, value });
    }
    if (options.accept(reports)) return { reports, detached: [...detached.keys()] };
    if (now() >= deadline) {
      const detachedReport = detached.size === 0
        ? "nothing detached"
        : `detached while polling: ${[...detached].map(([entry, count]) => count === 1 ? entry : `${entry} (x${count})`).join(" | ")}`;
      throw new Error(`${options.label} was not found within ${timeoutMs} ms (${detachedReport}). Last attempt: ${reportsBecause(options.describe, reports)}.`);
    }
    const interval = intervals[Math.min(attempt, intervals.length - 1)] ?? DEFAULT_INTERVALS[0]!;
    attempt += 1;
    await sleep(interval);
  }
}

export interface FrameAbsenceOptions<F> {
  /** What must not be on the page, for the deadline diagnostic. */
  readonly label: string;
  readonly frames: () => readonly F[];
  /** True when this frame shows what must not exist. A detachment means "unknown", never "absent". */
  readonly present: (frame: F) => Promise<boolean>;
  readonly timeoutMs?: number;
  readonly intervals?: readonly number[];
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Prove no frame matches, re-enumerating while a frame is detached or the page cannot list frames. A negative
 * assertion must never read a vanished frame as "absent": a detached frame is unknown, so the poll tries again until
 * every frame answered, and a frame that still matches or stays unknown fails at the deadline (#3257 review).
 */
export async function pollNoFrameMatching<F>(options: FrameAbsenceOptions<F>): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervals = options.intervals ?? DEFAULT_INTERVALS;
  const now = options.now ?? ((): number => Date.now());
  const sleep = options.sleep ?? ((ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const deadline = now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    let frames: readonly F[];
    let unknown = false;
    try {
      frames = options.frames();
    } catch (error) {
      if (!isFrameDetachment(error)) throw error;
      unknown = true;
      frames = [];
    }
    let present = false;
    for (const frame of frames) {
      try {
        if (await options.present(frame)) present = true;
      } catch (error) {
        if (!isFrameDetachment(error)) throw error;
        unknown = true;
      }
    }
    if (!present && !unknown) return;
    if (now() >= deadline) {
      throw new Error(`${options.label} could not be proven absent within ${timeoutMs} ms (${unknown ? "a frame detached and never settled" : "a frame still matches"}).`);
    }
    const interval = intervals[Math.min(attempt, intervals.length - 1)] ?? DEFAULT_INTERVALS[0]!;
    attempt += 1;
    await sleep(interval);
  }
}
