/**
 * The help projection (docs/spec/engine/rpgcode-tooling.md#tool-3 and the
 * AGENTS.md help-text rule).
 *
 * Help comes from one source: `commandDocumentation()`, the projection of the
 * registered plugin metadata that the command-docs gate already validates. This
 * module shapes that list for a reader - one entry per name and per alias, with
 * `isAlias` stated once - and answers "what is this command?" for a hover or a
 * call tip. It reads no file and no catalogue: the caller supplies the resolved
 * plugin definitions exactly as the engine registers them.
 */

import {
  commandDocumentation,
  foldAscii,
  type CommandDocumentation,
  type ResolvedPlugin,
} from "@tk-reawakened/core";

/** One documented name: a command, or one of its aliases. */
export type HelpEntry = CommandDocumentation & {
  /** True when this entry is an alias spelling rather than the canonical name. */
  readonly isAlias: boolean;
};

/** Every documented name, in registration order, each command followed by its aliases. */
export function projectHelp(plugins: readonly ResolvedPlugin[]): readonly HelpEntry[] {
  return commandDocumentation(plugins).map((doc) => ({
    ...doc,
    isAlias: doc.name !== doc.canonicalName,
  }));
}

/**
 * The entry for one spelling, folded the way RPGCode folds identifiers (LEX-10),
 * or `null` when no registered command has that name or alias.
 */
export function helpFor(plugins: readonly ResolvedPlugin[], name: string): HelpEntry | null {
  const folded = foldAscii(name);
  for (const entry of projectHelp(plugins)) {
    if (foldAscii(entry.name) === folded) return entry;
  }
  return null;
}
