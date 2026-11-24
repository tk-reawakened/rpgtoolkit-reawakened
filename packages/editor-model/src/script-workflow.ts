import { BinaryReader, foldPath, projectScriptDialect, readMainFile } from "@tk-reawakened/core";
import type { FileSystemService } from "@tk-reawakened/platform-services";
import { diffLines, type LineChange } from "./history-support.ts";
import { programCodec, type ProgramModel } from "./program-document.ts";
import type { WizardHistory } from "./wizard-history.ts";
import { checkpointFilePath } from "./checkpoint-groups.ts";

/**
 * Reviewed script workflows (story 13.16, docs/spec/engine/rpgcode-tooling.md#tool-11): format, normalise capitalisation,
 * update older syntax and clean up, over one program or every program of the project. The rewrites are the language
 * server's (`rpgcode/scriptTransform`); this module only plans (asks the provider about each file and keeps the answers),
 * holds the author's choices (the per-file opt-out), and applies the chosen results. It writes nothing until
 * `apply()`, and cancelling leaves every file as it was. DOM-free and host-free: files go through `fs`, open editors
 * through `openPrograms`, and recovery through the wizard history.
 */

export type ScriptTransformId = "format" | "canonical-case" | "update" | "cleanup";

/** What an editor calls each transform, with a sentence for someone writing a game (TOOL-11). */
export const SCRIPT_TRANSFORM_INFO: Readonly<Record<ScriptTransformId, { readonly name: string; readonly plain: string }>> = {
  format: { name: "Format", plain: "Lines up the indentation of your code and writes command names in their standard lower case." },
  "canonical-case": { name: "Normalise capitalisation", plain: "Writes command names and keywords in their standard lower case. Indentation is not touched." },
  update: { name: "Update older syntax", plain: "Brings programs written for older Toolkit versions up to 3.1 syntax: quotes plain text, uses == to compare, drops ! and $ marks, and wraps loose dialogue in mwin. Toolkit 2.x programs are never overwritten; the 3.1 result is saved as a copy." },
  cleanup: { name: "Clean up", plain: "Runs the update, then formats the result. Anything that cannot be shown to behave the same is left as it was." },
};

export const SCRIPT_TRANSFORM_IDS: readonly ScriptTransformId[] = ["format", "canonical-case", "update", "cleanup"];

/** Where a copy of a converted Toolkit 2.x program goes, under the project root. */
export const MIGRATED_FOLDER = ".tkr-migrated/3.1";

/** Folders a program search never enters (the inventory of TOOL-1, plus the folder converted copies go to). */
const SKIPPED_FOLDERS: Readonly<Record<string, true>> = { node_modules: true, ".git": true, ".tkr-history": true, ".tkr-exports": true, ".tkr-migrated": true };

/** A bound on the search, so a mis-selected folder is reported instead of read. */
export const MAX_WORKFLOW_PROGRAMS = 20_000;

export interface ScriptTransformStep {
  readonly id: string;
  readonly title: string;
  readonly applied: boolean;
  readonly reason?: string;
}

export interface ScriptUnsupportedFragment {
  /** 1-based, or `null` when the reason is about the whole file. */
  readonly line: number | null;
  readonly code: string;
  readonly message: string;
}

export interface ScriptReviewSpot {
  readonly line: number;
  readonly index: string;
  readonly message: string;
}

/** What the language server answers for one text (the wire contract of TOOL-11), read and checked. */
export interface ScriptTransformAnswer {
  readonly uri: string;
  readonly transform: ScriptTransformId;
  readonly status: "changed" | "unchanged" | "refused";
  readonly text: string;
  readonly dialect: "tk2" | "tk3";
  readonly established: boolean;
  readonly target: "in-place" | "copy";
  readonly steps: readonly ScriptTransformStep[];
  readonly reviews: readonly ScriptReviewSpot[];
  readonly unsupported: readonly ScriptUnsupportedFragment[];
  readonly reason?: { readonly code: string; readonly message: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown, test: (item: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item) && test(item));
}

