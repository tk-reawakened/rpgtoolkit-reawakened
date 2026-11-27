import type { AuditionPanel } from "./board-audition.ts";
import { CheckpointView } from "./checkpoint-view.tsx";
import type { AnimationAuthoring } from "@tk-reawakened/editor-model";
import {
  createPendingEdits,
  type ApplyOptions,
  type ApplyResult,
  type BoardCommand,
  type BoardDocumentSnapshot,
  type BoardPicture,
  type BoardPreviewRequest,
  type ConflictChoice,
  type ConflictResult,
  type EditorPreferences,
  type HistoryResult,
  type MainCommand,
  type MainDocument,
  type MainDocumentSnapshot,
  type ProgramCommand,
  type ProgramDocumentSnapshot,
  type SaveResult,
  type TileBitmapCommand,
  type TileBitmapDocumentSnapshot,
  type TileBitmapPicture,
  type PendingEdits,
  type ProjectLayout,
  type TilesetArtCommand,
  type TilesetArtSnapshot,
  projectLayoutForDocumentPath,
} from "@tk-reawakened/editor-model";
import { NativeClipView, type NativeClipViewDocument } from "./native-clip-view.tsx";
import { BattleBackgroundView, type BattleBackgroundViewDocument } from "./battle-background-view.tsx";
import { NativeSkinView, type NativeSkinViewDocument } from "./skin-view.tsx";
import { NativeGeometryView, type NativeGeometryViewDocument } from "./native-geometry-view.tsx";
import type { PlatformResult, PlatformServices } from "@tk-reawakened/platform-services";
import { createElement, Fragment, render } from "preact";
import { AssetPickerView, type AssetPickerViewProps } from "./asset-picker-view.tsx";
import { AssetRefreshContext } from "./asset-refresh.ts";
import { EmptyExplorerView, type EmptyExplorerViewProps } from "./empty-explorer-view.tsx";
import { Shell, type ShellProps } from "./shell.tsx";
import { RunStatusView, RunView, type RunViewProps } from "./run-view.tsx";
import { RunControl, type RunControlProps } from "./run-control.tsx";
import type { RunHandle } from "@tk-reawakened/platform-services";
import { DocumentHistoryView, type DocumentHistoryViewProps } from "./document-history-view.tsx";
import { CreatorTestsView, type CreatorTestsViewProps } from "./creator-tests-view.tsx";
import { FirstBoardTutorial, type FirstBoardTutorialProps } from "./first-board-tutorial.tsx";
import { BoardView } from "./board-view.tsx";
import { TerrainSceneView, type TerrainSceneViewProps } from "./terrain-scene-view.tsx";
import { useDocumentSnapshot } from "./use-document.ts";
import type { TerrainSceneDocument } from "@tk-reawakened/editor-model";
import { NewBoardView, type NewBoardViewProps } from "./new-board-view.tsx";
import { ScriptWorkflowView, type ScriptWorkflowViewProps } from "./script-workflow-view.tsx";
import { NewProjectView, type NewProjectViewProps } from "./new-project-view.tsx";
import { PreferencesView, type PreferencesViewProps } from "./preferences-view.tsx";
import { SettingsView } from "./settings-view.tsx";
import { TileBitmapView } from "./tile-bitmap-view.tsx";
import { FontView, type FontViewDocument } from "./font-view.tsx";
import { SpriteView, type SpriteViewDocument } from "./sprite-view.tsx";
import type { BoardPropertiesNavigation } from "./board-properties-view.tsx";
import type { BattleDataNavigation } from "./battle-data-form.tsx";
import type { TilesetBrowserContext } from "./tileset-browser.tsx";
import { TilesetArtView } from "./tileset-art-view.tsx";
import { AnimationView, type AnimationViewDocument } from "./animation-view.tsx";
import { ProgramView, type ProgramPreferencesSource, type ProgramViewDocument } from "./program-view.tsx";
import type { TextSurfaceFactory } from "./text-surface.ts";
import { CharacterAuthoringView, type CharacterAuthoringViewProps } from "./character-authoring-view.tsx";
import { SpecialMoveView, type SpecialMoveViewDocument } from "./special-move-view.tsx";
import { StatusEffectView, type StatusEffectViewDocument } from "./status-effect-view.tsx";
import { VisualFixtureView } from "./visual-fixture-view.tsx";

