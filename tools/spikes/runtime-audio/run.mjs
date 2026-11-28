// Run one host at a time. Optional --adb and --avd select local Android tooling and a disposable AVD.
import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const at = args.indexOf("--fixture");
const fixtures = at === -1 ? ["short", "long"] : [args[at + 1]];
const host = args[args.indexOf("--host") + 1];
if (!args.includes("--host") || !["browser", "electron", "capacitor"].includes(host)) {
  throw new Error("Usage: node tools/spikes/runtime-audio/run.mjs --host browser|electron|capacitor --rate 44100|48000 [--fixture short|long]");
}
const probe = fileURLToPath(new URL("./host-probe.mjs", import.meta.url));
for (const fixture of fixtures) {
  if (fixture !== fixtures[0]) await delay(2500);
  if (process.platform !== "win32") {
    const processes = execFileSync("ps", ["-axo", "pcpu=,command="], { encoding: "utf8" });
    const forbidden = processes.split("\n").filter((line) => {
      // Match process executables, not shell text or Electron-based apps such as VS Code.
      const [, cpu, command] = /^\s*(\d+(?:\.\d+)?)\s+(.+)$/.exec(line) ?? [];
      if (command === undefined) return false;
      if (/^[^\n]*?\/qemu-system-[^\s]+ /.test(command)) return true;
      return /^[^\n]*?\/chrome-headless-shell |^[^\n]*?\/Electron(?:\.exe)? .*runner-desktop[\/\\]dist\b/.test(command)
        || /\sorg\.gradle\.wrapper\.GradleWrapperMain .*assembleDebug/.test(command)
        || (Number(cpu) >= 20 && /\sorg\.gradle\.launcher\.daemon\.bootstrap\.GradleDaemon\b/.test(command));
    });
    if (forbidden.length) throw new Error(`Another host proof or active Gradle build is running: ${forbidden[0].trim().slice(0, 240)}`);
  }
  const child = spawnSync(process.execPath, [probe, ...args, ...(at === -1 ? ["--fixture", fixture] : [])], { stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = 1;
}
