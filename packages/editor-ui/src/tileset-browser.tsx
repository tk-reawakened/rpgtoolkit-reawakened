import { listCandidates, type AssetCandidate, type ProjectLayout } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { getBrowserContext, getBrowserSelection, retainBrowserContext, selectBrowserSource, subscribeBrowserSelection, type BrowserAssetKind, type BrowserSelection } from "./brush.ts";

const SOURCES = [
  { kind: "tiles" as const, extensions: [".tst", ".iso", ".tan"] },
  { kind: "bitmaps" as const, extensions: [".tbm"] },
] as const;

interface Source extends AssetCandidate {
  readonly kind: BrowserAssetKind;
  readonly boardTile: string | null;
}

function suffix(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

/** Tile count is the bounded unsigned-short header in `docs/spec/formats/tiles.md#tileset-tst-and-isometric-tileset-iso`. */
function tileCount(bytes: Uint8Array, path: string): number {
  if (bytes.length < 6) throw new Error("This tileset has an incomplete header.");
  const version = bytes[0]! | (bytes[1]! << 8);
  const count = bytes[2]! | (bytes[3]! << 8);
  const expected = suffix(path) === ".iso" ? 30 : 20;
  if (version !== expected || count > 32767) throw new Error("This tileset has an unsupported header or tile count.");
  return count;
}

function sourceReference(source: Source): string {
  return source.reference.replaceAll("/", "\\");
}

export interface TilesetBrowserProps {
  readonly fs: Pick<FileSystemService, "list" | "read">;
  readonly layout: ProjectLayout;
}

/** T-24's shared board palette; its source editor remains unavailable until the P1 provider owns those writes. */
export function TilesetBrowser({ fs, layout }: TilesetBrowserProps) {
  const initial = getBrowserContext();
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [path, setPath] = useState<string | null>(initial.path);
  const [items, setItems] = useState<readonly BrowserSelection[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [menu, setMenu] = useState<BrowserSelection | null>(null);
  const [brush, setBrush] = useState<BrowserSelection | null>(getBrowserSelection());
  const list = useRef<HTMLDivElement>(null);
  const activeSource = sources.find((source) => source.path === path) ?? null;
  useEffect(() => subscribeBrowserSelection(() => setBrush(getBrowserSelection())), []);

  useEffect(() => {
    let current = true;
    void Promise.all(SOURCES.map(async ({ kind, extensions }) => {
      const result = await listCandidates(fs, layout, kind, extensions);
      return { kind, ...result };
    })).then((results) => {
      if (!current) return;
      const all = results.flatMap(({ kind, candidates }) => candidates.map((candidate): Source => ({
        ...candidate,
        kind,
        boardTile: suffix(candidate.path) === ".tan" ? candidate.reference.replaceAll("/", "\\") : null,
      })));
      setSources(all);
      const wanted = getBrowserContext().path;
      const restored = all.find((source) => source.path === wanted) ?? all[0] ?? null;
      setPath(restored?.path ?? null);
      if (restored !== null) void load(restored);
      const failures = results.flatMap((result) => result.failures.map(({ path: folder, error }) => `${folder}: ${error.message}`));
      if (failures.length > 0) setMessage(`Some asset folders could not be read: ${failures.join("; ")}`);
    }).catch((error: unknown) => {
      if (current) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { current = false; };
  }, [fs, layout]);

  useEffect(() => {
    if (list.current !== null) list.current.scrollTop = getBrowserContext().scrollTop;
  }, []);

  async function load(source: Source): Promise<void> {
    setPath(source.path);
    setMessage(null);
    retainBrowserContext(source.path, list.current?.scrollTop ?? getBrowserContext().scrollTop);
    if (suffix(source.path) === ".tst" || suffix(source.path) === ".iso") {
      const bytes = await fs.read(source.path);
      if (!bytes.ok) {
        setItems([]);
        setMessage(`Cannot read ${source.path}: ${bytes.error.message}`);
        return;
      }
      try {
        const count = tileCount(bytes.value, source.path);
        setItems(Array.from({ length: count }, (_, index) => {
          const reference = `${source.reference.replaceAll("/", "\\")}${index + 1}`;
          return { kind: "tiles", path: source.path, reference, label: `${source.name} tile ${index + 1}`, boardTile: reference };
        }));
      } catch (error) {
        setItems([]);
        setMessage(error instanceof Error ? `${source.path}: ${error.message}` : String(error));
      }
      return;
    }
    const reference = sourceReference(source);
    const boardTile = source.boardTile;
    setItems([{
      kind: source.kind,
      path: source.path,
      reference,
      label: source.name,
      boardTile,
    }]);
  }

  const choose = (item: BrowserSelection): void => {
    selectBrowserSource(item);
    setMenu(null);
  };

  const keyboard = (event: KeyboardEvent): void => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-browser-reference]") : null;
    const item = items.find((candidate) => candidate.reference === row?.dataset.browserReference);
    if (event.key === "Escape") {
      setMenu(null);
    } else if (event.shiftKey && event.key === "F10" && item !== undefined) {
      event.preventDefault();
      setMenu(item);
    } else if (event.key.toLowerCase() === "l" && !event.ctrlKey && !event.metaKey && !event.altKey && item !== undefined && item.boardTile !== null) {
      event.preventDefault();
      choose(item);
    }
  };

  return (
    <section class="tkr-tileset-browser" aria-label="Tileset browser" onKeyDown={keyboard}>
      <h2 class="tkr-tileset-browser-heading">Tileset browser</h2>
      <label for="tkr-tileset-source">Source</label>
      <select id="tkr-tileset-source" value={path ?? ""} onChange={(event) => {
        const source = sources.find((candidate) => candidate.path === event.currentTarget.value);
        if (source !== undefined) void load(source);
      }}>
        {sources.map((source) => <option key={source.path} value={source.path}>{source.reference} ({source.kind === "tiles" ? suffix(source.path).slice(1) : "tile bitmap"})</option>)}
      </select>
      <div class="tkr-tileset-browser-list" ref={list} role="list" aria-label="Tiles and assets" onScroll={(event) => retainBrowserContext(path, event.currentTarget.scrollTop)}>
        {items.map((item) => (
          <div
            data-browser-reference={item.reference}
            class="tkr-tileset-browser-item"
            role="listitem"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (item.boardTile !== null) choose(item);
                else selectBrowserSource(item);
              }
            }}
            onContextMenu={(event) => { event.preventDefault(); setMenu(item); }}
          >
            <button
              type="button"
              class={brush?.reference === item.reference ? "tkr-tileset-browser-source tkr-tileset-browser-source-selected" : "tkr-tileset-browser-source"}
              aria-pressed={brush?.reference === item.reference}
              onClick={() => item.boardTile === null ? selectBrowserSource(item) : choose(item)}
            >
              {item.label}
            </button>
            <button type="button" aria-keyshortcuts="L" disabled={item.boardTile === null} onClick={() => choose(item)}>
              Select brush
            </button>
            <button type="button" onClick={() => setMenu(item)}>More actions</button>
            {menu === item ? (
              <div class="tkr-tileset-browser-menu" role="group" aria-label={`${item.label} actions`}>
                <button type="button" disabled={item.boardTile === null} onClick={() => choose(item)}>Select as board brush</button>
                <button type="button" aria-disabled="true" aria-describedby="tkr-source-edit-unavailable">Edit source (P1 unavailable)</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p id="tkr-source-edit-unavailable" class="tkr-tileset-browser-note" role="note">
        Source editing is unavailable until the P1 tile editor provider exists. Browsing and brush selection do not change source files or paint a board.
      </p>
      {activeSource === null ? <p class="tkr-tileset-browser-empty" role="status">No tilesets, animated tiles or tile bitmaps are available.</p> : null}
      {message === null ? null : <p class="tkr-tileset-browser-message" role="alert">{message}</p>}
    </section>
  );
}
