import type { LayoutModel, PackageArtifact, ProjectLayout, ProjectTree, Tabs, TreeOpenResult, TreeRow } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";
import { FilesView, type PackageActionOutcome } from "./files-view.tsx";
import { GameView } from "./game-view.tsx";
import { TabStrip } from "./tab-strip.tsx";
import { Workbench } from "./workbench.tsx";

export interface ShellProps {
  readonly layout: LayoutModel;
  readonly tabs: Tabs;
  readonly tree: ProjectTree;
  readonly projectLayout: ProjectLayout;
  readonly fs: Pick<FileSystemService, "list">;
  /** A file was opened from the Files panel (a document, or the OS took it). */
  readonly onOpened: (result: Extract<TreeOpenResult, { readonly ok: true }>, row: TreeRow) => void;
  /** The Game panel asks for a file to be opened; the host opens it through the tree, as Files does. */
  readonly onOpenPath: (path: string) => void;
  /** The Files panel prepares and, where supported, publishes a distribution package. */
  readonly onPackage: (mainPath: string, version: string) => Promise<PackageActionOutcome>;
  /** Downloads an already prepared artifact following an explicit user click. */
  readonly onDownload: (artifact: PackageArtifact) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** Called once with the element the active editor is mounted into, and with `null` when the shell goes away. */
  readonly onEditorElement: (element: HTMLElement | null) => void;
  /** Changes when the project's files may have, so the Game panel reads them again. */
  readonly version?: unknown;
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
export function Shell({ layout, tabs, tree, projectLayout, fs, onOpened, onOpenPath, onPackage, onDownload, onEditorElement, version }: ShellProps) {
  // The Game panel reads the project again whenever a tab opens or closes, as well as when the host says files changed.
  const tabsSnapshot = useDocumentSnapshot(tabs);
  return (
    <Workbench
      layout={layout}
      tabs={<TabStrip tabs={tabs} />}
      panels={{
        files: <FilesView tree={tree} fs={fs} onOpened={onOpened} onPackage={onPackage} onDownload={onDownload} />,
        game: <GameView fs={fs} layout={projectLayout} onOpen={onOpenPath} version={[version, tabsSnapshot.tabs.length]} />,
      }}
    >
      <EditorSlot onElement={onEditorElement} />
    </Workbench>
  );
}
