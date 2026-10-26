import type { BattleOwner, BattleOperationResult } from "./port.ts";
import { createHostObject } from "../script/objects.ts";
import { ScriptError } from "../script/errors.ts";
import type { HostObjectContext, HostObjectType } from "../script/host.ts";
import type { ObjectRecord, VmState } from "../script/state.ts";
import type { Value } from "../ports/value.ts";

export const BATTLE_HOST_TYPE = "battle";

/** Reuse the one empty host record saved for the global battle capability. */
export function registerBattleObject(vm: VmState): ObjectRecord {
  return vm.objects.find((record) => record.hostType === BATTLE_HOST_TYPE) ?? createHostObject(vm, BATTLE_HOST_TYPE);
}

function resolve<T>(result: BattleOperationResult<T>): T {
  if (!result.ok) throw new ScriptError(result.error.code, result.error.message);
  return result.value;
}


/** Hydrated global battle methods and live, read-only battle-section fields. */
export function createBattleHostType(): HostObjectType {
  return {
    name: BATTLE_HOST_TYPE,
    methods: {
      partySize: "__battle_party_size",
      partysize: "__battle_party_size",
      fighter: "__battle_fighter",
      charge: "__battle_charge",
      addCharge: "__battle_add_charge",
      addcharge: "__battle_add_charge",
      setCharge: "__battle_set_charge",
      setcharge: "__battle_set_charge",
      releaseCharge: "__battle_release_charge",
      releasecharge: "__battle_release_charge",
      chargePercent: "__battle_charge_percent",
      chargepercent: "__battle_charge_percent",
      finish: "__battle_finish",
    },
    read(context: HostObjectContext, name: string): Value | undefined {
      const owner = context.battle;
      if (owner === undefined) throw new ScriptError("battle.not-active", "there is no active battle");
      switch (name.toLowerCase()) {
        case "canrun": return resolve(owner.canRun()) ? 1 : 0;
        case "outcome": return resolve(owner.outcome());
        default: return undefined;
      }
    },
    write() {
      return "read-only";
    },
    readOnlyMembers: ["canRun", "outcome"],
    remove() {
      return "system-owned";
    },
  };
}
