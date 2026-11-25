import {
  createScriptReview,
  planScriptWorkflow,
  SCRIPT_TRANSFORM_INFO,
  type OpenScriptProgram,
  type ScriptTransformId,
  type ScriptWorkflowEntry,
  type ScriptWorkflowEnvironment,
  type ScriptWorkflowOutcome,
  type ScriptWorkflowPlan,
  type ScriptWorkflowScope,
  type WizardHistory,
} from "@tk-reawakened/editor-model";

/**
 * The reviewed script workflows in VS Code (story 13.16, docs/spec/engine/rpgcode-tooling.md#tool-11), as the questions VS
 * Code can ask: after scope selection, one multi-select list in which every program that would change starts selected (the
 * per-file opt-out), each with its comparison readable before anything is written. The model plans, holds the choices and
 * applies; this module only asks and reports, so VS Code and the browser apply the same plan by the same rules.
 */

/** One program of the review, offered in the multi-select list. */
export interface ScriptReviewItem {
  readonly path: string;
  /** What the list says beside the path. */
  readonly description: string;
  /** What the author reads before choosing: the plan's summary, and what is left as written. */
  readonly detail: string;
  /** The planned original, for the host's own diff view (`LF`). */
  readonly original: string | null;
  /** The proposed result, for the host's own diff view (`LF`). */
  readonly result: string | null;
}

export interface ScriptWorkflowUi {
  /** Show work in progress; the returned function hides it. */
  progress(message: string): () => void;
  /** Ask which programs to apply; the picked ones are applied, so a dismissed list writes nothing. */
  review(transform: ScriptTransformId, items: readonly ScriptReviewItem[], leftAsWritten: readonly string[]): Promise<readonly string[] | undefined>;
  /** Tell the author the outcome, with the programs that were refused, skipped or failed and why. */
  report(summary: string, problems: readonly string[], failed: boolean, stage?: "plan"): Promise<void>;
  /** Ask whether to try the files that failed again; `undefined`/false ends the run. */
  retry(problems: readonly string[]): Promise<boolean>;
  /** The project could not be listed. */
  tellUnavailable(message: string): Promise<void>;
}

export interface ScriptWorkflowHostEnvironment {
  readonly fs: ScriptWorkflowEnvironment["fs"];
  readonly provider: NonNullable<ScriptWorkflowEnvironment["provider"]>;
  readonly history: WizardHistory | null;
  /** Resolved again at every check, so a program opened during the run is seen (never a fixed list). */
  readonly openPrograms: () => readonly OpenScriptProgram[];
  readonly root: string;
  /** The selected main file's URI, so the request is matched to that project. */
  readonly projectMainUri?: string;
  readonly projectMainPath?: string;
  readonly isProjectCurrent?: () => boolean;
}

export type ScriptWorkflowSummary =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "nothing-to-change"; readonly plan: ScriptWorkflowPlan }
  | { readonly kind: "applied"; readonly outcome: ScriptWorkflowOutcome };

/** The items a review offers: only the programs that would change. */
export function reviewItems(entries: readonly ScriptWorkflowEntry[]): readonly ScriptReviewItem[] {
  return entries
    .filter((entry) => entry.state === "ready")
    .map((entry) => ({
      path: entry.path,
      description: entry.target === "copy" ? `3.1 copy to ${entry.destination}; the original is not changed` : "will change",
      detail: describeEntry(entry),
      original: entry.original,
      result: entry.result,
    }));
}

/**
 * The programs that could not be applied, were left as they were, or were only partly rewritten, one line each. A program
 * with no change of its own still needs its fragments in the report: they are the part the workflow refused to touch.
 */
export function problemsOf(entries: readonly ScriptWorkflowEntry[]): readonly string[] {
  return entries.flatMap((entry) => {
    const notes: string[] = [];
    if (entry.state === "refused" || entry.state === "failed" || entry.state === "skipped") notes.push(entry.reason?.message ?? entry.message ?? "left as it was");
    for (const fragment of entry.unsupported) notes.push(`${fragment.line === null ? "whole file" : `line ${fragment.line}`}: ${fragment.message}`);
    return notes.length === 0 ? [] : [`${entry.path}: ${notes.join("; ")}`];
  });
}

/** `changed` unchanged lines are kept around every change; a longer run of unchanged lines is folded into a count. */
const CONTEXT = 3;

