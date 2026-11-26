import { createEditTracker, projectLayoutForDocumentPath, referencePath, resolveDocumentPath, spritePicturePreview, type NativeSkinCommand, type NativeSkinSnapshot, type PendingEdits, type PickOutcome, type SpritePreviewFrame } from "@tk-reawakened/editor-model";
import type { Capability, DocumentEdited, FileSystemService } from "@tk-reawakened/platform-services";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { AssetRefreshContext } from "./asset-refresh.ts";
import type { CharacterAuthoringViewProps } from "./character-authoring-view.tsx";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

export type NativeSkinViewDocument = ViewDocument<NativeSkinSnapshot, NativeSkinCommand>;

export interface NativeSkinViewProps {
  readonly doc: NativeSkinViewDocument;
  readonly capabilities: ReadonlySet<Capability>;
  readonly pendingEdits: PendingEdits;
  readonly onEdited: (event: DocumentEdited) => void;
  readonly fs: ProjectReader;
  readonly projectId: string;
  readonly pickAsset?: CharacterAuthoringViewProps["pickAsset"];
}

type ProjectReader = Pick<FileSystemService, "readProject"> & Partial<Pick<FileSystemService, "list">>;

const IMAGE_EXTENSIONS = [".bmp", ".gif", ".jpeg", ".jpg", ".png"] as const;
const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);

function SkinImagePreview({
  reference, fs, projectId, documentPath, label,
}: {
  readonly reference: string;
  readonly fs: ProjectReader;
  readonly projectId: string;
  readonly documentPath: string;
  readonly label: string;
}) {
  // The picture is kept with the reference it was read for, so a changed reference never labels the previous picture.
  const [loaded, setLoaded] = useState<{ readonly reference: string; readonly frame: SpritePreviewFrame } | null>(null);
  const [status, setStatus] = useState<{ readonly reference: string; readonly text: string } | null>(null);
  const message = status?.reference === reference ? status.text : `Reading ${reference}…`;
  const frame = loaded?.reference === reference ? loaded.frame : null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const assetRevision = useContext(AssetRefreshContext);
  useEffect(() => {
    let active = true;
    void (async () => {
      let path = referencePath(projectLayoutForDocumentPath(documentPath), "bitmaps", reference);
      // The project stores one spelling of a name: a host that can list folders finds `Stone.PNG` from `stone.png`.
      if (fs.list !== undefined) {
        const resolved = await resolveDocumentPath({ list: (folder: string) => fs.list!(folder) }, path);
        if (!resolved.ok) {
          if (active) setStatus({ reference, text: `Preview unavailable for ${reference}: ${resolved.kind === "case-conflict" ? resolved.message : resolved.error.message}` });
          return;
        }
        path = resolved.path;
      }
      const result = await fs.readProject(projectId, path);
      if (!active) return;
      const picture = result.ok ? spritePicturePreview(result.value, path) : null;
      setLoaded(picture === null ? null : { reference, frame: picture });
      setStatus({
        reference,
        text: picture === null
          ? `Preview unavailable for ${reference}: ${result.ok ? "the image format could not be decoded" : result.error.message}`
          : `${label}: ${reference} (${picture.width} × ${picture.height} pixels).`,
      });
    })().catch((error: unknown) => {
      if (active) setStatus({ reference, text: `Preview unavailable for ${reference}: ${problem(error)}` });
    });
    return () => { active = false; };
  }, [reference, fs, projectId, documentPath, label, assetRevision]);
  useEffect(() => {
    const picture = frame;
    const target = canvas.current;
    if (picture === null || target === null) return;
    target.width = picture.width;
    target.height = picture.height;
    const context = target.getContext("2d");
    if (context !== null) context.putImageData(new ImageData(new Uint8ClampedArray(picture.rgba), picture.width, picture.height), 0, 0);
  }, [frame]);
  return <div class="tkr-skin-preview">
    {frame === null
      ? <p role="status" aria-label={`${label} image preview status`}>{message}</p>
      : <canvas ref={canvas} role="img" aria-label={`${label} image preview: ${reference}`} />}
    {frame !== null && <p aria-live="polite">{message}</p>}
  </div>;
}

