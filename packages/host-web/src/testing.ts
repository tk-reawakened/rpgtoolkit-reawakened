// Cross-package integration tests may exercise the real browser adapters through this test-only subpath: the session
// copy, the folder project over a directory handle the test supplies, and the File System Access file system.
export { createFolderProject, createSessionCopy, mountGameSettings, openGameSettings } from "./index.ts";
export type { GameSettingsOpenResult, GameSettingsView, WebProject, WebProjectOptions } from "./index.ts";
export { createWebFileSystem } from "./filesystem.ts";
