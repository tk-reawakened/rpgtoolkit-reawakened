import { actorId, getActor, patchActor as patchActorModel, type ActorId, type ActorRecord, type ActorStats, type ActorsSection } from "./model.ts";
import {
  advanceStatus,
  applyActorStatus,
  applyEquipment,
  awardExperience,
  beginLegacyBattleExperienceAward,
  completeLegacyBattleLevelStep,
  removeActorStatus,
  updateActorStats,
  type ActorHooks,
  type ActorSource,
  type AdvanceStatusOptions,
  type ActorRuleResult,
  type EquipmentItemDefinition,
  type LegacyBattleExperiencePlan,
  type LegacyBattleLevelStep,
  type StatsChangeOptions,
  type StatusChangeOptions,
} from "./rules.ts";
import type { ActorEventSink } from "./object.ts";
import type { HostObjectType } from "../script/host.ts";
import type { Value } from "../ports/value.ts";
/**
 * The actor-owned stats path used by legacy aliases (AD-10, E-85).
 *
 * Reads return the owner-held stats record rather than copying it into
 * `vm.globals`; writes replace that record through the actor owner.
 */
export type StatsPort = {
  read(actor: ActorId | number): Readonly<ActorStats> | null;
  write(actor: ActorId | number, patch: Partial<ActorStats>): boolean;
};

export type ActorOperationService = {
  updateStats(actor: ActorId | number, patch: Partial<ActorStats>, options: Omit<StatsChangeOptions, "hooks">): ActorRuleResult | null;
  /** Apply damage or healing through the actor owner; only `smp` selects SMP, all other pools use HP. */
  damage(actor: ActorId | number, amount: number, source?: ActorSource, pool?: string): number | null;
  /** Replace or start a status counter by identity through the actor owner and emit its ordinary transition. */
  applyStatus(actor: ActorId | number, status: string, rounds: number, options?: Omit<StatusChangeOptions, "hooks">): ActorRuleResult | null;
  /** Remove a matching status identity through the actor owner; an absent identity is a no-op. */
  removeStatus(actor: ActorId | number, status: string, options?: Omit<StatusChangeOptions, "hooks">): ActorRuleResult | null;
  advanceStatus(actor: ActorId | number, amount: number, options?: Omit<AdvanceStatusOptions, "hooks">): ActorRuleResult | null;
  applyEquipment(actor: ActorId | number, equipped: readonly string[], items: readonly EquipmentItemDefinition[]): ActorRuleResult | null;
  awardExperience(actor: ActorId | number, amount: number): ActorRuleResult | null;
  /** Add battle XP before legacy level-up programs, then apply growth one ordered step at a time. */
  beginLegacyBattleExperience(actor: ActorId | number, amount: number): LegacyBattleExperiencePlan | null;
  completeLegacyBattleLevelStep(actor: ActorId | number, remainingExperience: number): LegacyBattleLevelStep | null;
};

export type ActorService = StatsPort & ActorOperationService & {
  readActor(actor: ActorId | number): Readonly<ActorRecord> | null;
  rename(actor: ActorId | number, name: string): Readonly<ActorRecord> | null;
  activeActor(): Readonly<ActorRecord> | null;
  hooks(actor: ActorId | number): ActorHooks;
};
/** Create the owner service over the one authoritative actor section. */
export function createActorService(
  section: ActorsSection,
  resolveHooks: (actor: Readonly<ActorRecord>) => ActorHooks = () => ({}),
  events?: ActorEventSink,
): ActorService {
  const hooksFor = (actor: ActorId | number): ActorHooks => {
    const record = getActor(section, actorId(actor));
    return record === null ? {} : resolveHooks(record);
  };
  const stats = createStatsPort(section, (record) => resolveHooks(record), events);
  return {
    read(actor) {
      return stats.read(actor);
    },
    write(actor, patch) {
      const result = updateActorStats(section, actor, patch, { cause: "script", hooks: hooksFor(actor) });
      if (result !== null) events?.(result);
      return result !== null;
    },
    updateStats(actor, patch, options) {
      const result = updateActorStats(section, actor, patch, { ...options, hooks: hooksFor(actor) });
      if (result !== null) events?.(result);
      return result;
    },
    damage(actor, amount, source = null, pool = "hp") {
      if (!Number.isFinite(amount)) throw new RangeError("damage amount must be finite");
      const record = getActor(section, actorId(actor));
      if (record === null) return null;
      const field = pool === "smp" ? "smp" : "hp";
      const before = record.stats[field];
      const result = updateActorStats(section, actor, { [field]: before - amount }, { cause: "damage", source, hooks: hooksFor(actor) });
      if (result === null) return null;
      events?.(result);
      return before - result.actor.stats[field];
    },
    applyStatus(actor, status, rounds, options = {}) {
      const result = applyActorStatus(section, actor, status, rounds, { ...options, hooks: hooksFor(actor) });
      if (result !== null) events?.(result);
      return result;
    },
    removeStatus(actor, status, options = {}) {
      const result = removeActorStatus(section, actor, status, { ...options, hooks: hooksFor(actor) });
      if (result !== null) events?.(result);
      return result;
    },
    advanceStatus(actor, amount, options = {}) {
      const result = advanceStatus(section, actor, amount, { ...options, hooks: hooksFor(actor) });
      if (result !== null) events?.(result);
      return result;
    },
    applyEquipment(actor, equipped, items) {
      const result = applyEquipment(section, actor, equipped, items, hooksFor(actor));
      if (result !== null) events?.(result);
      return result;
    },
    awardExperience(actor, amount) {
      const result = awardExperience(section, actor, amount, hooksFor(actor));
      if (result !== null) events?.(result);
      return result;
    },
    beginLegacyBattleExperience(actor, amount) {
      return beginLegacyBattleExperienceAward(section, actor, amount);
    },
    completeLegacyBattleLevelStep(actor, remainingExperience) {
      const result = completeLegacyBattleLevelStep(section, actor, remainingExperience, hooksFor(actor));
      if (result !== null && result.transitions.length > 0) events?.({ actor: result.actor, transitions: result.transitions });
      return result;
    },
    readActor(actor) {
      return getActor(section, actorId(actor));
    },
    rename(actor, name) {
      return patchActorModel(section, actorId(actor), { name });
    },
    activeActor() {
      const party = section.actors.find((candidate) => candidate.kind === "party");
      return party ?? section.actors[0] ?? null;
    },
    hooks(actor) {
      return hooksFor(actor);
    },
  };
}