/** The snapshot/save surface plus a command action; an adapter may acknowledge a command asynchronously. */
export interface ViewDocument<Snapshot = MainDocumentSnapshot, Command = MainCommand> {
  /** The registered kind of the document (ADR 0026 decision 1); `mount` picks the view by it. */
  readonly kind: string;
  readonly identity: MainDocument["identity"];
  getSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  /** `options.coalesce` continues a typing gesture as one undoable edit (#3385); an adapter that cannot ignores it. */
  apply(command: Command, options?: ApplyOptions): ApplyResult | Promise<ApplyResult>;
  save(): Promise<SaveResult>;
  /** Settle a change made on disk by another program (ADR 0022 D3.5). */
  resolveConflict(choice: ConflictChoice): ConflictResult | Promise<ConflictResult>;
}

/** What a board view needs beyond the shared surface: a picture of the board as the engine draws it (AD-29). */
export interface BoardViewDocument extends ViewDocument<BoardDocumentSnapshot, BoardCommand> {
  /**
   * Compose the board as it is now, saved or not, with only the layers and background `request` asks for (every layer
   * and the background when it asks for nothing). The promise never rejects: failure is a value with a reason.
   */
  preview(request?: BoardPreviewRequest): Promise<BoardPicture>;
  /**
   * Undo and redo the latest edit. A host whose workbench owns the undo stack (VS Code's custom editors) leaves these out:
   * the view then shows no Undo or Redo button and says to use the host's own Undo.
   */
  undo?(): HistoryResult | Promise<HistoryResult>;
  redo?(): HistoryResult | Promise<HistoryResult>;
  /** Run the host's reviewed import of this saved board, then open the new scene. Not provided to history views. */
  importAsScene?(): Promise<PlatformResult<void>>;
  /** Run the host's registered board-upgrade command from the active board surface. */
  runUpgradeCommand?(operation: "stacked-to-rotated" | "tile-to-pixel" | "pre-vector"): void;
}

/** The board-editor preferences in force (T-33), read by the board view and told when they change. */
export interface BoardPreferencesSource {
  get(): EditorPreferences;
  subscribe(listener: () => void): () => void;
}

/** What the program editor needs from its host beyond the shared surface (story 11.7). */
export interface CodeEditorContext {
  /** The code editor (Monaco in the browser host). A plain text area when absent. */
  readonly createSurface?: TextSurfaceFactory;
  /** The running project's main file for the language server; `null` leaves documents unassessed. */
  readonly project?: { readonly main: string } | null;
  readonly preferences?: ProgramPreferencesSource;
}

/** The legacy tileset's pixel-editing surface, with history owned by its document. */
export type TilesetArtViewDocument = ViewDocument<TilesetArtSnapshot, TilesetArtCommand>;

/** What a tile bitmap view needs beyond the shared surface: a picture of the cells as the engine composes them, from the project's tiles. */
export interface TileBitmapViewDocument extends ViewDocument<TileBitmapDocumentSnapshot, TileBitmapCommand> {
  /** Compose the bitmap as it is now, saved or not. The promise never rejects: failure is a value with a reason. */
  preview(): Promise<TileBitmapPicture>;
}

