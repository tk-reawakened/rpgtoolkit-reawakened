import {
  COMMAND_CATEGORIES,
  createCommandRegistry,
  createWorkbenchCommands,
  listGame,
  type CommandCategory,
  type CommandPaletteFileEntry,
  type CommandRegistry,
  type DocumentWorkspace,
  type LayoutModel,
  type ProjectLayout,
  type Tabs,
  type WorkbenchCommand,
} from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AUTHORING_GUIDE_MARKDOWN, WHATS_NEW_MARKDOWN } from "./help-content.generated.ts";
import { focusedFieldHelp, HelpDocument, type HelpInvokerRef } from "./help-document.tsx";
import { useDocumentSnapshot } from "./use-document.ts";

export type { CommandCategory, CommandPaletteFileEntry, CommandRegistry, WorkbenchCommand };

export interface CommandPaletteProps {
  readonly layout: LayoutModel;
  readonly fs: Pick<FileSystemService, "list">;
  readonly projectLayout: ProjectLayout;
  readonly onOpenPath: (path: string) => void;
  readonly tabs?: Tabs;
  readonly workspace?: DocumentWorkspace;
  readonly commands?: CommandRegistry;
  readonly onNewBoard?: () => void;
  readonly onOpenPreferences?: () => void;
  readonly onOpenProject?: () => void;
  readonly extraCommands?: readonly WorkbenchCommand[];
  readonly version?: unknown;
}

const EMPTY_COMMANDS: readonly WorkbenchCommand[] = [];

function triggerHostButton(selector: string): boolean {
  if (typeof document === "undefined") return false;
  const target = document.querySelector<HTMLElement>(selector);
  if (target === null || target.hasAttribute("disabled")) return false;
  target.click();
  return true;
}

/** Open the active program's shared reference without closing a panel that is already open. */
function openProgramReference(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement;
  const program = active instanceof Element ? active.closest<HTMLElement>(".tkr-program") : null;
  const scope: ParentNode = program ?? document;
  const toggle = scope.querySelector<HTMLButtonElement>(".tkr-program-toggle-reference");
  if (toggle === null) return false;
  if (toggle.getAttribute("aria-pressed") !== "true") toggle.click();
  queueMicrotask(() => scope.querySelector<HTMLInputElement>(".tkr-program-reference input[type=search]")?.focus());
  return true;
}

/**
 * Shared IDE Application Menu (`☰` File / Edit / Selection / View / Go / Run / Help) and Command Palette
 * (`Ctrl+Shift+P` / `Cmd+Shift+P` / `F1`) backed by `@tk-reawakened/editor-model` `CommandRegistry` (#2703).
 */
