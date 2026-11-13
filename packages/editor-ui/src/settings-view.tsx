import type { ApplyResult, ConflictChoice, MainCommand, SaveFailure } from "@tk-reawakened/editor-model";
import type { Capabilities, DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
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
 * The game settings view; its one field is the game title (`docs/spec/formats/main-file.md#layout`, `gameTitle`).
 * The field edits a draft; leaving the field or pressing Enter commits it as one command. The text shown is the
 * document's, so an edit stays visible after a failed save, and what the document refuses is reported beside the field.
 * A change another program made on disk is shown beside the local title with the two ways to settle it (ADR 0022 D3.5).
 * Only classes and ARIA attributes are used, never a `style` attribute (ADR 0025 decision 6).
 */
export function SettingsView({ doc, capabilities, onEdited }: SettingsViewProps) {
  const snapshot = useDocumentSnapshot(doc);
  const [draft, setDraft] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
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
  // A newer keystroke belongs to the user, not to the command currently being applied.
  const draftRevision = useRef(0);
  const titleCommit = useRef<{ readonly title: string; readonly revision: number } | null>(null);
  // A live region announces an inserted element, not an unchanged one: a failure that arrives as a new value is rendered
  // under a new key, so the same words twice are announced twice.
  const commitFlight = useRef<Promise<boolean> | null>(null);
  const commitFlightRevision = useRef<number | null>(null);
  const latestCommit = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const saveErrorAtStart = useRef<SaveFailure | null>(null);
  const failureShown = useRef<{ failure: SaveFailure | null; key: number }>({ failure: null, key: 0 });
  const titleId = `${ids}-title`;
  const stateId = `${ids}-state`;
  const errorId = `${ids}-error`;
  const readOnly = snapshot.readOnly !== null;

  // A title the document changed under the draft (an undo, a revert, a version loaded from disk) replaces what was being
  // typed. A matching in-flight commit is different: preserve any draft typed after that command was submitted. Either
  // way the marker is finished once the title it named is in force, so a later document change is never ignored (a
  // revert after a commit used to leave its stale draft on screen).
  useEffect(() => {
    const committing = titleCommit.current;
    if (committing !== null) {
      titleCommit.current = null;
      if (snapshot.gameTitle !== committing.title) {
        if (draftRevision.current > committing.revision) return;
      } else if (draftRevision.current !== committing.revision) {
        return;
      }
    }
    setDraft(null);
    setRefusal(null);
  }, [snapshot.gameTitle]);

  const commit = (): Promise<boolean> => {
    const flight = commitFlight.current;
    if (flight !== null) {
      if (commitFlightRevision.current !== null && draftRevision.current > commitFlightRevision.current) {
        return flight.then(() => latestCommit.current());
      }
      return flight;
    }
    if (draft === null || draft === snapshot.gameTitle) {
      setDraft(null);
      return Promise.resolve(true);
    }
    const command: MainCommand = { type: "set-game-title", title: draft };
    const revision = draftRevision.current;
    const submitted = { title: draft, revision };
    titleCommit.current = submitted;
    const finish = (accepted: ApplyResult): boolean => {
      if (!accepted.ok) {
        if (titleCommit.current === submitted) titleCommit.current = null;
        setRefusal(accepted.rejection.message);
        return false;
      }
      if (draftRevision.current === revision) setDraft(null);
      setRefusal(null);
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === accepted.editId);
      onEdited({ document: doc.identity.key, editId: accepted.editId, label: edit?.label ?? "Set game title" });
      return true;
    };
    let result: ApplyResult | Promise<ApplyResult>;
    try {
      result = doc.apply(command);
    } catch (error) {
      if (titleCommit.current === submitted) titleCommit.current = null;
      setRefusal(error instanceof Error ? error.message : String(error));
      return Promise.resolve(false);
    }
    if (typeof (result as Promise<ApplyResult>).then !== "function") return Promise.resolve(finish(result as ApplyResult));
    const pending = Promise.resolve(result).then(finish).catch((error: unknown) => {
      if (titleCommit.current === submitted) titleCommit.current = null;
      setRefusal(error instanceof Error ? error.message : String(error));
      return false;
    }).finally(() => {
      if (commitFlight.current === pending) {
        commitFlight.current = null;
        commitFlightRevision.current = null;
      }
    });
    commitFlight.current = pending;
    commitFlightRevision.current = revision;
    return pending;
  };
  latestCommit.current = commit;

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
      <div class="tkr-settings-row">
        <label for={titleId}>Game title</label>
        <input
          id={titleId}
          type="text"
          value={draft ?? snapshot.gameTitle}
          readOnly={readOnly}
          aria-describedby={`${stateId}${refusal === null ? "" : ` ${errorId}`}`}
          aria-invalid={refusal === null ? undefined : true}
          onInput={(event) => {
            draftRevision.current += 1;
            setDraft(event.currentTarget.value);
          }}
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
        {snapshot.saving || (savePending && snapshot.saveError === saveErrorAtStart.current) ? "Saving…" : snapshot.dirty || draft !== null ? "Unsaved changes" : "All changes saved"}
      </p>
      <button
        type="button"
        class="tkr-settings-save"
        disabled={readOnly || savePending || snapshot.saving || conflict !== null || (!snapshot.dirty && draft === null)}
        onClick={() => {
          saveErrorAtStart.current = snapshot.saveError;
          setSavePending(true);
          void commit()
            .then((committed) => {
              if (!committed) return;
              // Save failures are reported as values and shown from the document snapshot.
              return doc.save().catch(() => undefined);
            })
            .finally(() => setSavePending(false));
        }}
      >
        Save
      </button>
      {failure === null || (failure.kind === "conflict" && conflict !== null) ? null : (
        <p key={failureShown.current.key} class="tkr-settings-error" role="alert">
          {failure.message}
        </p>
      )}
    </section>
  );
}
