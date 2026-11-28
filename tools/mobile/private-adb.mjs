import { chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";

export function assertOwnedDevice(devices, serial, transport) {
  if (!Array.isArray(devices) || devices.length !== 1) {
    throw new Error(`private ADB expected exactly one device, got ${Array.isArray(devices) ? devices.length : "invalid listing"}`);
  }
  const [device] = devices;
  if (device.serial !== serial || device.state !== "device" || !/^\d+$/u.test(device.transport ?? "")) {
    throw new Error(`private ADB did not contain the online owned emulator ${serial}`);
  }
  if (transport !== undefined && device.transport !== transport) {
    throw new Error(`private ADB transport changed: expected ${transport}, got ${device.transport}`);
  }
  return device;
}

export function assertPrivateAdbAlive(bridge) {
  if (!bridge || bridge.daemon.exitCode !== null || bridge.daemon.signalCode !== null
    || !bridge.server.listening || !bridge.emulatorServer.listening) {
    throw new Error("private Android ADB daemon or guarded endpoint was lost; refusing device access");
  }
}

export function assertPrivateOwnedTransport(bridge, devices, serial, transport) {
  assertPrivateAdbAlive(bridge);
  return assertOwnedDevice(devices, serial, transport);
}
export function assertOwnedProcessTreeListeners(rootPid, listenersByPort, processRows) {
  const owned = new Set([rootPid]);
  let changed;
  do {
    changed = false;
    for (const { pid, ppid } of processRows) {
      if (owned.has(ppid) && !owned.has(pid)) {
        owned.add(pid);
        changed = true;
      }
    }
  } while (changed);
  for (const [port, pids] of Object.entries(listenersByPort)) {
    if (!Array.isArray(pids) || !pids.some((pid) => owned.has(pid))) {
      throw new Error(`emulator process tree does not own listening port ${port}`);
    }
  }
  return owned;
}

export async function createPrivateAdbBridge(adbPath, bundleDir, maxLocalTransportPort = 5554) {
  const tempDir = mkdtempSync(join(tmpdir(), "tkr-adb-"));
  const socketPath = join(tempDir, "s");
  const env = { ...process.env, ADB_USB: "0", ADB_EMU: "0", ADB_MDNS: "0", ADB_LOCAL_TRANSPORT_MAX_PORT: String(maxLocalTransportPort) };
  for (const key of ["ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_ADB_SERVER_PORT", "ADB_SERVER_PORT"]) delete env[key];
  let daemon, server, emulatorServer, closing;
  const sockets = new Set();
  const relay = () => net.createServer((client) => {
    if (!daemon || daemon.exitCode !== null || daemon.signalCode !== null) {
      client.destroy();
      return;
    }
    const backend = net.createConnection({ path: socketPath });
    sockets.add(client);
    sockets.add(backend);
    client.on("close", () => sockets.delete(client));
    backend.on("close", () => sockets.delete(backend));
    client.pipe(backend);
    backend.pipe(client);
    backend.on("error", () => client.destroy());
    client.on("error", () => backend.destroy());
  });
  const listenLoopback = async (listener) => new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const closeListener = async (listener) => {
    if (listener?.listening) await new Promise((resolve) => listener.close(resolve));
  };
  try {
    server = relay();
    emulatorServer = relay();
    await listenLoopback(server);
    await listenLoopback(emulatorServer);
    const emulatorPort = emulatorServer.address().port;
    daemon = spawn(adbPath, ["-L", `localfilesystem:${socketPath}`, "server", "nodaemon"], {
      env, cwd: bundleDir, stdio: "ignore",
    });
    const deadline = Date.now() + 5000;
    while (!existsSync(socketPath) && daemon.exitCode === null && daemon.signalCode === null && Date.now() < deadline) {
      await delay(25);
    }
    if (!existsSync(socketPath) || daemon.exitCode !== null || daemon.signalCode !== null) {
      throw new Error("private Android ADB daemon did not start");
    }
    env.ADB_SERVER_SOCKET = `localfilesystem:${socketPath}`;
    env.ANDROID_ADB_SERVER_PORT = String(emulatorPort);
    chmodSync(tempDir, 0o500);
    const bridge = {
      daemon, server, emulatorServer, socketPath, tempDir, env, args: [],
      client: { host: "127.0.0.1", port: server.address().port },
      close: () => {
        if (closing) return closing;
        closing = (async () => {
          for (const socket of sockets) socket.destroy();
          await closeListener(server);
          await closeListener(emulatorServer);
          if (daemon.exitCode === null && daemon.signalCode === null) {
            daemon.kill("SIGTERM");
            await new Promise((resolve) => {
              if (daemon.exitCode !== null || daemon.signalCode !== null) resolve();
              else daemon.once("exit", resolve);
            });
          }
          chmodSync(tempDir, 0o700);
          rmSync(tempDir, { recursive: true, force: true });
        })();
        return closing;
      },
    };
    return bridge;
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await closeListener(server);
    await closeListener(emulatorServer);
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill("SIGTERM");
      await new Promise((resolve) => daemon.once("exit", resolve));
    }
    chmodSync(tempDir, 0o700);
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}
