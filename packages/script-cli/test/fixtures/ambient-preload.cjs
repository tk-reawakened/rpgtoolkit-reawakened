// If inherited, this preload starts an unowned process before any ESM import barrier.
const { spawnSync } = require("node:child_process");
spawnSync(process.execPath, ["-e", "require('node:fs').writeFileSync(process.env.TKR_PRELOAD_SENTINEL, 'spawned')"], {
  env: { ...process.env, NODE_OPTIONS: "" },
  stdio: "ignore",
});
