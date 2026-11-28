import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { assertOwnedDevice, assertPrivateAdbAlive, assertPrivateOwnedTransport, createPrivateAdbBridge } from "../private-adb.mjs";

const serial = "127.0.0.1:5567";
const device = (id = "9", name = serial, state = "device") => ({ serial: name, state, transport: id });

test("private ADB admits only its sole owned online emulator and stable transport", () => {
  assert.deepEqual(assertOwnedDevice([device()], serial), device());
  assert.throws(() => assertOwnedDevice([], serial), /exactly one/u);
  assert.throws(() => assertOwnedDevice([device(), device("10", "other")], serial), /exactly one/u);
  assert.throws(() => assertOwnedDevice([device("9", "other")], serial), /owned emulator/u);
  assert.throws(() => assertOwnedDevice([device("9", serial, "offline")], serial), /online owned emulator/u);
  assert.throws(() => assertOwnedDevice([device("10")], serial, "9"), /transport changed/u);
});

test("a recycled transport id from a restarted daemon cannot satisfy the old binding", () => {
  const bridge = { daemon: { exitCode: 1, signalCode: null }, server: { listening: true } };
  assert.throws(() => assertPrivateOwnedTransport(bridge, [device("1")], serial, "1"), /refusing device access/u);
});

test("private ADB loses its write gate when the daemon or guarded endpoint is lost", () => {
  const bridge = { daemon: { exitCode: null, signalCode: null }, server: { listening: true }, emulatorServer: { listening: true } };
  assert.equal(assertPrivateAdbAlive(bridge), undefined);
  bridge.daemon.exitCode = 0;
  assert.throws(() => assertPrivateAdbAlive(bridge), /refusing device access/u);
  bridge.daemon.exitCode = null;
  bridge.daemon.signalCode = "SIGTERM";
  assert.throws(() => assertPrivateAdbAlive(bridge), /refusing device access/u);
  bridge.daemon.signalCode = null;
  bridge.server.listening = false;
  assert.throws(() => assertPrivateAdbAlive(bridge), /refusing device access/u);
  bridge.server.listening = true;
  bridge.emulatorServer.listening = false;
  assert.throws(() => assertPrivateAdbAlive(bridge), /refusing device access/u);
});

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(process.env.HOME ?? "", "Library", "Android", "sdk");
const adbPath = join(sdk, "platform-tools", "adb");
test("lost private ADB cannot auto-restart behind the guarded loopback endpoint", { skip: !existsSync(adbPath), timeout: 10_000 }, async () => {
  const bridge = await createPrivateAdbBridge(adbPath, process.cwd());
  try {
    assert.equal(bridge.env.ADB_USB, "0");
    assert.equal(bridge.env.ADB_EMU, "0");
    assert.equal(bridge.env.ADB_MDNS, "0");
    assert.equal(bridge.env.ANDROID_ADB_SERVER_PORT, String(bridge.emulatorServer.address().port));
    assert.equal(bridge.env.ADB_SERVER_SOCKET, `localfilesystem:${bridge.socketPath}`);
    assert.equal(statSync(dirname(bridge.socketPath)).mode & 0o222, 0);
    assert.match(execFileSync(adbPath, ["devices", "-l"], { encoding: "utf8", env: bridge.env, timeout: 3000 }), /List of devices attached/u);
    const exited = new Promise((resolve) => bridge.daemon.once("exit", resolve));
    bridge.daemon.kill("SIGTERM");
    await exited;
    assert.throws(() => assertPrivateAdbAlive(bridge), /refusing device access/u);
    assert.throws(() => execFileSync(adbPath, ["devices"], { encoding: "utf8", env: bridge.env, timeout: 3000, stdio: "ignore" }));
    assert.throws(() => assertPrivateOwnedTransport(bridge, [device("1")], serial, "1"), /refusing device access/u);
    assert.equal(bridge.server.listening, true);
    assert.equal(bridge.emulatorServer.listening, true);
    assert.equal(statSync(dirname(bridge.socketPath)).mode & 0o222, 0);
  } finally {
    await bridge.close();
  }
});
