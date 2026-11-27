/**
 * Which open documents stop a packaging run (`docs/spec/formats/packaging-and-paths.md#distribution-package-this-projects-own`,
 * ADR 0022 D4.2). Packaging reads saved files, so it refuses while any document is dirty and never saves them itself: a
 * save would write edits the author may have cancelled the export to keep unsaved. This module imports no VS Code API so
 * the rule is testable without a host.
 */
export interface PackagingInputDocument {
  readonly identity: { readonly path: string };
  getSnapshot(): { readonly dirty: boolean };
}

/** Documents whose unsaved edits would not reach the package. */
export function dirtyPackagingDocuments(documents: readonly PackagingInputDocument[]): readonly string[] {
  return documents.filter((document) => document.getSnapshot().dirty).map((document) => document.identity.path);
}
