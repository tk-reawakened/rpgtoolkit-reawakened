/**
 * Every first-party plugin definition the engine registers, as one list for tools
 * that need the *whole* command catalogue rather than a boot manifest.
 *
 * The engine's boot table (`ENGINE_PLUGIN_TABLE`) holds only the definitions a
 * host starts from; the UI, graphics, movement, battle and stock-RPG packs are
 * registered alongside it. A linter or a language server that consulted only the
 * boot table would report registered commands such as `get` and `clearbuffer` as
 * unknown, so the tooling reads this list instead
 * (docs/spec/engine/rpgcode-tooling.md#tool-3).
 */

import { BATTLE_PLUGIN } from "./packs/battle.ts";
import { GRAPHICS_PLUGIN } from "./packs/graphics.ts";
import { MOVEMENT_PLUGIN } from "./packs/movement.ts";
import { UI_PLUGIN } from "./packs/ui.ts";
import { STOCK_RPG_PLUGIN } from "./stock-rpg.ts";
import { ENGINE_PLUGIN_TABLE } from "./engine-plugins.ts";
import type { PluginDefinition } from "./plugin.ts";

/** The tooling's catalogue: the engine table plus the packs a host registers beside it. */
export const FIRST_PARTY_PLUGINS: readonly PluginDefinition[] = [
  ...Object.values(ENGINE_PLUGIN_TABLE),
  UI_PLUGIN,
  GRAPHICS_PLUGIN,
  MOVEMENT_PLUGIN,
  BATTLE_PLUGIN,
  STOCK_RPG_PLUGIN,
];
