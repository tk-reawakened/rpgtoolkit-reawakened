/**
 * Minimal argv parser for `tkr script`. Global flags are recognised everywhere;
 * each subcommand owns its positional paths and optional `--out`.
 */

export type ParsedArgs = {
  readonly subcommand: string;
  readonly paths: readonly string[];
  readonly json: boolean;
  readonly check: boolean;
  readonly out: string | null;
  readonly dialect: "tk3" | "tk2";
  readonly strict: boolean;
};

export function parseArgs(argv: readonly string[]): { readonly ok: true; readonly args: ParsedArgs } | { readonly ok: false; readonly message: string } {
  const args = argv.slice(2);
  if (args.length === 0) return { ok: false, message: "usage: tkr script <check|fmt|test|docs|index> [options] <paths...>" };

  const subcommand: "check" | "fmt" | "test" | "docs" | "index" = args[0] as "check" | "fmt" | "test" | "docs" | "index";
  if (subcommand !== "check" && subcommand !== "fmt" && subcommand !== "test" && subcommand !== "docs" && subcommand !== "index") {
    return { ok: false, message: `unknown subcommand: ${subcommand}` };
  }

  let json = false;
  let check = false;
  let out: string | null = null;
  let dialect: "tk3" | "tk2" = "tk3";
  let strict = true;
  const paths: string[] = [];

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") {
      json = true;
    } else if (arg === "--check") {
      check = true;
    } else if (arg === "--out") {
      const value = args[index + 1];
      if (value === undefined) return { ok: false, message: "--out requires a value" };
      out = value;
      index += 1;
    } else if (arg.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    } else if (arg === "--dialect") {
      const value = args[index + 1];
      if (value !== "tk3" && value !== "tk2") return { ok: false, message: "--dialect must be tk3 or tk2" };
      dialect = value;
      index += 1;
    } else if (arg.startsWith("--dialect=")) {
      const value = arg.slice("--dialect=".length);
      if (value !== "tk3" && value !== "tk2") return { ok: false, message: "--dialect must be tk3 or tk2" };
      dialect = value;
    } else if (arg === "--no-strict") {
      strict = false;
    } else if (arg.startsWith("-")) {
      return { ok: false, message: `unknown option: ${arg}` };
    } else {
      paths.push(arg);
    }
  }

  if (subcommand === "test" && paths.length === 0) {
    // test defaults to the current working directory if no path is given.
    paths.push(".");
  }

  if (paths.length === 0 && subcommand !== "test" && subcommand !== "docs") {
    return { ok: false, message: `tkr script ${subcommand}: at least one path is required` };
  }

  return {
    ok: true,
    args: {
      subcommand,
      paths,
      json,
      check,
      out,
      dialect,
      strict,
    },
  };
}
