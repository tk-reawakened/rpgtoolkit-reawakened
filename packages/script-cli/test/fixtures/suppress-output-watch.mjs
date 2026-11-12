// Model an output file created and deleted before a recursive watcher discovers it.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const watch = fs.watch;
fs.watch = (...args) => {
  const index = args.length - 1;
  const listener = args[index];
  if (typeof listener === "function") {
    args[index] = (event, filename) => {
      if (filename?.toString() !== "report.xml") listener(event, filename);
    };
  }
  return watch(...args);
};
syncBuiltinESMExports();
