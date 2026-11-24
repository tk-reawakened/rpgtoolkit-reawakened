import {
  SCRIPT_TRANSFORM_INFO,
  type ScriptFileState,
  type ScriptReviewSession,
  type ScriptTransformId,
  type ScriptWorkflowEntry,
  type ScriptWorkflowPlan,
  type ScriptWorkflowScope,
  type PlanControl,
  type PlanProgress,
} from "@tk-reawakened/editor-model";
import { useEffect, useRef, useState } from "preact/hooks";
import { diffBlocks } from "./script-workflow-diff.ts";
import { useDocumentSnapshot } from "./use-document.ts";

/** How many reviews have been given ids (ids must be unique in the page). */
let reviewsMade = 0;

export interface ScriptWorkflowViewProps {
  readonly transform: ScriptTransformId;
  /** The project path of the program in front, or `null`: with one, the scope "This program" is offered. */
  readonly activeProgram: string | null;
  /** Ask the language server about every program in `scope`. Writes nothing. */
  readonly plan: (scope: ScriptWorkflowScope, control: PlanControl) => Promise<ScriptWorkflowPlan>;
  /** Hold a plan for review; the session is the only way to write. */
  readonly review: (plan: ScriptWorkflowPlan) => ScriptReviewSession;
  /** The review ended: cancelled, closed, or finished. */
  readonly onClose: () => void;
}

const STATE_TEXT: Readonly<Record<ScriptFileState, string>> = {
  ready: "Will change",
  unchanged: "Nothing to change",
  refused: "Left as it was",
  failed: "Could not be checked",
  skipped: "Skipped",
  applied: "Done",
};

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** One program of the review: its choice, its state and, when it is the one being read, what would change. */
function EntryDetail({ entry }: { readonly entry: ScriptWorkflowEntry }) {
  const blocks = entry.diff === null ? [] : diffBlocks(entry.diff);
  return (
    <section class="tkr-script-detail" aria-label={`Changes to ${entry.path}`}>
      <h3 class="tkr-script-detail-title">{entry.path}</h3>
      {entry.target === "copy" && entry.state !== "refused" ? (
        <p class="tkr-script-note">
          This is a Toolkit 2.x program. Its 3.1 version is saved as a copy at <code>{entry.destination}</code>; the original is never changed.
        </p>
      ) : null}
      {entry.reason === null ? null : <p class="tkr-script-refusal" role="note">{entry.reason.message}</p>}
      {entry.message === null ? null : <p class="tkr-script-message" role="note">{entry.message}</p>}
      {entry.steps.length === 0 ? null : (
        <ul class="tkr-script-steps" aria-label="What was done">
          {entry.steps.map((step) => (
            <li key={step.id} data-applied={step.applied ? "true" : "false"}>
              {step.title}: {step.applied ? "done" : "not done"}{step.reason === undefined ? "" : ` (${step.reason})`}
            </li>
          ))}
        </ul>
      )}
      {entry.reviews.length === 0 ? null : (
        <div class="tkr-script-reviews">
          <h4>Check these spots</h4>
          <ul aria-label="Spots to check">
            {entry.reviews.map((review) => <li key={`${review.line}-${review.index}`}>Line {review.line}: {review.message}</li>)}
          </ul>
        </div>
      )}
      {entry.unsupported.length === 0 ? null : (
        <div class="tkr-script-unsupported">
          <h4>Left as written</h4>
          <ul aria-label="Fragments left as written">
            {entry.unsupported.map((fragment, index) => (
              <li key={index} data-code={fragment.code}>{fragment.line === null ? "Whole file" : `Line ${fragment.line}`}: {fragment.message}</li>
            ))}
          </ul>
        </div>
      )}
      {entry.diff === null ? null : (
        <div class="tkr-script-diff" role="group" aria-label={`Original and result of ${entry.path}`}>
          {blocks.map((block, index) =>
            block.kind === "folded" ? (
              <div key={index} class="tkr-script-fold">… {block.count} unchanged {block.count === 1 ? "line" : "lines"}</div>
            ) : (
              block.lines.map((line, at) => (
                <div key={`${index}-${at}`} class={`tkr-script-line tkr-script-line-${line.kind}`} data-change={line.kind}>
                  <span class="tkr-script-gutter" aria-hidden="true">{line.original ?? ""}</span>
                  <span class="tkr-script-gutter" aria-hidden="true">{line.result ?? ""}</span>
                  <span class="tkr-script-sign" aria-label={line.kind === "added" ? "added" : line.kind === "removed" ? "removed" : "unchanged"}>{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}</span>
                  <span class="tkr-script-text">{line.text}</span>
                </div>
              ))
            ),
          )}
        </div>
      )}
    </section>
  );
}

