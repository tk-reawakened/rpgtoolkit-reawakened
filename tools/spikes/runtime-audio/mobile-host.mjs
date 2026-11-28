import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { stopChild } from "../../desktop/child-process.mjs";
import { attachPage, boundedAttach, closeDevice, selectDevice } from "../../mobile/proof-android.mjs";

const require = createRequire(import.meta.url), exec = promisify(execFile);
const localAdb = { host: "127.0.0.1", port: 5037 };
const localAdbArgs = ["-H", localAdb.host, "-P", String(localAdb.port)];
const localAdbEnv = { ...process.env };
for (const key of ["ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_ADB_SERVER_PORT", "ADB_SERVER_PORT"]) delete localAdbEnv[key];

const command = (bin, argv, { cwd, timeout = 60_000, env = process.env } = {}) => {
  const result = spawnSync(bin, argv, { cwd, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024, env });
  if (result.error) throw new Error(`${bin} ${argv.join(" ")}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${bin} ${argv.join(" ")} exited ${result.status}: ${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};

function adbDevices(adb) {
  return adb(["devices", "-l"]).split(/\r?\n/u).slice(1).map((line) => {
    const [serial, state] = line.trim().split(/\s+/u);
    const transport = /\btransport_id:(\d+)\b/u.exec(line)?.[1] ?? null;
    return serial ? { serial, state, transport } : null;
  }).filter(Boolean);
}

function isAlive(child) {
  return child !== undefined && child.exitCode === null && child.signalCode === null;
}

function sleep(ms) {
  return delay(ms);
}

async function retry(description, operation, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let pauseMs = 200;
  let lastError;
  while (Date.now() < until) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await sleep(pauseMs);
      pauseMs = Math.min(3000, Math.ceil(pauseMs * 1.5));
    }
  }
  throw new Error(`${description} timed out: ${String(lastError)}`);
}

function copyProbeBundle({ root, bundleDir, files, packagePath }) {
  const mobileRoot = join(root, "packages", "runner-mobile");
  const stage = join(bundleDir, "capacitor");
  const dist = join(stage, "dist");
  mkdirSync(join(dist, "public"), { recursive: true });
  copyFileSync(join(mobileRoot, "package.json"), join(stage, "package.json"));
  copyFileSync(join(mobileRoot, "capacitor.config.json"), join(stage, "capacitor.config.json"));
  symlinkSync(join(mobileRoot, "node_modules"), join(stage, "node_modules"), "junction");
  for (const [source, name] of [[files.html, "index.html"], [files.page, "probe.js"], [files.worklet, "probe-worklet.js"], [files.config, "probe-config.json"]]) {
    copyFileSync(source, join(dist, name));
  }
  copyFileSync(packagePath, join(dist, "public", "runtime-audio.tpk"));
  return stage;
}

export async function launchAndroidProbe({ root, bundleDir, files, packagePath, adbPath, avdName, result }) {
  let ownEmulator;
  let emulatorData;
  let androidDevice;
  let serial;
  let closePromise;
  const errors = [];
  const stage = copyProbeBundle({ root, bundleDir, files, packagePath });
  const appId = JSON.parse(readFileSync(join(stage, "capacitor.config.json"), "utf8")).appId;
  if (typeof appId !== "string" || appId.length === 0) throw new Error("Capacitor config has no appId");
  const adb = (args, options) => command(adbPath, [...localAdbArgs, ...args], { ...options, env: localAdbEnv });

  const close = () => {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      if (androidDevice) {
        try {
          await closeDevice(androidDevice, 5000);
        } catch (error) {
          errors.push(new Error(`Could not close Android Playwright device: ${String(error)}`));
        }
        androidDevice = undefined;
      }
      if (ownEmulator) {
        const stopped = await stopChild(ownEmulator);
        if (!stopped.exited) {
          errors.push(new Error("Android emulator did not exit after bounded shutdown; disposable userdata was retained"));
        } else {
          ownEmulator = undefined;
          if (emulatorData) {
            try {
              rmSync(emulatorData, { recursive: true, force: true });
              emulatorData = undefined;
            } catch (error) {
              errors.push(new Error(`Could not remove disposable Android userdata: ${String(error)}`));
            }
          }
        }
      }
      if (errors.length) throw new AggregateError(errors, "Android probe cleanup failed");
    })();
    return closePromise;
  };

  try {
    const javaHome = process.env.JAVA_HOME ?? "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home";
    if (!existsSync(javaHome)) throw new Error(`JDK 21 required by the Android proof is unavailable: ${javaHome}`);
    const env = { ...process.env, JAVA_HOME: javaHome, PATH: `${join(javaHome, "bin")}${delimiter}${process.env.PATH ?? ""}` };
    const capacitorBin = join(dirname(require.resolve("@capacitor/cli/package.json")), "bin", "capacitor");
    command(process.execPath, [capacitorBin, "add", "android"], { cwd: stage, env, timeout: 120_000 });
    const gradleBuilder = join(root, "tools", "mobile", "gradle-build.mjs");
    const buildOut = join(bundleDir, "gradle-output");
    command(process.execPath, [gradleBuilder, "--cwd", join(stage, "android"), "--out", buildOut, "--attempts", "1", "--delays", "0", "--deadline-ms", "900000"], {
      cwd: root, env, timeout: 960_000,
    });
    const apk = join(buildOut, "app-debug.apk");
    const apkBytes = readFileSync(apk);
    result.apkSha256 = createHash("sha256").update(apkBytes).digest("hex");

    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME ?? "", "Library", "Android", "sdk");
    const emulator = join(sdk, "emulator", "emulator");
    const devicesBefore = adbDevices(adb);
    const occupied = devicesBefore.filter(({ serial: deviceSerial }) => /^emulator-\d+$/u.test(deviceSerial));
    if (occupied.length) throw new Error(`Refusing to reuse existing Android emulator(s), including offline devices: ${occupied.map(({ serial: deviceSerial }) => deviceSerial).join(", ")}`);
    if (devicesBefore.length) throw new Error(`Refusing to use an external Android device: ${devicesBefore.map(({ serial: deviceSerial, state }) => `${deviceSerial} (${state})`).join(", ")}`);
    const avds = command(emulator, ["-list-avds"]).split(/\r?\n/u).filter(Boolean);
    if (!avds.includes(avdName)) throw new Error(`Android SDK has no configured AVD named ${avdName}`);
    serial = "emulator-5566";
    emulatorData = join(bundleDir, "android-userdata");
    mkdirSync(emulatorData, { recursive: true });
    const logFd = openSync(join(bundleDir, "emulator.log"), "w");
    try {
      ownEmulator = spawn(emulator, [
        "-avd", avdName, "-port", "5566", "-datadir", emulatorData, "-sdcard", join(emulatorData, "sdcard.img"), "-no-cache",
        "-partition-size", "4096", "-no-snapshot", "-no-window", "-no-boot-anim", "-gpu", "swiftshader_indirect",
      ], { env: localAdbEnv, stdio: ["ignore", logFd, logFd] });
    } finally {
      closeSync(logFd);
    }
    const transport = await retry(`Android AVD ${avdName} boot`, () => {
      if (!isAlive(ownEmulator)) throw new Error("owned emulator process exited during startup");
      const listed = adbDevices(adb).find(({ serial: listedSerial }) => listedSerial === serial);
      if (listed?.state !== "device" || listed.transport === null) throw new Error(`owned emulator ${serial} has no online ADB transport`);
      const observedAvd = adb(["-s", serial, "emu", "avd", "name"]);
      if (observedAvd.split(/\r?\n/u)[0] !== avdName) throw new Error(`serial ${serial} belongs to unexpected AVD ${observedAvd}`);
      if (adb(["-t", listed.transport, "shell", "getprop", "sys.boot_completed"]) !== "1") throw new Error("Android is booting");
      return listed.transport;
    }, 240_000);
    if (!isAlive(ownEmulator)) throw new Error("owned emulator process exited before APK install");
    const ownership = adb(["-s", serial, "emu", "avd", "name"]);
    const binding = adbDevices(adb).find((listed) => listed.serial === serial && listed.state === "device" && listed.transport === transport);
    if (ownership.split(/\r?\n/u)[0] !== avdName || binding === undefined) throw new Error(`ADB console and transport no longer identify the same owned emulator`);
    const deviceArgs = (parts) => ["-t", transport, ...parts];
    result.androidDataPartition = adb(deviceArgs(["shell", "df", "-k", "/data"]));
    adb(deviceArgs(["install", apk]), { timeout: 120_000 });
    adb(deviceArgs(["shell", "am", "start", "-n", `${appId}/.MainActivity`]));
    const pid = await retry("Capacitor player process", () => {
      if (!isAlive(ownEmulator)) throw new Error("owned emulator exited while launching player");
      const found = adb(deviceArgs(["shell", "pidof", appId])).split(/\s+/u)[0];
      if (!found) throw new Error("player process not available");
      return found;
    }, 60_000);
    const { _android } = await import("@playwright/test");
    androidDevice = await selectDevice(_android, serial, 15_000, localAdb);
    const page = await attachPage(androidDevice, appId, pid, 45_000);
    const ready = await boundedAttach("reading Android probe button readiness", () => page.evaluate(() => document.querySelector("#unlock") !== null && window.__runtimeAudioProbe !== undefined), 4000);
    if (!ready) throw new Error("packaged Android probe button is not ready");
    result.device = {
      serial, transport,
      api: adb(deviceArgs(["shell", "getprop", "ro.build.version.sdk"])),
      release: adb(deviceArgs(["shell", "getprop", "ro.build.version.release"])),
      model: adb(deviceArgs(["shell", "getprop", "ro.product.model"])),
    };
    const sampleMemory = async () => (await exec(adbPath, [...localAdbArgs, ...deviceArgs(["shell", "dumpsys", "meminfo", appId])], { env: localAdbEnv, timeout: 5000 })).stdout;
    return { page, sampleMemory, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Android probe startup failed and cleanup was unsuccessful");
    }
    throw error;
  }
}
