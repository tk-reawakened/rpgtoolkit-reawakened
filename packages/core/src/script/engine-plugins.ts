/**
 * The definitions the engine itself supplies, by manifest id (ADR 0004 decision 6;
 * docs/spec/engine/plugins-and-battle.md#e-99).
 *
 * One table serves every resolver of the one shared plugin manifest (PKG-1): the
 * engine's boot and a host's resolver both start from it, so adding an engine pack
 * is one edit here and no resolver has its own list of ids to keep in step.
 */

import { CORE_PLUGIN } from "./builtins.ts";
import { CATALOGUE_PLUGIN } from "./catalogue-responders.ts";
import { NATIVE_PACK_TABLE } from "./legacy-plugins.ts";
import { BATTLE_PLUGIN } from "./packs/battle.ts";
import { MEDIA_PLUGIN } from "./packs/media.ts";
import type { PluginDefinition } from "./plugin.ts";

/** Manifest id to the engine's own definition: `core`, `media`, `battle`, `catalogue` and every native pack. */
export const ENGINE_PLUGIN_TABLE: Readonly<Record<string, PluginDefinition>> = {
  core: CORE_PLUGIN,
  media: MEDIA_PLUGIN,
  battle: BATTLE_PLUGIN,
  catalogue: CATALOGUE_PLUGIN,
  ...NATIVE_PACK_TABLE,
};
