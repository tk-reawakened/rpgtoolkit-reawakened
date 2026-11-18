import type { Diagnostic } from "../ports/engine.ts";
import type { ActorRecord } from "./model.ts";
import type { ActorHooks } from "./rules.ts";
import type { ResolvedPlugin } from "../script/plugin.ts";
/** The closed core hook surface. */
export const ACTOR_BEHAVIOUR_HOOKS = ["levelUp", "revive", "statusChanged", "equipmentChanged", "statsChanged"] as const;
export type ActorBehaviourHook = (typeof ACTOR_BEHAVIOUR_HOOKS)[number];

/** Package-scoped actor behaviour registrar accepted by the registry. */
type BehaviourRegistryRegistrar = (name: string, hooks: unknown) => boolean;

/** A package's session-only behaviour definition. */
export type BehaviourDefinition = {
  readonly name: string;
  readonly hooks: ActorHooks;
};

/** Session registry; never part of game or actor save state. */
export type BehaviourRegistrySnapshot = {
  readonly definitions: readonly BehaviourDefinition[];
  readonly registrationsClosed: boolean;
};

/** Session registry; never part of game or actor save state. */
export type BehaviourRegistry = {
  /**
   * Host-only owner-scoped registration capability. Package code receives a
   * namespace-bound `BehaviourRegistrar` through `behaviourStartup`, never
   * this method directly.
   */
  readonly registerForNamespace: (namespace: string, name: string, hooks: unknown) => boolean;
  /** Close all callback registrars after the startup pass. */
  readonly closeRegistrations: () => void;
  /** Discard package registrations after an aborted startup pass. */
  readonly clearRegistrations: () => void;
  /** Capture and restore an aborted startup pass without losing prior definitions. */
  readonly snapshot: () => BehaviourRegistrySnapshot;
  readonly restore: (snapshot: BehaviourRegistrySnapshot) => void;
  readonly resolve: (name: string | null | undefined) => ActorHooks;
  readonly definitions: () => readonly BehaviourDefinition[];
  readonly missingReported: (name: string) => boolean;
};

const NAME = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.([A-Za-z][A-Za-z0-9_]*)$/;

function diagnostic(diagnostics: Diagnostic[] | undefined, code: string, message: string): void {
  diagnostics?.push({ code, file: "<package startup>", line: 0, message });
}

/** Register package-scoped startup contributions in manifest order. */
export function registerPackageBehaviours(registry: BehaviourRegistry, plugins: readonly ResolvedPlugin[]): void {
  try {
    for (const plugin of plugins) {
      const namespace = plugin.namespace ?? plugin.definition.id.slice(plugin.definition.id.lastIndexOf(".") + 1);
      const register = (name: string, hooks: ActorHooks): boolean => registry.registerForNamespace(namespace, name, hooks);
      plugin.definition.behaviourStartup?.(register);
    }
  } finally {
    registry.closeRegistrations();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Create a fresh registry for one boot/reset/restore session. */
export function createBehaviourRegistry(
  namespaces: readonly string[] = [],
  diagnostics?: Diagnostic[],
  defaults: ActorHooks = {},
): BehaviourRegistry {
  const allowed = new Set(namespaces);
  const definitions = new Map<string, BehaviourDefinition>();
  const missing = new Set<string>();
  let registrationsClosed = false;
  const register = (ownerNamespace: string, name: string, hooks: unknown): boolean => {
    if (registrationsClosed) {
      diagnostic(diagnostics, "behaviour.startup-closed", "behaviour registrar is no longer active after package startup");
      return false;
    }
    const match = typeof name === "string" ? NAME.exec(name) : null;
    if (match === null) {
      diagnostic(diagnostics, "behaviour.malformed-name", `behaviour name ${JSON.stringify(name)} must use namespace.name with a lower-case hyphenated namespace`);
      return false;
    }
    const namespace = match[1]!;
    if (!allowed.has(ownerNamespace) || namespace !== ownerNamespace) {
      diagnostic(diagnostics, "behaviour.namespace", `behaviour ${JSON.stringify(name)} is not owned by package namespace ${JSON.stringify(ownerNamespace)}`);
      return false;
    }
    if (!isPlainObject(hooks)) {
      diagnostic(diagnostics, "behaviour.hooks", `behaviour ${JSON.stringify(name)} hooks must be a plain dictionary`);
      return false;
    }
    const result: ActorHooks = {};
    for (const key of Reflect.ownKeys(hooks)) {
      const descriptor = Object.getOwnPropertyDescriptor(hooks, key);
      if (
        typeof key !== "string" ||
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor) ||
        !(ACTOR_BEHAVIOUR_HOOKS as readonly string[]).includes(key)
      ) {
        diagnostic(diagnostics, "behaviour.unknown-hook", `behaviour ${JSON.stringify(name)} has unknown or non-enumerable hook ${typeof key === "string" ? JSON.stringify(key) : String(key)}`);
        return false;
      }
      if (typeof descriptor.value !== "function") {
        diagnostic(diagnostics, "behaviour.hook", `behaviour ${JSON.stringify(name)} hook ${JSON.stringify(key)} must be callable`);
        return false;
      }
      (result as Record<string, unknown>)[key] = descriptor.value;
    }
    if (definitions.has(name)) {
      diagnostic(diagnostics, "behaviour.duplicate", `behaviour ${JSON.stringify(name)} is already registered`);
      return false;
    }
    definitions.set(name, { name, hooks: result });
    return true;
  };
  const registerForNamespace = (namespace: string, name: string, hooks: unknown): boolean => register(namespace, name, hooks);
  const resolve = (name: string | null | undefined): ActorHooks => {
    if (name === null || name === undefined || name === "") return defaults;
    return definitions.get(name)?.hooks ?? defaults;
  };
  const missingReported = (name: string): boolean => {
    if (missing.has(name)) return true;
    missing.add(name);
    return false;
  };
  const closeRegistrations = (): void => { registrationsClosed = true; };
  const clearRegistrations = (): void => {
    definitions.clear();
    missing.clear();
    registrationsClosed = true;
  };
  const snapshot = (): BehaviourRegistrySnapshot => ({
    definitions: [...definitions.values()],
    registrationsClosed,
  });
  const restore = (saved: BehaviourRegistrySnapshot): void => {
    definitions.clear();
    for (const definition of saved.definitions) definitions.set(definition.name, definition);
    missing.clear();
    registrationsClosed = saved.registrationsClosed;
  };
  return { registerForNamespace, closeRegistrations, clearRegistrations, snapshot, restore, resolve, definitions: () => [...definitions.values()], missingReported };
}

/** Resolve actor hooks and report one diagnostic when the saved name is absent. */
export function resolveBehaviour(
  registry: BehaviourRegistry,
  actor: Pick<ActorRecord, "behaviour">,
  diagnostics?: Diagnostic[],
): ActorHooks {
  if (actor.behaviour === null || actor.behaviour === undefined || actor.behaviour === "") return registry.resolve(actor.behaviour);
  const found = registry.definitions().some((definition) => definition.name === actor.behaviour);
  if (!found && !registry.missingReported(actor.behaviour)) diagnostic(diagnostics, "behaviour.missing", `actor behaviour ${JSON.stringify(actor.behaviour)} is not registered; using core defaults`);
  return registry.resolve(actor.behaviour);
}


