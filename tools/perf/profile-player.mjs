// profile-player: profile the live web player (the same page the editor's Run panel loads) while walking the player.
//
//   node tools/perf/profile-player.mjs [--package demo] [--seconds 8] [--out .perf] [--headed] [--swiftshader] [--port 4173]
//                                      [--executable <chromium binary>]
//
// Needs `pnpm build`, `pnpm browser:build`, `pnpm fixtures:fetch` and the package built under `fixtures/packages/`
// (see tools/perf/README.md). The script starts `tools/browser/serve.mjs` itself unless something already answers on
// the port. It writes `<out>/<package>.cpuprofile` (open it in Chrome DevTools > Performance) and prints frame timing,
// tick rate, long tasks and the hottest functions by self and inclusive time.
//
// `--swiftshader` forces software GL, which is what a GPU-less container has; leave it off on a real machine, because
// software GL caps the frame rate and hides whether the JavaScript or the GPU is the limit.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { summarizeProfile } from "./summarize-profile.mjs";

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}
const pack = option("package", "demo");
const seconds = Number(option("seconds", "8"));
const out = option("out", ".perf");
const port = Number(option("port", "4173"));
const headed = process.argv.includes("--headed");
const swiftshader = process.argv.includes("--swiftshader");
const executablePath = option("executable", undefined);
const origin = `http://127.0.0.1:${port}`;

async function healthy() {
  try {
    return (await fetch(`${origin}/health`)).ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await healthy())) {
  server = spawn(process.execPath, ["tools/browser/serve.mjs", "--port", String(port)], { stdio: "ignore" });
  for (let attempt = 0; attempt < 50 && !(await healthy()); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100 * Math.min(attempt + 1, 5)));
  if (!(await healthy())) throw new Error(`the player server did not start on ${origin}`);
}

const args = ["--autoplay-policy=no-user-gesture-required"];
if (swiftshader) args.push("--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
const browser = await chromium.launch({ headless: !headed, args, ...(executablePath === undefined ? {} : { executablePath }) });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on("pageerror", (error) => console.log("pageerror", error.message));
  await page.goto(`${origin}/packages/runner-web/app/index.html?package=fixtures/packages/${pack}.tpk`);
  await page.waitForFunction(() => window.__live !== undefined && window.__live.tick > 30, null, { timeout: 120_000 });

  // Frame intervals and long tasks, measured inside the page.
  await page.evaluate(() => {
    window.__perfFrames = [];
    window.__perfLong = [];
    let last = performance.now();
    const loop = (now) => {
      window.__perfFrames.push(now - last);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perfLong.push(entry.duration);
    }).observe({ entryTypes: ["longtask"] });
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const tickBefore = await page.evaluate(() => window.__live.tick);
  const started = Date.now();
  await page.locator("canvas").first().click({ force: true }).catch(() => {});
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
  for (let index = 0; Date.now() - started < seconds * 1000; index += 1) {
    const key = keys[index % keys.length];
    await page.keyboard.down(key);
    await page.waitForTimeout(700);
    await page.keyboard.up(key);
    await page.waitForTimeout(100);
  }
  const wall = (Date.now() - started) / 1000;
  const { profile } = await cdp.send("Profiler.stop");
  const tickAfter = await page.evaluate(() => window.__live.tick);
  const frames = await page.evaluate(() => window.__perfFrames);
  const long = await page.evaluate(() => window.__perfLong);

  mkdirSync(out, { recursive: true });
  const file = join(out, `${pack}.cpuprofile`);
  writeFileSync(file, JSON.stringify(profile));
  const sorted = [...frames].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]?.toFixed(1);
  console.log(JSON.stringify({
    package: pack,
    gl: swiftshader ? "swiftshader" : "default",
    wallSeconds: wall,
    ticksPerSecond: Number(((tickAfter - tickBefore) / wall).toFixed(1)),
    fps: Number((frames.length / wall).toFixed(1)),
    frameMs: { p50: percentile(0.5), p90: percentile(0.9), p99: percentile(0.99), max: sorted.at(-1)?.toFixed(1) },
    longTasks: long.length,
    longTaskMs: Math.round(long.reduce((sum, value) => sum + value, 0)),
    profile: file,
  }, null, 2));
  console.log(summarizeProfile(profile, 25));
} finally {
  await browser.close();
  server?.kill();
}
