import { readFileSync } from "node:fs";
import { join } from "node:path";

export function parseDebuggerPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** Chromium writes the OS-assigned remote-debugging port into its profile-specific file. */
export function browserDebuggingPort(userDataDirectory, readFile = readFileSync) {
  try {
    const contents = readFile(join(userDataDirectory, "DevToolsActivePort"), "utf8");
    const match = /^(\d+)\r?\n/.exec(contents);
    return match === null ? null : parseDebuggerPort(match[1]);
  } catch (error) {
    switch (error?.code) {
      case "ENOENT":
      case "EBUSY":
      case "EPERM":
        return null;
      default:
        throw error;
    }
  }
}

/** Poll until a debugger publishes its port, or Electron exits or the bounded startup deadline expires. */
export async function waitForDebuggerPort(
  description,
  getPort,
  stopped,
  {
    attempts = 200,
    intervalMs = 100,
    delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = getPort();
    if (port !== null) return port;
    const exit = await Promise.race([
      stopped.then((result) => ({ result })),
      delay(intervalMs).then(() => null),
    ]);
    if (exit !== null) {
      const { code, signal } = exit.result;
      throw new Error(`Electron exited before ${description} became available (code ${code}, signal ${signal})`);
    }
  }
  throw new Error(`Electron did not publish its ${description} within ${attempts * intervalMs / 1000} seconds`);
}