/** Check an answer's shape; `null` when it is not the TOOL-11 answer, so nothing malformed is ever shown as a result. */
export function readScriptTransformAnswer(value: unknown): ScriptTransformAnswer | null {
  if (!isRecord(value)) return null;
  const { uri, transform, status, text, dialect, established, target, steps, reviews, unsupported, reason } = value;
  if (typeof uri !== "string" || typeof text !== "string" || typeof established !== "boolean") return null;
  if (!SCRIPT_TRANSFORM_IDS.includes(transform as ScriptTransformId)) return null;
  if (status !== "changed" && status !== "unchanged" && status !== "refused") return null;
  if (dialect !== "tk2" && dialect !== "tk3") return null;
  if (target !== "in-place" && target !== "copy") return null;
  if (!isList(steps, (step) => typeof step.id === "string" && typeof step.title === "string" && typeof step.applied === "boolean")) return null;
  if (!isList(reviews, (review) => typeof review.line === "number" && typeof review.index === "string" && typeof review.message === "string")) return null;
  if (!isList(unsupported, (fragment) => (typeof fragment.line === "number" || fragment.line === null) && typeof fragment.code === "string" && typeof fragment.message === "string")) return null;
  if (reason !== undefined && !(isRecord(reason) && typeof reason.code === "string" && typeof reason.message === "string")) return null;
  return value as unknown as ScriptTransformAnswer;
}

/** One question to the provider: the program's project path and the text (with `LF` line breaks). */
export interface ScriptTransformQuestion {
  readonly transform: ScriptTransformId;
  readonly path: string;
  readonly text: string;
  readonly indentWidth: number;
  /** The path inside the host's project (workspace-relative), which is what its `uriOf` maps; defaults to `path`. */
  readonly workspacePath?: string;
  /** The running project's main file URI the request was planned against, so a selection change is not missed. */
  readonly projectMainUri?: string;
}

/** The language server's side of the workflow. Rejects when the server cannot answer. */
export interface ScriptTransformProvider {
  transform(question: ScriptTransformQuestion): Promise<ScriptTransformAnswer>;
}

/**
 * A provider over any way of sending the one `rpgcode/scriptTransform` request: the browser host's language client, or
 * VS Code's command that forwards it. `uriOf` names the URI the server knows the project file by.
 */
export function scriptProviderOver(
  send: (params: { readonly transform: ScriptTransformId; readonly textDocument: { readonly uri: string }; readonly text: string; readonly indentWidth: number; readonly project?: { readonly main: string } }) => Promise<unknown>,
  uriOf: (path: string) => string,
): ScriptTransformProvider {
  return {
    async transform(question) {
      const answer = readScriptTransformAnswer(await send({
        transform: question.transform,
        textDocument: { uri: uriOf(question.workspacePath ?? question.path) },
        text: question.text,
        indentWidth: question.indentWidth,
        ...(question.projectMainUri === undefined ? {} : { project: { main: question.projectMainUri } }),
      }));
      if (answer === null) throw new Error("The language server's answer was not a script transform result.");
      if (answer.transform !== question.transform) throw new Error(`The language server answered ${answer.transform} to a ${question.transform} question.`);
      return answer;
    },
  };
}

