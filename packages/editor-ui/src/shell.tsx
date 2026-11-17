import type { AnyDocument, CommandRegistry, DocumentWorkspace, Launcher, LayoutModel, PackageArtifact, ProjectLayout, ProjectTree, Tabs, TreeOpenResult, TreeRow } from "@tk-reawakened/editor-model";
import type { FileSystemService, RunHandle } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewHandle } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";
import { FilesView, type PackageActionOutcome } from "./files-view.tsx";
import { GameView } from "./game-view.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { RunControl, type RunSetupMemory } from "./run-control.tsx";
import type { RunSetupStore } from "./run-view.tsx";
import type { CreatorTestsController } from "./creator-tests-controller.ts";
import { TestsView } from "./tests-view.tsx";
import { TilesetBrowser, type TilesetBrowserContext } from "./tileset-browser.tsx";
import { WorkbenchCommandBar } from "./command-palette.tsx";
import { DocumentHistoryView } from "./document-history-view.tsx";
import { Workbench } from "./workbench.tsx";

interface ShellHistoryPanel {
  readonly files: Pick<FileSystemService, "list" | "read" | "write">;
  readonly mountPreview?: (element: HTMLElement, document: AnyDocument) => ViewHandle;
  readonly offer?: { readonly isEnabled: () => Promise<boolean>; readonly onNever: () => void };
}
type ShellWorkspace = DocumentWorkspace & { readonly historyPanel?: ShellHistoryPanel };

export interface ShellProps {
  readonly layout: LayoutModel;
  readonly tabs: Tabs;
  readonly tree: ProjectTree;
  readonly projectLayout: ProjectLayout;
  readonly fs: Pick<FileSystemService, "list" | "read">;
  /** Optional document workspace for Undo/Redo/SaveAll/Revert commands in the application menu and command palette. */
  readonly workspace?: DocumentWorkspace;
  /** Optional shared command registry for the application menu and command palette (#2703). */
  readonly commands?: CommandRegistry;
  /** A file was opened from the Files panel (a document, or the OS took it). */
  readonly onOpened: (result: Extract<TreeOpenResult, { readonly ok: true }>, row: TreeRow) => void;
  /** The Game panel asks for a file to be opened; the host opens it through the tree, as Files does. */
  readonly onOpenPath: (path: string) => void;
  /** The Files panel preflights and constructs an immutable package proposal; nothing is written. */
  readonly onPackage: (mainPath: string, version: string) => Promise<PackageActionOutcome>;
  /** Downloads an already prepared artifact through the host's normal download path after an explicit user click. */
  readonly onDownload: (artifact: PackageArtifact) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** Called once with the element the active editor is mounted into, and with `null` when the shell goes away. */
  readonly onEditorElement: (element: HTMLElement | null) => void;
  /** Ask the host for the new-board questions (T-20); no button is shown without it. */
  readonly onNewBoard?: () => void;
  readonly onNewAnimation?: () => void;
  readonly onRecovery?: () => void;
  readonly onNewProgram?: () => void;
  /** Open the editor preferences dialog (T-08) when offered by the host. */
  readonly onOpenPreferences?: () => void;
  /** Shared tileset browser context for the right inspector dock (T-24). */
  readonly browser?: TilesetBrowserContext;
  /** Changes when the project's files may have, so the Game panel reads them again. */
  readonly version?: unknown;
  /** Starts runs through the host's `run` service; with it the header has a Run button (T-07, T-41; ADR 0022 D8.7). */
  readonly launcher?: Launcher;
  /** Saved TOOL-5 tests (ADR 0022 D9); with it the left sidebar has a Tests section. */
  readonly creatorTests?: CreatorTestsController;
  /** The main file of the game open in the editor, which a saved setup without its own runs. */
  readonly main?: string;
  /** Where saved run setups are read and written (`.tkr/launch.json`). */
  readonly runSetups?: RunSetupStore;
  /** Which setup the Run button runs, remembered per user. */
  readonly runMemory?: RunSetupMemory;
  /** Return to the origin board from a linked document. */
  readonly onReturnFromVisit?: () => Promise<string | null>;
  /** Told about each run the Run button starts. */
  readonly onRun?: (handle: RunHandle) => void;
}