function Review({ session, transform, onClose }: { readonly session: ScriptReviewSession; readonly transform: ScriptTransformId; readonly onClose: () => void }) {
  const snapshot = useDocumentSnapshot(session);
  const [shown, setShown] = useState<string | null>(() => snapshot.entries.find((entry) => entry.state === "ready")?.path ?? snapshot.entries[0]?.path ?? null);
  const [id] = useState(() => `tkr-script-review-${++reviewsMade}`);
  const name = SCRIPT_TRANSFORM_INFO[transform].name;
  const applying = snapshot.phase === "applying";
  const finished = snapshot.phase === "done";
  const ready = snapshot.entries.filter((entry) => entry.state === "ready");
  const entry = snapshot.entries.find((candidate) => candidate.path === shown) ?? null;
  const counts = {
    refused: snapshot.entries.filter((candidate) => candidate.state === "refused").length,
    failed: snapshot.entries.filter((candidate) => candidate.state === "failed").length,
    unchanged: snapshot.entries.filter((candidate) => candidate.state === "unchanged").length,
  };
  return (
    <>
      <h2 id={`${id}-title`} class="tkr-script-title">{name}: review the changes</h2>
      <p class="tkr-script-count" role="status" aria-live="polite">
        {ready.length === 0 ? "Nothing would change." : `${snapshot.selected} of ${ready.length} changed ${ready.length === 1 ? "program is" : "programs are"} selected.`}
        {counts.refused > 0 ? ` ${counts.refused} left as ${counts.refused === 1 ? "it was" : "they were"}, with the reason shown.` : ""}
        {counts.failed > 0 ? ` ${counts.failed} could not be checked.` : ""}
        {counts.unchanged > 0 ? ` ${counts.unchanged} already fine.` : ""}
      </p>
      {snapshot.outcome === null ? null : (
        <p class="tkr-script-outcome" role="status">{snapshot.outcome.summary}</p>
      )}
      {snapshot.outcome === null || snapshot.outcome.failed.length === 0 ? null : (
        <ul class="tkr-script-failures" aria-label="Programs that could not be applied">
          {snapshot.outcome.failed.map((failure) => <li key={failure.path}>{failure.message}</li>)}
        </ul>
      )}
      <div class="tkr-script-actions">
        <button type="button" class="tkr-script-all" disabled={applying || finished || ready.length === 0} onClick={() => session.setAllIncluded(true)}>Select all</button>
        <button type="button" class="tkr-script-none" disabled={applying || finished || ready.length === 0} onClick={() => session.setAllIncluded(false)}>Select none</button>
      </div>
      <div class="tkr-script-body">
        <ul class="tkr-script-files" aria-label="Programs">
          {snapshot.entries.map((candidate) => {
            const label = `${id}-file-${snapshot.entries.indexOf(candidate)}`;
            return (
              <li key={candidate.path} class="tkr-script-file" data-state={candidate.state} data-shown={candidate.path === shown ? "true" : "false"}>
                {candidate.state === "ready" ? (
                  <input
                    type="checkbox"
                    id={label}
                    checked={candidate.included}
                    disabled={applying || finished}
                    aria-label={`Apply to ${candidate.path}`}
                    onChange={(event) => session.setIncluded(candidate.path, (event.currentTarget as HTMLInputElement).checked)}
                  />
                ) : <span class="tkr-script-nobox" aria-hidden="true" />}
                <button type="button" class="tkr-script-show" aria-pressed={candidate.path === shown} title={candidate.path} onClick={() => setShown(candidate.path)}>
                  <span class="tkr-script-file-name">{fileName(candidate.path)}</span>
                  <span class="tkr-script-file-state">{STATE_TEXT[candidate.state]}{candidate.target === "copy" && candidate.state === "ready" ? " (3.1 copy)" : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {entry === null ? <p class="tkr-script-empty">There are no programs to show.</p> : <EntryDetail entry={entry} />}
      </div>
      <div class="tkr-script-footer">
        <button
          type="button"
          class="tkr-script-apply"
          disabled={applying || finished || snapshot.selected === 0}
          onClick={() => { void session.apply(); }}
        >
          {applying ? "Applying…" : snapshot.selected === 0 ? "Apply" : `Apply to ${snapshot.selected} ${snapshot.selected === 1 ? "program" : "programs"}`}
        </button>
        <button type="button" class="tkr-script-cancel" disabled={applying} onClick={() => { session.cancel(); onClose(); }}>
          {finished ? "Close" : "Cancel"}
        </button>
      </div>
    </>
  );
}

/**
 * The reviewed script workflow (story 13.16, T-42, T-43, T-44, T-46; docs/spec/engine/rpgcode-tooling.md#tool-11). The
 * author chooses a scope, the editor asks the language server about each program, and the author reads the original
 * and result of every program that would change, unticks any they do not want, and applies or cancels. Nothing is
 * written until Apply, and Cancel (or Escape) leaves every file as it was.
 */
export function ScriptWorkflowView({ transform, activeProgram, plan, review, onClose }: ScriptWorkflowViewProps) {
  type Stage =
    | { readonly kind: "choose" }
    | { readonly kind: "planning"; readonly progress: PlanProgress | null }
    | { readonly kind: "unavailable"; readonly message: string }
    | { readonly kind: "review"; readonly session: ScriptReviewSession };
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [scope, setScope] = useState<"program" | "project">(activeProgram === null ? "project" : "program");
  const [id] = useState(() => `tkr-script-workflow-${++reviewsMade}`);
  const cancelled = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const info = SCRIPT_TRANSFORM_INFO[transform];
  // Focus lives inside the dialog at every stage: the first control when there is one, the dialog itself otherwise (its
  // radios can all be disabled). Escape is heard on the dialog, so focus must never drift out to the page behind it.
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const control = element.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled), select, textarea");
    (control ?? element).focus();
  }, [stage.kind]);

  const check = (): void => {
    cancelled.current = false;
    setStage({ kind: "planning", progress: null });
    void plan(scope === "program" && activeProgram !== null ? { kind: "program", path: activeProgram } : { kind: "project" }, {
      onProgress: (progress) => setStage((current) => (current.kind === "planning" ? { kind: "planning", progress } : current)),
      cancelled: () => cancelled.current,
    }).then((planned) => {
      if (cancelled.current) return onClose();
      if (planned.unavailable !== null) return setStage({ kind: "unavailable", message: planned.unavailable });
      setStage({ kind: "review", session: review(planned) });
    });
  };
  const cancel = (): void => {
    if (stage.kind === "planning") cancelled.current = true;
    if (stage.kind === "review") {
      if (!stage.session.cancel()) return;
    }
    onClose();
  };

  return (
    <div
      class="tkr-script-workflow"
      ref={root}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    >
      {stage.kind === "choose" ? (
        <>
          <h2 class="tkr-script-title" id={`${id}-title`}>{info.name}</h2>
          <p class="tkr-script-plain">{info.plain}</p>
          <p class="tkr-script-plain">You will see what would change in each program before anything is written, and can leave any program out or cancel.</p>
          <fieldset class="tkr-script-scope">
            <legend>Programs to check</legend>
            <label>
              <input type="radio" name={`${id}-scope`} checked={scope === "program"} disabled={activeProgram === null} onChange={() => setScope("program")} />
              {activeProgram === null ? "This program (open a program to choose it)" : `This program (${activeProgram})`}
            </label>
            <label>
              <input type="radio" name={`${id}-scope`} checked={scope === "project"} onChange={() => setScope("project")} />
              Every program in the project
            </label>
          </fieldset>
          <div class="tkr-script-footer">
            <button type="button" class="tkr-script-check" onClick={check}>Check programs</button>
            <button type="button" class="tkr-script-cancel" onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : null}
      {stage.kind === "planning" ? (
        <>
          <h2 class="tkr-script-title" id={`${id}-title`}>{info.name}</h2>
          <p class="tkr-script-progress" role="status" aria-live="polite">
            {stage.progress === null ? "Checking programs…" : `Checked ${stage.progress.done} of ${stage.progress.total} programs${stage.progress.path === "" ? "" : `: ${stage.progress.path}`}`}
          </p>
          <div class="tkr-script-footer">
            <button type="button" class="tkr-script-cancel" onClick={cancel}>Cancel</button>
          </div>
        </>
      ) : null}
      {stage.kind === "unavailable" ? (
        <>
          <h2 class="tkr-script-title" id={`${id}-title`}>{info.name}</h2>
          <p class="tkr-script-unavailable" role="alert">{stage.message}</p>
          <div class="tkr-script-footer">
            <button type="button" class="tkr-script-cancel" onClick={onClose}>Close</button>
          </div>
        </>
      ) : null}
      {stage.kind === "review" ? <Review session={stage.session} transform={transform} onClose={onClose} /> : null}
    </div>
  );
}
