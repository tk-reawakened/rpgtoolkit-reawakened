import type { HistoryPolicy } from "./document-history.ts";

/**
 * The retention settings of ADR 0022 D12.8 and their defaults. The ids are fixed by D12.8; the values are those ADR 0022
 * D12.11 records from the measured 2026-11-16 editing-hour trace (10 s merge, 24 h autosave floor, 1 GiB warning, 8 MiB
 * covered-file cap). They are user-only editor settings (D6.3): a project-layer value for any of them is ignored.
 */
export const HISTORY_SETTING_IDS = {
  mergeSeconds: "history.autosaveMergeSeconds",
  floorHours: "history.autosaveFloorHours",
  warnMiB: "history.warnAtMiB",
  maxFileMiB: "history.maxCoveredFileMiB",
  offerIgnore: "history.offerIgnore",
} as const;

const SECOND = 1000;
const HOUR = 3_600_000;
const MIB = 1_048_576;

export const HISTORY_DEFAULTS = {
  mergeSeconds: 10,
  floorHours: 24,
  warnMiB: 1024,
  maxFileMiB: 8,
} as const;

export const DEFAULT_HISTORY_POLICY: HistoryPolicy = {
  mergeWindowMs: HISTORY_DEFAULTS.mergeSeconds * SECOND,
  autoFloorMs: HISTORY_DEFAULTS.floorHours * HOUR,
  warnBytes: HISTORY_DEFAULTS.warnMiB * MIB,
  maxCoveredBytes: HISTORY_DEFAULTS.maxFileMiB * MIB,
};

/** The policy the effective value of each history setting gives. A value that is not a number keeps its default. */
export function historyPolicyFrom(value: (id: string) => unknown): HistoryPolicy {
  const number = (id: string, fallback: number, unit: number): number => {
    const raw = value(id);
    return typeof raw === "number" && Number.isFinite(raw) ? raw * unit : fallback * unit;
  };
  return {
    mergeWindowMs: number(HISTORY_SETTING_IDS.mergeSeconds, HISTORY_DEFAULTS.mergeSeconds, SECOND),
    autoFloorMs: number(HISTORY_SETTING_IDS.floorHours, HISTORY_DEFAULTS.floorHours, HOUR),
    warnBytes: number(HISTORY_SETTING_IDS.warnMiB, HISTORY_DEFAULTS.warnMiB, MIB),
    maxCoveredBytes: number(HISTORY_SETTING_IDS.maxFileMiB, HISTORY_DEFAULTS.maxFileMiB, MIB),
  };
}
