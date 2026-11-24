/**
 * Edits a view has submitted to its document but has not yet received a result for (#2613).
 *
 * A webview's document calls are asynchronous. A view can submit several commands before their acknowledgements return;
 * until each request has answered, the view's status and error feedback are unsettled. Save, close, revert and backup
 * wait for currently attached views to finish those requests before reading or writing the document.
 *
 * The view registers its in-flight work here. The registry is DOM-free, so the browser host's workspace and a VS Code
 * webview use the same one.
 */

/**
 * Why a host is settling a view's work (ADR 0022 D11.2). An explicit save (Save, Save All, Ctrl+S, a save-on-close)
 * applies the field the author is still typing in; autosave and a hot-exit backup must not commit mid-gesture; `query`
 * asks only for the dirty state, before a revert's question; `revert` drops text typed against the version being
 * discarded. A caller that passes nothing keeps the behaviour this registry had before the reason existed.
 */
export type SettleReason = "explicit" | "autosave" | "revert" | "query";

/** What a settlement found: `ok` when nothing refused, else the first refusal's sentence for the host to show. */
export type SettleOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** One view's submitted-but-unacknowledged edits. */
export interface PendingEditWork {
  /** Whether the view holds a submitted edit the document has not acknowledged. */
  busy(): boolean;
  /** Resolves once `busy()` is false. It never rejects: an edit the document refused is reported by the view itself. */
  idle(reason?: SettleReason): Promise<void>;
  /** Work the host must not save through (a field the file cannot store); `null` when there is none. */
  refusal?(): string | null;
}

/** What a view needs to take part: register its work, and wait for every view's work (its own Save waits for its siblings). */
export interface PendingEdits {
  /** Take part until the returned function is called. */
  register(work: PendingEditWork): () => void;
  /** Whether any registered view is busy. */
  busy(): boolean;
  /** Resolves once no registered view is busy, including work submitted while waiting, and says whether one refused. */
  settle(reason?: SettleReason): Promise<SettleOutcome>;
}

function refusalOf(works: readonly PendingEditWork[]): SettleOutcome {
  for (const work of works) {
    const message = work.refusal?.();
    if (message !== undefined && message !== null) return { ok: false, message };
  }
  return { ok: true };
}

export function createPendingEdits(): PendingEdits {
  const works = new Set<PendingEditWork>();
  const busy = (): boolean => [...works].some((work) => work.busy());
  return {
    register(work) {
      works.add(work);
      return () => void works.delete(work);
    },
    busy,
    async settle(reason) {
      // Every registered view hears the reason, busy or not: an explicit save applies the field being typed in, which no
      // view reports as busy because the document does not hold it yet.
      for (let round = 0; round < 8; round += 1) {
        const registered = [...works];
        if (registered.length === 0) return { ok: true };
        await Promise.all(registered.map((work) => work.idle(reason)));
        if (!busy()) return refusalOf(registered);
      }
      return refusalOf([...works]);
    },
  };
}
export interface EditTracker extends PendingEditWork {
  begin(): () => void;
}

export function createEditTracker(): EditTracker {
  let count = 0;
  let waiters: Array<() => void> = [];
  return {
    busy: () => count > 0,
    idle: () => (count === 0 ? Promise.resolve() : new Promise<void>((resolve) => { waiters.push(resolve); })),
    begin() {
      count += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        count -= 1;
        if (count === 0) {
          const ready = waiters;
          waiters = [];
          for (const resolve of ready) resolve();
        }
      };
    },
  };
}
