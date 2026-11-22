// Checks that the required mobile jobs stay wired into CI (#2721).
//
//   node tools/ci/check-mobile-gate.mjs
//
// The APK build is required and `gate` waits for it, the emulator proof stays advisory but must produce a readable
// verdict, and `gate` waits for that verdict. Any edit that quietly re-advisories the build, stops using the retrying
// Gradle wrapper, drops the always-uploaded evidence, or removes either job from `gate.needs` fails here, without a
// network request or a Gradle run.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

const NEXT_JOB = /^  \S/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The lines of one top-level job block, or null when the workflow has no such job. */
export function jobLines(workflowText, job) {
  const lines = workflowText.split(/\r?\n/);
  const header = new RegExp(`^  ${escapeRegExp(job)}:\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_JOB.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The job names in a block's `needs:` list, including a multi-line bracketed list. */
export function needsList(block) {
  const index = block.findIndex((line) => /^\s+needs:/.test(line));
  if (index === -1) return null;
  const first = block[index].replace(/^\s+needs:\s*/, "").trim();
  if (!first.startsWith("[")) return [first];
  const names = [];
  for (let line = index; line < block.length; line += 1) {
    const text = line === index ? first.slice(1) : block[line];
    const close = text.indexOf("]");
    for (const name of (close === -1 ? text : text.slice(0, close)).split(",")) {
      const trimmed = name.trim();
      if (trimmed !== "") names.push(trimmed);
    }
    if (close !== -1) break;
  }
  return names;
}

/**
 * Compares the mobile job wiring with what #2721 requires. Returns `{ ok: true }` or `{ ok: false, reason }`.
 */
export function mobileGateAgreement({ workflowText }) {
  const build = jobLines(workflowText, "mobile-build");
  if (build === null) {
    return { ok: false, reason: "the workflow has no mobile-build job; the APK build is required" };
  }
  if (build.some((line) => /^\s+continue-on-error:\s*true\s*$/.test(line))) {
    return { ok: false, reason: "mobile-build must not be continue-on-error; only the emulator proof is advisory" };
  }
  if (!build.some((line) => line.includes("tools/mobile/gradle-build.mjs"))) {
    return { ok: false, reason: "mobile-build must assemble through tools/mobile/gradle-build.mjs" };
  }
  const buildText = build.join("\n");
  for (const artifact of ["mobile-apk", "mobile-gradle-attempts"]) {
    if (!new RegExp(`^\\s+name:\\s*${artifact}\\s*$`, "m").test(buildText)) {
      return { ok: false, reason: `mobile-build must upload the ${artifact} artifact` };
    }
  }
  const errorUploads = build.filter((line) => /if-no-files-found:\s*error\s*$/.test(line)).length;
  if (errorUploads < 2) {
    return { ok: false, reason: "both mobile-build uploads must set if-no-files-found: error" };
  }

  const proof = jobLines(workflowText, "mobile-proof-present");
  if (proof === null) {
    return { ok: false, reason: "the workflow has no required mobile-proof-present job" };
  }
  if (!proof.some((line) => line.includes("tools/mobile/proof-present.mjs"))) {
    return { ok: false, reason: "mobile-proof-present must run tools/mobile/proof-present.mjs" };
  }

  const advisory = jobLines(workflowText, "mobile");
  if (advisory === null) {
    return { ok: false, reason: "the workflow has no advisory mobile job" };
  }
  if (!advisory.some((line) => /^\s+name:\s*mobile-apk\s*$/.test(line))) {
    return { ok: false, reason: "the advisory mobile job must download the required mobile-apk artifact" };
  }

  const gate = jobLines(workflowText, "gate");
  if (gate === null) return { ok: false, reason: "the workflow has no gate job" };
  const needs = needsList(gate);
  for (const required of ["mobile-build", "mobile-proof-present"]) {
    if (needs === null || !needs.includes(required)) {
      return { ok: false, reason: `gate.needs must include ${required}` };
    }
  }
  return { ok: true };
}

function main() {
  const workflowText = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const result = mobileGateAgreement({ workflowText });
  if (!result.ok) {
    console.error(`mobile gate check failed: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log("mobile gate check passed: the APK build and proof presence are required and wired into gate");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
