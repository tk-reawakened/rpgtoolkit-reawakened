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

/** One view's submitted-but-unacknowledged edits. */
export interface PendingEditWork {
  /** Whether the view holds a submitted edit the document has not acknowledged. */
  busy(): boolean;
  /** Resolves once `busy()` is false. It never rejects: an edit the document refused is reported by the view itself. */
  idle(): Promise<void>;
}

/** What a view needs to take part: register its work, and wait for every view's work (its own Save waits for its siblings). */
export interface PendingEdits {
  /** Take part until the returned function is called. */
  register(work: PendingEditWork): () => void;
  /** Whether any registered view is busy. */
  busy(): boolean;
  /** Resolves once no registered view is busy, including work submitted while waiting. */
  settle(): Promise<void>;
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
    async settle() {
      while (busy()) await Promise.all([...works].filter((work) => work.busy()).map((work) => work.idle()));
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
