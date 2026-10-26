import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FULL_SUITE = Object.freeze({ full: true, bun: true });

function isInertPath(path) {
  return (
    path === "docs/guardrails.md" ||
    path.startsWith("docs/adr/") ||
    (path.endsWith(".md") && !path.includes("/")) ||
    path.startsWith("_bmad-output/") ||
    path === ".github/pull_request_template.md" ||
    path.startsWith(".github/ISSUE_TEMPLATE/")
  );
}

function isRootBunInput(path) {
  return (
    path === "package.json" ||
    path === "pnpm-lock.yaml" ||
    (!path.includes("/") && path.startsWith("tsconfig"))
  );
}

function isStockRpgCode(path) {
  return path.startsWith("stock/") && /\.(?:prg|rnc)$/i.test(path);
}

function isKnownNodeSuitePath(path) {
  return path.startsWith("docs/spec/") || isStockRpgCode(path);
}

function isKnownBunPath(path) {
  return (
    path.startsWith("packages/") ||
    path.startsWith("golden/") ||
    path.startsWith("tools/") ||
    path.startsWith(".github/workflows/") ||
    isRootBunInput(path)
  );
}

/**
 * Classify repository-relative paths from `git diff --name-only`.
 * Unknown paths and invalid inputs select the complete suite.
 *
 * @param {unknown} paths
 * @param {{ forceFull?: boolean } | null} [options]
 * @returns {{ full: boolean, bun: boolean }}
 */
export function classifyChanges(paths, options = {}) {
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      return { ...FULL_SUITE };
    }
    const forceFull = options.forceFull === true;
    if (
      !Array.isArray(paths) ||
      !paths.every(
        (path) =>
          typeof path === "string" &&
          path.length > 0 &&
          !path.startsWith("/") &&
          !path.includes("\\") &&
          !path.split("/").includes(".."),
      )
    ) {
      return { ...FULL_SUITE };
    }

    if (forceFull || paths.length === 0) return { ...FULL_SUITE };

    let full = false;
    let bun = false;
    for (const path of paths) {
      if (isInertPath(path)) continue;
      full = true;
      if (isKnownBunPath(path)) {
        bun = true;
      } else if (!isKnownNodeSuitePath(path)) {
        // Fail closed for paths whose effect has not been classified yet.
        bun = true;
      }
    }

    return { full, bun };
  } catch {
    return { ...FULL_SUITE };
  }
}

/** Parse the NUL-delimited output of `git diff --name-only -z`. */
export function parseNameOnlyZ(input) {
  if (typeof input !== "string") throw new TypeError("diff input must be a string");
  if (input === "") return [];
  if (!input.endsWith("\0")) throw new Error("diff path list is not NUL-terminated");

  const paths = input.slice(0, -1).split("\0");
  if (paths.some((path) => path.length === 0)) throw new Error("diff path list contains an empty path");
  return paths;
}

function writeResult(result, outputPath) {
  if (outputPath) {
    appendFileSync(outputPath, `full=${result.full}\nbun=${result.bun}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

function runCli() {
  const args = process.argv.slice(2);
  const forceFull = args.length === 1 && args[0] === "--force-full";
  const validArgs = args.length === 0 || forceFull;
  let result;

  try {
    if (!validArgs) throw new Error("usage: classify-changes.mjs [--force-full]");
    const paths = parseNameOnlyZ(readFileSync(0, "utf8"));
    result = classifyChanges(paths, {
      forceFull: forceFull || process.env.GITHUB_EVENT_NAME === "push",
    });
  } catch {
    result = { ...FULL_SUITE };
  }

  try {
    writeResult(result, process.env.GITHUB_OUTPUT);
  } catch {
    // Keep the classification visible locally if the Actions output file cannot be written.
    process.stdout.write(`${JSON.stringify(FULL_SUITE)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
