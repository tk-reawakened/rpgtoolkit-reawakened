// The editor's views (ADR 0025). A view is handed to a host as `mount(el, ctx) -> { dispose }`; the host owns the
// element and the document, the view owns only what it renders into `el`.
export { mount, mountAssetPicker, mountPreferences, mountShell, type BoardViewDocument, type ViewContext, type ViewDocument, type ViewHandle } from "./mount.ts";
export type { AssetPickerViewProps } from "./asset-picker-view.tsx";
export type { PreferencesViewProps } from "./preferences-view.tsx";
export { createBrowserSession, type BrowserSession, type BrowserState, type BrowserSelection } from "./brush.ts";
export type { TilesetBrowserContext } from "./tileset-browser.tsx";
export type { ShellProps } from "./shell.tsx";
