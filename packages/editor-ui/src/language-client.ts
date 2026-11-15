import type { LanguageConnectOptions, LanguageConnection, LanguageMessage, LanguageService } from "@tk-reawakened/platform-services";

/**
 * The program editor's client of the language server (AD-20, docs/spec/engine/rpgcode-tooling.md#tool-10-connect): a
 * small JSON-RPC 2.0 client over the plain messages `language.connect()` carries. It knows the handshake, requests,
 * notifications and the server's end, and nothing about RPGCode; the program view says what to ask.
 */

export interface LanguageClient {
  /** Ask the server. Rejects with the server's message, or when the connection ends first. */
  request<T>(method: string, params: Readonly<Record<string, unknown>>): Promise<T>;
  notify(method: string, params: Readonly<Record<string, unknown>>): void;
  /** Listen to a notification the server sends; the returned function stops listening. */
  onNotification(method: string, handler: (params: unknown) => void): () => void;
  /** The URI the server knows the project file `path` by. */
  uriOf(path: string): string;
  /** Be told once if the connection ends (a listener added after it ended is called at once). */
  onClose(listener: (message: string) => void): () => void;
  dispose(): void;
}

function messageOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}

/** Connect and finish the `initialize` handshake; rejects when either fails. */
export async function startLanguageClient(service: LanguageService, options: LanguageConnectOptions): Promise<LanguageClient> {
  const connected = await service.connect(options);
  if (!connected.ok) throw new Error(connected.error.message);
  const connection: LanguageConnection = connected.value;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  const closers = new Set<(message: string) => void>();
  let nextId = 1;
  let closedWith: string | null = null;

  const failPending = (message: string): void => {
    for (const waiter of pending.values()) waiter.reject(new Error(message));
    pending.clear();
  };
  connection.onMessage((message: LanguageMessage) => {
    const { id, method } = message;
    if (typeof method === "string") {
      if (id !== undefined) {
        // A request from the server: this client declares no capability a server could call, so it answers "not found".
        connection.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
      }
      for (const handler of [...(handlers.get(method) ?? [])]) handler(message.params);
      return;
    }
    if (typeof id !== "number") return;
    const waiter = pending.get(id);
    if (waiter === undefined) return;
    pending.delete(id);
    if (message.error !== undefined) waiter.reject(new Error(messageOf(message.error)));
    else waiter.resolve(message.result);
  });
  connection.onClose((closed) => {
    closedWith = closed.message === "" ? "The language server stopped." : closed.message;
    failPending(closedWith);
    for (const closer of [...closers]) closer(closedWith);
    closers.clear();
  });

  const client: LanguageClient = {
    request<T>(method: string, params: Readonly<Record<string, unknown>>): Promise<T> {
      if (closedWith !== null) return Promise.reject(new Error(closedWith));
      const id = nextId;
      nextId += 1;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        connection.send({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params) {
      connection.send({ jsonrpc: "2.0", method, params });
    },
    onNotification(method, handler) {
      let set = handlers.get(method);
      if (set === undefined) {
        set = new Set();
        handlers.set(method, set);
      }
      set.add(handler);
      return () => void set.delete(handler);
    },
    uriOf: (path) => connection.uriOf(path),
    onClose(listener) {
      if (closedWith !== null) {
        listener(closedWith);
        return () => {};
      }
      closers.add(listener);
      return () => void closers.delete(listener);
    },
    dispose() {
      connection.dispose();
    },
  };
  try {
    await client.request("initialize", { processId: null, rootUri: null, capabilities: {} });
    client.notify("initialized", {});
  } catch (error) {
    connection.dispose();
    throw new Error(`The language server did not start: ${messageOf(error)}`);
  }
  return client;
}

/** A shared client for one language service and running project, counted so views of many programs use one server. */
export interface LanguageLease {
  readonly client: LanguageClient;
  /** Give the client back. The last lease to go ends the session after `idleMs`, so switching tabs does not restart the server. */
  release(): void;
}

interface SharedClient {
  readonly ready: Promise<LanguageClient>;
  leases: number;
  idle: ReturnType<typeof setTimeout> | null;
}

const shared = new WeakMap<LanguageService, Map<string, SharedClient>>();

/** How long a client with no views stays connected (milliseconds). */
export const LANGUAGE_IDLE_MS = 5000;

/**
 * Lease the shared client of `service` for the running project `project`, starting it on first use. A failure is returned
 * as a value (`{ ok: false }`) and is not remembered, so the next lease tries again.
 */
export async function leaseLanguageClient(
  service: LanguageService,
  project: LanguageConnectOptions["project"],
  idleMs: number = LANGUAGE_IDLE_MS,
): Promise<{ readonly ok: true; readonly lease: LanguageLease } | { readonly ok: false; readonly message: string }> {
  let byProject = shared.get(service);
  if (byProject === undefined) {
    byProject = new Map();
    shared.set(service, byProject);
  }
  const key = project === null ? "" : `main:${project.main}`;
  let entry = byProject.get(key);
  if (entry === undefined) {
    const fresh: SharedClient = { ready: startLanguageClient(service, { project }), leases: 0, idle: null };
    entry = fresh;
    byProject.set(key, fresh);
    const forget = (): void => {
      if (byProject.get(key) === fresh) byProject.delete(key);
    };
    fresh.ready.then((client) => void client.onClose(forget), forget);
  }
  const taken = entry;
  taken.leases += 1;
  if (taken.idle !== null) {
    clearTimeout(taken.idle);
    taken.idle = null;
  }
  let client: LanguageClient;
  try {
    client = await taken.ready;
  } catch (error) {
    taken.leases -= 1;
    return { ok: false, message: messageOf(error) };
  }
  let released = false;
  return {
    ok: true,
    lease: {
      client,
      release() {
        if (released) return;
        released = true;
        taken.leases -= 1;
        if (taken.leases > 0) return;
        const end = (): void => {
          taken.idle = null;
          if (byProject.get(key) === taken) byProject.delete(key);
          client.dispose();
        };
        if (idleMs <= 0) end();
        else taken.idle = setTimeout(end, idleMs);
      },
    },
  };
}