/** What a host gives a view when it mounts it (ADR 0025 decision 4). */
export interface ViewContext {
  /** The document the view shows and edits. The view never owns it. */
  readonly document: ViewDocument | BoardViewDocument | TileBitmapViewDocument | FontViewDocument | SpriteViewDocument | TilesetArtViewDocument | AnimationViewDocument | ProgramViewDocument | NativeClipViewDocument | NativeSkinViewDocument | BattleBackgroundViewDocument | NativeGeometryViewDocument | SpecialMoveViewDocument | StatusEffectViewDocument;
  /**
   * The host door: the view reports edits through `document.edited` (AD-19, AD-20) and reads `capabilities` to say
   * what the host cannot do instead of implying it can (ADR 0022 D3.5, D3.6).
   */
  readonly services: Pick<PlatformServices, "document" | "capabilities" | "imageExport"> & { readonly fs?: Pick<PlatformServices["fs"], "readProject"> & Partial<Pick<PlatformServices["fs"], "list">>; readonly language?: PlatformServices["language"]; readonly clipboard?: PlatformServices["clipboard"] };
  /** Persistent wizard and recovery operations owned by the authoritative document host. */
  readonly animationAuthoring?: AnimationAuthoring;
  /** One project-bound browser service is shared across this workspace's views, never a module-global selection. */
  readonly browser?: TilesetBrowserContext;
  /** Where this document's project folders are now, re-resolved by the host on a refresh (tab activation, asset change). */
  readonly resolveLayout?: () => Promise<ProjectLayout>;
  /** Workbench asset picking is available in full hosts, but not in standalone document mounts. */
  readonly navigation?: Pick<BattleDataNavigation, "pickAsset" | "canOpen"> & Partial<BoardPropertiesNavigation>;
  /**
   * Where views report edits they have accepted but not yet handed to the document, so the host's save, close and revert
   * wait for them (#2613). A mount with no host makes its own, which only the views sharing it wait for.
   */
  readonly pendingEdits?: PendingEdits;
  /** The board-editor preferences (flood behaviour); the defaults of the catalogue when the host gives none. */
  readonly boardPreferences?: BoardPreferencesSource;
  /** The program editor's code editor, running project and preferences. */
  readonly codeEditor?: CodeEditorContext;
  /** The board's background-music audition and the palette commands that drive it, owned by the host that mounts the board's document view. */
  readonly audition?: AuditionPanel;
}
/** The handle a host keeps to a mounted view. */
export interface ViewHandle {
  /** Remove the view from the page and everything it subscribed to. Calling it again does nothing. */
  dispose(): void;
  /** Present only for a program view. Queue a one-based location without changing its document or undo stack. */
  revealSource?(line: number, column: number): void;
  /** Present only for the tileset artwork view. Select a one-based tile without changing its document, drafts or history. */
  revealTile?(tile: number): void;
  /** Document views re-read saved linked artwork without resetting selection, drafts or history. */
  refreshAssets?(): void;
}

function isBoardView(document: ViewContext["document"]): document is BoardViewDocument {
  return document.kind === "board";
}

function isTilesetArtView(document: ViewContext["document"]): document is TilesetArtViewDocument {
  return document.kind === "tileset";
}

function isTileBitmapView(document: ViewContext["document"]): document is TileBitmapViewDocument {
  return document.kind === "tile-bitmap";
}

function isFontView(document: ViewContext["document"]): document is FontViewDocument {
  return document.kind === "font";
}

function isProgramView(document: ViewContext["document"]): document is ProgramViewDocument {
  return document.kind === "program";
}

function isSpriteView(document: ViewContext["document"]): document is SpriteViewDocument {
  return document.kind === "character" || document.kind === "item";
}

function isAnimationView(document: ViewContext["document"]): document is AnimationViewDocument {
  return document.kind === "animation";
}
function isNativeClipView(document: ViewContext["document"]): document is NativeClipViewDocument {
  return document.kind === "native-clip";
}
function isNativeSkinView(document: ViewContext["document"]): document is NativeSkinViewDocument {
  return document.kind === "skin";
}
function isBattleBackgroundView(document: ViewContext["document"]): document is BattleBackgroundViewDocument {
  return document.kind === "battle-background";
}
function isNativeGeometryView(document: ViewContext["document"]): document is NativeGeometryViewDocument {
  return document.kind === "native-tile" || document.kind === "native-asset-pack";
}
function isSpecialMoveView(document: ViewContext["document"]): document is SpecialMoveViewDocument {
  return document.kind === "special-move";
}
function isStatusEffectView(document: ViewContext["document"]): document is StatusEffectViewDocument {
  return document.kind === "status-effect";
}

