import { assertNoBuildOutputCollisions, HOST_BUILD_OUTPUTS } from "./build-outputs.mjs";

assertNoBuildOutputCollisions();
for (const [host, paths] of Object.entries(HOST_BUILD_OUTPUTS)) {
  console.log(`${host}: ${paths.length} declared apps/ outputs`);
}
console.log("host build outputs are collision-free");
