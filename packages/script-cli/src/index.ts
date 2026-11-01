/**
 * `@tk-reawakened/script-cli` — the `tkr script` command-line front end.
 *
 * The public surface is the argument parser and the subcommand runners, so
 * tests can exercise them without spawning a process.
 */

export { parseArgs } from "./args.ts";
export type { ParsedArgs } from "./args.ts";
export { runCheck } from "./commands/check.ts";
export type { CheckResult } from "./commands/check.ts";
export { runDocs } from "./commands/docs.ts";
export type { DocsResult } from "./commands/docs.ts";
export { runFmt } from "./commands/fmt.ts";
export type { FmtResult } from "./commands/fmt.ts";
export { runIndex } from "./commands/index.ts";
export type { IndexResult } from "./commands/index.ts";
export { runTest } from "./commands/test.ts";
export type { TestResult } from "./commands/test.ts";
export { isScriptResult, makeResult, RESULT_SCHEMA, stableStringify, TOOL_NAME } from "./result.ts";
export type { ResultDiagnostic, ScriptResult, Subcommand, Summary } from "./result.ts";