/** Render the view of the document's kind into `el` (ADR 0026 decision 2: views are registered here, models in `editor-model`). */
export function mount(el: HTMLElement, ctx: ViewContext): ViewHandle {
  const onEdited = (event: Parameters<PlatformServices["document"]["edited"]>[0]): void => ctx.services.document.edited(event);
  const capabilities = ctx.services.capabilities;
  const document = ctx.document;
  const fs = ctx.services.fs;
  if ((isSpriteView(document) || isAnimationView(document) || isSpecialMoveView(document) || isStatusEffectView(document) || isNativeSkinView(document) || isBattleBackgroundView(document)) && fs === undefined) throw new Error("This view requires project-file read access.");
  const pendingEdits = ctx.pendingEdits ?? createPendingEdits();
  let disposed = false;
  let reveal: ((line: number, column: number) => void) | null = null;
  let sourceRequest: { readonly line: number; readonly column: number } | null = null;
  const revealSource = (line: number, column: number): void => {
    if (disposed) return;
    if (reveal === null) sourceRequest = { line, column };
    else reveal(line, column);
  };
  let revealTile: ((tile: number) => void) | null = null;
  let tileRequest: number | null = null;
  const selectTile = (tile: number): void => {
    if (disposed) return;
    if (revealTile === null) tileRequest = tile;
    else revealTile(tile);
  };
  let view: Parameters<typeof render>[0];
  if (isBoardView(document)) {
    view = createElement(BoardView, {
      doc: document,
      capabilities,
      onEdited,
      ...(ctx.services.imageExport === undefined ? {} : { imageExport: ctx.services.imageExport }),
      ...(ctx.browser === undefined ? {} : { browser: ctx.browser }),
      pendingEdits,
      ...(ctx.services.clipboard === undefined ? {} : { clipboard: ctx.services.clipboard }),
      ...(ctx.boardPreferences === undefined ? {} : { preferences: ctx.boardPreferences }),
      ...(ctx.navigation === undefined ? {} : { navigation: ctx.navigation }),
      ...(ctx.audition === undefined ? {} : { audition: ctx.audition }),
    });
  } else if (isTilesetArtView(document)) {
    view = createElement(TilesetArtView, {
      doc: document,
      capabilities,
      onEdited,
      onRevealReady: (handler) => {
        revealTile = handler;
        if (handler !== null && tileRequest !== null) {
          const request = tileRequest;
          tileRequest = null;
          handler(request);
        }
      },
    });
  } else if (isTileBitmapView(document)) {
    view = createElement(TileBitmapView, {
      doc: document,
      capabilities,
      onEdited,
      ...(ctx.browser === undefined ? {} : { browser: ctx.browser }),
    });
  } else if (isFontView(document)) {
    view = createElement(FontView, { doc: document, capabilities, onEdited, pendingEdits });
  } else if (isProgramView(document)) {
    const editor = ctx.codeEditor;
    const program = createElement(ProgramView, {
      doc: document,
      capabilities,
      onEdited,
      pendingEdits,
      ...(editor?.createSurface === undefined ? {} : { createSurface: editor.createSurface }),
      ...(ctx.services.language === undefined ? {} : { language: ctx.services.language }),
      ...(editor?.project === undefined ? {} : { project: editor.project }),
      ...(editor?.preferences === undefined ? {} : { preferences: editor.preferences }),
      ...(ctx.navigation?.pickAsset === undefined ? {} : { pickAsset: ctx.navigation.pickAsset }),
      onRevealReady: (handler) => {
        reveal = handler;
        if (handler !== null && sourceRequest !== null) {
          const request = sourceRequest;
          sourceRequest = null;
          handler(request.line, request.column);
        }
      },
    });
    // A saved spec keeps its source editor (and reveal) and shows the TOOL-12 cards beneath it (#3568).
    view = /\.spec\.prg$/i.test(document.identity.path)
      ? createElement("div", { class: "tkr-spec-surface" }, program, createElement(VisualFixtureView, { doc: document, onEdited }))
      : program;
  } else if (isSpriteView(document)) {
    view = createElement(Fragment, null,
      createElement(SpriteView, { doc: document, fs: fs!, capabilities, onEdited, pendingEdits, ...ctx.navigation }),
      document.kind === "character"
        ? createElement(CharacterAuthoringView, { doc: document, fs: fs!, capabilities, onEdited, pendingEdits, ...ctx.navigation })
        : null);
  } else if (isAnimationView(document)) {
    view = createElement(AnimationView, {
      doc: document,
      pendingEdits,
      fs: fs!,
      onEdited,
      ...(ctx.animationAuthoring === undefined ? {} : { authoring: ctx.animationAuthoring }),
      ...(ctx.browser === undefined ? {} : { browser: ctx.browser }),
    });
  } else if (isNativeClipView(document)) {
    view = createElement(NativeClipView, { doc: document, pendingEdits, capabilities, onEdited });
  } else if (isNativeSkinView(document)) {
    view = createElement(NativeSkinView, {
      doc: document,
      pendingEdits,
      capabilities,
      onEdited,
      fs: fs!,
      projectId: document.identity.projectId,
      // The host names the document's project folders; a standalone mount infers them from the path (ADR 0022 D1.2).
      layout: ctx.browser?.layout ?? projectLayoutForDocumentPath(document.identity.path),
      ...(ctx.resolveLayout === undefined ? {} : { resolveLayout: ctx.resolveLayout }),
      ...(ctx.navigation?.pickAsset === undefined ? {} : { pickAsset: ctx.navigation.pickAsset }),
    });
  } else if (isNativeGeometryView(document)) {
    const browserFs = ctx.browser?.fs;
    view = createElement(NativeGeometryView, {
      doc: document,
      pendingEdits,
      capabilities,
      onEdited,
      ...(browserFs === undefined ? {} : { readFile: async (path: string) => { const result = await browserFs.read(path); return result.ok ? result.value : null; } }),
    });
  } else if (isSpecialMoveView(document)) {
    view = createElement(SpecialMoveView, { doc: document, fs: fs!, capabilities, pendingEdits, onEdited, ...ctx.navigation });
  } else if (isStatusEffectView(document)) {
    view = createElement(StatusEffectView, { doc: document, fs: fs!, capabilities, pendingEdits, onEdited, ...ctx.navigation });
  } else if (isBattleBackgroundView(document)) {
    const layout = ctx.navigation?.layout ?? ctx.browser?.layout;
    view = createElement(BattleBackgroundView, {
      doc: document, fs: fs!, capabilities, pendingEdits, onEdited,
      ...ctx.navigation,
      ...(layout === undefined ? {} : { layout }),
      ...(ctx.audition === undefined ? {} : { audition: ctx.audition }),
    });
  } else if (document.kind === "main") {
    view = createElement(SettingsView, { doc: document, capabilities, pendingEdits, onEdited });
  } else {
    throw new Error(`No editor view is registered for document kind "${document.kind}".`);
  }
  const titles: Readonly<Record<string, string>> = { board: "Board", tileset: "Tileset", "tile-bitmap": "Tile bitmap", font: "Bitmap font", character: "Character", item: "Item", program: "Program", animation: "Animation", main: "Game settings", "native-tile": "Native tile", "native-asset-pack": "Native asset pack", "native-clip": "Native animation clip", skin: "Native skin", "battle-background": "Fight background", "special-move": "Special move", "status-effect": "Status effect" };
  let assetRevision = 0;
  const display = (): void => render(createElement(AssetRefreshContext.Provider, { value: assetRevision },
    createElement("div", { class: "tkr-editor-surface", "data-tkr-editor": titles[document.kind] ?? document.kind }, view)), el);
  display();
  return {
    ...(isProgramView(document) ? { revealSource } : {}),
    ...(isTilesetArtView(document) ? { revealTile: selectTile } : {}),
    refreshAssets() {
      if (disposed) return;
      assetRevision++;
      display();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, el);
    },
  };
}

