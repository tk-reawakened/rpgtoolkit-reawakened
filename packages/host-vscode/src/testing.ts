export { createVscodeFileSystemWithPort } from "./filesystem-core.ts";
export { vscodeCapabilities } from "./capabilities.ts";
export type { VscodeFileSystemPort, VscodeUriLike } from "./filesystem-core.ts";
export { createGameEditorProvider, GameDocument } from "./custom-editor.ts";
export type { GameEditEvent, GameEditorPort, GameEditorProvider, UriLike, WebviewPort, WorkspaceFolderLike } from "./custom-editor.ts";
export { handleEditorHostRequest, isEditorHostRequest, RemoteDocument } from "./document-bridge.js";
export { recoverMainDocument } from "./document-backup.ts";
export type { BackupRecoveryResult } from "./document-backup.ts";
export type { BridgedDocument, BridgeMessage, EditorHostRequest, VscodeApi } from "./document-bridge.js";