/** A program open in an editor, as the workflow needs it: its current text, and one undoable edit. */
export interface OpenScriptProgram {
  readonly path: string;
  /** The text as the editor shows it, with `LF` line breaks; unsaved edits included. */
  text(): string;
  /** The host still has edits in transit; the last observed text is not safe to use. */
  busy?(): boolean;
  /** Replace the whole text as one labelled, undoable edit, without saving. */
  replace(label: string, text: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}

export type ScriptWorkflowFileSystem = Pick<FileSystemService, "list" | "read" | "write" | "createFolder">;

export interface ScriptWorkflowEnvironment {
  readonly fs: ScriptWorkflowFileSystem;
  /** The selected main file's URI as the server knows it, so a request is matched to that project and no older one. */
  readonly projectMainUri?: string;
  /** Workspace-relative path of that same main file, for checking the bytes before apply. */
  readonly projectMainPath?: string;
  /** Refuse when the selected project changes or its workbench closes before apply. */
  isProjectCurrent?(): boolean;
  /** `null` when the host has no language server: every workflow then says so and changes nothing. */
  readonly provider: ScriptTransformProvider | null;
  /** Why `provider` is `null`, in a sentence for the author (the server did not start, say); a plain "no language server" when absent. */
  readonly unavailableReason?: string;
  /** Records a recovery checkpoint before closed files are written; `null` when the host keeps none. */
  readonly history: WizardHistory | null;
  /** The programs open in an editor; their text, not the saved file, is what the workflow reads and edits. */
  openPrograms(): readonly OpenScriptProgram[];
  /** Spaces per brace depth; four by default. */
  readonly indentWidth?: number;
  /** The folder the project's programs are below; the project root by default (TOOL-1's root). */
  readonly root?: string;
}

export type ScriptWorkflowScope =
  | { readonly kind: "program"; readonly path: string }
  | { readonly kind: "project" };

export type ScriptFileState = "ready" | "unchanged" | "refused" | "failed" | "skipped" | "applied";

export interface ScriptWorkflowEntry {
  readonly path: string;
  readonly state: ScriptFileState;
  /** The text the plan was made from (`LF`); `null` when the file could not be read or is compiled. */
  readonly original: string | null;
  /** The proposed text; present for `ready` and `applied`. */
  readonly result: string | null;
  readonly target: "in-place" | "copy";
  /** Where an apply writes: the file itself, or its converted copy. */
  readonly destination: string;
  /** Whether the text came from an editor that has the program open. */
  readonly open: boolean;
  /** Whether the author left it in: only a `ready` file can be left out, and a new plan starts with every one in. */
  readonly included: boolean;
  readonly diff: readonly LineChange[] | null;
  readonly steps: readonly ScriptTransformStep[];
  readonly reviews: readonly ScriptReviewSpot[];
  readonly unsupported: readonly ScriptUnsupportedFragment[];
  /** The refusal the server gave. */
  readonly reason: { readonly code: string; readonly message: string } | null;
  /** Why a `failed` or `skipped` file is so, or how an `applied` one was applied. */
  readonly message: string | null;
}

export interface ScriptWorkflowPlan {
  readonly transform: ScriptTransformId;
  readonly scope: ScriptWorkflowScope;
  readonly entries: readonly ScriptWorkflowEntry[];
  /** What each written destination held when the plan was made, so a change before Apply is not overwritten. */
  readonly destinations: ReadonlyMap<string, Uint8Array | null>;
  /** Exact saved source bytes read for the proposal; open programs are checked through their live text instead. */
  readonly sources: ReadonlyMap<string, Uint8Array>;
  readonly mainBytes: Uint8Array | null;
  /** Set when the whole workflow cannot run (no language server, the search failed, or it was cancelled); there are then no entries. */
  readonly unavailable: string | null;
}

export interface PlanProgress {
  readonly done: number;
  readonly total: number;
  readonly path: string;
}

export interface PlanControl {
  onProgress?(progress: PlanProgress): void;
  /** True once the author has cancelled the planning. */
  cancelled?(): boolean;
}

function isProgramName(name: string): boolean {
  return /\.(prg|rnc)$/i.test(name);
}

/** The workspace path of the converted copy of `path`, which is relative to the project `root` (TOOL-11, `copy`). */
export function migratedPath(path: string, root = ""): string {
  const inside = root === "" || !path.startsWith(`${root}/`) ? path : path.slice(root.length + 1);
  return `${root === "" ? "" : `${root}/`}${MIGRATED_FOLDER}/${inside}`;
}

/** The path the language server knows a workspace path by: its inventory is relative to the project root (TOOL-1). */
function serverPathOf(path: string, root: string): string {
  return root !== "" && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

/** The programs below `root`, in path order, excluding the folders TOOL-1 and TOOL-11 exclude; a link is never followed. */
export async function listWorkflowPrograms(fs: Pick<FileSystemService, "list">, root: string): Promise<{ readonly paths: readonly string[] } | { readonly problem: string }> {
  const paths: string[] = [];
  const visit = async (folder: string): Promise<string | null> => {
    const listed = await fs.list(folder);
    if (!listed.ok) return `${folder === "" ? "the project folder" : folder}: ${listed.error.message}`;
    const entries = [...listed.value].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.kind === "link") continue;
      if (entry.kind === "directory") {
        if (Object.hasOwn(SKIPPED_FOLDERS, foldPath(entry.name))) continue;
        const problem = await visit(path);
        if (problem !== null) return problem;
      } else if (isProgramName(entry.name)) {
        if (paths.length >= MAX_WORKFLOW_PROGRAMS) return `the project holds more than ${MAX_WORKFLOW_PROGRAMS} programs`;
        paths.push(path);
      }
    }
    return null;
  };
  const problem = await visit(root);
  return problem === null ? { paths } : { problem };
}

const NO_PROVIDER = "This host has no language server, so programs cannot be formatted or updated here. Nothing was changed.";

function entryOf(path: string, fields: Partial<ScriptWorkflowEntry> & Pick<ScriptWorkflowEntry, "state">): ScriptWorkflowEntry {
  return {
    path,
    original: null,
    result: null,
    target: "in-place",
    destination: path,
    open: false,
    included: fields.state === "ready",
    diff: null,
    steps: [],
    reviews: [],
    unsupported: [],
    reason: null,
    message: null,
    ...fields,
  };
}

