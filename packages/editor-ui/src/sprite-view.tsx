import { kindForPath, classifyImageReference, spriteAnimationCanvasPreview, spriteAnimationPreview, spriteBasesFromFile, spriteGifPreview, spritePicturePreview, spriteProjectAssetPath, spriteTileBitmapPreviewFromAssets, spriteTileFrameFromReference, type ActorBase, type ActorPoint, type ApplyResult, type SaveResult, type SpriteCommand, type SpriteDocumentSnapshot, type SpritePreviewFrame } from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited, FileSystemService } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

const DIRECTIONS = ["South", "North", "East", "West", "North-west", "North-east", "South-west", "South-east"] as const;
const DIRECTION_CODES = ["S", "N", "E", "W", "NW", "NE", "SW", "SE"] as const;
let viewsMade = 0;
let customStancesMade = 0;

export interface SpriteViewDocument {
  readonly kind: string;
  readonly identity: SpriteDocumentSnapshot["identity"];
  getSnapshot(): SpriteDocumentSnapshot;
  subscribe(listener: () => void): () => void;
  apply(command: SpriteCommand): ApplyResult | Promise<ApplyResult>;
  save(): Promise<SaveResult>;
  resolveConflict(choice: "keep-local" | "reload"): { readonly ok: boolean; readonly message?: string } | Promise<{ readonly ok: boolean; readonly message?: string }>;
}

export interface SpriteViewProps {
  readonly doc: SpriteViewDocument;
  readonly fs: Pick<FileSystemService, "readProject">;
  readonly capabilities: Capabilities;
  readonly onEdited: (event: DocumentEdited) => void;
}

type BaseEdit = (bases: readonly ActorBase[]) => readonly ActorBase[];
interface StanceHistoryIdentity {
  readonly key: string;
  index: number;
  readonly editId: string;
  readonly kind: "add" | "delete";
  readonly handle: string;
  readonly animation: string;
}

interface PendingStanceIdentity {
  readonly key: string;
  readonly index: number;
  readonly handle: string;
  readonly animation: string;
}


function copiedBases(bases: readonly ActorBase[]): readonly ActorBase[] {
  return bases.map((base) => ({ points: base.points.map((point) => ({ ...point })) }));
}

