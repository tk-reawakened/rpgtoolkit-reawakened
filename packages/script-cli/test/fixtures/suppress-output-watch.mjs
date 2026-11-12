// Model an output file created and deleted before a recursive watcher discovers it.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
if (process.env.TKR_WATCH_READY && process.argv[1]?.endsWith("cli.js")) {
  const write = process.stderr.write;
  process.stderr.write = function (chunk, ...args) {
    const result = write.call(this, chunk, ...args);
    if (String(chunk).includes("1 passed, 0 failed")) {
      const temporary = `${process.env.TKR_WATCH_READY}.tmp`;
      fs.writeFileSync(temporary, String(process.pid));
      fs.renameSync(temporary, process.env.TKR_WATCH_READY);
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
