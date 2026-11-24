/**
 * The four reviewed script transforms (docs/spec/engine/rpgcode-tooling.md#tool-11-transforms): `format`,
 * `canonical-case`, `update` and `cleanup`. This module orchestrates the rewrites the package already has - the TOOL-4
 * formatter and the behaviour-proved dialect fixes - and adds no rewrite of its own. Every answer carries the text it
 * would produce and never writes anything; an editor shows it for review before it applies it.
 */
import { applyEdits, convertTk2, legacyPrefixLines, sameInPlaceBehavior, sigilFixes, type LegacyOptions, type LegacyReview, type UnsupportedFragment } from "./fixes.ts";
import { formatSource } from "./format.ts";

export type ScriptTransformId = "format" | "canonical-case" | "update" | "cleanup";

/** Every transform id, in the order an editor lists them. */
export const SCRIPT_TRANSFORMS: readonly ScriptTransformId[] = ["format", "canonical-case", "update", "cleanup"];

export type ScriptTransformRequest = {
  readonly transform: ScriptTransformId;
  /** The source, with `LF` line breaks. */
  readonly text: string;
  /** The reading the rewrite uses: the project's dialect when it assessed the document, else the language mode's. */
  readonly dialect: "tk2" | "tk3";
  /** Whether the running project assessed the document, so `dialect` is a project fact. */
  readonly established: boolean;
  /** Spaces per brace depth; default four. */
  readonly indentWidth?: number;
};

export type ScriptTransformStep = {
  readonly id: "tk2-to-tk3" | "sigil" | "format" | "canonical-case";
  readonly title: string;
  readonly applied: boolean;
  /** Why the stage did not apply, or what it left for the author. */
  readonly reason?: string;
};

export type ScriptTransformRefusal = {
  readonly code: "unassessed" | "tk2-dialect" | "unsupported-fragments" | "not-proven";
  readonly message: string;
};

export type ScriptTransformResult = {
  readonly transform: ScriptTransformId;
  readonly status: "changed" | "unchanged" | "refused";
  /** The proposed text; the request's text unless `status` is `changed`. */
  readonly text: string;
  readonly dialect: "tk2" | "tk3";
  readonly established: boolean;
  /** `copy` when the source is Toolkit 2.x and the result is 3.1 text, which must never replace the original. */
  readonly target: "in-place" | "copy";
  readonly steps: readonly ScriptTransformStep[];
  readonly reviews: readonly LegacyReview[];
  readonly unsupported: readonly UnsupportedFragment[];
  readonly reason?: ScriptTransformRefusal;
};

function refused(request: ScriptTransformRequest, reason: ScriptTransformRefusal, extra: { readonly steps?: readonly ScriptTransformStep[]; readonly unsupported?: readonly UnsupportedFragment[] } = {}): ScriptTransformResult {
  return {
    transform: request.transform,
    status: "refused",
    text: request.text,
    dialect: request.dialect,
    established: request.established,
    target: request.dialect === "tk2" ? "copy" : "in-place",
    steps: extra.steps ?? [],
    reviews: [],
    unsupported: extra.unsupported ?? [],
    reason,
  };
}

function finish(request: ScriptTransformRequest, text: string, steps: readonly ScriptTransformStep[], reviews: readonly LegacyReview[], unsupported: readonly UnsupportedFragment[]): ScriptTransformResult {
  return {
    transform: request.transform,
    status: text === request.text ? "unchanged" : "changed",
    text,
    dialect: request.dialect,
    established: request.established,
    target: request.dialect === "tk2" ? "copy" : "in-place",
    steps,
    reviews,
    unsupported,
  };
}

/** Format-style transforms rewrite only source the running project assesses as 3.1 (docs/spec/engine/rpgcode-tooling.md#tool-1-project). */
function formatRefusal(request: ScriptTransformRequest): ScriptTransformResult | null {
  if (request.dialect === "tk2") {
    return refused(request, { code: "tk2-dialect", message: "The program is Toolkit 2.x, where a loose line is dialogue the formatter must not rewrite. Use Update older syntax to convert it." });
  }
  if (!request.established) {
    return refused(request, { code: "unassessed", message: "The program's dialect is unassessed. Formatting rewrites only 3.1 source; select the running project (.gam) to establish the dialect." });
  }
  return null;
}

function runFormat(request: ScriptTransformRequest, jobs: { readonly indent: boolean; readonly capitalisation: boolean }): string {
  return formatSource(request.text, {
    dialect: "tk3",
    jobs,
    ...(request.indentWidth === undefined ? {} : { indentWidth: request.indentWidth }),
  }).text;
}

const SIGIL_TITLE = "Drop ignored `!` and `$` sigils";
const FORMAT_TITLE = "Re-indent and normalise capitalisation";

/** The reading-dependent spots of a 3.1 stage, as the stage's note. */
function readingNote(fragments: readonly UnsupportedFragment[]): string | undefined {
  return fragments.length === 0 ? undefined : `${fragments.length} spot${fragments.length === 1 ? "" : "s"} left as written because the running project has not said which dialect the file is`;
}