function pathPoints(points: readonly ActorPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function imagePath(projectPath: string, reference: string): string {
  return spriteProjectAssetPath(projectPath, reference);
}

function tileAnimationPath(reference: string): boolean {
  return reference.toLowerCase().endsWith(".tan");
}

async function readProjectAsset(fs: Pick<FileSystemService, "readProject">, projectId: string, path: string): Promise<Uint8Array | null> {
  const read = await fs.readProject(projectId, path);
  return read.ok ? read.value : null;
}

function spritePoint(svg: SVGSVGElement, clientX: number, clientY: number): ActorPoint | null {
  const matrix = svg.getScreenCTM();
  if (matrix === null) return null;
  const cursor = svg.createSVGPoint();
  cursor.x = clientX;
  cursor.y = clientY;
  const point = cursor.matrixTransform(matrix.inverse());
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  return x < -40 || x > 40 || y < -40 || y > 20 ? null : { x, y };
}

/** T-52 animation previews decode through editor-model and place the origin crosshair at bottom centre. */
function AnimationPreview({ file, fs, projectId, id }: { readonly file: string; readonly fs: Pick<FileSystemService, "readProject">; readonly projectId: string; readonly id: string }) {
  const [frames, setFrames] = useState<readonly SpritePreviewFrame[]>([]);
  const [frame, setFrame] = useState(0);
  const [message, setMessage] = useState("Choose an .anm or animated GIF to preview it.");
  const [delay, setDelay] = useState(0.167);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    setFrames([]);
    setFrame(0);
    if (file.trim() === "") {
      setMessage("Choose an .anm or animated GIF to preview it.");
      return () => { active = false; };
    }
    const selectedPath = imagePath("Misc", file.trim());
    void fs.readProject(projectId, selectedPath).then(async (read) => {
      if (!active) return;
      if (!read.ok) {
        setMessage(`Preview unavailable: ${read.error.message}`);
        return;
      }
      if (selectedPath.toLowerCase().endsWith(".gif")) {
        const gif = spriteGifPreview(read.value, selectedPath);
        if (gif === null) {
          setMessage("This GIF could not be decoded.");
          return;
        }
        setDelay(gif.delay);
        setFrames(gif.frames.map((page) => spriteAnimationCanvasPreview(page, page.width, page.height, gif.transparent)));
        setMessage(`Animated GIF preview: ${gif.frames.length} page${gif.frames.length === 1 ? "" : "s"}.`);
        return;
      }
      const animation = spriteAnimationPreview(read.value, selectedPath);
      if (animation === null) {
        setMessage("This animation could not be decoded.");
        return;
      }
      setDelay(animation.delay);
      const loaded: SpritePreviewFrame[] = [];
      for (const frame of animation.frames) {
        const reference = classifyImageReference(frame.image);
        let source: SpritePreviewFrame | null = null;
        let isPicture = false;
        if (reference.kind === "tile" || reference.kind === "singleTile" || tileAnimationPath(frame.image)) {
          source = await spriteTileFrameFromReference(frame.image, (path) => readProjectAsset(fs, projectId, path));
        } else if (reference.kind === "tileBitmap") {
          const bitmapPath = imagePath("Bitmap", reference.path);
          const bitmap = await fs.readProject(projectId, bitmapPath);
          if (bitmap.ok) {
            source = await spriteTileBitmapPreviewFromAssets(bitmap.value, bitmapPath, (path) => readProjectAsset(fs, projectId, path));
            isPicture = true;
          }
        } else if (reference.kind === "picture") {
          const imageFile = imagePath("Bitmap", reference.path);
          const picture = await fs.readProject(projectId, imageFile);
          if (picture.ok) source = spritePicturePreview(picture.value, imageFile);
          isPicture = true;
        }
        if (!active) return;
        if (source !== null) loaded.push(spriteAnimationCanvasPreview(
          source,
          animation.width,
          animation.height,
          isPicture ? frame.transparent : undefined,
          isPicture,
        ));
      }
      if (!active) return;
      setFrames(loaded);
      setMessage(loaded.length === 0 ? "No previewable picture frames were found in this animation." : `Animation preview: ${loaded.length} frame${loaded.length === 1 ? "" : "s"} on a ${animation.width} × ${animation.height} canvas.`);
    }).catch((error: unknown) => {
      if (active) setMessage(`Preview unavailable: ${error instanceof Error ? error.message : "project file could not be read"}`);
    });
    return () => { active = false; };
  }, [file, fs, projectId]);

  useEffect(() => {
    if (frames.length < 2) return;
    const timer = globalThis.setInterval(() => setFrame((current) => (current + 1) % frames.length), Math.max(16, delay * 1000));
    return () => globalThis.clearInterval(timer);
  }, [frames, delay]);

  const visible = frames[frame];
  useEffect(() => {
    const target = canvas.current;
    if (visible === undefined || target === null) return;
    target.width = visible.width;
    target.height = visible.height;
    const context = target.getContext("2d");
    if (context !== null) context.putImageData(new ImageData(new Uint8ClampedArray(visible.rgba), visible.width, visible.height), 0, 0);
  }, [visible]);

  return <div class="tkr-sprite-preview" id={id} aria-label={`Preview for ${file || "unassigned stance"}; the origin crosshair is at the bottom centre.`}>
    {visible === undefined
      ? <p role="status">{message}</p>
      : <div class="tkr-sprite-preview-stage">
          <canvas ref={canvas} role="img" aria-label={`${file} frame ${frame + 1} of ${frames.length}; origin crosshair at bottom centre`} />
          <svg class="tkr-sprite-preview-overlay" viewBox={`0 0 ${visible.width} ${visible.height}`} aria-hidden="true">
            <path d={`M ${visible.width / 2 - 4} ${visible.height - 1} h 8 M ${visible.width / 2} ${visible.height - 5} v 5`} stroke="red" stroke-width="1" />
          </svg>
        </div>}
    {visible !== undefined && <p role="status">{message}</p>}
  </div>;
}