function mountElement(el: HTMLElement, vnode: Parameters<typeof render>[0]): ViewHandle {
  render(vnode, el);
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      render(null, el);
    },
  };
}

/** Render shared first-board Help; the host owns the panel and preference storage. */
export function mountFirstBoardTutorial(el: HTMLElement, props: FirstBoardTutorialProps): ViewHandle {
  return mountElement(el, createElement(FirstBoardTutorial, props));
}

/** Render the shared saved-test view without giving the view ownership of the project controller. */
export function mountCreatorTests(el: HTMLElement, props: CreatorTestsViewProps): ViewHandle {
  return mountElement(el, createElement(CreatorTestsView, props));
}

/** Render the browser and desktop shell (workbench, panels, tabs) into `el`. */
export function mountShell(el: HTMLElement, props: ShellProps): ViewHandle {
  return mountElement(el, createElement(Shell, props));
}

/** Render a folder-aware asset picker into `el`. */
export function mountAssetPicker(el: HTMLElement, props: AssetPickerViewProps): ViewHandle {
  return mountElement(el, createElement(AssetPickerView, props));
}

/** Render the run setup form (T-07, T-41; ADR 0022 D8.7) into `el`, for a host page that shows it without the shell. */
export function mountRun(el: HTMLElement, props: RunViewProps): ViewHandle {
  return mountElement(el, createElement(RunView, props));
}

