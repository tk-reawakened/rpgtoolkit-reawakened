import type { ConflictChoice, SaveFailure } from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { GameSettingsForm } from "./game-settings-form.tsx";
import { useDocumentSnapshot } from "./use-document.ts";
import type { ViewDocument } from "./mount.ts";

/** How many views have been given ids. Ids must be unique in the page, and two views mounted by one host are two render roots. */
let viewsMade = 0;

export interface SettingsViewProps {
  readonly doc: ViewDocument;
  /** What the host can do; the view says what it cannot, and never implies it can (ADR 0022 D3.5, D3.6). */
  readonly capabilities: Capabilities;
  /** A command result is acknowledged only after the document adapter has accepted it. */
  readonly onEdited: (event: DocumentEdited) => void;
}
/**
 * Game settings stage in one form; Apply creates a document edit, while Save persists applied changes.
 * A disk conflict offers the host's supported resolution choices (ADR 0022 D3.5).
 */
export function SettingsView({ doc, capabilities, onEdited }: SettingsViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [savePending, setSavePending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [conflictChoicesDismissed, setConflictChoicesDismissed] = useState(false);
  useEffect(() => {
    if (snapshot.conflict === null) setConflictChoicesDismissed(false);
  }, [snapshot.conflict]);
  // `useId` numbers a component by its place in its own render tree, so two mounted views would both be `P0-0`: their
  // labels and descriptions would point into each other. The view takes its prefix once, when it is first made.
  const [ids] = useState(() => {
    viewsMade += 1;
    return `tkr-settings-${viewsMade}`;
  });
  const saveErrorAtStart = useRef<SaveFailure | null>(null);
  const failureShown = useRef<{ failure: SaveFailure | null; key: number }>({ failure: null, key: 0 });
  const stateId = `${ids}-state`;
  const readOnly = snapshot.readOnly !== null;


  // A host may save the chosen local version immediately only when it can target this document. Otherwise keep it
  // dirty for an explicit host save. Reload is offered only where the host can safely reset the intended document.
  const resolve = (choice: ConflictChoice): void => {
    setResolving(true);
    setResolveError(null);
    void Promise.resolve()
      .then(() => doc.resolveConflict(choice))
      .then(async (result) => {
        if (!result.ok) {
          setResolveError(result.message);
          return;
        }
        if (choice === "keep-local" && capabilities.has("conflictAutoSave")) await doc.save().catch(() => undefined);
      })
      .catch((error: unknown) => setResolveError(error instanceof Error ? error.message : String(error)))
      .finally(() => setResolving(false));
  };

  const failure = snapshot.saveError;
  if (failure !== failureShown.current.failure) failureShown.current = { failure, key: failureShown.current.key + 1 };
  const conflict = snapshot.conflict;

  return (
    <section class="tkr-settings" aria-label="Game settings">
      <h2 class="tkr-settings-heading">Game settings</h2>
      {snapshot.readOnly === null ? null : (
        <p class="tkr-settings-readonly" role="note">
          Read only: {snapshot.readOnly.message}
        </p>
      )}
      {capabilities.has("fileWatch") ? null : (
        <p class="tkr-settings-host-note">
          This host cannot watch files, so a change another program makes to this file is found when you save, and is
          never saved over.
        </p>
      )}
      {conflict === null ? null : (
        <div class="tkr-settings-conflict" role="group" aria-label="Changed on disk">
          <p role="alert">{conflict.message}</p>
          {conflict.externalTitle === null ? null : (
            <dl class="tkr-settings-compare">
              <dt>Your title</dt>
              <dd>{snapshot.gameTitle}</dd>
              <dt>Title on disk</dt>
              <dd>{conflict.externalTitle}</dd>
            </dl>
          )}
          {conflictChoicesDismissed ? (
            <button type="button" class="tkr-settings-review" onClick={() => setConflictChoicesDismissed(false)}>
              Review conflict
            </button>
          ) : (
            <>
              <button type="button" class="tkr-settings-keep" disabled={resolving || readOnly} onClick={() => resolve("keep-local")}>
                {capabilities.has("conflictAutoSave") ? "Save my version" : "Keep my version"}
              </button>
              {capabilities.has("conflictReload") && conflict.externalTitle !== null ? (
                <button type="button" class="tkr-settings-reload" disabled={resolving} onClick={() => resolve("reload")}>
                  Use the version on disk
                </button>
              ) : null}
              {!capabilities.has("conflictReload") ? (
                <p class="tkr-settings-host-note" role="note">
                  This host cannot safely reload the file in place. Both versions remain unchanged.
                </p>
              ) : null}
              <button type="button" class="tkr-settings-cancel" disabled={resolving} onClick={() => setConflictChoicesDismissed(true)}>
                Cancel
              </button>
            </>
          )}
          {resolveError === null ? null : <p class="tkr-settings-error">{resolveError}</p>}
        </div>
      )}
      <p id={stateId} class="tkr-settings-state" role="status">
        {snapshot.saving || (savePending && snapshot.saveError === saveErrorAtStart.current) ? "Saving…" : snapshot.dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        class="tkr-settings-save"
        disabled={readOnly || savePending || snapshot.saving || conflict !== null || !snapshot.dirty}
        onClick={() => {
          saveErrorAtStart.current = snapshot.saveError;
          setSavePending(true);
          void doc.save().catch(() => undefined).finally(() => setSavePending(false));
        }}
      >
        Save
      </button>
      {failure === null || (failure.kind === "conflict" && conflict !== null) ? null : (
        <p key={failureShown.current.key} class="tkr-settings-error" role="alert">
          {failure.message}
        </p>
      )}
      <GameSettingsForm doc={doc} snapshot={snapshot} ids={ids} readOnly={readOnly} onEdited={onEdited} />
    </section>
  );
}
