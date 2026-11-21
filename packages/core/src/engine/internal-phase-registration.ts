import type { EnginePhaseRegistration } from "./engine.ts";

const internalPhaseRegistrations = new WeakSet<EnginePhaseRegistration>();

/** Mark trusted core-owned callbacks that cannot observe canonical screen bytes. */
export function markInternalPhaseRegistration<T extends EnginePhaseRegistration>(registration: T): T {
  internalPhaseRegistrations.add(registration);
  return registration;
}

export function isInternalPhaseRegistration(registration: EnginePhaseRegistration): boolean {
  return internalPhaseRegistrations.has(registration);
}