export function WorkbenchCommandBar({
  layout,
  fs,
  projectLayout,
  onOpenPath,
  tabs,
  workspace,
  commands: externalRegistry,
  onNewBoard,
  onOpenPreferences,
  onOpenProject,
  extraCommands = EMPTY_COMMANDS,
  version,
}: CommandPaletteProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CommandCategory>("File");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projectFiles, setProjectFiles] = useState<readonly CommandPaletteFileEntry[]>([]);
  const [helpDocument, setHelpDocument] = useState<{ readonly title: string; readonly markdown: string } | null>(null);
  const [helpNotice, setHelpNotice] = useState<string | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const helpInvokerRef = useRef<HTMLElement | null>(null) as HelpInvokerRef;

  useEffect(() => {
    let current = true;
    void listGame(fs, projectLayout).then((listed) => {
      if (!current) return;
      const files = listed.groups.flatMap((group) =>
        group.files.map((file): CommandPaletteFileEntry => ({
          path: file.path,
          groupLabel: group.label,
          openable: file.openable,
        })),
      );
      setProjectFiles(files);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [fs, projectLayout, version]);

  const openPalette = (initialQuery = "", invoker?: HTMLElement | null): void => {
    invokerRef.current = invoker ?? (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setMenuOpen(false);
    setQuery(initialQuery);
    setSelectedIndex(0);
    setPaletteOpen(true);
  };

  const closePalette = (restoreFocus = true): void => {
    setPaletteOpen(false);
    const target = invokerRef.current;
    invokerRef.current = null;
    if (restoreFocus && target !== null && target.isConnected) queueMicrotask(() => target.focus());
  };

  useEffect(() => {
    if (paletteOpen) {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || document.querySelector(".tkr-help-document[open]") !== null) return;
      const cmdOrCtrl = event.ctrlKey || event.metaKey;
      if (event.key === "F1") {
        event.preventDefault();
        event.stopPropagation();
        const helpTarget = event.target instanceof Element ? event.target : document.activeElement;
        const fieldHelp = focusedFieldHelp(helpTarget);
        if (fieldHelp !== null) {
          helpInvokerRef.current = helpTarget instanceof HTMLElement ? helpTarget : null;
          setHelpDocument(fieldHelp);
        } else if (paletteOpen) closePalette();
        else openPalette("");
      } else if (cmdOrCtrl && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        if (paletteOpen) closePalette();
        else openPalette("");
      } else if (event.key === "Escape" && menuOpen) {
        event.preventDefault();
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [paletteOpen, menuOpen]);

  useEffect(() => {
    if (!menuOpen || typeof document === "undefined") return;
    const onPointerDown = (event: MouseEvent): void => {
      if (menuWrapRef.current !== null && event.target instanceof Node && !menuWrapRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const defaultRegistry = useMemo(() => {
    const standard = createWorkbenchCommands({
      layout,
      ...(tabs === undefined ? {} : { tabs }),
      ...(workspace === undefined ? {} : { workspace }),
      ...(onNewBoard === undefined ? {} : { onNewBoard }),
      ...(onOpenPreferences === undefined ? {} : { onOpenPreferences }),
      onOpenProject: onOpenProject ?? (() => { triggerHostButton("#open-project"); }),
      onReopenProject: () => { triggerHostButton("#reopen-project"); },
      onSaveAll: () => {
        if (!triggerHostButton("#save-all") && workspace !== undefined) void workspace.saveAll();
      },
      onSaveAs: () => {
        if (!triggerHostButton("#save-as") && workspace !== undefined && tabs !== undefined) {
          const activeKey = tabs.getSnapshot().active;
          const active = activeKey === null ? undefined : workspace.documents().find((doc) => doc.identity.key === activeKey);
          if (active !== undefined) void workspace.saveAs(active);
        }
      },
      onRevert: () => {
        if (!triggerHostButton("#revert") && workspace !== undefined && tabs !== undefined) {
          const activeKey = tabs.getSnapshot().active;
          const active = activeKey === null ? undefined : workspace.documents().find((doc) => doc.identity.key === activeKey);
          if (active !== undefined) void workspace.revert(active);
        }
      },
      onCloseActive: () => {
        if (!triggerHostButton("#close") && tabs !== undefined) {
          const activeKey = tabs.getSnapshot().active;
          if (activeKey !== null) void tabs.close(activeKey);
        }
      },
      onUndo: () => {
        if (!triggerHostButton("#undo") && workspace !== undefined && tabs !== undefined) {
          const activeKey = tabs.getSnapshot().active;
          const active = activeKey === null ? undefined : workspace.documents().find((doc) => doc.identity.key === activeKey);
          if (active !== undefined) workspace.undo(active);
        }
      },
      onRedo: () => {
        if (!triggerHostButton("#redo") && workspace !== undefined && tabs !== undefined) {
          const activeKey = tabs.getSnapshot().active;
          const active = activeKey === null ? undefined : workspace.documents().find((doc) => doc.identity.key === activeKey);
          if (active !== undefined) workspace.redo(active);
        }
      },
      onSelectBoardTool: (tool) => { triggerHostButton(`.tkr-board-tool[data-tool="${tool}"]`); },
      onSelectAllBoardCells: () => { triggerHostButton(".tkr-board-select-all"); },
      onToggleSecondView: () => { triggerHostButton("#mirror-view"); },
      onOpenPalette: (prefix) => openPalette(prefix),
    });
    return createCommandRegistry([...standard, ...extraCommands,
      {
        id: "help.rpgcodeReference",
        category: "Help",
        label: "Open RPGCode Quick Reference",
        run: () => {
          if (!openProgramReference()) {
            setHelpNotice("Open a program to search and insert RPGCode built-ins.");
            queueMicrotask(() => menuButtonRef.current?.focus());
          }
        },
      },
      {
        id: "help.manual",
        category: "Help",
        label: "Open RPGCode authoring guide",
        run: () => setHelpDocument({ title: "RPGCode program authoring", markdown: AUTHORING_GUIDE_MARKDOWN }),
      },
      {
        id: "help.whatsNew",
        category: "Help",
        label: "What's New",
        run: () => setHelpDocument({ title: "What's New", markdown: WHATS_NEW_MARKDOWN }),
      },
    ]);
  }, [layout, tabs, workspace, onNewBoard, onOpenPreferences, onOpenProject, extraCommands]);

  const registry = externalRegistry ?? defaultRegistry;
  useDocumentSnapshot(registry);

  const filtered = registry.filter(query, projectFiles, onOpenPath);
  const clampedIndex = filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1);

  const runCommand = (item: WorkbenchCommand): void => {
    const fromPalette = paletteOpen;
    if (item.id === "help.manual" || item.id === "help.whatsNew") {
      helpInvokerRef.current = fromPalette ? invokerRef.current : menuButtonRef.current;
    }
    if (fromPalette) {
      const invoker = invokerRef.current;
      closePalette(false);
      if (invoker !== null && invoker.isConnected) invoker.focus();
    } else {
      setMenuOpen(false);
      // Give host actions their real invoker before they open UI that owns focus and later returns it.
      menuButtonRef.current?.focus();
    }
    void item.run();
  };

  const categoryItems = registry.byCategory(activeCategory);

  return (
    <div class="tkr-command-bar">
      <div ref={menuWrapRef} class="tkr-app-menu-wrap">
        <button
          ref={menuButtonRef}
          type="button"
          class="tkr-app-menu-button"
          aria-label="Application menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span class="tkr-app-menu-icon" aria-hidden="true">☰</span>
        </button>
        {menuOpen ? (
          <div class="tkr-app-menu-popup" role="menu" aria-label="Application menu">
            <div class="tkr-app-menu-categories">
              {COMMAND_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  role="menuitem"
                  class={activeCategory === category ? "tkr-app-menu-category tkr-app-menu-category-active" : "tkr-app-menu-category"}
                  aria-haspopup="true"
                  aria-expanded={activeCategory === category}
                  onMouseEnter={() => setActiveCategory(category)}
                  onFocus={() => setActiveCategory(category)}
                  onClick={() => setActiveCategory(category)}
                >
                  <span>{category}</span>
                  <span class="tkr-app-menu-chevron" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
            <div class="tkr-app-menu-submenu" role="menu" aria-label={`${activeCategory} menu`}>
              {categoryItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  class="tkr-app-menu-item"
                  disabled={item.disabled}
                  onClick={() => runCommand(item)}
                >
                  <span>{item.label}</span>
                  {item.shortcut === undefined ? null : <kbd class="tkr-command-kbd">{item.shortcut}</kbd>}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        class="tkr-command-palette-trigger"
        aria-label="Command palette"
        aria-keyshortcuts="F1 Control+Shift+P"
        onClick={(event) => openPalette("", event.currentTarget)}
      >
        <span class="tkr-command-palette-trigger-text">Search files &amp; run commands…</span>
        <kbd class="tkr-command-kbd">Ctrl+Shift+P</kbd>
      </button>

      {paletteOpen ? (
        <div
          class="tkr-command-palette-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          onClick={(event) => {
            if (event.target === event.currentTarget) closePalette();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closePalette();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              if (filtered.length > 0) setSelectedIndex((clampedIndex + 1) % filtered.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (filtered.length > 0) setSelectedIndex((clampedIndex - 1 + filtered.length) % filtered.length);
            } else if (event.key === "Enter" && filtered[clampedIndex] !== undefined) {
              event.preventDefault();
              runCommand(filtered[clampedIndex]!);
            }
          }}
        >
          <div class="tkr-command-palette-dialog">
            <div class="tkr-command-palette-header">
              <input
                ref={inputRef}
                type="search"
                class="tkr-command-palette-input"
                aria-label="Search commands and files"
                placeholder="Type a command or file name (prefix with > for commands only)…"
                value={query}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setSelectedIndex(0);
                }}
              />
            </div>
            <ul class="tkr-command-palette-list" role="listbox" aria-label="Matching commands and files">
              {filtered.length === 0 ? (
                <li class="tkr-command-palette-empty">No matching commands or project files.</li>
              ) : (
                filtered.map((item, index) => (
                  <li key={item.id} role="option" aria-selected={index === clampedIndex}>
                    <button
                      type="button"
                      class={index === clampedIndex ? "tkr-command-palette-option tkr-command-palette-option-active" : "tkr-command-palette-option"}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => runCommand(item)}
                    >
                      <span class="tkr-command-palette-category">{item.category}</span>
                      <span class="tkr-command-palette-label">{item.label}</span>
                      {item.shortcut === undefined ? null : <kbd class="tkr-command-kbd">{item.shortcut}</kbd>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
      {helpDocument === null ? null : (
        <HelpDocument
          title={helpDocument.title}
          markdown={helpDocument.markdown}
          invoker={helpInvokerRef}
          onClose={() => setHelpDocument(null)}
        />
      )}
      {helpNotice === null ? null : <p class="tkr-help-notice" role="status">{helpNotice}</p>}
    </div>
  );
}
