import {
  CATALOGUE_RESPONDERS_PLUGIN,
  CATALOGUE_STUBS_PLUGIN,
  CORE_PLUGIN,
  WORLD_PLUGIN,
  createScriptServices as createResolvedScriptServices,
  type GameState,
  type Logger,
  type PluginDefinition,
  type ProgramLoader,
  type ResolvedPlugin,
  type ScriptServices,
  type VirtualVariablePort,
} from "../src/index.ts";

const FILE_COMMANDS = new Set(["save", "load", "openfileinput", "openfileoutput", "openfileappend", "openfilebinary", "fileinput", "fileprint", "fileget", "fileput"]);
const TEST_CORE_PLUGIN: PluginDefinition = {
  ...CORE_PLUGIN,
  commands: CORE_PLUGIN.commands.filter((command) => !FILE_COMMANDS.has(command.name)),
};
const DEFAULT_RESOLVED: readonly ResolvedPlugin[] = [
  { definition: TEST_CORE_PLUGIN },
  { definition: CATALOGUE_STUBS_PLUGIN },
  { definition: WORLD_PLUGIN },
];

type TestPlugin = PluginDefinition | ResolvedPlugin;

export function createScriptServices(
  state: GameState,
  plugins: readonly TestPlugin[] = [],
  logger?: Logger,
  virtuals?: VirtualVariablePort,
  loader?: ProgramLoader,
): ScriptServices {
  const resolved = plugins.map((plugin) =>
    "definition" in plugin ? plugin : { definition: plugin },
  );
  return createResolvedScriptServices(
    state,
    [...DEFAULT_RESOLVED, ...resolved],
    logger,
    virtuals,
    loader,
  );
}
