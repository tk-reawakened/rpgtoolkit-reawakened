import type { ApplyResult, MainCommand, SaveFailure } from "@tk-reawakened/editor-model";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import { useDocumentSnapshot } from "./use-document.ts";
import type { ViewDocument } from "./mount.ts";

/** How many views have been given ids. Ids must be unique in the page, and two views mounted by one host are two render roots. */
let viewsMade = 0;

export interface SettingsViewProps {
  readonly doc: ViewDocument;
  /** A command result is acknowledged only after the document adapter has accepted it. */
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
  const [savePending, setSavePending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
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

  // A title the document changed under the draft (an undo) replaces what was being typed. A matching
  // in-flight commit is different: preserve any draft typed after that command was submitted.
  useEffect(() => {
    const committing = titleCommit.current;
    if (committing !== null) {
      if (snapshot.gameTitle !== committing.title) return;
      titleCommit.current = null;
      if (draftRevision.current !== committing.revision) return;
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
        disabled={readOnly || savePending || snapshot.saving || (!snapshot.dirty && draft === null)}
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
      {failure === null ? null : (
        <p key={failureShown.current.key} class="tkr-settings-error" role="alert">
          {failure.message}
        </p>
      )}
    </section>
  );
}
