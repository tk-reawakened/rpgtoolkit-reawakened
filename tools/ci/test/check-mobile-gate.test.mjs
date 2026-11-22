import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { jobLines, mobileGateAgreement, needsList, repoRoot } from "../check-mobile-gate.mjs";

const workflow = ({
  buildCoe = false,
  wrapper = true,
  apkUpload = true,
  attemptsUpload = true,
  gateNeeds = ["changes", "mobile-build", "mobile-proof-present"],
  proofJob = true,
  proofScript = true,
  advisoryDownload = true,
} = {}) => [
  "name: CI",
  "jobs:",
  "  changes:",
  "    runs-on: ubuntu-24.04",
  "  mobile-build:",
  "    needs: [changes]",
  ...(buildCoe ? ["    continue-on-error: true"] : []),
  "    steps:",
  wrapper
    ? "      - name: Assemble debug APK\n        run: node ../../../tools/mobile/gradle-build.mjs"
    : "      - run: ./gradlew assembleDebug",
  ...(apkUpload
    ? ["      - uses: actions/upload-artifact@v6", "        with:", "          name: mobile-apk", "          if-no-files-found: error"]
    : []),
  ...(attemptsUpload
    ? ["      - uses: actions/upload-artifact@v6", "        with:", "          name: mobile-gradle-attempts", "          if-no-files-found: error"]
    : []),
  "  mobile:",
  "    needs: [changes, mobile-build]",
  "    continue-on-error: true",
  "    steps:",
  ...(advisoryDownload ? ["      - uses: actions/download-artifact@v8", "        with:", "          name: mobile-apk"] : []),
  ...(proofJob
    ? [
      "  mobile-proof-present:",
      "    needs: [changes, mobile]",
      "    steps:",
      proofScript
        ? "      - run: node tools/mobile/proof-present.mjs artifacts/mobile-proof/readings.json"
        : "      - run: echo skipped",
    ]
    : []),
  "  gate:",
  `    needs: [${gateNeeds.join(", ")}]`,
  "    runs-on: ubuntu-24.04",
  "",
].join("\n");

test("passes when the required build, the proof-presence check and gate wiring are all present", () => {
  assert.deepEqual(mobileGateAgreement({ workflowText: workflow() }), { ok: true });
});

test("fails when mobile-build regains continue-on-error", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ buildCoe: true }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /must not be continue-on-error/);
});

test("fails when the assemble step stops calling the retrying wrapper", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ wrapper: false }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /gradle-build\.mjs/);
});

test("fails when the APK upload loses if-no-files-found: error", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ apkUpload: false }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /mobile-apk|if-no-files-found/);
});

test("fails when the attempts upload is dropped", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ attemptsUpload: false }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /mobile-gradle-attempts|if-no-files-found/);
});

test("fails when gate.needs omits mobile-build", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ gateNeeds: ["changes", "mobile-proof-present"] }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /gate\.needs must include mobile-build/);
});

test("fails when gate.needs omits mobile-proof-present", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ gateNeeds: ["changes", "mobile-build"] }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /gate\.needs must include mobile-proof-present/);
});

test("fails when the required proof-presence job is missing", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ proofJob: false }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no required mobile-proof-present job/);
});

test("fails when the proof-presence job stops checking readings", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ proofScript: false }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /proof-present\.mjs/);
});

test("fails when the advisory job no longer downloads the APK", () => {
  const result = mobileGateAgreement({ workflowText: workflow({ advisoryDownload: false }) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /download the required mobile-apk/);
});

test("jobLines does not confuse the advisory mobile job with mobile-build", () => {
  const text = workflow();
  const build = jobLines(text, "mobile-build");
  const advisory = jobLines(text, "mobile");
  assert.equal(build.some((line) => line.includes("gradle-build.mjs")), true);
  assert.equal(advisory.some((line) => line.includes("gradle-build.mjs")), false);
});

test("needsList reads a bracketed list that spans lines", () => {
  const block = ["    needs: [changes,", "      mobile-build,", "      mobile-proof-present]", "    runs-on: x"];
  assert.deepEqual(needsList(block), ["changes", "mobile-build", "mobile-proof-present"]);
});

test("the repository's own CI workflow keeps the required mobile wiring", () => {
  const result = mobileGateAgreement({
    workflowText: readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"),
  });
  assert.equal(result.ok, true, result.reason);
});
