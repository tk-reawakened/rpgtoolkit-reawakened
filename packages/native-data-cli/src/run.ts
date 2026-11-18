/**
 * `tkr-native-check`: the command-line front end of the native document checker.
 *
 * It reads a folder and reports problems. It never writes, moves or repairs a
 * file. Exit codes: 0 nothing to report, 1 problems found, 2 usage error, 3 the
 * folder could not be read.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { checkDocuments, formatReport, REGISTRY, validateConfig, type CheckConfig, type CheckReport } from "@tk-reawakened/native-data";
import { collectDocuments } from "./walk.ts";

export const RESULT_SCHEMA = "tkr-native-check/1";

export type CliResult = {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly stdout: string;
  readonly stderr: string;
};

const REGISTERED = REGISTRY.map((entry) => entry.extension).join(", ");

export const HELP = `tkr-native-check: find broken documents in a folder of native game data

In plain words: it reads every native document in a folder and reports missing or
malformed stamps, duplicate IDs, paths that fold to one ID, extension/contract
mismatches, and malformed plugin-data blocks. Plugin data is preserved and only its
envelope is checked. It only reports and never changes a file. Classic legacy files
(.anm, .brd, .tem, .itm, .ene, .tst and the rest) are not native documents: it does
not read or report them, so a legacy file and a native document with the same name
can sit in one folder.

Exactly: reads files under the folder whose names end in a native document extension
(${REGISTERED}), as UTF-8 YAML, and writes nothing. A file with any other extension
is skipped unread, an unregistered tkr extension included. A document's ID is its
path below the folder, separated by "/", with the extension kept:
"clips/walk.tkranm". IDs are compared with only the letters A to Z folded to a to z.

Usage:
  tkr-native-check [options] FOLDER

Options:
  --ext .EXT            read files with this extension as documents instead; repeat for
                        several (default: ${REGISTERED})
  --json                print one JSON result instead of lines of text
  --help                print this text

Exit codes: 0 nothing to report, 1 problems found, 2 usage error, 3 folder not readable.
`;

type Parsed =
  | { readonly ok: true; readonly folder: string; readonly config: CheckConfig; readonly json: boolean }
  | { readonly ok: false; readonly help: boolean; readonly message: string };

function parse(argv: readonly string[]): Parsed {
  const extensions: string[] = [];
  let json = false;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") return { ok: false, help: true, message: "" };
    if (argument === "--json") json = true;
    else if (argument === "--ext") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false, help: false, message: `${argument} needs a value` };
      index += 1;
      extensions.push(value);
    } else if (argument.startsWith("-")) return { ok: false, help: false, message: `unknown option ${argument}` };
    else positional.push(argument);
  }
  if (positional.length !== 1) return { ok: false, help: false, message: "give exactly one folder to check" };
  const config: CheckConfig = extensions.length === 0 ? {} : { documentExtensions: extensions };
  try {
    validateConfig(config);
  } catch (error) {
    return { ok: false, help: false, message: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, folder: positional[0]!, config, json };
}

function describe(reports: readonly CheckReport[], documents: number): string {
  return `${documents} document${documents === 1 ? "" : "s"} checked, ${reports.length} problem${reports.length === 1 ? "" : "s"} found`;
}

export function runCli(argv: readonly string[]): CliResult {
  const parsed = parse(argv);
  if (!parsed.ok) {
    if (parsed.help) return { exitCode: 0, stdout: HELP, stderr: "" };
    return { exitCode: 2, stdout: "", stderr: `tkr-native-check: ${parsed.message}\n\n${HELP}` };
  }
  const root = resolve(parsed.folder);
  try {
    if (!statSync(root).isDirectory()) throw new Error("not a folder");
  } catch (error) {
    return { exitCode: 3, stdout: "", stderr: `tkr-native-check: cannot read the folder ${parsed.folder}: ${error instanceof Error ? error.message : String(error)}\n` };
  }
  let documents;
  try {
    documents = collectDocuments(root, parsed.config.documentExtensions);
  } catch (error) {
    return { exitCode: 3, stdout: "", stderr: `tkr-native-check: cannot read ${parsed.folder}: ${error instanceof Error ? error.message : String(error)}\n` };
  }
  const reports = checkDocuments(documents, parsed.config);
  const exitCode = reports.length === 0 ? 0 : 1;
  if (parsed.json) {
    const result = { schema: RESULT_SCHEMA, documents: documents.length, problems: reports.length, reports };
    return { exitCode, stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: "" };
  }
  const lines = reports.map(formatReport);
  return { exitCode, stdout: `${[...lines, describe(reports, documents.length)].join("\n")}\n`, stderr: "" };
}
