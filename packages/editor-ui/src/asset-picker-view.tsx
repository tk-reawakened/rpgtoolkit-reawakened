import type { AssetPicker, PickOutcome } from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

let viewsMade = 0;

export interface AssetPickerViewProps {
  readonly picker: AssetPicker;
  /** What the field is called, as the title: "Picture". */
  readonly title: string;
  /** Called when the picker closes: chosen with the reference to store, or not chosen (the field is left as it was). */
  readonly onDone: (outcome: PickOutcome) => void;
}

/**
 * The folder-aware asset picker (T-05): the folder's files and sub-folders' files as one list, a confirm that names what
 * it will store, and a way in from outside the project. Cancel, Escape and a dismissed confirmation all leave the field
 * exactly as it was. The list is one tab stop and moves with the arrow keys.
 */
export function AssetPickerView({ picker, title, onDone }: AssetPickerViewProps) {
  const snapshot = useDocumentSnapshot(picker);
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-picker-${viewsMade}`;
  });
  const [subfolder, setSubfolder] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const focus = useRef(false);
  const busy = snapshot.phase === "busy";

  useEffect(() => {
    void picker.refresh();
  }, [picker]);
  useEffect(() => {
    if (!focus.current) return;
    focus.current = false;
    list.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  const finish = (outcome: Promise<PickOutcome>): void => {
    void outcome.then((result) => {
      if (picker.getSnapshot().phase === "closed") onDone(result);
    });
  };
  const candidates = snapshot.candidates;
  const active = candidates.find((candidate) => candidate.reference === snapshot.selected) ?? candidates[0] ?? null;
  const move = (to: number): void => {
    const target = candidates[Math.max(0, Math.min(candidates.length - 1, to))];
    if (target === undefined) return;
    focus.current = true;
    picker.select(target.reference);
  };

  return (
    <section
      class="tkr-picker"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onDone(picker.cancel());
        }
      }}
    >
      <h2 class="tkr-picker-heading">{title}</h2>
      <p class="tkr-picker-folder">Files in {snapshot.folder}, including its folders</p>
      <div ref={list} class="tkr-picker-list" role="listbox" aria-label={`Files in ${snapshot.folder}`}>
        {candidates.map((candidate, index) => (
          <div
            key={candidate.reference}
            role="option"
            class={candidate.reference === snapshot.selected ? "tkr-picker-option tkr-picker-option-selected" : "tkr-picker-option"}
            tabIndex={candidate.reference === active?.reference ? 0 : -1}
            aria-selected={candidate.reference === snapshot.selected}
            onClick={() => picker.select(candidate.reference)}
            onDblClick={() => { picker.select(candidate.reference); finish(picker.confirm()); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); move(index + 1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move(index - 1); }
              else if (event.key === "Home") { event.preventDefault(); move(0); }
              else if (event.key === "End") { event.preventDefault(); move(candidates.length - 1); }
              else if (event.key === " ") { event.preventDefault(); picker.select(candidate.reference); }
              else if (event.key === "Enter") { event.preventDefault(); picker.select(candidate.reference); finish(picker.confirm()); }
            }}
          >
            {candidate.reference}
          </div>
        ))}
      </div>
      {candidates.length === 0 && snapshot.failures.length === 0 ? <p class="tkr-picker-empty" role="status">There are no matching files in this folder yet.</p> : null}
      <div class="tkr-picker-actions">
        <button type="button" class="tkr-picker-use" disabled={busy || snapshot.selected === null} onClick={() => finish(picker.confirm())}>
          Use{snapshot.selected === null ? "" : ` ${snapshot.selected}`}…
        </button>
        <label for={`${ids}-sub`}>Folder inside {snapshot.folder} for a copied file (optional)</label>
        <input id={`${ids}-sub`} type="text" value={subfolder} disabled={busy || snapshot.outsideUnavailable !== null} onInput={(event) => setSubfolder(event.currentTarget.value)} />
        <button
          type="button"
          class="tkr-picker-outside"
          disabled={busy || snapshot.outsideUnavailable !== null}
          aria-describedby={snapshot.outsideUnavailable === null ? undefined : `${ids}-why`}
          onClick={() => finish(picker.pickOutside(subfolder))}
        >
          Choose a file from outside the project…
        </button>
        <button type="button" class="tkr-picker-cancel" disabled={busy} onClick={() => onDone(picker.cancel())}>Cancel</button>
      </div>
      {snapshot.outsideUnavailable === null ? null : <p id={`${ids}-why`} class="tkr-picker-host-note" role="note">{snapshot.outsideUnavailable}</p>}
      {snapshot.message === null ? null : <p class="tkr-picker-message" role="alert">{snapshot.message}</p>}
    </section>
  );
}
