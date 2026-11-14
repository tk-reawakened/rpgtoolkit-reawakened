import type { AssetKind } from "@tk-reawakened/core";
import type { Capabilities, DialogService, FileSystemService } from "@tk-reawakened/platform-services";
import {
  copyIntoReservedFolder,
  listCandidates,
  reservedFolder,
  type AssetCandidate,
  type ListFailure,
  type ProjectLayout,
} from "./reserved-folders.ts";

/**
 * A folder-aware asset picker (T-05): the files of one reserved folder and its sub-folders, one selection, and a way to
 * bring a file in from outside the project. Choosing is explicit: a selection changes nothing until the user confirms
 * it, and cancelling (or a dismissed question) leaves the reference exactly as it was, unresolved if it was (story 11.4).
 * It holds no document and writes only the one copied file; the caller stores the reference it is given.
 */

export interface AssetPickerOptions {
  readonly services: {
    readonly fs: FileSystemService;
    readonly dialogs: DialogService;
    readonly capabilities: Capabilities;
  };
  readonly layout: ProjectLayout;
  readonly kind: AssetKind;
  /** Lower-case extensions with the dot that this field accepts; empty accepts every file. */
  readonly extensions: readonly string[];
  /** What the field is called, in words for the confirmation: "the tile set", "the board link". */
  readonly field: string;
}

export interface AssetPickerSnapshot {
  readonly folder: string;
  readonly candidates: readonly AssetCandidate[];
  /** Folders that could not be read; a host failure is shown, never hidden as an empty list. */
  readonly failures: readonly ListFailure[];
  /** The reference the user has selected and not yet confirmed. */
  readonly selected: string | null;
  readonly phase: "browsing" | "busy" | "closed";
  /** Why the last action did nothing or failed, in a sentence safe to show; `null` when it is not news. */
  readonly message: string | null;
  /** `null` when the host can choose a file from outside the project; otherwise why it cannot. */
  readonly outsideUnavailable: string | null;
}

export type PickOutcome =
  /** The reference to store. For a copy it is the new file's link. */
  | { readonly chosen: true; readonly reference: string }
  /** Nothing was chosen; the field keeps what it had. */
  | { readonly chosen: false };

export interface AssetPicker {
  getSnapshot(): AssetPickerSnapshot;
  subscribe(listener: () => void): () => void;
  /** Read the folder again. */
  refresh(): Promise<void>;
  /** Select a candidate (or `null` for none). Changes nothing else. */
  select(reference: string | null): void;
  /** Ask the user to confirm the selection; resolves with the outcome. Without a selection it resolves unchosen and says why. */
  confirm(): Promise<PickOutcome>;
  /** Choose a file from outside the project, and (after the user agrees) copy it into the folder and choose it. */
  pickOutside(subfolder?: string): Promise<PickOutcome>;
  /** Close without choosing. */
  cancel(): PickOutcome;
}

export function createAssetPicker(options: AssetPickerOptions): AssetPicker {
  const { services, layout, kind, extensions, field } = options;
  const folder = reservedFolder(layout, kind);
  const listeners = new Set<() => void>();
  const outsideUnavailable = !services.capabilities.has("pickFile") || services.dialogs.pickFile === undefined
    ? "This host cannot choose a file from outside the project. Put the file in the project's folder first."
    : null;
  let snapshot: AssetPickerSnapshot = { folder, candidates: [], failures: [], selected: null, phase: "browsing", message: null, outsideUnavailable };
  let generation = 0;

  const publish = (next: Partial<AssetPickerSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A view that cannot update is that view's fault; the snapshot it missed is still current.
      }
    }
  };
  const closed = (): boolean => snapshot.phase === "closed";

  const picker: AssetPicker = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async refresh() {
      const mine = ++generation;
      const listed = await listCandidates(services.fs, layout, kind, extensions);
      if (mine !== generation || closed()) return;
      // A selection whose file has gone is dropped, so the user is never asked to confirm a file that is not there.
      const stillThere = snapshot.selected !== null && listed.candidates.some((candidate) => candidate.reference === snapshot.selected);
      publish({
        candidates: listed.candidates,
        failures: listed.failures,
        selected: stillThere ? snapshot.selected : null,
        message: listed.failures.length > 0 ? `Could not read ${listed.failures.map((failure) => failure.path).join(", ")}: ${listed.failures[0]!.error.message}` : null,
      });
    },
    select(reference) {
      if (closed()) return;
      const known = reference === null || snapshot.candidates.some((candidate) => candidate.reference === reference);
      publish({ selected: known ? reference : snapshot.selected, message: known ? null : `${reference} is not in ${folder}.` });
    },
    async confirm() {
      const reference = snapshot.selected;
      if (closed() || snapshot.phase === "busy") return { chosen: false };
      if (reference === null) {
        publish({ message: `Select a file first; nothing is attached to ${field} until you confirm one.` });
        return { chosen: false };
      }
      publish({ phase: "busy", message: null });
      const answer = await services.dialogs.ask({
        message: `Use ${reference} for ${field}?`,
        detail: `Use stores the link ${reference}. Cancel changes nothing.`,
        choices: [{ id: "use", label: "Use it" }, { id: "cancel", label: "Cancel" }],
        cancel: "cancel",
      });
      if (closed()) return { chosen: false };
      if (answer !== "use") {
        publish({ phase: "browsing" });
        return { chosen: false };
      }
      publish({ phase: "closed" });
      return { chosen: true, reference };
    },
    async pickOutside(subfolder = "") {
      if (closed() || snapshot.phase === "busy") return { chosen: false };
      const pick = services.dialogs.pickFile;
      if (outsideUnavailable !== null || pick === undefined) {
        publish({ message: outsideUnavailable ?? "This host cannot choose a file from outside the project." });
        return { chosen: false };
      }
      publish({ phase: "busy", message: null });
      const file = await pick.call(services.dialogs, { title: `Choose a file for ${field}`, extensions });
      if (closed()) return { chosen: false };
      if (file === null) {
        publish({ phase: "browsing" });
        return { chosen: false };
      }
      const answer = await services.dialogs.ask({
        message: `Copy ${file.name} into ${folder} and use it for ${field}?`,
        detail: "The original file stays where it is. Cancel copies nothing and changes nothing.",
        choices: [{ id: "copy", label: "Copy and use" }, { id: "cancel", label: "Cancel" }],
        cancel: "cancel",
      });
      if (closed()) return { chosen: false };
      if (answer !== "copy") {
        publish({ phase: "browsing" });
        return { chosen: false };
      }
      const copied = await copyIntoReservedFolder({ fs: services.fs, dialogs: services.dialogs }, layout, kind, file, subfolder);
      if (closed()) return { chosen: false };
      if (!copied.ok) {
        publish({ phase: "browsing", message: copied.reason === "cancelled" ? null : copied.message });
        return { chosen: false };
      }
      publish({ phase: "closed" });
      return { chosen: true, reference: copied.reference };
    },
    cancel() {
      if (!closed()) publish({ phase: "closed", message: null });
      return { chosen: false };
    },
  };
  return picker;
}
