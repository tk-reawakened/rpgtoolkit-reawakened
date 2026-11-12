import { spawn } from "node:child_process";

process.once("disconnect", () => {
  if (process.platform !== "win32") process.kill(-process.pid, "SIGKILL");
  else process.exit(0); // The Windows job owner terminates the remaining descendants on pipe EOF.
});

const child = spawn(process.execPath, process.argv.slice(2), {
  env: process.env,
  stdio: "inherit",
});

child.once("spawn", () => {
  process.send({ type: "root", pid: child.pid });
});
child.once("error", (error) => {
  process.send({ type: "error", message: error.message });
});
child.once("exit", (code, signal) => {
  process.send({ type: "exit", code, signal });
});
