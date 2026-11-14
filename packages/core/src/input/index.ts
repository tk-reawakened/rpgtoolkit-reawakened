export {
  applyInputEvent,
  applySemanticActionEdge,
  configureInput,
  configureMainFileMovement,
  movementBindingCollisions,
  createInputSection,
  inputView,
  processGamepadEvents,
  pruneClaimed,
  claimInputBefore,
  registeredActionNames,
  rebuildKeyboardActionClaimIndex,
  rebuildKeyboardKeyClaimIndex,
  registerGameAction,
  recomputeInputActions,
  takeInputActions,
  heldPointerGoal,
  setPointerMovementSuppressed,
} from "./input.ts";
export type { InputAction, InputConfig, InputKey, InputView } from "./input.ts";
export { DIRECT_INPUT_PHYSICAL_KEYS } from "./movement-settings.ts";
export { inputPhaseRegistration, inputResetRegistration, openMainMenu, routePointerUpActivations, runInputPhase } from "./registration.ts";
export type { InputPhaseOptions } from "./registration.ts";
