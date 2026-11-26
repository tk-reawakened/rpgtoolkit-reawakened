// What's New is composed from the changelog's Unreleased list. The help window makes only this repository's HTTPS links
// clickable, so a changelog's repository-relative destination is rewritten to the same file's absolute URL here; a writer
// keeps using the repository-relative spelling the rest of the changelog uses (#3527, #3537).

export const REPOSITORY_BLOB = "https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/main/";
export const CHANGELOG_URL = `${REPOSITORY_BLOB}CHANGELOG.md`;

/** How many Unreleased entries the in-editor notes carry; the rest stay in the full changelog. */
export const WHATS_NEW_LIMIT = 12;

export function absoluteRepositoryLinks(markdown) {
  return markdown.replace(/\]\((?!https?:\/\/)([^)\s]+)\)/g, (_match, target) => `](${REPOSITORY_BLOB}${target})`);
}

/**
 * The What's New document for one changelog's Unreleased entries. `source` names the changelog in error messages, so a
 * caller can test this with its own text.
 */
export function whatsNewNotes(changelogMarkdown, source = "CHANGELOG.md") {
  const lines = changelogMarkdown.split(/\r?\n/);
  if (lines[0] !== "# Changelog") throw new Error(`Unexpected changelog heading in ${source}`);
  if (lines[2] !== "## Unreleased") throw new Error(`Missing Unreleased section in ${source}`);
  const nextHeading = lines.findIndex((line, index) => index > 2 && /^## /.test(line));
  const notes = lines.slice(3, nextHeading < 0 ? undefined : nextHeading).filter((line) => line.startsWith("- "));
  if (notes.length === 0) throw new Error(`Missing non-empty Unreleased section in ${source}`);
  return `# What's New\n\n${absoluteRepositoryLinks(notes.slice(0, WHATS_NEW_LIMIT).join("\n\n"))}\n\n[Read the full changelog](${CHANGELOG_URL}).`;
}
