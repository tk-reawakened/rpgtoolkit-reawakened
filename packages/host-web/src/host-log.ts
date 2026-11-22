/** A host failure, recorded with the operation it came from so the cause can be found later. */
export interface HostErrorRecord {
  readonly scope: string;
  readonly name: string;
  readonly message: string;
  readonly at: number;
}

const MAX_RECORDS = 50;
const records: HostErrorRecord[] = [];

/**
 * Log a host failure to the console and keep it for telemetry. `scope` names the operation (for example
 * `projects.open`), so a report says where it happened, not only what failed.
 */
export function reportHostError(scope: string, error: unknown): void {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : String(error);
  const record: HostErrorRecord = { scope, name, message, at: Date.now() };
  records.push(record);
  if (records.length > MAX_RECORDS) records.shift();
  console.error(`[tkr-host] ${scope}: ${name}: ${message}`, error);
}

/** The most recent host failures, oldest first. */
export function hostErrors(): readonly HostErrorRecord[] {
  return [...records];
}