/** Create the StatsPort view over the one authoritative actor section. */

export function createStatsPort(
  section: ActorsSection,
  resolveHooks: (actor: Readonly<ActorRecord>) => ActorHooks = () => ({}),
  events?: ActorEventSink,
): StatsPort {
  return {
    read(actor) {
      return getActor(section, actorId(actor))?.stats ?? null;
    },
    write(actor, patch) {
      const record = getActor(section, actorId(actor));
      const result = updateActorStats(section, actor, patch, { cause: "script", hooks: record === null ? {} : resolveHooks(record) });
      if (result !== null) events?.(result);
      return result !== null;
    },
  };
}

const ACTOR_STAT_FIELDS: Readonly<Record<string, keyof ActorStats>> = {
  experience: "experience",
  hp: "hp",
  maxhp: "maxHp",
  dp: "dp",
  fp: "fp",
  smp: "smp",
  maxsmp: "maxSmp",
  level: "level",
  criticalon: "criticalOn",
  criticalby: "criticalBy",
};

function actorIdFromEmitter(context: { readonly events: { readonly emitters?: Readonly<Record<string, number>> }; readonly record: { readonly handle: number } }): ActorId | null {
  for (const [key, handle] of Object.entries(context.events.emitters ?? {})) {
    if (handle !== context.record.handle || !key.startsWith("actor:")) continue;
    const parsed = Number(key.slice("actor:".length));
    if (Number.isSafeInteger(parsed) && parsed > 0) return actorId(parsed);
  }
  return null;
}

/** Build the generic OOP-12 actor host type with owner-backed data hooks. */
export function createActorHostType(service: ActorService): HostObjectType {
  return {
    name: "actor",
    methods: { damage: "actor_damage" },
    read(context, name): Value | undefined {
      const id = actorIdFromEmitter(context);
      if (id === null) return undefined;
      const actor = service.readActor(id);
      if (actor === null) return undefined;
      const stat = ACTOR_STAT_FIELDS[name.toLowerCase()];
      if (stat !== undefined) return actor.stats[stat];
      switch (name.toLowerCase()) {
        case "id":
          return actor.id;
        case "kind":
          return actor.kind;
        case "source":
          return actor.source;
        case "name":
          return actor.name;
        case "behaviour":
          return actor.behaviour ?? "";
        default:
          return undefined;
      }
    },
    write(context, name, value) {
      const id = actorIdFromEmitter(context);
      if (id === null) return "not-host";
      const actor = service.readActor(id);
      if (actor === null) return "not-host";
      const stat = ACTOR_STAT_FIELDS[name.toLowerCase()];
      if (stat !== undefined && typeof value === "number") {
        const result = service.updateStats(id, { [stat]: value } as Partial<ActorStats>, { cause: "script" });
        return result === null ? "not-host" : "written";
      }
      if (name.toLowerCase() === "name" && typeof value === "string") {
        service.rename(id, value);
        return "written";
      }
      return "read-only";
    },
    remove() {
      return "system-owned";
    },
  };
}
