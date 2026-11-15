import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

export interface EmptyExplorerRecentProject {
  readonly id: string;
  readonly name: string;
}

export interface EmptyExplorerViewProps {
  /** Heading at the top of the left explorer dock; defaults to "Explorer". */
  readonly title?: string;
  /** Collapsible section title; defaults to "No Game Opened". */
  readonly sectionTitle?: string;
  /** Help text shown when no project or .gam file is open yet. */
  readonly description?: string;
  /** Primary button label; defaults to "Open project folder". */
  readonly openProjectLabel?: string;
  /** Invoked when the user clicks the primary open-folder button. */
  readonly onOpenProject?: () => void;
  /** Secondary button/picker label for opening a single `.gam` session copy. */
  readonly openSessionLabel?: string;
  /** Invoked when the user chooses a `.gam` file for a session copy. */
  readonly onOpenSessionFile?: (file: File) => void;
  /** Recently opened projects offered for quick reopen. */
  readonly recentProjects?: readonly EmptyExplorerRecentProject[];
  /** Invoked when the user selects and reopens a recent project. */
  readonly onReopenProject?: (id: string) => void;
  /** Optional custom controls or stage content. */
  readonly children?: ComponentChildren;
}

/**
 * Shared IDE "No Game Opened" Explorer view (#2703): renders the left-dock Explorer empty state
 * with primary/secondary open actions and recent-project selector when no project is open yet.
 */
export function EmptyExplorerView({
  title = "Explorer",
  sectionTitle = "No Game Opened",
  description = "Looks like you don't have a game open yet. Open a project folder for direct writes and package publication, or open one game as a session copy.",
  openProjectLabel = "Open project folder",
  onOpenProject,
  openSessionLabel = "Open .gam session copy",
  onOpenSessionFile,
  recentProjects = [],
  onReopenProject,
  children,
}: EmptyExplorerViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [selectedRecent, setSelectedRecent] = useState<string>(recentProjects[0]?.id ?? "");

  return (
    <aside class="tkr-web-project-bar tkr-empty-explorer" aria-label={title}>
      <div class="tkr-web-empty-explorer-header">
        <span class="tkr-web-empty-explorer-title">{title}</span>
        <button
          type="button"
          class="tkr-web-empty-explorer-section"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "▸" : "▾"} {sectionTitle}
        </button>
        {collapsed ? null : <p class="tkr-web-subtitle">{description}</p>}
      </div>
      {collapsed ? null : (
        <div class="tkr-web-project-controls">
          {onOpenProject === undefined ? null : (
            <button type="button" class="tkr-web-primary-open" onClick={() => onOpenProject()}>
              {openProjectLabel}
            </button>
          )}
          {onOpenSessionFile === undefined ? null : (
            <div class="tkr-web-session-open">
              <label for="tkr-empty-open-session">{openSessionLabel}</label>
              <input
                id="tkr-empty-open-session"
                type="file"
                accept=".gam"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file !== undefined) onOpenSessionFile(file);
                }}
              />
            </div>
          )}
          {recentProjects.length > 0 && onReopenProject !== undefined ? (
            <div class="tkr-web-recent-open">
              <label for="tkr-empty-recent-project">Recent project</label>
              <select
                id="tkr-empty-recent-project"
                value={selectedRecent || recentProjects[0]!.id}
                onChange={(event) => setSelectedRecent(event.currentTarget.value)}
              >
                {recentProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onReopenProject(selectedRecent || recentProjects[0]!.id)}
              >
                Reopen project
              </button>
            </div>
          ) : null}
          {children}
        </div>
      )}
    </aside>
  );
}