export function SpriteView({ doc, fs, capabilities, onEdited }: SpriteViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [formId] = useState(() => { viewsMade += 1; return `sprite-${viewsMade}`; });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState("");
  const [selectedBase, setSelectedBase] = useState(0);
  const [importPath, setImportPath] = useState("");
  const [feedback, setFeedback] = useState("");
  const [dragPreview, setDragPreview] = useState<{ readonly index: number; readonly point: ActorPoint } | null>(null);
  const draggingPoint = useRef<number | null>(null);
  const dragCoordinate = useRef<ActorPoint | null>(null);
  const suppressClick = useRef(false);
  const blockedPointerId = useRef<number | null>(null);
  const baseCanvas = useRef<SVGSVGElement>(null);
  const blockedPointerCleanup = useRef<(() => void) | null>(null);
  const finishBlockedPointer = (pointerId: number, suppress: boolean): void => {
    if (blockedPointerId.current !== pointerId) return;
    blockedPointerId.current = null;
    suppressClick.current = suppress;
    blockedPointerCleanup.current?.();
    blockedPointerCleanup.current = null;
  };
  useEffect(() => () => {
    blockedPointerCleanup.current?.();
    blockedPointerCleanup.current = null;
    blockedPointerId.current = null;
  }, []);
  const newCustomStanceKey = (): string => `${formId}-custom-${++customStancesMade}`;
  const customStanceKeys = useRef<string[] | null>(null);
  const stanceHistory = useRef(new Map<string, StanceHistoryIdentity>());
  const pendingStanceAdds = useRef<PendingStanceIdentity[]>([]);
  const pendingStanceDeletes = useRef<PendingStanceIdentity[]>([]);
  const pendingCustomStanceOperations = useRef(0);
  const observedEdits = useRef(new Map(snapshot.edits.map((edit) => [edit.editId, edit] as const)));
  const observedStances = useRef(snapshot.customStances);
  if (customStanceKeys.current === null) {
    customStanceKeys.current = snapshot.customStances.map(() => newCustomStanceKey());
  } else {
    const currentEdits = new Map(snapshot.edits.map((edit) => [edit.editId, edit] as const));
    const addedEdits = snapshot.edits.filter((edit) => !observedEdits.current.has(edit.editId));
    const removedEdits = [...observedEdits.current.values()].filter((edit) => !currentEdits.has(edit.editId)).reverse();
    let workingStances = [...observedStances.current];
    const removeIdentity = (identity: StanceHistoryIdentity, fallbackIndex = identity.index): number => {
      const keyIndex = customStanceKeys.current!.indexOf(identity.key);
      const index = keyIndex >= 0 ? keyIndex : fallbackIndex;
      if (keyIndex >= 0) customStanceKeys.current!.splice(keyIndex, 1);
      identity.index = index;
      return index;
    };
    const insertIdentity = (identity: StanceHistoryIdentity): number => {
      if (customStanceKeys.current!.includes(identity.key)) return customStanceKeys.current!.indexOf(identity.key);
      const index = Math.max(0, Math.min(identity.index, customStanceKeys.current!.length));
      customStanceKeys.current!.splice(index, 0, identity.key);
      identity.index = index;
      return index;
    };

    for (const edit of removedEdits) {
      if (edit.command.type === "delete-custom-stance") {
        const identity = stanceHistory.current.get(edit.editId);
        if (identity !== undefined) {
          const index = insertIdentity(identity);
          workingStances.splice(index, 0, { handle: identity.handle, animation: identity.animation });
        }
      } else if (edit.command.type === "add-custom-stance") {
        const identity = stanceHistory.current.get(edit.editId);
        if (identity !== undefined) {
          const index = removeIdentity(identity);
          workingStances.splice(index, 1);
        }
      }
    }
    for (const edit of addedEdits) {
      if (edit.command.type === "add-custom-stance") {
        let identity = stanceHistory.current.get(edit.editId);
        if (identity === undefined) {
          const pending = pendingStanceAdds.current.shift();
          identity = {
            key: pending?.key ?? newCustomStanceKey(), index: customStanceKeys.current.length,
            editId: edit.editId, kind: "add", handle: pending?.handle ?? edit.command.name,
            animation: pending?.animation ?? edit.command.file,
          };
          stanceHistory.current.set(identity.editId, identity);
        }
        const index = insertIdentity(identity);
        workingStances.splice(index, 0, { handle: identity.handle, animation: identity.animation });
      } else if (edit.command.type === "delete-custom-stance") {
        let identity = stanceHistory.current.get(edit.editId);
        if (identity === undefined) {
          const index = edit.command.index;
          const pendingIndex = pendingStanceDeletes.current.findIndex((pending) => pending.index === index);
          const pending = pendingIndex < 0 ? undefined : pendingStanceDeletes.current.splice(pendingIndex, 1)[0];
          const stance = workingStances[index];
          const key = pending?.key ?? customStanceKeys.current[index];
          if (key !== undefined && (pending !== undefined || stance !== undefined)) {
            identity = {
              key, index, editId: edit.editId, kind: "delete",
              handle: pending?.handle ?? stance!.handle, animation: pending?.animation ?? stance!.animation,
            };
            stanceHistory.current.set(identity.editId, identity);
          }
        }
        if (identity !== undefined) {
          const index = removeIdentity(identity, edit.command.index);
          workingStances.splice(index, 1);
        }
      }
    }
    if (pendingCustomStanceOperations.current === 0 && customStanceKeys.current.length !== snapshot.customStances.length) {
      customStanceKeys.current = snapshot.customStances.map(() => newCustomStanceKey());
      stanceHistory.current.clear();
      pendingStanceAdds.current = [];
      pendingStanceDeletes.current = [];
    }
    observedEdits.current = currentEdits;
    observedStances.current = snapshot.customStances;
  }
  const stanceKeySignature = customStanceKeys.current.join(",");
  const liveCustomDrafts = new Set(customStanceKeys.current.flatMap((id) => [`custom-name:${id}`, `custom-animation:${id}`]));
  useEffect(() => {
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) =>
      (!key.startsWith("custom-name:") && !key.startsWith("custom-animation:")) || liveCustomDrafts.has(key))));
  }, [stanceKeySignature]);
  const [pendingBaseWorkCount, setPendingBaseWorkCount] = useState(0);
  const [pendingBaseStructureCount, setPendingBaseStructureCount] = useState(0);
  const [pendingBaseRemovalCount, setPendingBaseRemovalCount] = useState(0);
  const pendingBaseStructureCommands = useRef(0);
  const pendingBaseRemovalCommands = useRef(0);
  const pendingBaseCommands = useRef(0);
  const queuedBaseEdits = useRef<BaseEdit[]>([]);
  const baseQueue = useRef<Promise<void>>(Promise.resolve());
  const readOnly = snapshot.readOnly !== null;
  const disabled = readOnly || snapshot.conflict !== null || snapshot.saving;
  const bases = snapshot.vectorBases ?? [];
  const baseStructureDisabled = disabled || snapshot.graphicsUnavailable !== null || pendingBaseStructureCount > 0 || pendingBaseStructureCommands.current > 0;
  const baseCoordinatesDisabled = disabled || snapshot.graphicsUnavailable !== null || pendingBaseRemovalCount > 0 || pendingBaseRemovalCommands.current > 0;
  const baseDraft = useRef(copiedBases(bases));
  if (pendingBaseCommands.current === 0) baseDraft.current = copiedBases(bases);
  const selected = bases[selectedBase] ?? { points: [] };
  const selectedPoints = selected.points.map((point, index) => dragPreview?.index === index ? dragPreview.point : point);
  const submit = async (command: SpriteCommand): Promise<boolean> => {
    try {
      const result = await doc.apply(command);
      if (!result.ok) {
        setFeedback(result.rejection.message);
        return false;
      }
      setFeedback("Graphics change recorded. Save the document to keep it.");
      onEdited({ document: doc.identity.key, editId: result.editId, label: "Edit sprite graphics" });
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "The graphics edit could not be applied.");
      return false;
    }
  };
  const rebaseBaseDraft = (): void => {
    const committed = copiedBases(doc.getSnapshot().vectorBases ?? []);
    baseDraft.current = queuedBaseEdits.current.reduce((current, next) => next(current), committed);
  };
  const enqueueBaseWork = (work: () => Promise<void>, structural = false, removal = false): void => {
    pendingBaseCommands.current += 1;
    setPendingBaseWorkCount((count) => count + 1);
    if (structural) {
      pendingBaseStructureCommands.current += 1;
      setPendingBaseStructureCount((count) => count + 1);
    }
    if (removal) {
      pendingBaseRemovalCommands.current += 1;
      setPendingBaseRemovalCount((count) => count + 1);
    }
    const finished = (): void => {
      pendingBaseCommands.current -= 1;
      setPendingBaseWorkCount((count) => Math.max(0, count - 1));
      if (structural) {
        pendingBaseStructureCommands.current -= 1;
        setPendingBaseStructureCount((count) => Math.max(0, count - 1));
      }
      if (removal) {
        pendingBaseRemovalCommands.current -= 1;
        setPendingBaseRemovalCount((count) => Math.max(0, count - 1));
      }
    };
    baseQueue.current = baseQueue.current.then(work).then(
      () => {
        finished();
        rebaseBaseDraft();
      },
      (error: unknown) => {
        finished();
        setFeedback(error instanceof Error ? error.message : "A polygon edit could not be applied.");
      },
    );
  };
  const submitBases = (edit: BaseEdit, structural = false, removal = false): void => {
    queuedBaseEdits.current.push(edit);
    baseDraft.current = edit(baseDraft.current);
    enqueueBaseWork(async () => {
      const operation = queuedBaseEdits.current.shift();
      if (operation === undefined) return;
      const committed = copiedBases(doc.getSnapshot().vectorBases ?? []);
      await submit({ type: "set-sprite-bases", bases: copiedBases(operation(committed)) });
    }, structural, removal);
  };
  const clearDraft = (key: string, submitted: string): void => setDrafts((current) => {
    if (current[key] !== submitted) return current;
    const next = { ...current };
    delete next[key];
    return next;
  });
  const addCustomStance = async (name: string): Promise<void> => {
    const pending = { key: newCustomStanceKey(), index: doc.getSnapshot().customStances.length, handle: name, animation: "" };
    pendingStanceAdds.current.push(pending);
    pendingCustomStanceOperations.current += 1;
    const success = await submit({ type: "add-custom-stance", name, file: "" });
    pendingCustomStanceOperations.current -= 1;
    if (!success) {
      const pendingIndex = pendingStanceAdds.current.indexOf(pending);
      if (pendingIndex >= 0) pendingStanceAdds.current.splice(pendingIndex, 1);
    }
    setDrafts((current) => ({ ...current }));
  };
  const deleteCustomStance = async (index: number): Promise<void> => {
    const stance = doc.getSnapshot().customStances[index];
    const key = customStanceKeys.current![index];
    if (stance === undefined || key === undefined) return;
    const pending = { key, index, handle: stance.handle, animation: stance.animation };
    pendingStanceDeletes.current.push(pending);
    pendingCustomStanceOperations.current += 1;
    const success = await submit({ type: "delete-custom-stance", index });
    pendingCustomStanceOperations.current -= 1;
    if (!success) {
      const pendingIndex = pendingStanceDeletes.current.indexOf(pending);
      if (pendingIndex >= 0) pendingStanceDeletes.current.splice(pendingIndex, 1);
    }
    setDrafts((current) => ({ ...current }));
  };
  const saveSprite = async (): Promise<void> => {
    while (pendingBaseCommands.current > 0) await baseQueue.current;
    const result = await doc.save();
    setFeedback(result.ok ? "Sprite saved." : result.failure.message);
  };
  const field = (key: string, current: string, label: string, group: "walk" | "idle" | "battle" | "custom", index: number, supports: boolean) => {
    const value = drafts[key] ?? current;
    const inputId = `${formId}-${key}-input`;
    return <div class="tkr-sprite-file" key={key}>
      <label for={inputId}>{label}
        <input id={inputId} type="text" value={value} placeholder="Misc/hero_walk_s.anm or hero.gif" aria-label={`${label} animation file`} disabled={disabled || !supports} onInput={(event) => setDrafts((current) => ({ ...current, [key]: event.currentTarget.value }))} onBlur={() => {
          if (value !== current && supports && !disabled) void submit({ type: "set-sprite-animation", group, index, file: value.trim() }).then((success) => { if (success) clearDraft(key, value); });
        }} />
      </label>
      <small>Project-relative animation file (.anm or animated .gif).</small>
      {value.trim() !== "" && <AnimationPreview file={value} fs={fs} projectId={snapshot.identity.projectId} id={`${formId}-${key}`} />}
    </div>;
  };
  const setPoint = (pointIndex: number, axis: "x" | "y", value: number): void => {
    if (disabled || snapshot.graphicsUnavailable !== null || pendingBaseRemovalCommands.current > 0 || !Number.isInteger(value)) return;
    const baseIndex = selectedBase;
    submitBases((current) => {
      const next = copiedBases(current);
      const points = [...(next[baseIndex]?.points ?? [])];
      const point = points[pointIndex];
      if (point === undefined) return current;
      points[pointIndex] = { ...point, [axis]: value };
      const changed = [...next];
      changed[baseIndex] = { points };
      return changed;
    });
  };
  const movePoint = (pointIndex: number, point: ActorPoint): void => {
    if (disabled || snapshot.graphicsUnavailable !== null || pendingBaseRemovalCommands.current > 0) return;
    const baseIndex = selectedBase;
    submitBases((current) => {
      const next = copiedBases(current);
      const points = [...(next[baseIndex]?.points ?? [])];
      if (points[pointIndex] === undefined) return current;
      points[pointIndex] = point;
      const changed = [...next];
      changed[baseIndex] = { points };
      return changed;
    });
  };
  const replaceBase = (index: number, points: readonly ActorPoint[]): void => {
    if (disabled || snapshot.graphicsUnavailable !== null) return;
    submitBases((current) => {
      const next = [...copiedBases(current)];
      next[index] = { points: points.map((point) => ({ ...point })) };
      return next;
    }, true);
  };
  const appendBasePoint = (index: number, point: ActorPoint): void => {
    if (baseStructureDisabled) return;
    submitBases((current) => {
      const next = [...copiedBases(current)];
      const base = next[index];
      if (base === undefined) return current;
      next[index] = { points: [...base.points, { ...point }] };
      return next;
    }, true);
  };
  const removeBasePoint = (index: number, pointIndex: number): void => {
    if (baseStructureDisabled) return;
    submitBases((current) => {
      const next = [...copiedBases(current)];
      const base = next[index];
      if (base === undefined || base.points.length <= 3 || base.points[pointIndex] === undefined) return current;
      next[index] = { points: base.points.filter((_point, candidate) => candidate !== pointIndex) };
      return next;
    }, true, true);
  };
  const assignWalk = async (): Promise<void> => {
    if (template.split("*").length !== 2) {
      setFeedback("Use exactly one * in the filename template for the direction code.");
      return;
    }
    for (let index = 0; index < DIRECTION_CODES.length; index += 1) {
      const file = template.replace("*", DIRECTION_CODES[index]!);
      if (!await submit({ type: "set-sprite-animation", group: "walk", index, file })) return;
    }
    setFeedback("Assigned all eight walk directions from the filename template.");
  };
  const importBases = (): void => {
    const path = importPath.trim().replaceAll("\\", "/");
    if (path === "") return;
    const kind = kindForPath(path);
    if (kind === null || (kind.id !== "character" && kind.id !== "item")) {
      setFeedback("Choose another character (.tem) or item (.itm) sprite.");
      return;
    }
    const actorKind: "character" | "item" = kind.id === "character" ? "character" : "item";
    const projectId = snapshot.identity.projectId;
    enqueueBaseWork(async () => {
      const read = await fs.readProject(projectId, path);
      if (!read.ok) {
        setFeedback(`Could not import bases: ${read.error.message}`);
        return;
      }
      const imported = spriteBasesFromFile(actorKind, read.value, path);
      if (imported === null) {
        setFeedback("Could not read the selected sprite's collision and activation bases.");
        return;
      }
      if (imported.unavailable !== null || imported.bases === null || imported.bases.length !== 2) {
        setFeedback("The selected sprite format does not store a collision and activation base pair.");
        return;
      }
      await submit({ type: "set-sprite-bases", bases: copiedBases(imported.bases) });
    }, true);
  };

  return <section class="tkr-sprite-graphics" aria-label={`${snapshot.actorType} sprite graphics`}>
    <header><h2>Sprite graphics</h2><p>{snapshot.actorName || `Untitled ${snapshot.actorType}`} · {snapshot.actorType} file minor {snapshot.minor}</p></header>
    {readOnly && <p role="status">Read-only: {snapshot.readOnly?.message}</p>}
    <fieldset disabled={disabled}>
      <legend>Directional walk animations</legend>
      <div class="tkr-sprite-direction-grid">{DIRECTIONS.map((direction, index) => field(`walk-${index}`, snapshot.movementAnimations[index] ?? "", direction, "walk", index, snapshot.minor >= (snapshot.actorType === "character" ? 5 : 4)))}</div>
      <div class="tkr-sprite-assignment">
        <label>Assign all walk directions from filename template
          <input value={template} placeholder="hero_walk_*.anm" onInput={(event) => setTemplate(event.currentTarget.value)} aria-describedby={`${formId}-template-help`} />
        </label>
        <small id={`${formId}-template-help`}>Replace * with S, N, E, W, NW, NE, SW or SE, in that order.</small>
        <button type="button" onClick={assignWalk} disabled={disabled || snapshot.minor < (snapshot.actorType === "character" ? 5 : 4)}>Assign eight directions</button>
      </div>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>Directional idle animations</legend>
      <div class="tkr-sprite-direction-grid">{DIRECTIONS.map((direction, index) => field(`idle-${index}`, snapshot.idleAnimations[index] ?? "", direction, "idle", index, snapshot.minor >= (snapshot.actorType === "character" ? 6 : 5)))}</div>
    </fieldset>
    {snapshot.actorType === "character" && <fieldset disabled={disabled}>
      <legend>Battle stances</legend>
      <div class="tkr-sprite-direction-grid">{["Attack", "Defend", "Special Move", "Die", "Rest"].map((name, index) => field(`battle-${index}`, snapshot.battleAnimations[index] ?? "", name, "battle", index, snapshot.minor >= 5))}</div>
    </fieldset>}
    <fieldset disabled={disabled}>
      <legend>Custom stances</legend>
      {snapshot.customStances.map((stance, index) => {
        const id = customStanceKeys.current![index]!;
        const nameKey = `custom-name:${id}`;
        const animationKey = `custom-animation:${id}`;
        const name = drafts[nameKey] ?? stance.handle;
        const supported = snapshot.minor >= (snapshot.actorType === "character" ? 5 : 4);
        return <div class="tkr-sprite-custom" key={id}>
          <label>Stance name<input value={name} disabled={disabled || !supported} onInput={(event) => setDrafts((current) => ({ ...current, [nameKey]: event.currentTarget.value }))} onBlur={() => {
            if (name !== stance.handle && !disabled) void submit({ type: "rename-custom-stance", index, name: name.trim() }).then((success) => { if (success) clearDraft(nameKey, name); });
          }} /></label>
          {field(animationKey, stance.animation, `${stance.handle} animation`, "custom", index, supported)}
          <button type="button" onClick={() => void deleteCustomStance(index)} disabled={disabled || !supported}>Delete stance</button>
        </div>;
      })}
      <form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const name = String(new FormData(form).get("stance-name") ?? "").trim(); if (name !== "") void addCustomStance(name); form.reset(); }}>
        <label>New custom stance name<input name="stance-name" required maxLength={128} disabled={snapshot.minor < (snapshot.actorType === "character" ? 5 : 4)} /></label>
        <button type="submit" disabled={disabled || snapshot.minor < (snapshot.actorType === "character" ? 5 : 4)}>Add custom stance</button>
      </form>
    </fieldset>
    <fieldset disabled={disabled}>
      <legend>Movement timing</legend>
      {snapshot.speed === null || snapshot.idleTime === null
        ? <p>This file version does not store movement speed and idle delay.</p>
        : <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit({ type: "set-sprite-timing", speed: Number(form.get("speed")), idleTime: Number(form.get("idleTime")) }); }}>
          <label>Speed (seconds per step)<input name="speed" type="number" min="0.000001" step="any" required defaultValue={snapshot.speed} /></label>
          <label>Idle delay (seconds)<input name="idleTime" type="number" min="0" step="any" required defaultValue={snapshot.idleTime} /></label>
          <button type="submit">Apply timing</button>
        </form>}
    </fieldset>
    <fieldset disabled={disabled || snapshot.graphicsUnavailable !== null}>
      <legend>Collision and activation bases</legend>
      {snapshot.graphicsUnavailable !== null && <p role="status">{snapshot.graphicsUnavailable}</p>}
      {snapshot.graphicsUnavailable === null && <>
        <p>Coordinates are whole pixels from the sprite origin (bottom-centre, 0, 0). Collision stops sprite movement; activation marks the interaction area.</p>
        <div role="group" aria-label="Choose a polygon to edit">
          <button type="button" aria-pressed={selectedBase === 0} onClick={() => setSelectedBase(0)}>Collision polygon</button>
          <button type="button" aria-pressed={selectedBase === 1} onClick={() => setSelectedBase(1)}>Activation polygon</button>
        </div>
        <button type="button" onClick={() => appendBasePoint(selectedBase, { x: 0, y: 0 })} disabled={baseStructureDisabled}>Add polygon point at origin</button>
        <svg ref={baseCanvas} class="tkr-sprite-base-canvas" viewBox="-40 -40 80 60" role="img" aria-label={`Sprite origin and ${selectedBase === 0 ? "collision" : "activation"} polygon. Click to add a point; drag a point to move it.`} onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const point = spritePoint(event.currentTarget, event.clientX, event.clientY);
          if (point !== null) appendBasePoint(selectedBase, point);
        }} onPointerDown={(event) => {
          if (baseStructureDisabled || pendingBaseStructureCommands.current > 0) {
            event.preventDefault();
            blockedPointerCleanup.current?.();
            const pointerId = event.pointerId;
            blockedPointerId.current = pointerId;
            const onPointerUp = (nativeEvent: PointerEvent): void => {
              if (nativeEvent.pointerId === pointerId) finishBlockedPointer(pointerId, baseCanvas.current?.contains(nativeEvent.target as Node) ?? false);
            };
            const onPointerCancel = (nativeEvent: PointerEvent): void => {
              if (nativeEvent.pointerId === pointerId) finishBlockedPointer(pointerId, false);
            };
            window.addEventListener("pointerup", onPointerUp, true);
            window.addEventListener("pointercancel", onPointerCancel, true);
            blockedPointerCleanup.current = () => {
              window.removeEventListener("pointerup", onPointerUp, true);
              window.removeEventListener("pointercancel", onPointerCancel, true);
            };
            try {
              event.currentTarget.setPointerCapture(pointerId);
            } catch {
              // Window listeners still clear the gesture if this host cannot capture synthetic pointers.
            }
            return;
          }
          const indexValue = (event.target as Element).getAttribute("data-point-index");
          if (indexValue === null) return;
          const index = Number(indexValue);
          event.preventDefault();
          draggingPoint.current = index;
          dragCoordinate.current = selected.points[index] ?? null;
          setDragPreview({ index, point: selected.points[index]! });
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Keep the in-SVG drag usable in hosts that do not implement pointer capture.
          }
        }} onPointerMove={(event) => {
          const index = draggingPoint.current;
          if (index === null) return;
          const point = spritePoint(event.currentTarget, event.clientX, event.clientY);
          if (point === null) return;
          dragCoordinate.current = point;
          setDragPreview({ index, point });
        }} onPointerUp={(event) => {
          if (blockedPointerId.current === event.pointerId) {
            finishBlockedPointer(event.pointerId, baseCanvas.current?.contains(event.target as Node) ?? true);
            return;
          }
          const index = draggingPoint.current;
          if (index === null) return;
          const point = spritePoint(event.currentTarget, event.clientX, event.clientY) ?? dragCoordinate.current;
          if (point !== null) movePoint(index, point);
          draggingPoint.current = null;
          dragCoordinate.current = null;
          setDragPreview(null);
          suppressClick.current = true;
        }} onPointerCancel={(event) => {
          if (blockedPointerId.current === event.pointerId) finishBlockedPointer(event.pointerId, false);
          suppressClick.current = false;
          draggingPoint.current = null;
          dragCoordinate.current = null;
          setDragPreview(null);
        }} onLostPointerCapture={(event) => {
          if (blockedPointerId.current === event.pointerId) finishBlockedPointer(event.pointerId, false);
        }}>
          <line x1="0" y1="-40" x2="0" y2="20" aria-hidden="true" />
          <line x1="-40" y1="0" x2="40" y2="0" aria-hidden="true" />
          <circle cx="0" cy="0" r="1.5" aria-label="Sprite origin" />
          <polygon points={pathPoints(selectedPoints)} aria-label={`${selectedBase === 0 ? "Collision" : "Activation"} polygon`} />
          {selectedPoints.map((point, index) => <circle key={index} data-point-index={index} cx={point.x} cy={point.y} r="2" aria-label={`Point ${index + 1}: ${point.x}, ${point.y}`} />)}
        </svg>
        <table><caption>{selectedBase === 0 ? "Collision" : "Activation"} polygon points</caption><thead><tr><th scope="col">Point</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Action</th></tr></thead>
          <tbody>{selected.points.map((point, index) => <tr key={index}><th scope="row">{index + 1}</th>
            <td><label class="tkr-sr-only" for={`${formId}-x-${index}`}>Point {index + 1} X</label><input id={`${formId}-x-${index}`} type="number" min="-2147483648" max="2147483647" step="1" value={point.x} disabled={baseCoordinatesDisabled} onChange={(event) => setPoint(index, "x", Number(event.currentTarget.value))} /></td>
            <td><label class="tkr-sr-only" for={`${formId}-y-${index}`}>Point {index + 1} Y</label><input id={`${formId}-y-${index}`} type="number" min="-2147483648" max="2147483647" step="1" value={point.y} disabled={baseCoordinatesDisabled} onChange={(event) => setPoint(index, "y", Number(event.currentTarget.value))} /></td>
            <td><button type="button" onClick={() => removeBasePoint(selectedBase, index)} disabled={baseStructureDisabled || selected.points.length <= 3}>Remove point {index + 1}</button></td>
          </tr>)}</tbody></table>
        <div role="group" aria-label="Polygon shape presets">
          <button type="button" onClick={() => replaceBase(selectedBase, selectedBase === 0 ? DEFAULT_SMALL : DEFAULT_SMALL_ACTIVATION)}>Small rectangle</button>
          <button type="button" onClick={() => replaceBase(selectedBase, selectedBase === 0 ? DEFAULT_LARGE : DEFAULT_LARGE_ACTIVATION)}>Large rectangle</button>
          <button type="button" onClick={() => replaceBase(selectedBase, selectedBase === 0 ? ISO_DIAMOND : ISO_ACTIVATION)}>Isometric diamond</button>
        </div>
        <label>Import bases from another sprite<input value={importPath} placeholder="Chrs/hero.tem or Item/key.itm" onInput={(event) => setImportPath(event.currentTarget.value)} /></label>
        <button type="button" onClick={() => void importBases()}>Import both bases</button>
      </>}
    </fieldset>
    {snapshot.conflict !== null && <div role="group" aria-label="External file conflict">
      <p role="status">{snapshot.conflict.message}</p>
      <button type="button" onClick={() => void Promise.resolve(doc.resolveConflict("keep-local")).then((result) => setFeedback(result.ok ? "Conflict resolved; local edits are ready to save." : result.message ?? "Could not keep local changes."))}>Keep local edits</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null
        ? <button type="button" onClick={() => void Promise.resolve(doc.resolveConflict("reload")).then((result) => {
            setFeedback(result.ok ? "Reloaded the file from disk." : result.message ?? "Could not reload the file.");
            if (result.ok) setDrafts({});
          })}>Reload from disk</button>
        : <p role="note">This host cannot safely reload the file in place. Both versions remain unchanged.</p>}
    </div>}
    {snapshot.saveError !== null && <p role="alert">{snapshot.saveError.message}</p>}
    <button type="button" onClick={() => void saveSprite()} disabled={disabled || !snapshot.dirty || snapshot.saving}>{snapshot.saving ? "Saving…" : "Save sprite"}</button>
    <p role="status" aria-live="polite">{feedback || (snapshot.dirty ? "Unsaved sprite changes." : "All sprite changes saved.")}</p>
  </section>;
}

const DEFAULT_SMALL = [{ x: -15, y: -15 }, { x: 15, y: -15 }, { x: 15, y: 0 }, { x: -15, y: 0 }];
const DEFAULT_LARGE = [{ x: -24, y: -24 }, { x: 24, y: -24 }, { x: 24, y: 0 }, { x: -24, y: 0 }];
const DEFAULT_SMALL_ACTIVATION = [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 4 }, { x: -20, y: 4 }];
const DEFAULT_LARGE_ACTIVATION = [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 10 }, { x: -30, y: 10 }];
const ISO_DIAMOND = [{ x: 0, y: -30 }, { x: 15, y: -15 }, { x: 0, y: 0 }, { x: -15, y: -15 }];
const ISO_ACTIVATION = [{ x: 0, y: -38 }, { x: 24, y: -20 }, { x: 0, y: 8 }, { x: -24, y: -20 }];
