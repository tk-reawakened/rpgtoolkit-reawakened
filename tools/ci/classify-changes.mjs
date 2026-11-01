// This function only classifies paths; it does not change CI scheduling.
// The caller must supply both sides of renames (for example, git diff
// --no-renames --name-only -z) and treat diff/decoding errors as full runs.

/**
 * Return whether a PR needs all expensive CI steps. Only the explicitly
 * allowlisted prose and planning paths are inert. A caller must provide a
 * complete repository-relative path list and the GitHub event name.
 *
 * @param {unknown} paths
 * @param {unknown} eventName
 * @returns {{ runExpensive: boolean }}
 */
export function classifyChanges(paths, eventName) {
  if (eventName !== "pull_request" || !Array.isArray(paths) || paths.length === 0) {
    return { runExpensive: true };
  }

  for (const path of paths) {
    if (typeof path !== "string" || !isValidPath(path) || !isInertPath(path)) {
      return { runExpensive: true };
    }
  }
  return { runExpensive: false };
}

function isValidPath(path) {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/[\x00-\x1f\x7f\ufffd]/u.test(path) &&
    !/^[a-z]:/iu.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

function isInertPath(path) {
  // These exclusions take precedence even for Markdown and future expansions
  // to the allowlist. Their content is executable, normative, or test data.
  if (/^(?:packages|tools|stock|golden)\//u.test(path) || path.startsWith("docs/spec/") || path.startsWith(".github/workflows/")) {
    return false;
  }

  return (
    (!path.includes("/") && path.endsWith(".md")) ||
    path === "docs/guardrails.md" ||
    (path.startsWith("docs/adr/") && path.endsWith(".md")) ||
    (path.startsWith("_bmad-output/") && path.endsWith(".md")) ||
    /^\.github\/ISSUE_TEMPLATE\/.+\.(?:md|yml|yaml)$/u.test(path)
  );
}
