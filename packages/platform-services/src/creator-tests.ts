import type { PlatformResult } from "./result.ts";
import type { RunStartGuard } from "./run.ts";

/** The host-only save and navigation doors of saved RPGCode tests (ADR 0022 D8/D9; TOOL-5). */
export interface SavedTestsHostService {
  /** Identity of the project whose saved bytes the filesystem serves. */
  readonly project: string;
  /** Save accepted work, refuse failed/racing saves, and return the final synchronous snapshot-start check. */
  prepare(): Promise<PlatformResult<RunStartGuard>>;
  /** Open the owning program in its existing editor at a one-based source location, never a parallel text model. */
  openSource(path: string, line: number, column: number): Promise<PlatformResult<void>>;
}
