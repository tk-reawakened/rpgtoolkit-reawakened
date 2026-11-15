import type { PlatformResult } from "./result.ts";

/**
 * One message of the Language Server Protocol: a JSON-RPC 2.0 request, response or notification as a plain object, with
 * no framing (no `Content-Length` header). `platform-services` imports no LSP library, so the message is typed only as
 * far as the transport needs; the client and the server agree on what is inside.
 */
export type LanguageMessage = Readonly<Record<string, unknown>>;

/** Why a connection ended. `disposed` is the client's own `dispose()`; the others are the host reporting a failure. */
export interface LanguageClosed {
  readonly reason: "disposed" | "server-stopped" | "transport-error";
  /** One sentence for a status line; empty when the client closed it. */
  readonly message: string;
}

/** What the running project is, for a server that analyses a program against it (docs/spec/engine/rpgcode-tooling.md#tool-1-project). */
export interface LanguageConnectOptions {
  /** The project-relative path of the running project's `.gam`, or `null` when none is selected (documents are then unassessed). */
  readonly project: { readonly main: string } | null;
}

/** One live session with a language server. The host delivers the running project to the server itself. */
export interface LanguageConnection {
  /** Send a message to the server. Messages sent after the connection ended are dropped. */
  send(message: LanguageMessage): void;
  /** Receive the messages the server sends. The returned function removes the listener. */
  onMessage(listener: (message: LanguageMessage) => void): () => void;
  /**
   * Be told once when the connection ends, for any reason, including a listener added after it ended (which is called
   * at once). After it, `send` does nothing and no message arrives.
   */
  onClose(listener: (closed: LanguageClosed) => void): () => void;
  /** End the session and release the server. Calling it again does nothing. */
  dispose(): void;
}

/**
 * The `language` surface of AD-20 (`language.connect()`), present only with the `languageServer` capability. A program
 * editor is a client of the server in every host that has one; a host that cannot run a server leaves the capability
 * out and the editor edits without language features.
 */
export interface LanguageService {
  /** Start one session. `unavailable` when the host could not start a server; the editor then edits without it. */
  connect(options: LanguageConnectOptions): Promise<PlatformResult<LanguageConnection>>;
}
