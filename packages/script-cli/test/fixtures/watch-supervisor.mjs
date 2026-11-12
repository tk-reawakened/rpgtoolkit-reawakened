import { spawn } from "node:child_process";

process.once("disconnect", () => process.exit(0));

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
