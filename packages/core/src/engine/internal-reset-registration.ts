import type { EngineResetRegistration } from "./engine.ts";

const internalResetRegistrations = new WeakSet<EngineResetRegistration>();

/** Mark trusted engine-owned reset callbacks that cannot inspect screen pixels. */
export function markInternalResetRegistration<T extends EngineResetRegistration>(registration: T): T {
  internalResetRegistrations.add(registration);
  return registration;
}

export function isInternalResetRegistration(registration: EngineResetRegistration): boolean {
  return internalResetRegistrations.has(registration);
}
