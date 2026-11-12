export { createVscodeFileSystemWithPort } from "./filesystem-core.ts";
export { VSCODE_CAPABILITIES } from "./capabilities.ts";
export type { VscodeFileSystemPort, VscodeUriLike } from "./filesystem-core.ts";
export { handleEditorHostRequest, isEditorHostRequest, RemoteDocument } from "./document-bridge.js";
export { recoverMainDocument } from "./document-backup.ts";
export type { BackupRecoveryResult } from "./document-backup.ts";
export type { BridgeMessage, EditorHostRequest, VscodeApi } from "./document-bridge.js";
