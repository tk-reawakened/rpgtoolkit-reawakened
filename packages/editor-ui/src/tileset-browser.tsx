import { createTileSourcePreviewer, listCandidates, type AssetCandidate, type ProjectLayout, type TilePreviewPixels } from "@tk-reawakened/editor-model";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BrowserSession, BrowserAssetKind, BrowserSelection } from "./brush.ts";

let browsersMade = 0;

const SOURCES = [
  { kind: "tiles" as const, extensions: [".tst", ".iso", ".tan", ".gph"] },
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


export interface TilesetBrowserContext {
  readonly session: BrowserSession;
  readonly fs: Pick<FileSystemService, "list" | "read">;
  readonly layout: ProjectLayout;
  /**
   * Open the source file at `path` in its editor through the host (a tab, a linked visit). It resolves with `null` when
   * the editor opened and with a reason otherwise. A host with no tab to open leaves it out, and the browser then says so.
   */
  readonly openSource?: (path: string) => Promise<string | null>;
}

export interface TilesetBrowserProps {
  readonly context: TilesetBrowserContext;
}

/** T-24's shared board palette; its source editor remains unavailable until the P1 provider owns those writes. */
export function TilesetBrowser({ context }: TilesetBrowserProps) {
  const { fs, layout, session } = context;
  const [ids] = useState(() => {
    browsersMade += 1;
    return `tkr-tileset-browser-${browsersMade}`;
  });
  const initial = session.getSnapshot();
  const [sources, setSources] = useState<readonly Source[]>([]);
  const [path, setPath] = useState<string | null>(initial.path);
  const [items, setItems] = useState<readonly BrowserSelection[]>([]);
  const [previews, setPreviews] = useState<ReadonlyMap<string, TilePreviewPixels>>(new Map());
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const loadedPathRef = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [menu, setMenu] = useState<BrowserSelection | null>(null);
  const [brush, setBrush] = useState<BrowserSelection | null>(initial.selection);
  const list = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuInvoker = useRef<HTMLElement | null>(null);
  const request = useRef(0);
  const sourceCache = useRef<readonly Source[]>([]);
  const observedPath = useRef(initial.path);
  const activeSource = sources.find((source) => source.path === path) ?? null;

  useEffect(() => session.subscribe(() => {
    const state = session.getSnapshot();
    setBrush(state.selection);
    if (state.path !== observedPath.current) {
      observedPath.current = state.path;
      const source = sourceCache.current.find((candidate) => candidate.path === state.path);
      if (source !== undefined) void load(source, sourceCache.current);
      else setPath(state.path);
    }
    if (list.current !== null && loadedPathRef.current === state.path && list.current.scrollTop !== state.scrollTop) list.current.scrollTop = state.scrollTop;
  }), [session]);
  useEffect(() => {
    let active = true;
    void Promise.all(SOURCES.map(async ({ kind, extensions }) => {
      const result = await listCandidates(fs, layout, kind, extensions);
      return { kind, ...result };
    })).then((results) => {
      if (!active) return;
      const all = results.flatMap(({ kind, candidates }) => candidates.map((candidate): Source => ({
        ...candidate,
        kind,
        boardTile: [".tan", ".gph"].includes(suffix(candidate.path)) ? candidate.reference.replaceAll("/", "\\") : null,
      })));
      sourceCache.current = all;
      setSources(all);
      const restored = all.find((source) => source.path === session.getSnapshot().path) ?? all[0] ?? null;
      observedPath.current = restored?.path ?? null;
      setPath(restored?.path ?? null);
      if (restored !== null) void load(restored, all);
      const failures = results.flatMap((result) => result.failures.map(({ path: folder, error }) => `${folder}: ${error.message}`));
      if (failures.length > 0) setMessage(`Some asset folders could not be read: ${failures.join("; ")}`);
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; request.current += 1; };
  }, [fs, layout, session]);

  useEffect(() => {
    if (menu !== null) menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  useEffect(() => {
    for (const [reference, preview] of previews) {
      const canvas = [...(list.current?.querySelectorAll<HTMLCanvasElement>("canvas[data-preview-reference]") ?? [])]
        .find((candidate) => candidate.dataset.previewReference === reference);
      const context2d = canvas?.getContext("2d");
      if (canvas === undefined || canvas === null || context2d === null || context2d === undefined) continue;
      canvas.width = preview.width;
      canvas.height = preview.height;
      const image = context2d.createImageData(preview.width, preview.height);
      image.data.set(preview.pixels);
      context2d.putImageData(image, 0, 0);
    }
  }, [items, previews]);
  useEffect(() => {
    if (list.current !== null && loadedPath === path) list.current.scrollTop = session.getSnapshot().scrollTop;
  }, [loadedPath, path, session]);

  async function load(source: Source, available = sources): Promise<void> {
    loadedPathRef.current = null;
    setLoadedPath(null);
    const currentRequest = ++request.current;
    observedPath.current = source.path;
    setPath(source.path);
    setMessage(null);
    session.update({ path: source.path, scrollTop: session.getSnapshot().scrollTop });
    const isCurrent = (): boolean => currentRequest === request.current;
    const previewer = createTileSourcePreviewer(available, async (path) => {
      const result = await fs.read(path);
      return result.ok ? result.value : null;
    });
    try {
      const result = await fs.read(source.path);
      if (!isCurrent()) return;
      if (!result.ok) {
        setItems([]);
        setPreviews(new Map());
        setMessage(`Cannot read ${source.path}: ${result.error.message}`);
        loadedPathRef.current = source.path;
        setLoadedPath(source.path);
        return;
      }
      const rendered = await previewer.previewSource(source, result.value);
      if (!isCurrent()) return;
      if (!rendered.ok) throw new Error(rendered.message);
      const reference = source.reference.replaceAll("/", "\\");
      if (rendered.value.kind === "tileset") {
        const nextItems: BrowserSelection[] = [];
        const nextPreviews = new Map<string, TilePreviewPixels>();
        rendered.value.tiles.forEach((preview, index) => {
          const tileReference = `${reference}${index + 1}`;
          nextItems.push({ kind: "tiles", path: source.path, reference: tileReference, label: `${source.name} tile ${index + 1}`, boardTile: tileReference, stamp: null });
          nextPreviews.set(tileReference, preview);
        });
        setItems(nextItems);
        setPreviews(nextPreviews);
        loadedPathRef.current = source.path;
        setLoadedPath(source.path);
        return;
      }
      const selection: BrowserSelection = {
        kind: source.kind,
        path: source.path,
        reference,
        label: source.name,
        boardTile: source.boardTile,
        stamp: rendered.value.kind === "bitmap" ? rendered.value.size : null,
      };
      const preview = rendered.value.preview;
      if (rendered.value.kind === "animation") {
        setMessage(`Animated tile: ${rendered.value.frameCount} frames at ${1000 / rendered.value.speed} ms per frame. Select the animation as a board brush.`);
      } else if (rendered.value.kind === "bitmap") {
        setMessage(`Tile bitmap, ${rendered.value.size.width} × ${rendered.value.size.height} tiles. Select it as a whole stamp brush, or open it in the tile bitmap editor.`);
      }
      setItems([selection]);
      setPreviews(preview === null ? new Map() : new Map([[selection.reference, preview]]));
      loadedPathRef.current = source.path;
      setLoadedPath(source.path);
    } catch (error) {
      if (!isCurrent()) return;
      setItems([]);
      setPreviews(new Map());
      setMessage(error instanceof Error ? `${source.path}: ${error.message}` : String(error));
      loadedPathRef.current = source.path;
      setLoadedPath(source.path);
    }
  }

  const closeMenu = (): void => {
    const invoker = menu === null ? null : menuInvoker.current;
    menuInvoker.current = null;
    setMenu(null);
    if (invoker !== null) queueMicrotask(() => invoker.isConnected && invoker.focus());
  };
  const choose = (item: BrowserSelection): void => {
    session.update({ selection: item });
    closeMenu();
  };

  const editSource = (item: BrowserSelection): void => {
    closeMenu();
    const opened: Promise<string | null> = context.openSource?.(item.path) ?? Promise.resolve("This host cannot open another editor from the browser.");
    void opened.then(
      (reason) => { if (reason !== null) setMessage(`Cannot open ${item.path}: ${reason}`); },
      (error: unknown) => setMessage(`Cannot open ${item.path}: ${error instanceof Error ? error.message : String(error)}`),
    );
  };

  const openMenu = (item: BrowserSelection, invoker: HTMLElement): void => {
    menuInvoker.current = invoker;
    setMenu(item);
  };

  const keyboard = (event: KeyboardEvent): void => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-browser-reference]") : null;
    const item = items.find((candidate) => candidate.reference === row?.dataset.browserReference);
    if (event.shiftKey && event.key === "F10" && item !== undefined) {
      const control = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      const invoker = control !== null && row?.contains(control) ? control : row?.querySelector<HTMLButtonElement>("button") ?? row;
      if (invoker !== null) {
        event.preventDefault();
        openMenu(item, invoker);
      }
    }
  };

  const menuKeys = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
  };

  return (
    <section class="tkr-tileset-browser" aria-label="Tileset browser" onKeyDown={keyboard}>
      <h2 class="tkr-tileset-browser-heading">Tileset browser</h2>
      <label for={`${ids}-source`}>Source</label>
      <select id={`${ids}-source`} value={path ?? ""} onChange={(event) => {
        const source = sources.find((candidate) => candidate.path === event.currentTarget.value);
        if (source !== undefined) void load(source);
      }}>
        {sources.map((source) => <option key={source.path} value={source.path}>{source.reference} ({source.kind === "tiles" ? suffix(source.path).slice(1) : "tile bitmap"})</option>)}
      </select>
      <div class="tkr-tileset-browser-list" ref={list} role="list" aria-label="Tiles and assets" onScroll={(event) => session.update({ path, scrollTop: event.currentTarget.scrollTop })}>
        {items.map((item) => (
          <div
            key={item.reference}
            data-browser-reference={item.reference}
            class="tkr-tileset-browser-item"
            role="listitem"
            onContextMenu={(event) => {
              event.preventDefault();
              const invoker = event.currentTarget.querySelector<HTMLButtonElement>("button");
              if (invoker !== null) openMenu(item, invoker);
            }}
          >
            <button
              type="button"
              class={brush?.reference === item.reference ? "tkr-tileset-browser-source tkr-tileset-browser-source-selected" : "tkr-tileset-browser-source"}
              aria-pressed={brush?.reference === item.reference}
              onClick={() => item.boardTile === null ? session.update({ selection: item }) : choose(item)}
            >
              {previews.has(item.reference) ? (
                <canvas
                  class="tkr-tileset-browser-preview"
                  data-preview-reference={item.reference}
                  role="img"
                  aria-label={`Preview of ${item.label}`}
                />
              ) : null}
              <span>{item.label}</span>
            </button>
            <button type="button" class="tkr-tileset-browser-select-brush" disabled={item.boardTile === null && item.stamp === null} onClick={() => choose(item)}>
              {item.stamp === null ? "Select brush" : "Select stamp brush"}
            </button>
            <button type="button" onClick={(event) => openMenu(item, event.currentTarget)}>More actions</button>
            {menu === item ? (
              <div ref={menuRef} class="tkr-tileset-browser-menu" role="group" aria-label={`${item.label} actions`} onKeyDown={menuKeys}>
                {item.stamp === null ? (
                  <button type="button" disabled={item.boardTile === null} onClick={() => choose(item)}>Select as board brush</button>
                ) : (
                  <button type="button" onClick={() => choose(item)}>Select as stamp brush</button>
                )}
                {item.stamp === null || context.openSource === undefined ? (
                  <button type="button" disabled aria-describedby={`${ids}-source-edit-unavailable`}>Edit source unavailable (P1)</button>
                ) : (
                  <button type="button" onClick={() => editSource(item)}>Edit tile bitmap</button>
                )}
                <button type="button" onClick={closeMenu}>Close actions</button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p id={`${ids}-source-edit-unavailable`} class="tkr-tileset-browser-note" role="note">
        Source editing is unavailable until the P1 tile editor provider exists, except for tile bitmaps, which open in the tile bitmap editor. Browsing and brush selection do not change source files or paint a board.
      </p>
      {activeSource === null ? <p class="tkr-tileset-browser-empty" role="status">No tilesets, animated tiles or tile bitmaps are available.</p> : null}
      {message === null ? null : <p class="tkr-tileset-browser-message" role="alert">{message}</p>}
    </section>
  );
}
