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
 * Code can ask: which programs, then one multi-select list in which every program that would change starts selected (the
 * per-file opt-out), each with its comparison readable before anything is written. The model plans, holds the choices and
 * applies; this module only asks and reports, so VS Code and the browser apply the same plan by the same rules.
 */

/** One program of the review, offered in the multi-select list. */
export interface ScriptReviewItem {
  readonly path: string;
  /** What the list says beside the path. */
  readonly description: string;
  /** What the author reads before choosing: the comparison, the spots to check and what is left as written. */
  readonly detail: string;
}

export interface ScriptWorkflowUi {
  /** Ask which programs to check; `undefined` when the question is dismissed. */
  scope(transform: ScriptTransformId, activeProgram: string | null): Promise<"program" | "project" | undefined>;
  /** Show work in progress; the returned function hides it. */
  progress(message: string): () => void;
  /** Ask which programs to apply; the picked ones are applied, so a dismissed list writes nothing. */
  review(transform: ScriptTransformId, items: readonly ScriptReviewItem[]): Promise<readonly string[] | undefined>;
  /** Tell the author the outcome, with the programs that were refused, skipped or failed and why. */
  report(summary: string, problems: readonly string[], failed: boolean): Promise<void>;
  /** The workflow cannot run here: no language server, or the project could not be listed. */
  tellUnavailable(message: string): Promise<void>;
}

export interface ScriptWorkflowHostEnvironment {
  readonly fs: ScriptWorkflowEnvironment["fs"];
  /** `null` when this host cannot reach a language server; the workflow then says so and writes nothing. */
  readonly provider: ScriptWorkflowEnvironment["provider"] | null;
  readonly unavailableReason?: string;
  readonly history: WizardHistory | null;
  readonly openPrograms: readonly OpenScriptProgram[];
  readonly root: string;
  readonly activeProgram: string | null;
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
    }));
}

/** The programs that could not be applied or were left as they were, one line each, for the report. */
export function problemsOf(entries: readonly ScriptWorkflowEntry[]): readonly string[] {
  return entries
    .filter((entry) => entry.state === "refused" || entry.state === "failed")
    .map((entry) => `${entry.path}: ${entry.reason?.message ?? entry.message ?? "left as it was"}`);
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
    ...(env.unavailableReason === undefined ? {} : { unavailableReason: env.unavailableReason }),
    history: env.history,
    openPrograms: () => env.openPrograms,
    root: env.root,
  };
}

function summaryOf(transform: ScriptTransformId, scope: ScriptWorkflowScope, plan: ScriptWorkflowPlan, outcome: ScriptWorkflowOutcome | null): string {
  const where = scope.kind === "program" ? scope.path : "the project";
  const counts = { refused: plan.entries.filter((entry) => entry.state === "refused").length, failed: plan.entries.filter((entry) => entry.state === "failed").length };
  const tail = `${counts.refused > 0 ? ` ${counts.refused} left as ${counts.refused === 1 ? "it was" : "they were"}.` : ""}${counts.failed > 0 ? ` ${counts.failed} could not be checked.` : ""}`;
  return outcome === null ? `${SCRIPT_TRANSFORM_INFO[transform].name}: nothing would change in ${where}.${tail}` : `${SCRIPT_TRANSFORM_INFO[transform].name}: ${outcome.summary}${tail}`;
}

/**
 * Run one workflow: ask the scope, plan, ask which programs to apply, apply and report. Nothing is written unless the
 * author picks programs in the review list; dismissing any question changes nothing.
 */
export async function runScriptWorkflow(transform: ScriptTransformId, env: ScriptWorkflowHostEnvironment, ui: ScriptWorkflowUi): Promise<ScriptWorkflowSummary> {
  if (env.provider === null) {
    const message = env.unavailableReason ?? "This host has no language server, so programs cannot be formatted or updated here. Nothing was changed.";
    await ui.tellUnavailable(message);
    return { kind: "unavailable", message };
  }
  const asked = await ui.scope(transform, env.activeProgram);
  if (asked === undefined) return { kind: "cancelled" };
  const scope: ScriptWorkflowScope = asked === "program" && env.activeProgram !== null ? { kind: "program", path: env.activeProgram } : { kind: "project" };
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
    await ui.report(summaryOf(transform, scope, plan, null), problems, problems.length > 0);
    return { kind: "nothing-to-change", plan };
  }
  const picked = await ui.review(transform, items);
  if (picked === undefined) return { kind: "cancelled" };
  const session = createScriptReview(environmentOf(env), plan);
  // The list is the choice: every program that would change starts unticked, and only the picked ones are applied.
  session.setAllIncluded(false);
  for (const path of picked) session.setIncluded(path, true);
  if (session.getSnapshot().selected === 0) {
    session.cancel();
    return { kind: "cancelled" };
  }
  const outcome = await session.apply();
  const problems = [...problemsOf(session.getSnapshot().entries), ...outcome.failed.map((failure) => failure.message)];
  await ui.report(summaryOf(transform, scope, session.getSnapshot().plan, outcome), problems, problems.length > 0);
  return { kind: "applied", outcome };
}
