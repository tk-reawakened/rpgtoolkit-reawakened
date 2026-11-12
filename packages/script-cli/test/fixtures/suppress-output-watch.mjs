// Model an output file created and deleted before a recursive watcher discovers it.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
if (process.env.TKR_WATCH_READY && process.argv[1]?.endsWith("cli.js")) {
  let reported = false;
  let port;
  const publish = () => {
    if (!reported || port === undefined) return;
    const temporary = `${process.env.TKR_WATCH_READY}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ pid: process.pid, port }));
    fs.renameSync(temporary, process.env.TKR_WATCH_READY);
  };
  // The parent holds an accepted connection until this real CLI process exits.
  const lease = createServer((socket) => { socket.resume(); });
  lease.listen(0, "127.0.0.1", () => {
    port = lease.address().port;
    publish();
  });
  const write = process.stderr.write;
  process.stderr.write = function (chunk, ...args) {
    const result = write.call(this, chunk, ...args);
    if (String(chunk).includes("1 passed, 0 failed")) {
      reported = true;
      publish();
    }
    return result;
  };
}
const watch = fs.watch;
fs.watch = (...args) => {
  const index = args.length - 1;
  const listener = args[index];
  if (typeof listener === "function") {
    args[index] = (event, filename) => {
      if (process.env.TKR_WATCH_READY && filename?.toString() === "case.spec.prg") return;
      if (filename?.toString() !== "report.xml") listener(event, filename);
    };
  }
  return watch(...args);
};
syncBuiltinESMExports();
