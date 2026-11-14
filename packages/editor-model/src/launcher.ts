import { LAUNCH_CAPABILITY, type Launch, type LaunchKind, type PlatformServices, type RunHandle } from "@tk-reawakened/platform-services";
import type { DocumentWorkspace } from "./workspace.ts";

/**
 * Starting a run from the editor (T-07, T-41; ADR 0022 D8). The launcher is the one place the editor's rules for a run
 * live, so every host and every view applies them the same way:
 *
 * 1. A launch the host cannot do is refused with the host's own reason, before anything is saved (D8.6).
 * 2. **Save before run** (D8.2, owner ruling 2026-11-09): every document with unsaved work is saved first. If a save
 *    fails, nothing runs and the refusal names the document; if an edit lands while saving, nothing runs either, because
 *    the run would not be what the creator sees. Nothing is ever run from unsaved memory.
 * 3. The host reads the saved files once and returns a handle with the run's snapshot (D8.3); later edits never reach
 *    that run (D8.4). Running again is a new launch and a new snapshot.
 */

/** Why a launch did not start. */
export type LaunchRefusal =
  /** The host cannot do this kind of launch (D8.6). */
  | { readonly reason: "unavailable"; readonly message: string }
  /** A document could not be saved, so the run would read a stale revision (D8.2). */
  | { readonly reason: "save-failed"; readonly document: string; readonly message: string }
  /** A document still has unsaved work after saving (an edit made while it saved). */
  | { readonly reason: "unsaved"; readonly document: string; readonly message: string }
  /** The host refused the launch itself: a file it names is missing, or its arguments are malformed. */
  | { readonly reason: "refused"; readonly message: string };

export type LaunchOutcome = { readonly ok: true; readonly handle: RunHandle } | ({ readonly ok: false } & LaunchRefusal);

export interface Launcher {
  /** `null` when this host can do `kind`, otherwise the sentence that says why not (D8.6). */
  unavailable(kind: LaunchKind): string | null;
  /** Save, then start the launch. The promise never rejects: a refusal is a value with its reason. */
  launch(launch: Launch): Promise<LaunchOutcome>;
}

export interface LauncherOptions {
  readonly services: Pick<PlatformServices, "capabilities" | "run">;
  /** The documents a run reads: they are saved before it and checked for unsaved work after. */
  readonly workspace: Pick<DocumentWorkspace, "saveAll" | "documents">;
}

const WHAT: Readonly<Record<LaunchKind, string>> = {
  game: "run the game from its start-up",
  board: "start a board test",
  program: "run a program test",
};

export function createLauncher({ services, workspace }: LauncherOptions): Launcher {
  const unavailable = (kind: LaunchKind): string | null => {
    if (services.run !== undefined && services.capabilities.has(LAUNCH_CAPABILITY[kind])) return null;
    const reason = services.run?.unavailable[kind] ?? "it has no game runner.";
    return `This host cannot ${WHAT[kind]}: ${reason}`;
  };
  return {
    unavailable,
    async launch(launch) {
      const refused = unavailable(launch.kind);
      const run = services.run;
      if (refused !== null || run === undefined) return { ok: false, reason: "unavailable", message: refused ?? "" };
      for (const entry of await workspace.saveAll()) {
        if (!entry.result.ok) {
          return {
            ok: false,
            reason: "save-failed",
            document: entry.document,
            message: `${entry.document} could not be saved (${entry.result.failure.message}), so nothing was run: the run would not use your latest changes.`,
          };
        }
      }
      const dirty = workspace.documents().find((document) => document.getSnapshot().dirty);
      if (dirty !== undefined) {
        const document = dirty.identity.path;
        return { ok: false, reason: "unsaved", document, message: `${document} changed while it was being saved, so nothing was run. Save it and run again.` };
      }
      const started = launch.kind === "program" ? await run.startProgram(launch) : await run.startGame(launch);
      if (!started.ok) {
        return started.error.code === "unavailable"
          ? { ok: false, reason: "unavailable", message: started.error.message }
          : { ok: false, reason: "refused", message: started.error.message };
      }
      return { ok: true, handle: started.value };
    },
  };
}
