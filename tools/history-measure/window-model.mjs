// Pure arithmetic for the history merge-window measurement (ADR 0022 D12.8, story 11.14).
// No clock, no randomness: every number here follows from the inputs.

export const WINDOWS_SECONDS = [10, 60, 300];
export const SAVE_RATES_PER_HOUR = [60, 360, 3600];

const HOUR_MS = 3_600_000;

// Autosave saves arrive at a constant rate for one hour. A merge window opens at
// its first save and absorbs every save made within `windowSeconds` after it; the
// next save after that opens a new entry. Returns how many entries the hour creates.
export function entriesPerHour(savesPerHour, windowSeconds) {
  if (!Number.isInteger(savesPerHour) || savesPerHour < 1) {
    throw new RangeError(`savesPerHour must be a positive integer, got ${savesPerHour}`);
  }
  if (!(windowSeconds > 0)) {
    throw new RangeError(`windowSeconds must be positive, got ${windowSeconds}`);
  }
  const windowMs = windowSeconds * 1000;
  const intervalMs = HOUR_MS / savesPerHour;
  let entries = 0;
  let windowOpenedAt = Number.NEGATIVE_INFINITY;
  for (let save = 0; save < savesPerHour; save++) {
    const at = save * intervalMs;
    if (at >= windowOpenedAt + windowMs) {
      entries++;
      windowOpenedAt = at;
    }
  }
  return entries;
}

// Sorted-copy statistics. Median averages the two middle values for an even count;
// p90 uses nearest rank.
export function distribution(values) {
  if (values.length === 0) {
    throw new RangeError("distribution needs at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const middle = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const p90Rank = Math.ceil(0.9 * n);
  return {
    count: n,
    min: sorted[0],
    median: middle,
    p90: sorted[p90Rank - 1],
    max: sorted[n - 1],
    sum: sorted.reduce((total, value) => total + value, 0),
  };
}
