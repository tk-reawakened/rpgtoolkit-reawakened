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
 * Why a host is settling a view's work (ADR 0022 D11.2): an explicit save (Save, Save All, Ctrl+S, a save-on-close)
 * applies the field the author is still typing in; autosave and a hot-exit backup must not commit mid-gesture; a revert
 * drops text typed against the version being discarded.
 */
export type SettleReason = "explicit" | "autosave" | "revert";

/** One view's submitted-but-unacknowledged edits. */
export interface PendingEditWork {
  /** Whether the view holds a submitted edit the document has not acknowledged. */
  busy(): boolean;
  /** Resolves once `busy()` is false. It never rejects: an edit the document refused is reported by the view itself. */
  idle(reason?: SettleReason): Promise<void>;
}

/** What a view needs to take part: register its work, and wait for every view's work (its own Save waits for its siblings). */
export interface PendingEdits {
  /** Take part until the returned function is called. */
  register(work: PendingEditWork): () => void;
  /** Whether any registered view is busy. */
  busy(): boolean;
  /** Resolves once no registered view is busy, including work submitted while waiting. */
  settle(reason?: SettleReason): Promise<void>;
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
    async settle(reason = "explicit") {
      // Every registered view hears the reason, busy or not: an explicit save applies the field being typed in, which is
      // work no view reports as busy because the document does not hold it yet.
      for (let round = 0; round < 8; round += 1) {
        const registered = [...works];
        if (registered.length === 0) return;
        await Promise.all(registered.map((work) => work.idle(reason)));
        if (!busy()) return;
      }
    },
  };
}

/** The counter a view keeps for its own submissions: `begin` when a user's edit is accepted, call the result when the document has answered. */
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