/** Render the History panel (ADR 0022 D12) into `el`, for a host page that shows it without the shell. */
export function mountHistory(el: HTMLElement, props: DocumentHistoryViewProps): ViewHandle {
  return mountElement(el, createElement(DocumentHistoryView, props));
}

/** Render the header Run control (ADR 0022 D8.7) into `el`, for a host page that shows it without the shell. */
export function mountRunControl(el: HTMLElement, props: RunControlProps): ViewHandle {
  return mountElement(el, createElement(RunControl, props));
}

/** Render a run's status, problems, snapshot and Stop into `el`, for the host's Running game tab. */
export function mountRunStatus(el: HTMLElement, run: RunHandle): ViewHandle {
  return mountElement(el, createElement(RunStatusView, { run }));
}

/** Render the editor preferences into `el`. */
export function mountPreferences(el: HTMLElement, props: PreferencesViewProps): ViewHandle {
  return mountElement(el, createElement(PreferencesView, props));
}

/** Render the new-board questions into `el`. */
export function mountNewBoard(el: HTMLElement, props: NewBoardViewProps): ViewHandle {
  return mountElement(el, createElement(NewBoardView, props));
}

type TerrainDocumentProps = Omit<TerrainSceneViewProps, "scene"> & {
  readonly document: Pick<TerrainSceneDocument, "subscribe"> & { getSnapshot(): { readonly scene: TerrainSceneViewProps["scene"] } };
};
function TerrainDocumentView({ document, ...props }: TerrainDocumentProps) {
  return createElement(TerrainSceneView, { ...props, scene: useDocumentSnapshot(document).scene });
}
export function mountTerrainScene(el: HTMLElement, props: TerrainDocumentProps): ViewHandle {
  return mountElement(el, createElement(TerrainDocumentView, props));
}

/** Render the reviewed script workflow (story 13.16, TOOL-11) into `el`. */
export function mountScriptWorkflow(el: HTMLElement, props: ScriptWorkflowViewProps): ViewHandle {
  return mountElement(el, createElement(ScriptWorkflowView, props));
}

/** Render the new-project wizard into `el` (T-04). */
export function mountNewProject(el: HTMLElement, props: NewProjectViewProps): ViewHandle {
  return mountElement(el, createElement(NewProjectView, props));
}

/** Render the IDE "No Game Opened" Explorer panel into `el`. */
export function mountEmptyExplorer(el: HTMLElement, props: EmptyExplorerViewProps): ViewHandle {
  return mountElement(el, createElement(EmptyExplorerView, props));
}

/** Shared persistent project recovery, also available with every affected editor closed. */
export function mountCheckpoints(element: HTMLElement, groups: import("@tk-reawakened/editor-model").CheckpointGroups): ViewHandle {
  render(createElement(CheckpointView, { groups }), element);
  return { dispose: () => render(null, element) };
}
