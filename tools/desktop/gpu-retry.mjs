// Classify a desktop launch failure and retry only the GPU ones (#2169).
//
// The CI failure `render-webgl2: shader compilation failed:` with an *empty* info log is not a shader bug: Chromium's GPU
// process died, so there was no driver to compile on. Chromium says so in its own lines. A real shader bug always has a
// non-empty info log, which is why an empty log (or explicit context loss / GPU-process death) is infrastructure and
// anything else is rethrown untouched: retries must never be able to hide a launch, format or hash regression.

/** Lines Chromium or the renderer prints when the GPU environment failed, not the game. */
export const GPU_EVIDENCE = [
  /Exiting GPU process due to errors during initialization/,
  /GPU state invalid/,
  // The old bare form and the renderer's current, informative form both mean the same dead GPU (#2169).
  /shader compilation failed:\s*$/m,
  /shader compilation failed: no info log \(the WebGL context may be lost\)/,
  // A link failure on a machine with no GPU means the same thing as a compile failure (#2169, Xvfb lane).
  /program link failed:\s*$/m,
  /program link failed: no info log \(the WebGL context may be lost\)/,
  /render-webgl2: the WebGL2 context was lost/,
  /render-webgl2\.context-lost/,
  /no WebGL2 context/,
];

/** The failure is the machine's GPU, not the game or the package. */
export class InfrastructureError extends Error {
  constructor(message, { attempts = [], evidence = [], log = "", cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "InfrastructureError";
    this.kind = "infrastructure";
    this.attempts = attempts;
    this.evidence = evidence;
    this.log = log;
  }
}

/**
 * Decide whether a launch failure is retryable infrastructure. Returns `{ kind: "gpu", evidence }` when the message or
 * log carries GPU evidence and `{ kind: "other", evidence: [] }` otherwise. The caller rethrows `other` unchanged.
 */
export function classifyLaunchFailure({ message = "", log = "" } = {}) {
  const text = [message, log].filter((part) => typeof part === "string" && part.length > 0).join("\n");
  const evidence = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || evidence.includes(trimmed)) continue;
    if (GPU_EVIDENCE.some((pattern) => pattern.test(trimmed))) evidence.push(trimmed);
  }
  return evidence.length > 0 ? { kind: "gpu", evidence } : { kind: "other", evidence: [] };
}

/**
 * Chromium arguments per launch attempt. The first attempt keeps the platform's normal setup (software WebGL2 on
 * headless Linux); every retry forces ANGLE's SwiftShader so a dead hardware GPU cannot fail the retry the same way.
 */
export function gpuFallbackArgs(platform = process.platform, attempt = 0) {
  if (attempt <= 0) return platform === "linux" ? ["--enable-unsafe-swiftshader"] : [];
  return [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    ...(platform === "linux" ? ["--disable-dev-shm-usage"] : []),
  ];
}

function defaultDelay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function lastLines(text, count) {
  const lines = String(text ?? "").split(/\r?\n/).filter((line) => line !== "");
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

function infrastructureMessage(records, evidence) {
  const distinct = [...new Set(evidence)];
  const lines = [
    `desktop infrastructure failure: the GPU/WebGL2 environment failed ${records.length} attempt${records.length === 1 ? "" : "s"}`,
    distinct.length > 0 ? `evidence: ${distinct.join("; ")}` : "evidence: none",
  ];
  for (const record of records) {
    const detail = record.evidence.length > 0 ? ` (${record.evidence.join("; ")})` : "";
    lines.push(`attempt ${record.attempt}: ${record.kind}${detail}: ${record.message.split(/\r?\n/)[0]}`);
  }
  const tail = lastLines(records.at(-1)?.log ?? "", 60);
  if (tail !== "") lines.push(`last log:\n${tail}`);
  return lines.join("\n");
}

/**
 * Run one launch attempt at a time, retrying only classified GPU failures with exponential backoff. Each retry receives
 * its own attempt index so the caller can force SwiftShader; the previous child must already be stopped when `attempt`
 * rejects, because the caller owns its bounded shutdown.
 *
 * Returns `{ value, attempts, delays, evidence, records }`. A non-GPU failure is rethrown as the same error object; an
 * exhausted GPU failure becomes an `InfrastructureError` that names every attempt and the evidence.
 */
export async function launchWithRecovery({
  attempt,
  classify = classifyLaunchFailure,
  attempts = 3,
  initialBackoffMs = 2_000,
  maxBackoffMs = 8_000,
  delay = defaultDelay,
  log = () => {},
} = {}) {
  if (typeof attempt !== "function") throw new TypeError("launchWithRecovery needs an attempt function");
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("launchWithRecovery needs attempts >= 1");
  const records = [];
  const evidence = [];
  const delays = [];
  let backoffMs = initialBackoffMs;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const value = await attempt(index);
      return { value, attempts: index + 1, delays, evidence: [...new Set(evidence)], records };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const classification = classify({ message, log: error?.log ?? "" });
      const record = { attempt: index + 1, kind: classification.kind, evidence: classification.evidence, message, log: error?.log ?? "" };
      records.push(record);
      evidence.push(...classification.evidence);
      log(`desktop launch attempt ${index + 1}/${attempts} failed (${classification.kind})${classification.evidence.length > 0 ? `: ${classification.evidence.join("; ")}` : ""}`);
      if (classification.kind !== "gpu") throw error;
      if (index === attempts - 1) {
        throw new InfrastructureError(infrastructureMessage(records, evidence), {
          attempts: records,
          evidence: [...new Set(evidence)],
          log: record.log,
          cause: error,
        });
      }
      const waitMs = Math.min(backoffMs, maxBackoffMs);
      delays.push(waitMs);
      log(`retrying the desktop launch in ${waitMs} ms with software WebGL2`);
      await delay(waitMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }
  // Unreachable with attempts >= 1, but keeps the return type honest if the loop is ever changed.
  throw new InfrastructureError(infrastructureMessage(records, evidence), { attempts: records, evidence, log: "" });
}