/** Shared native skin authoring surface: independently choose and inspect each role's actual image. */
export function NativeSkinView({ doc, capabilities, pendingEdits, onEdited, fs, projectId, pickAsset }: NativeSkinViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  const [message, setMessage] = useState<string | null>(null);
  const [picking, setPicking] = useState<"windowImage" | "buttonImage" | null>(null);
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);
  const skin = snapshot.skin;
  const disabled = snapshot.readOnly !== null || snapshot.conflict !== null || snapshot.saving;

  const apply = (command: NativeSkinCommand): Promise<boolean> => {
    const finish = submitted.current.begin();
    const operation = queue.current.then(async () => {
      try {
        const result = await doc.apply(command);
        if (!result.ok) { setMessage(result.rejection.message); return false; }
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Edit native skin" });
        setMessage(null);
        return true;
      } catch (error) {
        setMessage(problem(error));
        return false;
      } finally { finish(); }
    });
    queue.current = operation.then(() => undefined);
    return operation;
  };
  const choose = async (field: "windowImage" | "buttonImage"): Promise<void> => {
    if (pickAsset === undefined || disabled || picking !== null) return;
    setPicking(field);
    try {
      const outcome: PickOutcome = await pickAsset({
        kind: "bitmaps",
        extensions: IMAGE_EXTENSIONS,
        field: field === "windowImage" ? "the skin's window graphic" : "the skin's button graphic",
      });
      if (!outcome.chosen) return;
      const reference = `bitmap/${outcome.reference.replaceAll("\\", "/")}`.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
      await apply({ type: "set-native-skin-image", field, reference });
    } catch (error) {
      setMessage(problem(error));
    } finally {
      setPicking(null);
    }
  };
  const save = async (): Promise<void> => {
    try {
      await pendingEdits.settle();
      const result = await doc.save();
      setMessage(result.ok ? "Native skin saved." : result.failure.message);
    } catch (error) { setMessage(problem(error)); }
  };
  const resolve = async (choice: "keep-local" | "reload"): Promise<void> => {
    try {
      const result = await doc.resolveConflict(choice);
      if (!result.ok) setMessage(result.message);
      else if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        const saved = await doc.save();
        setMessage(saved.ok ? "Native skin saved." : saved.failure.message);
      } else {
        setMessage(null);
      }
    } catch (error) { setMessage(problem(error)); }
  };

  return <main class="tkr-native-skin-editor" aria-label="Native skin authoring">
    <header>
      <h1>Native skin</h1>
      <button type="button" data-editor-save="true" disabled={snapshot.saving || snapshot.readOnly !== null} onClick={() => void save()}>Save</button>
      <p>Contract: {skin.contract} · version: {skin.version}</p>
    </header>
    <p class="tkr-skin-preview-notice">Preview only: the engine does not use skins yet.</p>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <section role="alert">
      <p>{snapshot.conflict.message} Nothing was saved.</p>
      <button type="button" disabled={snapshot.saving} onClick={() => void resolve("keep-local")}>{capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null && <button type="button" disabled={snapshot.saving} onClick={() => void resolve("reload")}>Use the version on disk</button>}
    </section>}
    {(["windowImage", "buttonImage"] as const).map((field) => {
      const label = field === "windowImage" ? "Window graphic" : "Button graphic";
      return <fieldset key={field} disabled={disabled}>
        <legend>{label}</legend>
        <p><code>{skin[field]}</code></p>
        <button type="button" aria-label={`Choose ${label.toLowerCase()} image…`} disabled={disabled || pickAsset === undefined || picking !== null} onClick={() => void choose(field)}>
          {picking === field ? "Choosing image…" : `Choose ${label.toLowerCase()} image…`}
        </button>
        {pickAsset === undefined && <p>Asset picker unavailable here; this host cannot choose a project image.</p>}
        <SkinImagePreview reference={skin[field]} fs={fs} projectId={projectId} documentPath={doc.identity.path} label={label} />
      </fieldset>;
    })}
    {message !== null && <p role="status">{message}</p>}
  </main>;
}