/** The result of one transform of one source; never throws for a source it cannot rewrite. */
export function transformSource(request: ScriptTransformRequest): ScriptTransformResult {
  const options: LegacyOptions = { dialectEstablished: request.established };

  if (request.transform === "format" || request.transform === "canonical-case") {
    const refusal = formatRefusal(request);
    if (refusal !== null) return refusal;
    const job = request.transform === "format" ? { indent: true, capitalisation: true } : { indent: false, capitalisation: true };
    const text = runFormat(request, job);
    const id = request.transform === "format" ? "format" : "canonical-case";
    return finish(request, text, [{ id, title: request.transform === "format" ? FORMAT_TITLE : "Normalise capitalisation", applied: text !== request.text }], [], []);
  }

  if (request.dialect === "tk2") {
    const outcome = convertTk2(request.text);
    if (outcome.kind === "refused") {
      const message = outcome.code === "unsupported-fragments"
        ? "The program has fragments that cannot be converted without risking what it does; it is left as it was."
        : "The converted program does not keep the original's behaviour, so no conversion is offered.";
      return refused(request, { code: outcome.code, message }, { unsupported: outcome.unsupported, steps: [{ id: "tk2-to-tk3", title: "Convert Toolkit 2.x to 3.1", applied: false, reason: message }] });
    }
    if (outcome.kind === "unchanged") return finish(request, request.text, [{ id: "tk2-to-tk3", title: "Convert Toolkit 2.x to 3.1", applied: false, reason: "nothing to convert" }], [], []);
    const converted = applyEdits(request.text, outcome.fix.edits);
    const steps: ScriptTransformStep[] = [{ id: "tk2-to-tk3", title: "Convert Toolkit 2.x to 3.1", applied: true }];
    const reviews = outcome.fix.reviews ?? [];
    if (request.transform === "update") return finish(request, converted, steps, reviews, []);
    // Clean up: the converted 3.1 text is then formatted, kept only if it still lowers the same.
    const formatted = runFormat({ ...request, text: converted }, { indent: true, capitalisation: true });
    if (formatted === converted) return finish(request, converted, [...steps, { id: "format", title: FORMAT_TITLE, applied: false, reason: "already formatted" }], reviews, []);
    if (sameInPlaceBehavior(converted, formatted, { dialectEstablished: true })) {
      return finish(request, formatted, [...steps, { id: "format", title: FORMAT_TITLE, applied: true }], reviews, []);
    }
    return finish(request, converted, [...steps, { id: "format", title: FORMAT_TITLE, applied: false, reason: "not proved to keep the program's behaviour" }], reviews, []);
  }

  // A 3.1 source: in-place stages, each kept only when proved.
  const steps: ScriptTransformStep[] = [];
  const unsupported: UnsupportedFragment[] = [];
  let current = request.text;

  const sigils = sigilFixes(current, options);
  unsupported.push(...sigils.readingDependent);
  if (sigils.fixes.length > 0) {
    const edits = sigils.fixes.flatMap((fix) => fix.edits);
    const next = applyEdits(current, edits);
    if (sameInPlaceBehavior(current, next, options)) {
      current = next;
      const note = readingNote(sigils.readingDependent);
      steps.push({ id: "sigil", title: SIGIL_TITLE, applied: true, ...(note === undefined ? {} : { reason: note }) });
    } else {
      steps.push({ id: "sigil", title: SIGIL_TITLE, applied: false, reason: "the combined edit is not proved to keep the program's behaviour" });
    }
  } else {
    const note = readingNote(sigils.readingDependent);
    steps.push({ id: "sigil", title: SIGIL_TITLE, applied: false, reason: note ?? "no ignored sigils" });
  }
  if (request.transform === "update") {
    if (current === request.text && unsupported.length > 0) {
      return refused(request, { code: "unsupported-fragments", message: "The edits depend on whether the file is 3.1 or Toolkit 2.x, which the running project has not said; it is left as it was." }, { unsupported, steps });
    }
    return finish(request, current, steps, [], unsupported);
  }

  // A leading `#` is ignored whole by 3.1 (LEX-6), so removing it would make a dead line run: report, never rewrite.
  unsupported.push(...legacyPrefixLines(current));

  if (!request.established) {
    steps.push({ id: "format", title: FORMAT_TITLE, applied: false, reason: "the program's dialect is unassessed; formatting rewrites only 3.1 source the running project assesses" });
  } else {
    const formatted = runFormat({ ...request, text: current }, { indent: true, capitalisation: true });
    if (formatted === current) steps.push({ id: "format", title: FORMAT_TITLE, applied: false, reason: "already formatted" });
    else if (sameInPlaceBehavior(current, formatted, options)) {
      current = formatted;
      steps.push({ id: "format", title: FORMAT_TITLE, applied: true });
    } else steps.push({ id: "format", title: FORMAT_TITLE, applied: false, reason: "not proved to keep the program's behaviour" });
  }
  return finish(request, current, steps, [], unsupported);
}
