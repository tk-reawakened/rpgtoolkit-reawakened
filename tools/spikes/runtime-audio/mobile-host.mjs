import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { stopChild } from "../../desktop/child-process.mjs";
import { attachPage, boundedAttach, closeDevice, selectDevice } from "../../mobile/proof-android.mjs";
import { createPrivateAdbBridge, assertOwnedDevice, assertPrivateAdbAlive, assertPrivateOwnedTransport } from "../../mobile/private-adb.mjs";

const require = createRequire(import.meta.url);

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
async function freeEmulatorPorts() {
  for (let consolePort = 5554; consolePort <= 5682; consolePort += 2) {
    const listeners = [];
    try {
      for (const port of [consolePort, consolePort + 1]) {
        const listener = net.createServer();
        listeners.push(listener);
        await new Promise((resolve, reject) => {
          listener.once("error", reject);
          listener.listen(port, "127.0.0.1", resolve);
        });
      }
      return { consolePort, adbPort: consolePort + 1 };
    } catch {
      // Keep searching; the selected pair is checked again by the emulator process.
    } finally {
      await Promise.all(listeners.filter((listener) => listener.listening)
        .map((listener) => new Promise((resolve) => listener.close(resolve))));
    }
  }
  throw new Error("no free Android emulator console/ADB port pair in 5554–5683");
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
  let privateAdb;
  const adb = (args, options) => {
    assertPrivateAdbAlive(privateAdb);
    const output = command(adbPath, [...privateAdb.args, ...args], { ...options, env: privateAdb.env });
    assertPrivateAdbAlive(privateAdb);
    return output;
  };

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
      if (privateAdb) {
        try {
          await privateAdb.close();
        } catch (error) {
          errors.push(new Error(`Could not stop private Android ADB daemon: ${String(error)}`));
        }
        privateAdb = undefined;
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
    const avds = command(emulator, ["-list-avds"]).split(/\r?\n/u).filter(Boolean);
    if (!avds.includes(avdName)) throw new Error(`Android SDK has no configured AVD named ${avdName}`);
    const ports = await freeEmulatorPorts();
    serial = `emulator-${ports.consolePort}`;
    emulatorData = join(bundleDir, "android-userdata");
    mkdirSync(emulatorData, { recursive: true });
    privateAdb = await createPrivateAdbBridge(adbPath, bundleDir, ports.consolePort);
    const emulatorLog = join(bundleDir, "emulator.log");
    const logFd = openSync(emulatorLog, "w");
    try {
      ownEmulator = spawn(emulator, [
        "-avd", avdName, "-ports", `${ports.consolePort},${ports.adbPort}`, "-datadir", emulatorData, "-sdcard", join(emulatorData, "sdcard.img"), "-no-cache",
        "-partition-size", "4096", "-no-snapshot", "-no-window", "-no-boot-anim", "-gpu", "swiftshader_indirect",
      ], { env: privateAdb.env, stdio: ["ignore", logFd, logFd] });
    } finally {
      closeSync(logFd);
    }
    await retry("private Android ADB server socket", () => {
      assertPrivateAdbAlive(privateAdb);
      return existsSync(privateAdb.socketPath) ? true : Promise.reject(new Error("private adb socket is not ready"));
    }, 5000);
    const transport = await retry(`Android AVD ${avdName} boot`, () => {
      if (!isAlive(ownEmulator)) throw new Error("owned emulator process exited during startup");
      if (readFileSync(emulatorLog, "utf8").includes("Unable to connect to adb daemon on port: 5037")) {
        throw new Error("emulator attempted the shared default ADB server port instead of its private relay");
      }
      const listed = assertOwnedDevice(adbDevices(adb), serial);
      const observedAvd = adb(["-s", serial, "emu", "avd", "name"]).split(/\r?\n/u)[0];
      if (observedAvd !== avdName) throw new Error(`emulator console reported unexpected AVD ${observedAvd}`);
      if (!isAlive(ownEmulator)) throw new Error("owned emulator process exited during boot verification");
      if (adb(["-t", listed.transport, "shell", "getprop", "sys.boot_completed"]) !== "1") throw new Error("Android is booting");
      return listed.transport;
    }, 240_000);
    const verifyTransport = () => {
      if (!isAlive(ownEmulator)) throw new Error("owned emulator process exited; refusing device access");
      const devices = adbDevices(adb);
      const owned = assertPrivateOwnedTransport(privateAdb, devices, serial, transport);
      const observedAvd = adb(["-s", serial, "emu", "avd", "name"]).split(/\r?\n/u)[0];
      if (observedAvd !== avdName || !isAlive(ownEmulator)) {
        throw new Error("owned emulator process or console identity changed; refusing device access");
      }
      return ["-t", owned.transport];
    };
    result.androidDataPartition = adb([...verifyTransport(), "shell", "df", "-k", "/data"]);
    adb([...verifyTransport(), "install", apk], { timeout: 120_000 });
    adb([...verifyTransport(), "shell", "am", "start", "-n", `${appId}/.MainActivity`]);
    const pid = await retry("Capacitor player process", () => {
      if (!isAlive(ownEmulator)) throw new Error("owned emulator exited while launching player");
      const found = adb([...verifyTransport(), "shell", "pidof", appId]).split(/\s+/u)[0];
      if (!found) throw new Error("player process not available");
      return found;
    }, 60_000);
    const { _android } = await import("@playwright/test");
    androidDevice = await selectDevice(_android, serial, 15_000, privateAdb.client);
    const page = await attachPage(androidDevice, appId, pid, 45_000);
    const ready = await boundedAttach("reading Android probe button readiness", () => page.evaluate(() => document.querySelector("#unlock") !== null && window.__runtimeAudioProbe !== undefined), 4000);
    if (!ready) throw new Error("packaged Android probe button is not ready");
    result.device = {
      serial, transport, consolePort: ports.consolePort, adbPort: ports.adbPort,
      emulatorProcessAlive: isAlive(ownEmulator),
      api: adb([...verifyTransport(), "shell", "getprop", "ro.build.version.sdk"]),
      release: adb([...verifyTransport(), "shell", "getprop", "ro.build.version.release"]),
      model: adb([...verifyTransport(), "shell", "getprop", "ro.product.model"]),
    };
    const sampleMemory = async () => adb([...verifyTransport(), "shell", "dumpsys", "meminfo", appId], { timeout: 5000 });
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
