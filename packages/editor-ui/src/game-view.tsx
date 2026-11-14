import { listGame, type GameGroup, type ProjectLayout } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";

export interface GameViewProps {
  readonly fs: Pick<FileSystemService, "list">;
  readonly layout: ProjectLayout;
  /** Open the file; the host's tree does it, so a file reached here and from Files is one document. */
  readonly onOpen: (path: string) => void;
  /** A value that changes when the project's files may have, to read the groups again. */
  readonly version?: unknown;
}

/**
 * The Game view (T-02): the project's files grouped by what they are. Each group is a labelled list; a file with no
 * editor yet is shown as unavailable rather than offered. The first file is the one tab stop, and the arrow keys move
 * through every file across groups.
 */
export function GameView({ fs, layout, onOpen, version }: GameViewProps) {
  const [groups, setGroups] = useState<readonly GameGroup[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const focus = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    void listGame(fs, layout).then((listed) => {
      if (!current) return;
      setGroups(listed.groups);
      setProblem(listed.failures.length === 0 ? null : `Could not read ${listed.failures.map((failure) => failure.path).join(", ")}: ${listed.failures[0]!.error.message}`);
    });
    return () => { current = false; };
  }, [fs, layout, version]);

  useEffect(() => {
    if (!focus.current) return;
    focus.current = false;
    root.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const files = (groups ?? []).flatMap((group) => group.files);
  const current = files.find((file) => file.path === active) ?? files[0] ?? null;
  const move = (from: number, to: number): void => {
    const target = files[Math.max(0, Math.min(files.length - 1, to))];
    if (target === undefined || to === from) return;
    focus.current = true;
    setActive(target.path);
  };

  return (
    <section class="tkr-game" aria-label="Game">
      <h2 class="tkr-game-heading">Game</h2>
      {groups === null ? <p class="tkr-game-state" role="status">Reading the project…</p> : null}
      {groups !== null && groups.length === 0 ? <p class="tkr-game-state" role="status">This project has no game files yet.</p> : null}
      {problem === null ? null : <p class="tkr-game-problem" role="alert">{problem}</p>}
      <div ref={root} class="tkr-game-groups">
        {(groups ?? []).map((group) => (
          <div key={group.kind} class="tkr-game-group" role="group" aria-label={group.label}>
            <h3>{group.label}</h3>
            <ul>
              {group.files.map((file) => {
                const index = files.indexOf(file);
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      class="tkr-game-file"
                      tabIndex={file.path === current?.path ? 0 : -1}
                      aria-disabled={file.openable ? undefined : true}
                      aria-label={file.openable ? file.path : `${file.path}, no editor for this file yet`}
                      onClick={() => {
                        setActive(file.path);
                        if (file.openable) onOpen(file.path);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") { event.preventDefault(); move(index, index + 1); }
                        else if (event.key === "ArrowUp") { event.preventDefault(); move(index, index - 1); }
                        else if (event.key === "Home") { event.preventDefault(); move(index, 0); }
                        else if (event.key === "End") { event.preventDefault(); move(index, files.length - 1); }
                      }}
                    >
                      {file.path.slice(group.folder.length + 1)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
