// Cross-package integration tests may exercise the real browser session-copy adapter through this test-only subpath.
export { createSessionCopy } from "./index.ts";
export { createWebFileSystem } from "./filesystem.ts";
