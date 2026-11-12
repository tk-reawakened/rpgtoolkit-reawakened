import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const supervisor = spawn(process.execPath, [
  fileURLToPath(new URL("./watch-supervisor.mjs", import.meta.url)),
  fileURLToPath(new URL("../../dist/cli.js", import.meta.url)),
  "script", "test", process.argv[2], "--watch", "--reporter", "junit", "--out", process.argv[3],
], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
supervisor.once("spawn", () => { process.send({ type: "group", pid: supervisor.pid }); });
supervisor.once("error", (error) => { process.send({ type: "error", message: error.message }); });
