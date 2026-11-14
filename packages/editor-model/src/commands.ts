import type { LayoutModel } from "./layout.ts";
import type { Tabs } from "./tabs.ts";
import type { DocumentWorkspace } from "./workspace.ts";

/**
 * Top-level IDE menu and command palette categories (#2703).
 */
export const COMMAND_CATEGORIES = [
  "File",
  "Edit",
  "Selection",
  "View",
  "Go",
  "Run",
  "Help",
] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];

/**
 * A command registered in the workbench's application menu and command palette.
 */
export interface WorkbenchCommand {
  readonly id: string;
  readonly category: CommandCategory;
  readonly label: string;
  readonly shortcut?: string;
  readonly disabled?: boolean;
  readonly run: () => void | Promise<void>;
}

/**
 * A project file entry surfaced in the command palette for quick navigation (`Go to File`).
 */
export interface CommandPaletteFileEntry {
  readonly path: string;
  readonly groupLabel: string;
  readonly openable: boolean;
}

/**
 * Shared, DOM-free command registry for the IDE workbench (#2703).
 * Hosts, shells, and extensions register commands by stable `id`, query them by category or search text,
 * and execute them identically from the Application Menu, Command Palette, or keyboard shortcuts.
 */
export interface CommandRegistry {
  /** Register or replace a command by its `id`; returns an unregister function. */
  register(command: WorkbenchCommand): () => void;
  /** Register or replace multiple commands; returns an unregister function for the batch. */
  registerMany(commands: readonly WorkbenchCommand[]): () => void;
  /** All currently registered commands in registration order. */
  getCommands(): readonly WorkbenchCommand[];
  /** Snapshot alias for `getCommands()` so `useDocumentSnapshot(registry)` binds directly without wrapper objects. */
  getSnapshot(): readonly WorkbenchCommand[];
  /** Commands belonging to a single top-level menu category. */
  byCategory(category: CommandCategory): readonly WorkbenchCommand[];
  /** Execute a command by `id` if present and enabled; returns `true` when invoked. */
  execute(id: string): boolean;
  /**
   * Filter registered commands and optional openable project files against a search query.
   * Queries starting with `>` filter commands only; plain queries include both commands and openable files.
   */
  filter(
    query: string,
    files?: readonly CommandPaletteFileEntry[],
    onOpenPath?: (path: string) => void,
  ): readonly WorkbenchCommand[];
  subscribe(listener: () => void): () => void;
}

