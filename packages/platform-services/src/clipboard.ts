import { platformError, platformOk, type PlatformResult } from "./result.ts";

/**
 * The `clipboard` surface of AD-20, as far as story 13.13 needs it: the plain text of the system clipboard. An editor
 * puts its own versioned JSON there and reads it back, so a copy in one editor window can be pasted into another. A
 * host that cannot read or write the system clipboard does not provide this service and does not declare the `clipboard`
 * capability; an editor then says so and keeps the data it has, and never keeps a private clipboard of its own.
 */
export interface ClipboardService {
  /** The text on the clipboard (`""` when it holds none). A refused read is `permission-denied`. */
  readText(): Promise<PlatformResult<string>>;
  /** Replace the clipboard's text. A refused write changes nothing and is `permission-denied`. */
  writeText(text: string): Promise<PlatformResult<void>>;
}

/** The asynchronous clipboard API of a browser, as far as it is used (`navigator.clipboard`), with no DOM dependency. */
export interface ClipboardApi {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}

/**
 * A `ClipboardService` over a browser-style asynchronous clipboard, or `null` when the page has none. A rejection (the
 * page lacks focus or the user denied the permission) becomes `permission-denied`, never a thrown error.
 */
export function clipboardFromApi(api: ClipboardApi | null | undefined): ClipboardService | null {
  if (api === null || api === undefined || typeof api.readText !== "function" || typeof api.writeText !== "function") return null;
  return {
    async readText() {
      try {
        return platformOk(await api.readText());
      } catch {
        return platformError("permission-denied", "The browser did not allow reading the clipboard. Click the board and try again, or allow clipboard access for this page.");
      }
    },
    async writeText(text) {
      try {
        await api.writeText(text);
        return platformOk(undefined);
      } catch {
        return platformError("permission-denied", "The browser did not allow writing to the clipboard. Click the board and try again, or allow clipboard access for this page.");
      }
    },
  };
}
