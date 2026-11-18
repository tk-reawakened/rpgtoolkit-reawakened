import { createEditTracker, type NativeClipCommand, type NativeClipSnapshot, type PendingEdits } from "@tk-reawakened/editor-model";
import type { Capability, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

export type NativeClipViewDocument = ViewDocument<NativeClipSnapshot, NativeClipCommand>;

export interface NativeClipViewProps {
  readonly doc: NativeClipViewDocument;
  readonly capabilities: ReadonlySet<Capability>;
  readonly pendingEdits: PendingEdits;
  readonly onEdited: (event: DocumentEdited) => void;
}

type Drafts = Readonly<Record<string, string>>;
const draftKey = (path: readonly (string | number)[]): string => JSON.stringify(path);
const problem = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Story 27.6: edit only supported native clip properties; the model owns authored-text preservation and validation. */
export function NativeClipView({ doc, pendingEdits, capabilities, onEdited }: NativeClipViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const submitted = useRef(createEditTracker());
  const queue = useRef(Promise.resolve());
  const [drafts, setDrafts] = useState<Drafts>({});
  const [message, setMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => pendingEdits.register(submitted.current), [pendingEdits]);

  const run = (command: NativeClipCommand): Promise<boolean> => {
    const finish = submitted.current.begin();
    const operation = queue.current.then(async () => {
      try {
        const result = await doc.apply(command);
        if (!result.ok) { setMessage(result.rejection.message); return false; }
        const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
        onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Edit native clip" });
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
  const save = async (): Promise<void> => {
    try {
      await pendingEdits.settle();
      const result = await doc.save();
      setMessage(result.ok ? "Native clip saved." : result.failure.message);
    } catch (error) { setMessage(problem(error)); }
  };
  const resolve = async (choice: "keep-local" | "reload"): Promise<void> => {
    setResolving(true);
    try {
      const result = await doc.resolveConflict(choice);
      if (!result.ok) setMessage(result.message);
      else if (choice === "keep-local" && capabilities.has("conflictAutoSave")) {
        const saved = await doc.save();
        setMessage(saved.ok ? "Native clip saved." : saved.failure.message);
      } else {
        if (choice === "reload") setDrafts({});
        setMessage(null);
      }
    } catch (error) { setMessage(problem(error)); }
    finally { setResolving(false); }
  };
  const disabled = snapshot.readOnly !== null || snapshot.conflict !== null || snapshot.saving;
  const value = (path: readonly (string | number)[], actual: string | number): string => drafts[draftKey(path)] ?? String(actual);
  const setDraft = (path: readonly (string | number)[], text: string): void => {
    const key = draftKey(path);
    setDrafts((previous) => ({ ...previous, [key]: text }));
  };
  const submitText = async (path: readonly (string | number)[], text: string): Promise<void> => {
    setMessage(null);
    const accepted = await run({ type: "set-native-clip-property", path, value: text });
    if (accepted) setDrafts((previous) => { const next = { ...previous }; if (next[draftKey(path)] === text) delete next[draftKey(path)]; return next; });
  };
  const submitNumber = async (path: readonly (string | number)[], text: string): Promise<void> => {
    setMessage(null);
    if (text.trim() === "") { setMessage("Enter a number before applying this change."); return; }
    const number = Number(text);
    if (!Number.isFinite(number)) { setMessage("Enter a finite number before applying this change."); return; }
    const accepted = await run({ type: "set-native-clip-property", path, value: number });
    if (accepted) setDrafts((previous) => { const next = { ...previous }; if (next[draftKey(path)] === text) delete next[draftKey(path)]; return next; });
  };
  const colour = (path: readonly (string | number)[], actual: { readonly r: number; readonly g: number; readonly b: number }, label: string) => <fieldset>
    <legend>{label}</legend>
    {(["r", "g", "b"] as const).map((channel) => {
      const channelPath = [...path, channel];
      return <label key={channel}>{channel === "r" ? "Red" : channel === "g" ? "Green" : "Blue"}
        <input type="number" min="0" max="255" step="1" value={value(channelPath, actual[channel])} disabled={disabled} onInput={(event) => setDraft(channelPath, event.currentTarget.value)} />
      </label>;
    })}
    <button type="button" disabled={disabled} onClick={() => {
      const channels = ["r", "g", "b"] as const;
      const values = channels.map((channel) => value([...path, channel], actual[channel]));
      if (values.some((entry) => entry.trim() === "" || !Number.isInteger(Number(entry)) || Number(entry) < 0 || Number(entry) > 255)) {
        setMessage("Colour channels must be whole numbers from 0 to 255.");
        return;
      }
      void run({ type: "set-native-clip-property", path, value: { r: Number(values[0]), g: Number(values[1]), b: Number(values[2]) } }).then((accepted) => {
        if (accepted) setDrafts((previous) => { const next = { ...previous }; channels.forEach((channel, index) => { const key = draftKey([...path, channel]); if (next[key] === values[index]) delete next[key]; }); return next; });
      });
    }}>Set colour key</button>
  </fieldset>;
  const absentColour = (path: readonly (string | number)[], label: string) => <fieldset>
    <legend>{label}</legend>
    <p>This optional colour key is absent.</p>
    {(["r", "g", "b"] as const).map((channel) => {
      const channelPath = [...path, channel];
      return <label key={channel}>{channel === "r" ? "Red" : channel === "g" ? "Green" : "Blue"}
        <input type="number" min="0" max="255" step="1" value={value(channelPath, "")} disabled={disabled} onInput={(event) => setDraft(channelPath, event.currentTarget.value)} />
      </label>;
    })}
    <button type="button" disabled={disabled} onClick={() => {
      const channels = ["r", "g", "b"] as const;
      const values = channels.map((channel) => value([...path, channel], ""));
      if (values.some((entry) => entry.trim() === "" || !Number.isInteger(Number(entry)) || Number(entry) < 0 || Number(entry) > 255)) {
        setMessage("Colour channels must be whole numbers from 0 to 255.");
        return;
      }
      void run({ type: "set-native-clip-property", path, value: { r: Number(values[0]), g: Number(values[1]), b: Number(values[2]) } }).then((accepted) => {
        if (accepted) setDrafts((previous) => { const next = { ...previous }; channels.forEach((channel, index) => { const key = draftKey([...path, channel]); if (next[key] === values[index]) delete next[key]; }); return next; });
      });
    }}>Set colour key</button>
  </fieldset>;
  const removeOptional = (path: readonly (string | number)[]): void => {
    setMessage(null);
    void run({ type: "remove-native-clip-property", path });
  };
  const clip = snapshot.clip;
  return <main class="tkr-native-clip-editor" aria-label="Native animation clip">
    <header>
      <h1>Native animation clip</h1>
      <button type="button" data-editor-save="true" disabled={snapshot.saving || snapshot.readOnly !== null || Object.keys(drafts).length > 0} onClick={() => void save()}>Save</button>
      <p>Contract: {clip.contract} · version: {clip.version}</p>
    </header>
    {snapshot.readOnly !== null && <p role="status">Read only: {snapshot.readOnly.message}</p>}
    {snapshot.conflict !== null && <section role="alert">
      <p>{snapshot.conflict.message} Nothing was saved.</p>
      <button type="button" disabled={resolving || snapshot.readOnly !== null} onClick={() => void resolve("keep-local")}>{capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}</button>
      {capabilities.has("conflictReload") && snapshot.conflict.externalTitle !== null && <button type="button" disabled={resolving} onClick={() => void resolve("reload")}>Use the version on disk</button>}
    </section>}
    {Object.keys(drafts).length > 0 && <p role="status">These field changes are not saved until you apply them. <button type="button" onClick={() => setDrafts({})}>Discard unapplied changes</button></p>}
    <section aria-label="Clip canvas and timing">
      <h2>Canvas</h2>
      <p>Canvas: {clip.canvas.width} × {clip.canvas.height} pixels. Artwork preview is not available for native clips yet.</p>
      <p><label>Canvas width (pixels)
        <input type="number" min="1" step="1" value={value(["canvas", "width"], clip.canvas.width)} disabled={disabled} onInput={(event) => setDraft(["canvas", "width"], event.currentTarget.value)} />
      </label>{" "}<button type="button" disabled={disabled} onClick={() => void submitNumber(["canvas", "width"], value(["canvas", "width"], clip.canvas.width))}>Set canvas width</button></p>
      <p><label>Canvas height (pixels)
        <input type="number" min="1" step="1" value={value(["canvas", "height"], clip.canvas.height)} disabled={disabled} onInput={(event) => setDraft(["canvas", "height"], event.currentTarget.value)} />
      </label>{" "}<button type="button" disabled={disabled} onClick={() => void submitNumber(["canvas", "height"], value(["canvas", "height"], clip.canvas.height))}>Set canvas height</button></p>
      <p><label>Delay (seconds)
        <input type="number" min="0" step="any" value={value(["delay"], clip.delay)} disabled={disabled} onInput={(event) => setDraft(["delay"], event.currentTarget.value)} />
      </label>{" "}<button type="button" disabled={disabled} onClick={() => void submitNumber(["delay"], value(["delay"], clip.delay))}>Apply delay</button></p>
    </section>
    {clip.colourKey === undefined ? absentColour(["colourKey"], "Clip colour key") : <>
      {colour(["colourKey"], clip.colourKey, "Clip colour key")}
      <button type="button" disabled={disabled} onClick={() => removeOptional(["colourKey"])}>Remove clip colour key</button>
    </>}
    <section aria-label="Native clip frames">
      <h2>Frames ({clip.frames.length})</h2>
      <ol>{clip.frames.map((frame, index) => <li key={index}>
        <fieldset><legend>Frame {index + 1}</legend>
          <label>Image reference
            <input value={value(["frames", index, "image"], frame.image)} disabled={disabled} onInput={(event) => setDraft(["frames", index, "image"], event.currentTarget.value)} />
          </label>
          <button type="button" disabled={disabled} onClick={() => void submitText(["frames", index, "image"], value(["frames", index, "image"], frame.image))}>Set image reference</button>
          {frame.sound === undefined ? <>
            <p>Sound reference is absent.</p>
            <label>Sound reference to add
              <input value={value(["frames", index, "sound"], "")} disabled={disabled} onInput={(event) => setDraft(["frames", index, "sound"], event.currentTarget.value)} />
            </label>
            <button type="button" disabled={disabled} onClick={() => void submitText(["frames", index, "sound"], value(["frames", index, "sound"], ""))}>Set sound reference</button>
          </> : <>
            <label>Sound reference
              <input value={value(["frames", index, "sound"], frame.sound)} disabled={disabled} onInput={(event) => setDraft(["frames", index, "sound"], event.currentTarget.value)} />
            </label>
            <button type="button" disabled={disabled} onClick={() => void submitText(["frames", index, "sound"], value(["frames", index, "sound"], frame.sound!))}>Set sound reference</button>
            <button type="button" disabled={disabled} onClick={() => removeOptional(["frames", index, "sound"])}>Remove sound reference</button>
          </>}
          {frame.colourKey === undefined ? absentColour(["frames", index, "colourKey"], `Frame ${index + 1} colour key`) : <>
            {colour(["frames", index, "colourKey"], frame.colourKey, `Frame ${index + 1} colour key`)}
            <button type="button" disabled={disabled} onClick={() => removeOptional(["frames", index, "colourKey"])}>Remove frame colour key</button>
          </>}
        </fieldset>
      </li>)}</ol>
    </section>
    {message !== null && (snapshot.conflict === null || !message.startsWith(snapshot.conflict.message)) && <p role="alert">{message}</p>}
  </main>;
}
