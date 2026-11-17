// The editor's views (ADR 0025). A view is handed to a host as `mount(el, ctx) -> { dispose }`; the host owns the
// element and the document, the view owns only what it renders into `el`.
export { mountCreatorTests, mountCheckpoints, mount, mountAssetPicker, mountEmptyExplorer, mountNewBoard, mountNewProject, mountPreferences, mountRun, mountRunControl, mountRunStatus, mountShell, type BoardPreferencesSource, type BoardViewDocument, type CodeEditorContext, type TileBitmapViewDocument, type TilesetArtViewDocument, type ViewContext, type ViewDocument, type ViewHandle } from "./mount.ts";
export type { AssetPickerViewProps } from "./asset-picker-view.tsx";
export { EmptyExplorerView, type EmptyExplorerRecentProject, type EmptyExplorerViewProps } from "./empty-explorer-view.tsx";
export { WorkbenchCommandBar, type CommandPaletteProps } from "./command-palette.tsx";
export type { NewBoardViewProps } from "./new-board-view.tsx";
export type { NewProjectViewProps } from "./new-project-view.tsx";
export { SpriteView, type SpriteViewDocument, type SpriteViewProps } from "./sprite-view.tsx";
export { AnimationView, type AnimationViewDocument, type AnimationViewProps } from "./animation-view.tsx";
export type { PreferencesViewProps } from "./preferences-view.tsx";
export type { RunSetupOutcome, RunSetupStore, RunViewProps } from "./run-view.tsx";
export type { RunControlProps, RunSetupMemory } from "./run-control.tsx";
export { createBrowserSession, type BrowserSession, type BrowserState, type BrowserSelection, type BrowserStamp } from "./brush.ts";
export type { TilesetBrowserContext } from "./tileset-browser.tsx";
export type { ShellProps } from "./shell.tsx";
export { ProgramView, type ProgramPreferencesSource, type ProgramViewDocument, type ProgramViewProps } from "./program-view.tsx";
export { createPlainTextSurface, diffText, type LanguageFeatures, type SurfaceDiagnostic, type TextChange, type TextSelection, type TextSurface, type TextSurfaceFactory, type TextSurfaceHost } from "./text-surface.ts";
export { leaseLanguageClient, startLanguageClient, LANGUAGE_IDLE_MS, type LanguageClient, type LanguageLease } from "./language-client.ts";
export { mountHistory } from "./mount.ts";
export { createCreatorTestsController, type CreatorTestsController, type CreatorTestsControllerOptions, type CreatorTestsFrame, type CreatorTestsRequest, type CreatorTestsState } from "./creator-tests-controller.ts";
export { CreatorTestsView, type CreatorTestsViewProps } from "./creator-tests-view.tsx";