/** The editor slot: an element the host mounts the active editor into, and the shell never draws into. */
function EditorSlot({ onElement }: { readonly onElement: (element: HTMLElement | null) => void }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onElement(element.current);
    return () => onElement(null);
  }, [onElement]);
  return <div ref={element} class="tkr-editor-slot" />;
}

/** The browser and desktop shell (T-01, T-02, T-03): the workbench with the Files and Game panels, and the document tabs. */
export function Shell({ layout, tabs, tree, projectLayout, fs, workspace, commands, onOpened, onOpenPath, onPackage, onDownload, onEditorElement, onNewBoard, onNewAnimation, onRecovery, onNewProgram, onOpenPreferences, browser, version, launcher, creatorTests, main, runSetups, runMemory, onRun, onReturnFromVisit }: ShellProps) {
  // The Game panel reads the project again whenever a tab opens or closes, as well as when the host says files changed.
  const tabsSnapshot = useDocumentSnapshot(tabs);
  const active = tabsSnapshot.tabs.find((tab) => tab.key === tabsSnapshot.active)?.path ?? null;
  const activeDocHasEmbeddedBrowser = active !== null && /\.(brd|tbm)$/i.test(active);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
  const historyPanel = (workspace as ShellWorkspace | undefined)?.historyPanel;
  return (
    <Workbench
      layout={layout}
      tabs={<TabStrip tabs={tabs} />}
      headerBar={
        <>
        <WorkbenchCommandBar
          layout={layout}
          tabs={tabs}
          {...(workspace === undefined ? {} : { workspace })}
          {...(commands === undefined ? {} : { commands })}
          fs={fs}
          projectLayout={projectLayout}
          onOpenPath={onOpenPath}
          {...(onNewBoard === undefined ? {} : { onNewBoard })}
          {...(onOpenPreferences === undefined ? {} : { onOpenPreferences })}
          version={[version, tabsSnapshot.tabs.length]}
        />
        {launcher === undefined ? null : (
          <RunControl
            launcher={launcher}
            fs={fs}
            layout={projectLayout}
            active={active}
            version={[version, tabsSnapshot.tabs.length]}
            {...(main === undefined ? {} : { main })}
            {...(runSetups === undefined ? {} : { store: runSetups })}
            {...(runMemory === undefined ? {} : { memory: runMemory })}
            {...(onRun === undefined ? {} : { onRun })}
          />
        )}
        {onReturnFromVisit === undefined ? null : <button class="tkr-return-to-board" type="button" aria-label="Return to board" onClick={() => { void onReturnFromVisit().then(setReturnMessage); }}>Return to board</button>}
        </>
      }
      panels={{
        files: <FilesView tree={tree} fs={fs} onOpened={onOpened} onPackage={onPackage} onDownload={onDownload} {...(onNewBoard === undefined ? {} : { onNewBoard })} {...(onNewAnimation === undefined ? {} : { onNewAnimation })} {...(onRecovery === undefined ? {} : { onRecovery })} {...(onNewProgram === undefined ? {} : { onNewProgram })} />,
        game: <GameView fs={fs} layout={projectLayout} onOpen={onOpenPath} version={[version, tabsSnapshot.tabs.length]} />,
        ...(browser === undefined ? {} : { tileset: activeDocHasEmbeddedBrowser ? null : <TilesetBrowser context={browser} /> }),
        ...(creatorTests === undefined ? {} : { tests: <TestsView controller={creatorTests} /> }),
        ...(workspace === undefined || historyPanel === undefined ? {} : { history: <DocumentHistoryView workspace={workspace} files={historyPanel.files} activePath={active} {...(historyPanel.mountPreview === undefined ? {} : { mountPreview: historyPanel.mountPreview })} {...(historyPanel.offer === undefined ? {} : { offerIgnore: historyPanel.offer.isEnabled, onNeverOfferIgnore: historyPanel.offer.onNever })} /> }),
      }}
    >
      {returnMessage === null ? null : <p class="tkr-visit-message" role="status">{returnMessage}</p>}
      <EditorSlot onElement={onEditorElement} />
    </Workbench>
  );
}
