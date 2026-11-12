// Loaded only by the cancellation proof: retain real watchers but suppress their notifications.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const watch = fs.watch;
fs.watch = (...args) => {
  const watcher = watch(...args);
  watcher.removeAllListeners("change");
  return watcher;
};
syncBuiltinESMExports();
