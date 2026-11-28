// Measure a canonical TPK on the packaged host. All adaptation and measurement code is probe-local.
import { build } from "esbuild";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { electronBinary } from "../../desktop/electron-binary.mjs";
import { boundedAttach } from "../../mobile/proof-android.mjs";
import { launchAndroidProbe } from "./mobile-host.mjs";
import { matchesLoop, matchesOverlap } from "./waveform-oracles.mjs";
import { matchesNegativeLanes } from "./negative-oracle.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2), argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const host = argument("--host", "browser"), rate = Number(argument("--rate", "48000")), fixture = argument("--fixture", "short");
const productionPage = {
  browser: "packages/runner-web/app/index.html",
  electron: "packages/runner-desktop/app/player.html",
  capacitor: "packages/runner-mobile/app/player.html",
}[host];
if (productionPage === undefined || ![44100, 48000].includes(rate) || !["short", "long"].includes(fixture)) throw new Error("Expected --host browser|electron|capacitor --rate 44100|48000 --fixture short|long");
if (args.includes("--serial")) throw new Error("The Android probe only installs on its own disposable emulator; --serial is not supported.");
const artifacts = join(root, "artifacts", "runtime-audio");
const outputDir = join(artifacts, "hosts"), packagePath = join(artifacts, "runtime-audio.tpk");
const manifest = JSON.parse(readFileSync(join(artifacts, "fixtures", "manifest.json"), "utf8"));
const fixtureRecord = manifest.fixtures.find((item) => item.name === fixture);
const entries = {
  opus: manifest.package.entries.find((item) => item.key === `Media/${fixture}.opus.ogg`),
  wav: manifest.package.entries.find((item) => item.key === `Media/${fixture}.wav`),
};
const midi = manifest.package.controls?.find((item) => item.assetKey === "media/midi-control.mid");
const bank = manifest.package.controls?.find((item) => item.assetKey === "media/tk-16.sf2");
if (!fixtureRecord || !entries.opus || !entries.wav || !midi || !bank) throw new Error("Generate the canonical package and control fixtures first.");
const packageBytes = readFileSync(packagePath), id = randomUUID(), bundleDir = join(outputDir, id);
mkdirSync(bundleDir, { recursive: true });
const files = { page: join(bundleDir, "probe.js"), worklet: join(bundleDir, "probe-worklet.js"), config: join(bundleDir, "probe-config.json"), html: join(bundleDir, "index.html") };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(join(root, productionPage), "utf8"))?.[1];
if (csp === undefined) throw new Error(`Could not find shipped CSP in ${productionPage}`);

function processRss({ pid, profile }) {
  const ps = spawnSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (ps.status !== 0) return null;
  const rows = ps.stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), parent: Number(match[2]), rss: Number(match[3]), command: match[4] }];
  });
  const launched = pid === undefined ? rows.find((row) => row.command.includes(`--user-data-dir=${profile}`) && !row.command.includes("--type="))?.pid : pid;
  if (launched === undefined || !rows.some((row) => row.pid === launched)) return null;
  const owned = new Set([launched]);
  for (let count = 0; count !== owned.size;) {
    count = owned.size;
    for (const row of rows) if (owned.has(row.parent)) owned.add(row.pid);
  }
  return { rssKb: rows.reduce((sum, row) => sum + (owned.has(row.pid) ? row.rss : 0), 0), processCount: owned.size };
}

