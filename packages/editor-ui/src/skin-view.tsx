import { createEditTracker, referencePath, resolveDocumentPath, spritePicturePreview, type NativeSkinCommand, type NativeSkinSnapshot, type PendingEdits, type PickOutcome, type ProjectLayout, type SpritePreviewFrame } from "@tk-reawakened/editor-model";
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
  /**
   * The project's asset folders as the host resolved them when it mounted this view; the document path is only a
   * fallback for a standalone mount. A pick replaces it with the folders the picker itself read (#3536).
   */
  readonly layout: ProjectLayout;
  readonly pickAsset?: CharacterAuthoringViewProps["pickAsset"];
  /**
   * Where this document's project folders are now. The host re-resolves them on a refresh (a tab becoming active, the
   * assets changing) and after a cancelled pick, so a game file that moved the project is noticed without a new pick
   * (#3536). The view keeps the last answer it was given.
   */
  readonly resolveLayout?: () => Promise<ProjectLayout>;
}

type ProjectReader = Pick<FileSystemService, "readProject"> & Partial<Pick<FileSystemService, "list">>;

const IMAGE_EXTENSIONS = [".bmp", ".gif", ".jpeg", ".jpg", ".png"] as const;
const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);

function SkinImagePreview({
  reference, fs, projectId, layout, label,
}: {
  readonly reference: string;
  readonly fs: ProjectReader;
  readonly projectId: string;
  readonly layout: ProjectLayout;
  readonly label: string;
}) {
  // One record holds the picture and the sentence for the reference it was read for, so neither can outlive that
  // reference: a failed or in-flight read shows its own message and never the previous picture.
  const [shown, setShown] = useState<{ readonly reference: string; readonly frame: SpritePreviewFrame | null; readonly text: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const assetRevision = useContext(AssetRefreshContext);
  useEffect(() => {
    let active = true;
    const unavailable = (reason: string): void => {
      setShown({ reference, frame: null, text: `Preview unavailable for ${reference}: ${reason}` });
    };
    void (async () => {
      // The host names the project's asset folders; the document's own path is only a fallback for a standalone mount.
      let path = referencePath(layout, "bitmaps", reference);
      // The project stores one spelling of a name: a host that can list folders finds `Stone.PNG` from `stone.png`.
      if (fs.list !== undefined) {
        const resolved = await resolveDocumentPath({ list: (folder: string) => fs.list!(folder) }, path);
        if (!resolved.ok) {
          if (active) unavailable(resolved.kind === "case-conflict" ? resolved.message : resolved.error.message);
          return;
        }
        path = resolved.path;
      }
      const result = await fs.readProject(projectId, path);
      if (!active) return;
      const picture = result.ok ? spritePicturePreview(result.value, path) : null;
      if (picture === null) {
        unavailable(result.ok ? "the image format could not be decoded" : result.error.message);
        return;
      }
      setShown({ reference, frame: picture, text: `${label}: ${reference} (${picture.width} × ${picture.height} pixels).` });
    })().catch((error: unknown) => {
      if (active) unavailable(problem(error));
    });
    return () => { active = false; };
  }, [reference, fs, projectId, layout, label, assetRevision]);
  const current = shown?.reference === reference ? shown : null;
  const message = current?.text ?? `Reading ${reference}…`;
  const frame = current?.frame ?? null;
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
export function NativeSkinView({ doc, capabilities, pendingEdits, onEdited, fs, projectId, layout, pickAsset, resolveLayout }: NativeSkinViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  const [message, setMessage] = useState<string | null>(null);
  const [picking, setPicking] = useState<"windowImage" | "buttonImage" | null>(null);
  // A game file can change which folders a project uses while this view is open; the picker re-resolves them every time,
  // so the reference it returns is read from the folders it names, not from the ones the view mounted with.
  const [activeLayout, setActiveLayout] = useState<ProjectLayout>(layout);
  const assetRevision = useContext(AssetRefreshContext);
  // Every request for the folders takes a sequence when it starts. Ownership only moves forward: a read that finishes
  // after a newer request (a refresh, or a confirmation) is superseded, so its answer is discarded and read again; only
  // the latest resolution sets the folders or lets a pick apply (#3536).
  const layoutSequence = useRef(0);
  const adopt = (next: ProjectLayout | undefined): void => {
    if (next === undefined) return;
    setActiveLayout((current) => (current.projectFolder === next.projectFolder ? current : next));
  };
  /**
   * The folders as they are now, from a read no newer request superseded. A superseded read is retried a bounded number
   * of times and then given up on (`layout: undefined`), so two resolutions in flight together cannot chase each other.
   */
  const resolveOwnership = async (): Promise<{ readonly layout: ProjectLayout | undefined; readonly sequence: number } | undefined> => {
    if (resolveLayout === undefined) return undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sequence = ++layoutSequence.current;
      const answer = await resolveLayout().catch(() => undefined);
      if (sequence !== layoutSequence.current) continue;
      adopt(answer);
      return { layout: answer, sequence };
    }
    return { layout: undefined, sequence: layoutSequence.current };
  };
  // A refresh is the host saying "look again": the game file may name different folders by now, with no pick at all.
  useEffect(() => {
    void resolveOwnership();
  }, [resolveLayout, assetRevision]);
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
      // The folders this render shows, for a picker that names none of its own.
      const openedLayout = activeLayout;
      const outcome: PickOutcome = await pickAsset({
        kind: "bitmaps",
        extensions: IMAGE_EXTENSIONS,
        field: field === "windowImage" ? "the skin's window graphic" : "the skin's button graphic",
      });
      if (!outcome.chosen) {
        await resolveOwnership();
        return;
      }
      // What matters is the folders the picker read, not whether some refresh ran meanwhile: an unrelated refresh leaves
      // them equal. Ask where the folders are now and compare the sets themselves.
      const pickerLayout = outcome.layout ?? openedLayout;
      const resolved = await resolveOwnership();
      if (resolved !== undefined) {
        if (resolved.layout === undefined) {
          // Every read was superseded, so nothing here can say which folders the reference belongs to.
          setMessage("The project's picture folders were read again while this picture was being checked. Nothing was changed; choose the picture again.");
          return;
        }
        if (resolved.layout.projectFolder !== pickerLayout.projectFolder) {
          // The reference names a file in folders the project no longer reads: the same relative name may be another
          // picture there, or no picture at all. It is never written; the newer folders stand and the user chooses again.
          setMessage("The project's picture folders changed while the picker was open, so the picture you chose belongs to the older folders. Nothing was changed; choose the picture again.");
          return;
        }
        if (resolved.sequence !== layoutSequence.current) {
          // A newer read started while this one was being checked, so it, not this confirmation, decides the folders.
          setMessage("The project's picture folders were read again while this picture was being checked. Nothing was changed; choose the picture again.");
          return;
        }
      } else {
        layoutSequence.current += 1;
      }
      adopt(pickerLayout);
      const reference = `bitmap/${outcome.reference.replaceAll("\\", "/")}`.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
      // Choosing the picture the document already names is a successful no-edit: no command, no refusal, the draft as it
      // is. The document is asked now, not at the render that opened the picker: an edit may have landed meanwhile.
      if (reference === doc.getSnapshot().skin[field]) return;
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
        <SkinImagePreview reference={skin[field]} fs={fs} projectId={projectId} layout={activeLayout} label={label} />
      </fieldset>;
    })}
    {message !== null && <p role="status">{message}</p>}
  </main>;
}
