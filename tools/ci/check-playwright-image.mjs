// Checks that the browser lane's Playwright container image is the same version as `@playwright/test` (#1884).
//
//   node tools/ci/check-playwright-image.mjs
//
// The `browser` job runs inside `mcr.microsoft.com/playwright:v<version>-noble`, which ships Chromium at the version the
// image was built for. If `@playwright/test` moves without the image tag, the lane drives a different Chromium from the
// one the tests were written against, so this fails until the two agree.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "..", "..");

const JOB_HEADER = /^  browser:\s*$/;
const NEXT_JOB = /^  \S/;
const IMAGE_LINE = /^\s+image:\s*mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble\s*$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/** The lines of the `browser:` job in a workflow file, or null when the file has no such job. */
export function browserJobLines(workflowText) {
  const lines = workflowText.split(/\r?\n/);
  const start = lines.findIndex((line) => JOB_HEADER.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_JOB.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Compares the pinned `@playwright/test` version with the image tag the browser job runs in.
 * Returns `{ ok: true, version }` or `{ ok: false, reason }`.
 */
export function playwrightImageAgreement({ packageJsonText, workflowText }) {
  const pinned = JSON.parse(packageJsonText).devDependencies?.["@playwright/test"];
  if (typeof pinned !== "string" || !EXACT_VERSION.test(pinned)) {
    return { ok: false, reason: `@playwright/test must be pinned to an exact version, found "${pinned ?? "nothing"}"` };
  }
  const block = browserJobLines(workflowText);
  if (block === null) return { ok: false, reason: "the workflow has no browser job" };
  const images = block.map((line) => IMAGE_LINE.exec(line)).filter((match) => match !== null);
  if (images.length !== 1) {
    return {
      ok: false,
      reason: `the browser job must name exactly one mcr.microsoft.com/playwright:v<version>-noble image, found ${images.length}`,
    };
  }
  const image = images[0][1];
  if (image !== pinned) {
    return {
      ok: false,
      reason: `the browser job runs Playwright image v${image} but @playwright/test is ${pinned}; move the image tag to v${pinned}-noble`,
    };
  }
  return { ok: true, version: pinned };
}

function main() {
  const packageJsonText = readFileSync(join(repoRoot, "package.json"), "utf8");
  const workflowText = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const result = playwrightImageAgreement({ packageJsonText, workflowText });
  if (!result.ok) {
    console.error(`playwright image check failed: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`playwright image check passed: browser job and @playwright/test are both ${result.version}`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