export function createCommandRegistry(initial: readonly WorkbenchCommand[] = []): CommandRegistry {
  const listeners = new Set<() => void>();
  let commands: readonly WorkbenchCommand[] = [...initial];

  const publish = (next: readonly WorkbenchCommand[]): void => {
    commands = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A subscriber failure does not block other listeners.
      }
    }
  };

  const upsert = (current: readonly WorkbenchCommand[], command: WorkbenchCommand): readonly WorkbenchCommand[] => {
    const index = current.findIndex((entry) => entry.id === command.id);
    if (index === -1) return [...current, command];
    return current.map((entry, at) => (at === index ? command : entry));
  };

  return {
    register(command) {
      publish(upsert(commands, command));
      return () => {
        if (!commands.some((entry) => entry.id === command.id)) return;
        publish(commands.filter((entry) => entry.id !== command.id));
      };
    },
    registerMany(batch) {
      let next = commands;
      for (const command of batch) next = upsert(next, command);
      publish(next);
      const ids = new Set(batch.map((command) => command.id));
      return () => {
        if (!commands.some((entry) => ids.has(entry.id))) return;
        publish(commands.filter((entry) => !ids.has(entry.id)));
      };
    },
    getCommands: () => commands,
    getSnapshot: () => commands,
    byCategory: (category) => commands.filter((command) => command.category === category),
    execute(id) {
      const target = commands.find((command) => command.id === id);
      if (target === undefined || target.disabled === true) return false;
      void target.run();
      return true;
    },
    filter(query, files = [], onOpenPath) {
      const trimmed = query.trim();
      const commandsOnly = trimmed.startsWith(">");
      const normalized = trimmed.replace(/^>\s*/, "").toLowerCase();
      const fileItems: WorkbenchCommand[] = commandsOnly || onOpenPath === undefined
        ? []
        : files
            .filter((file) => file.openable)
            .map((file) => ({
              id: `open:${file.path}`,
              category: "Go" as const,
              label: `Open ${file.path}`,
              shortcut: file.groupLabel,
              run: () => onOpenPath(file.path),
            }));
      const pool = [...commands, ...fileItems];
      if (normalized === "") return pool;
      return pool.filter((item) =>
        `${item.category}: ${item.label}`.toLowerCase().includes(normalized)
        || (item.shortcut?.toLowerCase().includes(normalized) ?? false),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * Host and model hooks used to construct the standard workbench command set (#2703).
 */
export interface WorkbenchCommandSourceOptions {
  readonly layout: LayoutModel;
  readonly tabs?: Tabs;
  readonly workspace?: DocumentWorkspace;
  readonly onNewBoard?: () => void;
  readonly onOpenPreferences?: () => void;
  readonly onOpenProject?: () => void;
  readonly onSaveAll?: () => void;
  readonly onSaveAs?: () => void;
  readonly onRevert?: () => void;
  readonly onCloseActive?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onSelectBoardTool?: (tool: "draw" | "select") => void;
  readonly onSelectAllBoardCells?: () => void;
  readonly onToggleSecondView?: () => void;
  readonly onOpenPalette?: (initialQuery: string) => void;
}

/**
 * Construct the standard IDE commands for a workbench from its layout, tabs, workspace, and optional host hooks.
 */
export function createWorkbenchCommands(options: WorkbenchCommandSourceOptions): readonly WorkbenchCommand[] {
  const {
    layout,
    tabs,
    workspace,
    onNewBoard,
    onOpenPreferences,
    onOpenProject,
    onSaveAll,
    onSaveAs,
    onRevert,
    onCloseActive,
    onUndo,
    onRedo,
    onSelectBoardTool,
    onSelectAllBoardCells,
    onToggleSecondView,
    onOpenPalette,
  } = options;

  const activeDocument = () => {
    if (tabs === undefined || workspace === undefined) return null;
    const activeKey = tabs.getSnapshot().active;
    if (activeKey === null) return null;
    return workspace.documents().find((doc) => doc.identity.key === activeKey) ?? null;
  };

  const panels = layout.getPanels();
  const hasPanel = (id: string): boolean => panels.some((panel) => panel.id === id);

  return [
    ...(onNewBoard === undefined ? [] : [{
      id: "file.newBoard",
      category: "File" as const,
      label: "New Board…",
      run: () => onNewBoard(),
    }]),
    ...(onOpenProject === undefined ? [] : [{
      id: "file.openProject",
      category: "File" as const,
      label: "Open Project Folder…",
      run: () => onOpenProject(),
    }]),
    {
      id: "file.saveAll",
      category: "File",
      label: "Save All Open Documents",
      shortcut: "Ctrl+S",
      run: () => {
        if (onSaveAll !== undefined) {
          onSaveAll();
          return;
        }
        if (workspace !== undefined) void workspace.saveAll();
      },
    },
    ...(onSaveAs === undefined && workspace === undefined ? [] : [{
      id: "file.saveAs",
      category: "File" as const,
      label: "Save Active Document As…",
      run: () => {
        if (onSaveAs !== undefined) {
          onSaveAs();
          return;
        }
        const active = activeDocument();
        if (active !== null && workspace !== undefined) void workspace.saveAs(active);
      },
    }]),
    {
      id: "file.revert",
      category: "File",
      label: "Revert Active Document",
      run: () => {
        if (onRevert !== undefined) {
          onRevert();
          return;
        }
        const active = activeDocument();
        if (active !== null && workspace !== undefined) void workspace.revert(active);
      },
    },
    {
      id: "file.close",
      category: "File",
      label: "Close Active Tab",
      run: () => {
        if (onCloseActive !== undefined) {
          onCloseActive();
          return;
        }
        if (tabs !== undefined) {
          const activeKey = tabs.getSnapshot().active;
          if (activeKey !== null) void tabs.close(activeKey);
        }
      },
    },
    {
      id: "edit.undo",
      category: "Edit",
      label: "Undo",
      shortcut: "Ctrl+Z",
      run: () => {
        if (onUndo !== undefined) {
          onUndo();
          return;
        }
        const active = activeDocument();
        if (active !== null && workspace !== undefined) workspace.undo(active);
      },
    },
    {
      id: "edit.redo",
      category: "Edit",
      label: "Redo",
      shortcut: "Ctrl+Y",
      run: () => {
        if (onRedo !== undefined) {
          onRedo();
          return;
        }
        const active = activeDocument();
        if (active !== null && workspace !== undefined) workspace.redo(active);
      },
    },
    ...(onOpenPreferences === undefined ? [] : [{
      id: "edit.preferences",
      category: "Edit" as const,
      label: "Editor Preferences…",
      run: () => onOpenPreferences(),
    }]),
    ...(onSelectBoardTool === undefined ? [] : [
      {
        id: "selection.drawTool",
        category: "Selection" as const,
        label: "Board Tool: Draw",
        shortcut: "D",
        run: () => onSelectBoardTool("draw"),
      },
      {
        id: "selection.selectTool",
        category: "Selection" as const,
        label: "Board Tool: Select Region",
        shortcut: "S",
        run: () => onSelectBoardTool("select"),
      },
    ]),
    ...(onSelectAllBoardCells === undefined ? [] : [{
      id: "selection.selectAll",
      category: "Selection" as const,
      label: "Select All Cells on Board",
      shortcut: "Ctrl+A",
      run: () => onSelectAllBoardCells(),
    }]),
    ...(onOpenPalette === undefined ? [] : [{
      id: "view.commandPalette",
      category: "View" as const,
      label: "Command Palette…",
      shortcut: "Ctrl+Shift+P",
      run: () => onOpenPalette(">"),
    }]),
    ...panels.map((panel): WorkbenchCommand => ({
      id: `view.toggle.${panel.id}`,
      category: "View",
      label:
        panel.id === "files" ? "Toggle Files Explorer"
        : panel.id === "game" ? "Toggle Game Accordion"
        : panel.id === "tileset" ? "Toggle Tileset Inspector"
        : panel.id === "run" ? "Toggle Run & Diagnostics Dock"
        : `Toggle ${panel.title} Panel`,
      run: () => layout.toggle(panel.id),
    })),
    ...(onToggleSecondView === undefined ? [] : [{
      id: "view.secondView",
      category: "View" as const,
      label: "Toggle Split Second View",
      run: () => onToggleSecondView(),
    }]),
    ...(onOpenPalette === undefined ? [] : [{
      id: "go.file",
      category: "Go" as const,
      label: "Go to File in Project…",
      shortcut: "Ctrl+P",
      run: () => onOpenPalette(""),
    }]),
    ...(hasPanel("run") ? [{
      id: "run.openPanel",
      category: "Run" as const,
      label: "Show Run & Launch Controls",
      run: () => layout.show("run"),
    }] : []),
    ...(onOpenPalette === undefined ? [] : [{
      id: "help.shortcuts",
      category: "Help" as const,
      label: "Show All Commands & Shortcuts…",
      shortcut: "F1",
      run: () => onOpenPalette(">"),
    }]),
  ];
}