interface Source {
  readonly text: string;
  readonly open: boolean;
  readonly bytes: Uint8Array | null;
}

async function requireExactPath(fs: ScriptWorkflowFileSystem, path: string): Promise<void> {
  const resolved = await checkpointFilePath((parent) => fs.list(parent), path);
  if (resolved !== path) throw new Error(`${path} has a different stored spelling (${resolved}); it was not changed.`);
}

async function sourceOf(env: ScriptWorkflowEnvironment, path: string): Promise<Source | { readonly entry: ScriptWorkflowEntry }> {
  try { await requireExactPath(env.fs, path); }
  catch (error) { return { entry: entryOf(path, { state: "failed", message: String(error) }) }; }
  const read = await env.fs.read(path);
  if (read.ok && read.value[0] === 0) {
    return { entry: entryOf(path, { state: "skipped", message: "A compiled program has no source text to rewrite." }) };
  }
  const editor = env.openPrograms().find((program) => program.path === path);
  if (editor?.busy?.() === true) return { entry: entryOf(path, { state: "failed", message: `${path} has an edit still in progress. Try again once it settles.` }) };
  if (editor !== undefined && (read.ok || read.error.code === "not-found")) return { text: editor.text(), open: true, bytes: null };
  if (!read.ok) return { entry: entryOf(path, { state: "failed", message: `Could not read ${path}: ${read.error.message}` }) };
  const model = programCodec.read(read.value, path);
  if (!model.ok) return { entry: entryOf(path, { state: "failed", message: `Could not read ${path}: ${model.error.message}` }) };
  return { text: model.value.text, open: false, bytes: read.value.slice() };
}

async function planFile(env: ScriptWorkflowEnvironment, provider: ScriptTransformProvider, transform: ScriptTransformId, path: string, source: Source, dialect: "tk2" | "tk3" | null): Promise<ScriptWorkflowEntry> {
  let answer: ScriptTransformAnswer;
  try {
    answer = await provider.transform({
      transform,
      path: serverPathOf(path, env.root ?? ""),
      text: source.text,
      indentWidth: env.indentWidth ?? 4,
      workspacePath: path,
      ...(env.projectMainUri === undefined ? {} : { projectMainUri: env.projectMainUri }),
    });
    if (answer.established && dialect !== null && answer.dialect !== dialect) throw new Error("The selected project's dialect changed during planning. Review the current project again.");
  } catch (error) {
    return entryOf(path, { state: "failed", original: source.text, open: source.open, message: `The language server could not answer for ${path}: ${error instanceof Error ? error.message : String(error)}` });
  }
  const common = {
    original: source.text,
    open: source.open,
    target: answer.target,
    destination: answer.target === "copy" ? migratedPath(path, env.root ?? "") : path,
    steps: answer.steps,
    reviews: answer.reviews,
    unsupported: answer.unsupported,
  } as const;
  if (answer.status === "refused") {
    return entryOf(path, { ...common, state: "refused", reason: answer.reason ?? { code: "not-proven", message: "The language server refused without a reason." } });
  }
  if (answer.status === "unchanged" || answer.text === source.text) return entryOf(path, { ...common, state: "unchanged" });
  const diff = diffLines(source.text, answer.text);
  if (diff === null) {
    return entryOf(path, { ...common, state: "failed", message: `${path} is too large to show a comparison, and a result that cannot be shown before it is applied is never applied.` });
  }
  return entryOf(path, { ...common, state: "ready", result: answer.text, diff });
}

/**
 * Ask the language server about each program in scope. Nothing is written. A program the server cannot answer for is
 * kept in the plan as `failed` with the reason; it never stops the others.
 */
