import type { DocumentEdited } from "@tk-reawakened/platform-services";
import type { MainDocument, SaveFailure } from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";

/** How many views have been given ids. Ids must be unique in the page, and two views mounted by one host are two render roots. */
let viewsMade = 0;

export interface SettingsViewProps {
  readonly doc: MainDocument;
  /** Told about each accepted edit: the `document.edited` message of AD-19. */
  readonly onEdited: (event: DocumentEdited) => void;
}

/**
 * The game settings view; its one field is the game title (`docs/spec/formats/main-file.md#layout`, `gameTitle`).
 * The field edits a draft; leaving the field or pressing Enter commits it as one command. The text shown is the
 * document's, so an edit stays visible after a failed save, and what the document refuses is reported beside the field.
 * Only classes and ARIA attributes are used, never a `style` attribute (ADR 0025 decision 6).
 */
export function SettingsView({ doc, onEdited }: SettingsViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // `useId` numbers a component by its place in its own render tree, so two mounted views would both be `P0-0`: their
  // labels and descriptions would point into each other. The view takes its prefix once, when it is first made.
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-settings-${viewsMade}`;
  });
  // A live region announces an inserted element, not an unchanged one: a failure that arrives as a new value is rendered
  // under a new key, so the same words twice are announced twice.
  const failureShown = useRef<{ readonly failure: SaveFailure | null; readonly key: number }>({ failure: null, key: 0 });
  const titleId = `${ids}-title`;
  const stateId = `${ids}-state`;
  const errorId = `${ids}-error`;
  const readOnly = snapshot.readOnly !== null;

  // A title the document changed under the draft (an undo) replaces what was being typed.
  useEffect(() => {
    setDraft(null);
    setRefusal(null);
  }, [snapshot.gameTitle]);

  const commit = (): void => {
    if (draft === null || draft === snapshot.gameTitle) {
      setDraft(null);
      return;
    }
    const result = doc.apply({ type: "set-game-title", title: draft });
    if (result.ok) {
      setDraft(null);
      setRefusal(null);
      const edit = doc.getSnapshot().edits.at(-1);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? "Set game title" });
    } else {
      setRefusal(result.rejection.message);
    }
  };

  const failure = snapshot.saveError;
  if (failure !== failureShown.current.failure) failureShown.current = { failure, key: failureShown.current.key + 1 };

  return (
    <section class="tkr-settings" aria-label="Game settings">
      <h2 class="tkr-settings-heading">Game settings</h2>
      {snapshot.readOnly === null ? null : (
        <p class="tkr-settings-readonly" role="note">
          Read only: {snapshot.readOnly.message}
        </p>
      )}
      <div class="tkr-settings-row">
        <label for={titleId}>Game title</label>
        <input
          id={titleId}
          type="text"
          value={draft ?? snapshot.gameTitle}
          readOnly={readOnly}
          aria-describedby={`${stateId}${refusal === null ? "" : ` ${errorId}`}`}
          aria-invalid={refusal === null ? undefined : true}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onChange={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </div>
      {refusal === null ? null : (
        <p id={errorId} class="tkr-settings-error" role="alert">
          The title was not changed: {refusal}
        </p>
      )}
      <p id={stateId} class="tkr-settings-state" role="status">
        {snapshot.saving ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        class="tkr-settings-save"
        disabled={readOnly || snapshot.saving || (!snapshot.dirty && draft === null)}
        onClick={() => {
          commit();
          // A save reports failure as a value and the failure is on the snapshot; a document that rejects instead has
          // broken that contract, and there is nothing more the view could show, so the rejection is not left unhandled.
          doc.save().catch(() => undefined);
        }}
      >
        Save
      </button>
      {failure === null ? null : (
        <p key={failureShown.current.key} class="tkr-settings-error" role="alert">
          {failure.message}
        </p>
      )}
    </section>
  );
}
