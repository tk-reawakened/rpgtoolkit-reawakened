import { createEditTracker, type BoardCommand, type PendingEdits } from "@tk-reawakened/editor-model";
import type { DocumentEdited } from "@tk-reawakened/platform-services";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BoardViewDocument } from "./mount.ts";

export interface BoardSubmit {
  /** Apply one command as one edit; `false` (with `message` set) when it is refused. */
  readonly submit: (command: BoardCommand) => Promise<boolean>;
  readonly message: string | null;
  readonly clearMessage: () => void;
  readonly setMessage: (text: string | null) => void;
  readonly busy: boolean;
}

/**
 * Apply board commands from a panel or the canvas through one path: the edit is tracked so a save waits for it, the edit is
 * announced to the host, and a refusal becomes a message and changes nothing (ADR 0022).
 */
export function useBoardSubmit(doc: BoardViewDocument, onEdited: (event: DocumentEdited) => void, pendingEdits: PendingEdits, fallbackLabel: string): BoardSubmit {
  const tracker = useRef(createEditTracker());
  useEffect(() => pendingEdits.register(tracker.current), [pendingEdits]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (command: BoardCommand): Promise<boolean> => {
    const finish = tracker.current.begin();
    setBusy(true);
    setMessage(null);
    try {
      const result = await doc.apply(command);
      if (!result.ok) {
        setMessage(result.rejection.message);
        return false;
      }
      const edit = doc.getSnapshot().edits.find((entry) => entry.editId === result.editId);
      onEdited({ document: doc.identity.key, editId: result.editId, label: edit?.label ?? fallbackLabel });
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finish();
      setBusy(false);
    }
  };
  return { submit, message, clearMessage: () => setMessage(null), setMessage, busy };
}