export async function planScriptWorkflow(env: ScriptWorkflowEnvironment, transform: ScriptTransformId, scope: ScriptWorkflowScope, control: PlanControl = {}): Promise<ScriptWorkflowPlan> {
  const unavailable = (message: string): ScriptWorkflowPlan => ({ transform, scope, entries: [], destinations: new Map(), sources: new Map(), mainBytes: null, unavailable: message });
  if (env.provider === null) return unavailable(env.unavailableReason === undefined ? NO_PROVIDER : `${env.unavailableReason} Nothing was changed.`);
  let mainBytes: Uint8Array | null = null;
  let dialect: "tk2" | "tk3" | null = null;
  if (env.projectMainPath !== undefined) {
    const read = await env.fs.read(env.projectMainPath);
    if (!read.ok) return unavailable(`Could not read the selected project's main file: ${read.error.message}. Nothing was changed.`);
    const parsed = readMainFile(new BinaryReader(read.value, env.projectMainPath));
    if (!parsed.ok) return unavailable(`Could not read the selected project's main file: ${parsed.error.message}. Nothing was changed.`);
    mainBytes = read.value.slice();
    dialect = projectScriptDialect(parsed.value);
  }
  let paths: readonly string[];
  if (scope.kind === "program") paths = [scope.path];
  else {
    const found = await listWorkflowPrograms(env.fs, env.root ?? "");
    if ("problem" in found) return unavailable(`Could not list the project's programs: ${found.problem}. Nothing was changed.`);
    paths = found.paths;
  }
  const destinations = new Map<string, Uint8Array | null>();
  const sources = new Map<string, Uint8Array>();
  const entries: ScriptWorkflowEntry[] = [];
  for (const path of paths) {
    if (control.cancelled?.() === true) return unavailable("Cancelled. Nothing was changed.");
    control.onProgress?.({ done: entries.length, total: paths.length, path });
    const source = await sourceOf(env, path);
    if ("entry" in source) { entries.push(source.entry); continue; }
    const entry = await planFile(env, env.provider, transform, path, source, dialect);
    if (entry.state === "ready" && !(entry.open && entry.target === "in-place")) {
      if (source.bytes !== null) sources.set(path, source.bytes);
      if (entry.target === "in-place") {
        destinations.set(path, source.bytes);
      } else {
        try { await requireExactPath(env.fs, entry.destination); }
        catch (error) { entries.push({ ...entry, state: "failed", included: false, message: String(error) }); continue; }
        const read = await env.fs.read(entry.destination);
        if (!read.ok && read.error.code !== "not-found") {
          entries.push({ ...entry, state: "failed", included: false, message: `Could not read ${entry.destination}: ${read.error.message}` });
          continue;
        }
        destinations.set(entry.destination, read.ok ? read.value.slice() : null);
      }
    }
    entries.push(entry);
  }
  control.onProgress?.({ done: paths.length, total: paths.length, path: "" });
  return { transform, scope, entries, destinations, sources, mainBytes, unavailable: null };
}

export interface ScriptApplyFailure {
  readonly path: string;
  readonly message: string;
}

export interface ScriptWorkflowOutcome {
  /** The files written or edited, with where the result went. */
  readonly applied: readonly { readonly path: string; readonly destination: string; readonly via: "edit" | "write" | "copy" }[];
  /** Ready files the author left out. */
  readonly leftOut: readonly string[];
  readonly refused: readonly string[];
  readonly unchanged: number;
  readonly skipped: readonly string[];
  readonly failed: readonly ScriptApplyFailure[];
  readonly recoveryWarnings: readonly ScriptApplyFailure[];
  /** One sentence for the status line, with the counts. */
  readonly summary: string;
}

export type ScriptReviewPhase = "reviewing" | "applying" | "done" | "cancelled";

export interface ScriptReviewSnapshot {
  readonly plan: ScriptWorkflowPlan;
  readonly entries: readonly ScriptWorkflowEntry[];
  readonly phase: ScriptReviewPhase;
  /** The result of the latest apply; `null` before one. */
  readonly outcome: ScriptWorkflowOutcome | null;
  /** How many ready files are left in. */
  readonly selected: number;
}

export interface ScriptReviewSession {
  getSnapshot(): ScriptReviewSnapshot;
  subscribe(listener: () => void): () => void;
  /** Leave a ready file in or out; any other file cannot be changed. Ignored while applying. */
  setIncluded(path: string, included: boolean): void;
  setAllIncluded(included: boolean): void;
  /** Apply the files that are left in. Resolves with the outcome; files that fail stay in the review so a retry covers them. */
  apply(): Promise<ScriptWorkflowOutcome>;
  /** Close the review. Nothing is written and every file is as it was. Not possible while an apply is running. */
  cancel(): boolean;
}

