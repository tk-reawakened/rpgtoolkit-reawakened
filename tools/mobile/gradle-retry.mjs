// Retry only the transient Gradle dependency failures, with bounds (#2721).
//
// A hosted runner's shared egress can answer a Maven request with 429 or a 5xx, and Gradle then fails the whole build in
// seconds. Gradle already retries those internally, but silently; this wrapper makes the retries visible, bounds them,
// and — the important half — never retries a permanent failure (a 404, a missing artifact, a compile error), because a
// retry would only hide it.

/** Failures a later attempt can plausibly avoid: shared-egress throttling and transient network errors. */
export const TRANSIENT_GRADLE_FAILURES = [
  /\bstatus code 429\b/i,
  /\bToo Many Requests\b/i,
  /\bstatus code 5\d\d\b/i,
  /\bRead timed out\b/i,
  /\btimed out\b/i,
  /\bConnection reset\b/i,
  /\bConnection refused\b/i,
  /\bSSL handshake\b/i,
  /\bSSLException\b/i,
  /\bCould not resolve host\b/i,
  // `Could not GET` also carries a status code; a 404 line is caught by the permanent list, which wins.
  /\bCould not (?:GET|HEAD|download)\b/i,
];

/** A resolution failure line that is only evidence when another transient or ambiguous marker explains it. */
export const GRADLE_RESOLVE_CONTEXT = /\bCould not resolve all (?:files|dependencies) for configuration\b/i;

/**
 * Ambiguous resolution output. Gradle prints `Could not find …` / `Searched in the following locations:` after it has
 * exhausted its own 429/5xx retries, and attempt 1 may hide the underlying status line, so this is retryable — bounded.
 * A genuine absence that the repository stated explicitly (`Received status code 404`) stays permanent.
 */
export const AMBIGUOUS_GRADLE_RESOLUTION = [
  /\bCould not find\b/i,
  /\bSearched in the following locations\b/i,
];

/** Failures no retry can fix. A permanent marker anywhere in the output wins over every transient one. */
export const PERMANENT_GRADLE_FAILURES = [
  /\bstatus code 40[134]\b/i,
  /\bchecksum\b.*(?:mismatch|did not match|not match)/i,
  /\bsignature\b.*(?:mismatch|verification failed|invalid)/i,
  /\bUnsupported class file major version\b/i,
  /\bCompilation error\b/,
  /\bUnresolved reference\b/,
];

/**
 * Decide whether a Gradle failure may be retried. Returns `{ retryable, evidence, permanent }`: `evidence` holds the
 * transient lines and `permanent` the permanent ones. An unrecognised failure is not retryable either.
 */
export function classifyGradleFailure(text) {
  const evidence = [];
  const context = [];
  const ambiguous = [];
  const permanent = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (PERMANENT_GRADLE_FAILURES.some((pattern) => pattern.test(trimmed))) {
      if (!permanent.includes(trimmed)) permanent.push(trimmed);
      continue;
    }
    if (TRANSIENT_GRADLE_FAILURES.some((pattern) => pattern.test(trimmed))) {
      if (!evidence.includes(trimmed)) evidence.push(trimmed);
    } else if (GRADLE_RESOLVE_CONTEXT.test(trimmed) && !context.includes(trimmed)) {
      context.push(trimmed);
    } else if (AMBIGUOUS_GRADLE_RESOLUTION.some((pattern) => pattern.test(trimmed)) && !ambiguous.includes(trimmed)) {
      ambiguous.push(trimmed);
    }
  }
  if (permanent.length > 0) return { retryable: false, evidence: [], permanent };
  if (evidence.length > 0 || ambiguous.length > 0) {
    return { retryable: true, evidence: [...evidence, ...context, ...ambiguous], permanent: [] };
  }
  return { retryable: false, evidence: [], permanent: [] };
}

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Run `run({ attempt, remainingMs })` until it succeeds, a failure is permanent, the attempts run out or the overall
 * deadline passes. `sleep` and `now` are injected so tests never wait. Every attempt's output is kept in the result.
 */
export async function runWithRetry({
  run,
  classify = classifyGradleFailure,
  attempts = 3,
  delays = [10_000, 30_000],
  deadlineMs = 20 * 60_000,
  now = Date.now,
  sleep = defaultSleep,
  log = () => {},
} = {}) {
  if (typeof run !== "function") throw new TypeError("runWithRetry needs a run function");
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("runWithRetry needs attempts >= 1");
  const deadline = now() + deadlineMs;
  const results = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    const output = await run({ attempt, remainingMs });
    const text = `${output.stdout ?? ""}\n${output.stderr ?? ""}`;
    const classification = classify(text);
    const record = {
      attempt: attempt + 1,
      status: output.status ?? null,
      stdout: output.stdout ?? "",
      stderr: output.stderr ?? "",
      classification,
    };
    results.push(record);
    log(`gradle attempt ${attempt + 1}/${attempts} exited ${record.status}${classification.retryable ? ` (retryable: ${classification.evidence.join("; ") || "transient"})` : classification.permanent.length > 0 ? ` (permanent: ${classification.permanent.join("; ")})` : ""}`);
    if (record.status === 0) return { ok: true, status: 0, attempts: record.attempt, results };
    if (!classification.retryable) return { ok: false, status: record.status, attempts: record.attempt, results };
    if (attempt === attempts - 1) break;
    const waitMs = Math.min(delays[Math.min(attempt, delays.length - 1)] ?? 0, Math.max(0, deadline - now()));
    if (waitMs <= 0) break;
    log(`retrying gradle in ${waitMs} ms`);
    await sleep(waitMs);
  }
  const last = results.at(-1) ?? null;
  return { ok: false, status: last?.status ?? null, attempts: results.length, results };
}