async function trustedAndroidTap(page) {
  const point = await boundedAttach("reading Android button geometry", () => page.evaluate(() => {
    const button = document.querySelector("#unlock");
    const bounds = button?.getBoundingClientRect();
    return button && !button.disabled && bounds.width > 0 && bounds.height > 0
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null;
  }), 5000);
  if (point === null) throw new Error("Capacitor unlock button is not ready");
  const cdp = await boundedAttach("opening Android touch session", () => page.context().newCDPSession(page), 5000, (late) => late.detach());
  try {
    await boundedAttach("trusted Android touch start", () => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] }), 5000);
    await delay(100);
    await boundedAttach("trusted Android touch end", () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }), 5000);
  } finally { await boundedAttach("detach Android touch session", () => cdp.detach(), 5000).catch(() => {}); }
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Runtime audio host probe</title></head><body><button id="unlock" disabled>Start measured audio</button><script src="/probe.js"></script></body></html>\n`;
writeFileSync(files.html, html);
writeFileSync(files.config, `${JSON.stringify({
  host, fixture, rate, fixtureDigests: { opus: entries.opus.sha256, wav: entries.wav.sha256 },
  playable48kFrames: fixtureRecord.oracle.playable48kFrames, channels: fixtureRecord.source.channels,
  workletUrl: "/probe-worklet.js",
}, null, 2)}\n`);
const alias = {
  "@tk-reawakened/synth": createRequire(import.meta.resolve("@tk-reawakened/runner-web")).resolve("@tk-reawakened/synth"),
  "stb-vorbis": join(root, "tools", "browser", "stb-vorbis-stub.mjs"),
};
const bundle = (entry, outfile) => build({ entryPoints: [join(root, "tools", "spikes", "runtime-audio", entry)], outfile, bundle: true, format: "iife", platform: "browser", target: "chrome101", alias, logLevel: "silent" });
await bundle("host-page.mjs", files.page);
await bundle("probe-worklet.mjs", files.worklet);
const result = {
  id, host, fixture, requestedRateHz: rate, fixtureOracle48kFrames: fixtureRecord.oracle.playable48kFrames,
  entries, packageBytes: packageBytes.length, packageSha256: sha(packageBytes),
  packageReader: "core loadPackage + resolveAsset using the shipped media index",
  csp, productionPage, autoplayBypass: false,
  unlockMethod: host === "capacitor" ? "trusted Android CDP touch" : "trusted Playwright click",
  physicalOutput: host === "browser" ? "unmeasured; Playwright Chromium headless audio is muted" : "unmeasured; graph only",
  decoderScope: "probe-only decodeAudioData to native PCM; no product Opus support is asserted",
  authoringToolLicense: manifest.authoringToolLicense,
  artifacts: { pageSha256: sha(readFileSync(files.page)), workletSha256: sha(readFileSync(files.worklet)), htmlSha256: sha(readFileSync(files.html)) },
  startedAt: new Date().toISOString(), outcome: "failed", error: null,
};
let server, browser, electron, android, sampledMemory;

async function runEncoding(page, expectedOrigin, encoding) {
  const url = new URL(page.url());
  url.searchParams.set("encoding", encoding);
  await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForFunction(() => !document.querySelector("#unlock")?.disabled || window.__runtimeAudioProbe?.status === "failed", null, { polling: 250, timeout: 10_000 });
  const initial = await page.evaluate(() => ({ origin: location.origin, userAgent: navigator.userAgent, probe: window.__runtimeAudioProbe }));
  result.userAgent = initial.userAgent;
  result.appOrigin = initial.origin;
  if (initial.probe?.status === "failed") throw new Error(initial.probe.errors.join("; "));
  if (initial.origin !== expectedOrigin || initial.probe?.encoding !== encoding) throw new Error(`Expected packaged ${encoding} page at ${expectedOrigin}, got ${initial.probe?.encoding} at ${initial.origin}`);
  const memory = { baseline: null, overlap: null, afterClose: null, during: [] };
  const collectMemory = async (phase) => {
    try {
      const startedAt = Date.now();
      const sample = await sampledMemory();
      const finishedAt = Date.now();
      if (sample === null) return;
      let acknowledgedRenderFrame = null;
      if (phase === "overlap") {
        acknowledgedRenderFrame = await boundedAttach("confirming overlap still active after memory sample", () => page.evaluate(() => (
          window.__runtimeAudioProbe?.memoryPhase === "overlap" ? window.__runtimeAudioProbe.overlapWindow.renderedFrame : null
        )), 4000);
        if (acknowledgedRenderFrame === null) throw new Error("memory sample finished after the acknowledged overlap window");
      }
      const record = { startedAt, finishedAt, acknowledgedRenderFrame, ...sample };
      if (phase === "during") memory.during.push(record);
      else memory[phase] = record;
    } catch (error) { (result.memoryErrors ??= []).push(`${encoding}/${phase}: ${String(error)}`); }
  };
  await collectMemory("baseline");
  let samplePending, observingOverlap = false;
  const overlapSampling = page.waitForFunction(() => window.__runtimeAudioProbe?.memoryPhase === "overlap", null, { polling: 250, timeout: 15_000 })
    .then(async () => {
      observingOverlap = true;
      try {
        await samplePending;
        await collectMemory("overlap");
      } finally { observingOverlap = false; }
    }, (error) => { (result.memoryErrors ??= []).push(`${encoding}/overlap: ${String(error)}`); });
  const timer = setInterval(() => {
    if (!observingOverlap && samplePending === undefined) samplePending = collectMemory("during").finally(() => { samplePending = undefined; });
  }, host === "capacitor" ? 1500 : 250);
  let probe;
  try {
    if (host === "capacitor") await trustedAndroidTap(page);
    else await page.locator("#unlock").click({ timeout: 10_000 });
    await page.waitForFunction(() => ["complete", "failed"].includes(window.__runtimeAudioProbe?.status), null, { polling: 250, timeout: 30_000 });
    probe = await page.evaluate(() => window.__runtimeAudioProbe);
  } finally {
    clearInterval(timer);
    await samplePending;
    await overlapSampling;
  }
  await collectMemory("afterClose");
  const playback = probe.playback, expectedTicks = Math.round(fixtureRecord.oracle.playable48kFrames / 800);
  const entry = entries[encoding];
  const assertions = {
    completed: probe.status === "complete",
    trustedGestureAndRunningContext: probe.unlock?.trustedClick === true && probe.unlock?.userActivation !== false && probe.contextStateAfterResume === "running",
    packageBytesMatchAuthoredFixture: probe.package?.sha256 === manifest.package.sha256 && probe.package?.entry?.matchesAuthoredBytes === true && probe.package?.entry?.key === entry.assetKey,
    shippedCspEnforced: probe.csp === csp && probe.cspInlineBlocked === true && probe.cspViolations.every(({ resource }) => resource === "inline"),
    workletReadyTicks: playback?.events?.some((event) => event.kind === "ready" && event.voice === 1 && event.lengthTicks === expectedTicks) === true,
    nonzeroAudioWorkletOutput: playback?.graphPeak > 0.001 && Number.isFinite(playback?.gestureToFirstAnalyserEnergyMs),
    authoredLeadSilencePreserved: playback?.musicReference?.onsetAfterCueStartMs > 200,
    authoredImpulsePositionPreserved: Number.isFinite(playback?.musicReference?.impulseOffsetFromAuthoredMs) && Math.abs(playback.musicReference.impulseOffsetFromAuthoredMs) < 5,
    repeatedWaveformAndPeriod: matchesLoop(playback?.loopEvidence, playback?.repeatedWaveformCorrelation),
    observedWorkletRate: playback?.workletRateHz === rate && probe.requestedRateHonored === true,
    seekEmitted: playback?.seekEmitted === true,
    bothVoicesContribute: matchesOverlap(playback?.mixContribution),
    finiteVoiceEnded: fixture === "long" ? "not-applicable: 60-second effect is stopped after overlap" : playback?.endedCueIds?.includes(2) === true,
    midiControlRendered: probe.midiControl?.sha256 === midi.sha256 && probe.midiControl?.bankSha === bank.sha256 && probe.midiControl?.lengthTicks === 120 && probe.midiControl?.waveform?.peak > 0.001,
    phaseMemoryObserved: memory.baseline !== null && memory.overlap !== null && memory.during.length > 0 && memory.afterClose !== null && probe.contextStateAfterClose === "closed"
      && memory.overlap.acknowledgedRenderFrame === probe.overlapWindow?.renderedFrame && Number.isFinite(probe.overlapWindow?.closedAtMs),
  };
  if (encoding === "opus") {
    assertions.nativeDecode = probe.nativeDecode?.frames > 0 && probe.nativeDecode.sampleRateHz === rate;
    assertions.nativeStereoLayout = probe.nativeDecode?.channels === fixtureRecord.source.channels;
    assertions.granuleDurationWithinOneFrame = probe.nativeDecode?.matches48kGranuleOracleWithinOneFrame === true;
    assertions.workletReceivedConvertedPcm = probe.adapter?.workletReceipt?.bytes === probe.adapter?.transferBytes && probe.adapter?.transferBytes > 0;
    assertions.negativeLanesSilent = matchesNegativeLanes(probe.negativeLanes, probe.playback.workletRateHz);
  } else {
    assertions.directProductionPcm = probe.nativeDecode === undefined && probe.adapter === null;
  }
  return { probe, memory: { ...memory, pageUsedJsHeapBytes: { beforeDecode: probe.memoryBeforeDecode, afterPlayback: probe.memoryAfterPlayback } }, assertions };
}

const allPassed = (assertions) => Object.values(assertions).every((value) => value === true || typeof value === "string");
try {
  let page, expectedOrigin;
  if (host === "browser") {
    const routes = new Map([
      ["/index.html", [readFileSync(files.html), "text/html"]],
      ["/probe.js", [readFileSync(files.page), "text/javascript"]],
      ["/probe-worklet.js", [readFileSync(files.worklet), "text/javascript"]],
      ["/probe-config.json", [readFileSync(files.config), "application/json"]],
      ["/runtime-audio.tpk", [packageBytes, "application/octet-stream"]],
    ]);
    server = createServer((request, response) => {
      const route = routes.get(request.url?.split("?", 1)[0]);
      if (route === undefined) { response.writeHead(404).end(); return; }
      const [bytes, type] = route;
      response.writeHead(200, { "content-type": type, "content-security-policy": csp, "content-length": bytes.length, "cache-control": "no-store" }).end(bytes);
    });
    await new Promise((done, failed) => { server.once("error", failed); server.listen(0, "127.0.0.1", done); });
    expectedOrigin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = await import("@playwright/test");
    const profile = join(bundleDir, "chromium-profile");
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    page = browser.pages()[0] ?? await browser.newPage();
    await page.goto(`${expectedOrigin}/index.html`);
    result.engineVersion = browser.browser()?.version() ?? null;
    sampledMemory = () => processRss({ profile });
  } else if (host === "electron") {
    expectedOrigin = "app://player";
    const { _electron } = await import("@playwright/test");
    const desktop = join(root, "packages", "runner-desktop", "dist");
    result.artifacts.electronMainSha256 = sha(readFileSync(join(desktop, "main.js")));
    result.artifacts.electronPreloadSha256 = sha(readFileSync(join(desktop, "preload.js")));
    electron = await _electron.launch({
      executablePath: electronBinary(),
      args: [desktop, "--serve", bundleDir, "--game", packagePath, "--page", "index.html", "--user-data-dir", join(bundleDir, "electron-user-data")],
      timeout: 90_000,
    });
    page = await electron.firstWindow();
    sampledMemory = () => processRss({ pid: electron.process().pid });
    result.engineVersion = await electron.evaluate(() => process.versions.electron);
  } else {
    expectedOrigin = "https://localhost";
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME ?? "", "Library", "Android", "sdk");
    android = await launchAndroidProbe({
      root, bundleDir, files, packagePath, result,
      adbPath: argument("--adb", join(sdk, "platform-tools", "adb")), avdName: argument("--avd", "Pixel_3a_API_33_arm64-v8a"),
    });
    page = android.page;
    sampledMemory = async () => {
      const parsed = /TOTAL PSS:\s+(\d+)\s+TOTAL RSS:\s+(\d+)/.exec(await android.sampleMemory());
      return parsed === null ? null : { pssKb: Number(parsed[1]), rssKb: Number(parsed[2]) };
    };
  }
  page.on("pageerror", (error) => { (result.pageErrors ??= []).push(String(error)); });
  page.on("console", (message) => { if (message.type() === "error") (result.consoleErrors ??= []).push(message.text()); });
  const wav = await runEncoding(page, expectedOrigin, "wav");
  result.wavProbe = wav.probe;
  result.wavMemory = wav.memory;
  result.wavAssertions = wav.assertions;
  const opus = await runEncoding(page, expectedOrigin, "opus");
  result.probe = opus.probe;
  result.memory = opus.memory;
  result.assertions = { ...opus.assertions, matchedWavRunPassed: allPassed(wav.assertions), noPageErrors: (result.pageErrors?.length ?? 0) === 0 };
  result.outcome = allPassed(result.assertions) ? "passed" : "completed-with-unproven-or-failed-assertions";
} catch (error) {
  result.outcome = "failed";
  result.error = String(error?.stack ?? error);
} finally {
  await browser?.close().catch(() => {});
  await electron?.close().catch(() => {});
  if (server) await new Promise((done) => server.close(done));
  try { await android?.close(); } catch (error) { result.outcome = "failed"; result.cleanupError = String(error); }
  result.finishedAt = new Date().toISOString();
  const destination = join(outputDir, `${host}-${rate}-${fixture}-${id}.json`);
  writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ ...result, artifact: destination }, null, 2));
  if (result.outcome !== "passed") process.exitCode = 1;
}