function describe(entries: readonly ScriptWorkflowEntry[], applied: ScriptWorkflowOutcome["applied"], failed: readonly ScriptApplyFailure[], recoveryWarnings: readonly ScriptApplyFailure[]): ScriptWorkflowOutcome {
  const leftOut = entries.filter((entry) => entry.state === "ready" && !entry.included).map((entry) => entry.path);
  const refused = entries.filter((entry) => entry.state === "refused").map((entry) => entry.path);
  const skipped = entries.filter((entry) => entry.state === "skipped").map((entry) => entry.path);
  const unchanged = entries.filter((entry) => entry.state === "unchanged").length;
  const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const copies = applied.filter((item) => item.via === "copy").length;
  const parts = [`${count(applied.length, "program")} updated${copies > 0 ? ` (${count(copies, "converted copy")} written to ${MIGRATED_FOLDER}; use the copies in a separately migrated 3.1 project. This project and the originals are unchanged)` : ""}`];
  if (leftOut.length > 0) parts.push(`${leftOut.length} left out`);
  if (refused.length > 0) parts.push(`${refused.length} refused and left as they were`);
  if (skipped.length > 0) parts.push(`${skipped.length} skipped`);
  if (failed.length > 0) parts.push(`${failed.length} failed and left as they were`);
  if (recoveryWarnings.length > 0) parts.push(`${recoveryWarnings.length} recovery ${recoveryWarnings.length === 1 ? "warning" : "warnings"}`);
  return { applied, leftOut, refused, unchanged, skipped, failed, recoveryWarnings, summary: `${parts.join("; ")}.` };
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

type ApplyOneResult = { readonly via: "edit" | "write" | "copy"; readonly recoveryWarning?: string } | { readonly failure: string };

/** The bytes of `path` after replacing the text of `model` by `text`, keeping the file's line endings and encoding. */
function rewritten(model: ProgramModel, text: string, label: string): { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly message: string } {
  const next = programCodec.apply(model, { type: "edit-text", label, edits: [{ from: 0, to: model.text.length, text }] });
  const written = programCodec.write(next);
  return written.ok ? { ok: true, bytes: written.value } : { ok: false, message: written.error.message };
}

/**
 * Hold the plan for review. The review is the only way to write: `apply()` writes the files that are left in, and
 * `cancel()` closes it with nothing written.
 */
export function createScriptReview(env: ScriptWorkflowEnvironment, plan: ScriptWorkflowPlan): ScriptReviewSession {
  let entries: readonly ScriptWorkflowEntry[] = plan.entries;
  let phase: ScriptReviewPhase = "reviewing";
  let outcome: ScriptWorkflowOutcome | null = null;
  let snapshot: ScriptReviewSnapshot | null = null;
  const listeners = new Set<() => void>();
  const changed = (): void => {
    snapshot = null;
    for (const listener of [...listeners]) listener();
  };
  const update = (path: string, patch: Partial<ScriptWorkflowEntry>): void => {
    entries = entries.map((entry) => (entry.path === path ? { ...entry, ...patch } : entry));
  };

  const findOpen = (path: string): OpenScriptProgram | undefined =>
    env.openPrograms().find((program) => program.path === path);
  const anyOpen = (path: string): boolean => env.openPrograms().some((program) => foldPath(program.path) === foldPath(path));
  const hasReviewedText = (editor: OpenScriptProgram | undefined, entry: ScriptWorkflowEntry): boolean =>
    editor !== undefined && editor.busy?.() !== true && editor.text() === entry.original;
  const projectChanged = "The selected project changed after the review; nothing further was written. Review the current project again.";
  const sourceChanged = (entry: ScriptWorkflowEntry): string =>
    `${entry.path} changed since the review (changed-since-review); it was not written. Run the workflow again.`;
  const destinationChanged = (entry: ScriptWorkflowEntry): string =>
    `${entry.destination} changed while the review was open or during the apply; it was not written. Run the workflow again.`;
  const readBytes = async (path: string): Promise<Uint8Array | null> => {
    const read = await env.fs.read(path);
    if (read.ok) return read.value;
    if (read.error.code === "not-found") return null;
    throw new Error(`Could not read ${path}: ${read.error.message}`);
  };
  const mainIsCurrent = async (): Promise<boolean> =>
    env.projectMainPath === undefined || sameBytes(await readBytes(env.projectMainPath), plan.mainBytes);
  interface PreparedWrite {
    readonly sourceBytes: Uint8Array | null;
    readonly before: Uint8Array | null;
    readonly bytes: Uint8Array;
  }
  const prepareWrite = async (entry: ScriptWorkflowEntry): Promise<PreparedWrite> => {
    if (env.isProjectCurrent?.() === false) throw new Error(projectChanged);
    if (!(await mainIsCurrent())) throw new Error(projectChanged);
    await requireExactPath(env.fs, entry.destination);
    if (entry.target === "copy") await requireExactPath(env.fs, entry.path);
    const before = plan.destinations.get(entry.destination) ?? null;
    const [sourceBytes, held] = entry.target === "in-place"
      ? await readBytes(entry.path).then((bytes) => [bytes, bytes] as const)
      : await Promise.all([readBytes(entry.path), readBytes(entry.destination)]);
    if (!sameBytes(held, before)) throw new Error(destinationChanged(entry));
    const opened = findOpen(entry.path);
    const openConflict = !entry.open && anyOpen(entry.path);
    if (entry.open ? !hasReviewedText(opened, entry) : openConflict || !sameBytes(sourceBytes, plan.sources.get(entry.path) ?? null)) {
      throw new Error(openConflict ? `${entry.path} was opened in an editor during the review; it was not written.` : sourceChanged(entry));
    }
    if (entry.target === "copy" && anyOpen(entry.destination)) throw new Error(`${entry.destination} is open in an editor; it was not written.`);
    const base = sourceBytes === null ? null : programCodec.read(sourceBytes, entry.path);
    if (base !== null && (!base.ok || base.value.compiled !== null)) throw new Error(`${entry.path} is no longer a readable text program.`);
    const model = base?.value ?? { text: "", breaks: [], compiled: null };
    const built = rewritten(model, entry.result!, `${SCRIPT_TRANSFORM_INFO[plan.transform].name} (reviewed)`);
    if (!built.ok) throw new Error(`${entry.path} could not be written: ${built.message}`);
    return { sourceBytes, before, bytes: built.bytes };
  };

  const applyOne = async (entry: ScriptWorkflowEntry, groupId: string | null, prepared: PreparedWrite | undefined): Promise<ApplyOneResult> => {
    if (env.isProjectCurrent?.() === false) return { failure: projectChanged };
    const result = entry.result!;
    const label = `${SCRIPT_TRANSFORM_INFO[plan.transform].name} (reviewed)`;
    await requireExactPath(env.fs, entry.destination);
    if (entry.open && entry.target === "in-place") {
      const [projectCurrent, saved] = await Promise.all([mainIsCurrent(), readBytes(entry.path)]);
      if (!projectCurrent || env.isProjectCurrent?.() === false) return { failure: projectChanged };
      await requireExactPath(env.fs, entry.path);
      if (env.isProjectCurrent?.() === false) return { failure: projectChanged };
      const currentEditor = findOpen(entry.path);
      if (saved?.[0] === 0 || currentEditor === undefined || !hasReviewedText(currentEditor, entry)) return { failure: sourceChanged(entry) };
      const done = await currentEditor.replace(label, result);
      return done.ok ? { via: "edit" } : { failure: `${entry.path} could not be edited: ${done.message}` };
    }
    if (prepared === undefined) return { failure: `${entry.destination} was not prepared for writing.` };
    const { before, sourceBytes, bytes } = prepared;
    if (entry.target === "copy") {
      await requireExactPath(env.fs, entry.path);
      const slash = entry.destination.lastIndexOf("/");
      const made = await env.fs.createFolder(entry.destination.slice(0, slash));
      if (!made.ok) return { failure: `Could not make the folder for ${entry.destination}: ${made.error.message}` };
    }
    await requireExactPath(env.fs, entry.destination);
    if (entry.target === "copy") await requireExactPath(env.fs, entry.path);
    // Compare live bytes after folder preparation, then make a final link/identity check before dispatching the write.
    // The provider's list/read/write calls are not a cross-file transaction.
    const [projectCurrent, source, destination] = await Promise.all([
      mainIsCurrent(),
      readBytes(entry.path),
      entry.target === "copy" ? readBytes(entry.destination) : Promise.resolve(before),
    ]);
    if (!projectCurrent) return { failure: projectChanged };
    if (!sameBytes(source, sourceBytes)) return { failure: sourceChanged(entry) };
    if (!sameBytes(destination, before)) return { failure: destinationChanged(entry) };
    if (entry.target === "copy") await requireExactPath(env.fs, entry.path);
    await requireExactPath(env.fs, entry.destination);
    const opened = findOpen(entry.path);
    const openConflict = !entry.open && anyOpen(entry.path);
    if (entry.open ? !hasReviewedText(opened, entry) : openConflict) {
      return { failure: openConflict ? `${entry.path} was opened in an editor during the apply; it was not written.` : sourceChanged(entry) };
    }
    if (entry.target === "copy" && anyOpen(entry.destination)) {
      return { failure: `${entry.destination} was opened in an editor during the apply; it was not written.` };
    }
    if (env.isProjectCurrent?.() === false) return { failure: projectChanged };
    const written = await env.fs.write(entry.destination, bytes);
    if (!written.ok) return { failure: `Could not write ${entry.destination}: ${written.error.message}. ${entry.path} is as it was.` };
    if (groupId !== null && env.history !== null) {
      const receiptFailed = (message: string): ApplyOneResult => ({
        via: entry.target === "copy" ? "copy" : "write",
        recoveryWarning: `${entry.destination} was written, but its recovery receipt could not be recorded: ${message}`,
      });
      try {
        const recorded = await env.history.written(groupId, entry.destination, bytes);
        if (!recorded.ok) return receiptFailed(recorded.message);
      } catch (error) {
        return receiptFailed(error instanceof Error ? error.message : String(error));
      }
    }
    return { via: entry.target === "copy" ? "copy" : "write" };
  };

  const session: ScriptReviewSession = {
    getSnapshot() {
      snapshot ??= { plan, entries, phase, outcome, selected: entries.filter((entry) => entry.state === "ready" && entry.included).length };
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setIncluded(path, included) {
      if (phase !== "reviewing") return;
      const entry = entries.find((candidate) => candidate.path === path);
      if (entry === undefined || entry.state !== "ready" || entry.included === included) return;
      update(path, { included });
      changed();
    },
    setAllIncluded(included) {
      if (phase !== "reviewing") return;
      entries = entries.map((entry) => (entry.state === "ready" ? { ...entry, included } : entry));
      changed();
    },
    cancel() {
      if (phase === "applying") return false;
      phase = "cancelled";
      changed();
      return true;
    },
    async apply() {
      if (phase !== "reviewing") return outcome ?? describe(entries, [], [], []);
      phase = "applying";
      changed();
      const chosen = entries.filter((entry) => entry.state === "ready" && entry.included);
      const applied: { path: string; destination: string; via: "edit" | "write" | "copy" }[] = [...(outcome?.applied ?? [])];
      const failed: ScriptApplyFailure[] = [];
      const recoveryWarnings = [...(outcome?.recoveryWarnings ?? [])];
      const prepared = new Map<string, PreparedWrite>();
      const toWrite = chosen.filter((entry) => !(entry.open && entry.target === "in-place"));
      for (const entry of toWrite) {
        try {
          prepared.set(entry.path, await prepareWrite(entry));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failed.push({ path: entry.path, message });
          update(entry.path, { message });
        }
      }
      let groupId: string | null = null;
      let blocked: string | null = null;
      if (prepared.size > 0 && env.history !== null) {
        if (env.history.prepareScripts === undefined) blocked = "This host cannot record the reviewed checkpoint. Nothing was written.";
        else {
          try {
            const targets = toWrite.flatMap((entry) => {
              const target = prepared.get(entry.path);
              return target === undefined ? [] : [{ path: entry.destination, bytes: target.bytes, expectedBefore: target.before }];
            });
            const group = await env.history.prepareScripts(`${SCRIPT_TRANSFORM_INFO[plan.transform].name} (reviewed)`, targets);
            if (group.ok) groupId = group.groupId;
            else blocked = `Its recovery checkpoint could not be recorded: ${group.message}. Nothing was written.`;
          } catch (error) {
            blocked = `Its recovery checkpoint could not be recorded: ${error instanceof Error ? error.message : String(error)}. Nothing was written.`;
          }
        }
      }
      for (const entry of chosen) {
        const saved = prepared.get(entry.path);
        if (saved === undefined && !(entry.open && entry.target === "in-place")) continue;
        if (blocked !== null) {
          failed.push({ path: entry.path, message: `${entry.path}: ${blocked}` });
          update(entry.path, { message: blocked });
          continue;
        }
        let done: ApplyOneResult;
        try {
          done = await applyOne(entry, groupId, saved);
        } catch (error) {
          done = { failure: `${entry.path} could not be applied: ${error instanceof Error ? error.message : String(error)}` };
        }
        if ("failure" in done) {
          failed.push({ path: entry.path, message: done.failure });
          update(entry.path, { message: done.failure });
        } else {
          applied.push({ path: entry.path, destination: entry.destination, via: done.via });
          if (done.recoveryWarning !== undefined) recoveryWarnings.push({ path: entry.path, message: done.recoveryWarning });
          update(entry.path, { state: "applied", message: done.recoveryWarning ?? (done.via === "edit" ? "Edited in the open editor; not saved yet." : done.via === "copy" ? `Written to ${entry.destination}.` : "Written.") });
        }
      }
      outcome = describe(entries, applied, failed, recoveryWarnings);
      // A failure keeps the review open, showing it, so the author can try again; otherwise the run is done.
      phase = failed.length > 0 ? "reviewing" : "done";
      changed();
      return outcome;
    },
  };
  return session;
}
