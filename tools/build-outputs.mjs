import { join } from "node:path";

/** Every emitted file under apps/, grouped by the build that owns it. */
export const HOST_BUILD_OUTPUTS = Object.freeze({
  browser: Object.freeze([
    "apps/browser/player.js",
    "apps/browser/vectors.js",
    "apps/browser/agreement.js",
    "apps/browser/parity.js",
    "apps/browser/closing.js",
    "apps/browser/audio.js",
    "apps/browser/video.js",
    "apps/browser/storage.js",
    "apps/browser/decode-worker.js",
    "apps/browser/audio-worklet.js",
    "apps/browser/decode.js",
    "apps/browser/worker-probe.js",
    "apps/browser/bundled.json",
    "apps/browser/closing-files.json",
    "apps/browser/precache.json",
    "apps/service-worker.js",
  ]),
  desktop: Object.freeze([
    "apps/desktop/player-desktop.js",
    "apps/desktop/player-desktop-live.js",
    "apps/desktop/audio-worklet.js",
    "apps/desktop/bundled.json",
    "apps/desktop/closing-files.json",
  ]),
  mobile: Object.freeze([
    "apps/mobile/player-mobile.js",
    "apps/mobile/audio-worklet.js",
    "apps/mobile/bundled.json",
  ]),
});

/** Resolve a declared host output, rejecting a new artifact until its contract is updated. */
export function hostBuildOutput(root, host, file) {
  const outputs = HOST_BUILD_OUTPUTS[host];
  const path = outputs?.find((candidate) =>
    candidate === `apps/${host}/${file}` || (host === "browser" && candidate === `apps/${file}`),
  );
  if (path === undefined) {
    throw new Error(`${host} build output is not declared: apps/${host}/${file}`);
  }
  return join(root, path);
}

/** Return paths claimed by more than one host, accepting an alternate map for regression tests. */
export function findBuildOutputCollisions(outputs = HOST_BUILD_OUTPUTS) {
  const owners = new Map();
  const collisions = [];
  for (const [host, paths] of Object.entries(outputs)) {
    for (const path of paths) {
      const previous = owners.get(path);
      if (previous !== undefined) collisions.push({ path, hosts: [previous, host] });
      else owners.set(path, host);
    }
  }
  return collisions;
}

export function assertNoBuildOutputCollisions(outputs = HOST_BUILD_OUTPUTS) {
  const collisions = findBuildOutputCollisions(outputs);
  if (collisions.length > 0) {
    throw new Error(`host build output collision(s): ${collisions.map(({ path, hosts }) => `${path} (${hosts.join(", ")})`).join("; ")}`);
  }
}