/** One program's comparison and notes, as plain text for a review list's detail. */
export function describeEntry(entry: ScriptWorkflowEntry): string {
  const lines: string[] = [];
  if (entry.target === "copy") lines.push(`Toolkit 2.x program: its 3.1 version is saved at ${entry.destination}; the original is never changed.`, "");
  if (entry.reason !== null) lines.push(entry.reason.message, "");
  if (entry.message !== null) lines.push(entry.message, "");
  const notes = [
    ...entry.steps.map((step) => `${step.title}: ${step.applied ? "done" : "not done"}${step.reason === undefined ? "" : ` (${step.reason})`}`),
    ...entry.reviews.map((review) => `Check line ${review.line} (${review.index}): ${review.message}`),
    ...entry.unsupported.map((fragment) => `Left as written${fragment.line === null ? "" : ` at line ${fragment.line}`}: ${fragment.message}`),
  ];
  if (notes.length > 0) lines.push(...notes, "");
  if (entry.diff === null) return lines.join("\n");
  lines.push("Original and result:");
  let folded = 0;
  entry.diff.forEach((line, index) => {
    const near = line.kind !== "same" || entry.diff!.some((other, at) => other.kind !== "same" && Math.abs(at - index) <= CONTEXT);
    if (!near) {
      folded += 1;
      return;
    }
    if (folded > 0) {
      lines.push(`… ${folded} unchanged ${folded === 1 ? "line" : "lines"}`);
      folded = 0;
    }
    lines.push(`${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}${line.text}`);
  });
  if (folded > 0) lines.push(`… ${folded} unchanged ${folded === 1 ? "line" : "lines"}`);
  return lines.join("\n");
}

function environmentOf(env: ScriptWorkflowHostEnvironment): ScriptWorkflowEnvironment {
  return {
    fs: env.fs,
    provider: env.provider,
    history: env.history,
    openPrograms: () => env.openPrograms(),
    root: env.root,
    ...(env.projectMainUri === undefined ? {} : { projectMainUri: env.projectMainUri }),
    ...(env.projectMainPath === undefined ? {} : { projectMainPath: env.projectMainPath }),
    ...(env.isProjectCurrent === undefined ? {} : { isProjectCurrent: env.isProjectCurrent }),
  };
}

function summaryOf(transform: ScriptTransformId, scope: ScriptWorkflowScope, plan: ScriptWorkflowPlan, outcome: ScriptWorkflowOutcome | null): string {
  const where = scope.kind === "program" ? scope.path : "the project";
  const counts = { refused: plan.entries.filter((entry) => entry.state === "refused").length, failed: plan.entries.filter((entry) => entry.state === "failed").length };
  const tail = `${counts.refused > 0 ? ` ${counts.refused} left as ${counts.refused === 1 ? "it was" : "they were"}.` : ""}${counts.failed > 0 ? ` ${counts.failed} could not be checked.` : ""}`;
  return outcome === null ? `${SCRIPT_TRANSFORM_INFO[transform].name}: nothing would change in ${where}.${tail}` : `${SCRIPT_TRANSFORM_INFO[transform].name}: ${outcome.summary}${tail}`;
}

/**
 * Plan the accepted scope, ask which programs to apply, apply and report. Nothing is written unless the
 * author picks programs in the review list; dismissing that list changes nothing.
 */
export async function runScriptWorkflow(transform: ScriptTransformId, scope: ScriptWorkflowScope, env: ScriptWorkflowHostEnvironment, ui: ScriptWorkflowUi): Promise<ScriptWorkflowSummary> {
  const hide = ui.progress(`Checking ${scope.kind === "program" ? scope.path : "the project's programs"}…`);
  let plan: ScriptWorkflowPlan;
  try {
    plan = await planScriptWorkflow(environmentOf(env), transform, scope);
  } finally {
    hide();
  }
  if (plan.unavailable !== null) {
    await ui.tellUnavailable(plan.unavailable);
    return { kind: "unavailable", message: plan.unavailable };
  }
  const items = reviewItems(plan.entries);
  if (items.length === 0) {
    const problems = problemsOf(plan.entries);
    await ui.report(summaryOf(transform, scope, plan, null), problems, problems.length > 0, "plan");
    return { kind: "nothing-to-change", plan };
  }
  const picked = await ui.review(transform, items, problemsOf(plan.entries.filter((entry) => entry.state !== "ready")));
  if (picked === undefined) return { kind: "cancelled" };
  const session = createScriptReview(environmentOf(env), plan);
  // Result selection is authoritative: uncheck the model's defaults before applying the selected list.
  session.setAllIncluded(false);
  for (const path of picked) session.setIncluded(path, true);
  if (session.getSnapshot().selected === 0) {
    session.cancel();
    return { kind: "cancelled" };
  }
  let outcome = await session.apply();
  let problems = [...problemsOf(session.getSnapshot().entries), ...outcome.failed.map((failure) => failure.message), ...outcome.recoveryWarnings.map((warning) => warning.message)];
  await ui.report(summaryOf(transform, scope, session.getSnapshot().plan, outcome), problems, problems.length > 0);
  // A file that failed stays selected, so trying again covers exactly those files and never a program already written.
  while (outcome.failed.length > 0 && await ui.retry(outcome.failed.map(({ message }) => message))) {
    outcome = await session.apply();
    problems = [...problemsOf(session.getSnapshot().entries), ...outcome.failed.map((failure) => failure.message), ...outcome.recoveryWarnings.map((warning) => warning.message)];
    await ui.report(summaryOf(transform, scope, session.getSnapshot().plan, outcome), problems, problems.length > 0);
  }
  return { kind: "applied", outcome };
}
