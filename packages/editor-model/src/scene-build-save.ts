import { buildScene, type SceneBuildInputs, type SceneBuildProblem, type SceneBuildResult } from "./scene-build.ts";
import type { SceneBuildCheck, SceneBuildWriteResult, createSceneBuildOwnership } from "./scene-build-ownership.ts";

type Ownership = ReturnType<typeof createSceneBuildOwnership>;
export type SceneBuildPreparation =
  | { readonly ok: true; readonly built: Extract<SceneBuildResult, { readonly ok: true }>; readonly check: SceneBuildCheck }
  | { readonly ok: false; readonly problems: readonly SceneBuildProblem[] };

/** Build all outputs, then inspect every destination before the caller asks for conflict decisions. */
export async function prepareSceneBuild(inputs: SceneBuildInputs, ownership: Ownership): Promise<SceneBuildPreparation> {
  const built = await buildScene(inputs);
  if (!built.ok) return built;
  const checked = await ownership.check(inputs.scenePath, built.outputs);
  return checked.ok ? { ok: true, built, check: checked.check } : { ok: false, problems: [{ path: inputs.scenePath, message: checked.message }] };
}

/** Write exactly the reviewed build; authorization applies only to the conflict paths the author selected. */
export function writePreparedSceneBuild(prepared: Extract<SceneBuildPreparation, { readonly ok: true }>, ownership: Ownership, authorizedPaths: readonly string[] = []): Promise<SceneBuildWriteResult> {
  return ownership.write(prepared.check, prepared.built.outputs, authorizedPaths);
}
