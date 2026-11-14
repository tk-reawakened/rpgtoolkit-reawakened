/**
 * Edits a view has accepted from the user but has not yet finished handing to its document (#2613).
 *
 * A view may not be able to give a command to the document at once: it can apply commands one after another, so that a
 * command built from the latest snapshot sees the one before it, and an adapter (a webview talking to its extension
 * host) acknowledges each command later. Until the view's last command is acknowledged, the document is not what the
 * user sees, and saving, closing, reverting or backing it up would leave the later edits out without a word.
 *
 * The view therefore registers its work here. Every path that reads or writes the document as a whole (save all, close,
 * revert, Save As, VS Code's save, backup and close) first waits for `settle`. The registry is DOM-free, so the browser
 * host's workspace and a VS Code webview use the same one.
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
