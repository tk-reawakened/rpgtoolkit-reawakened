import { describeLinkedStatusEffect, type SpecialMoveCommand, type SpecialMoveDocumentSnapshot } from "@tk-reawakened/editor-model";
import type { JSX } from "preact";
import { FlagRow, LinesRow, LinkRow, NumberRow, SaveBar, TextRow, useBattleDataForm, useLinkedFile, type BattleDataFormProps } from "./battle-data-form.tsx";
import type { ViewDocument } from "./mount.ts";

export type SpecialMoveViewDocument = ViewDocument<SpecialMoveDocumentSnapshot, SpecialMoveCommand>;
export type SpecialMoveViewProps = BattleDataFormProps<SpecialMoveDocumentSnapshot, SpecialMoveCommand>;

// The rows are generic in the command type; binding it here keeps each command's literal fields exact.
const Text = TextRow<SpecialMoveCommand>;
const Lines = LinesRow<SpecialMoveCommand>;
const Amount = NumberRow<SpecialMoveCommand>;
const Flag = FlagRow<SpecialMoveCommand>;
const Link = LinkRow<SpecialMoveCommand>;
const Bar = SaveBar<SpecialMoveCommand>;

const damageHint = (damage: number): string => damage < 0
  ? `Heals the target by ${-damage}. A negative damage heals.`
  : "Removed from the target's HP. A negative damage heals.";

/**
 * The special move editor (story 13.10, T-57; `docs/editor-features.md#special-move-status-effect-editors`). One form of
 * every stored field. The usable boxes are ticked exactly when the stored byte is 0, as the format ruled; the stored
 * byte is shown beside them. The status effect, animation and program are references to files in the project, each
 * with Choose and Open, and the status effect's own numbers are shown from its saved file.
 */
export function SpecialMoveView(props: SpecialMoveViewProps): JSX.Element {
  const form = useBattleDataForm(props, "special move");
  const { snapshot } = form;
  const { fs, pickAsset, open, capabilities } = props;
  const navigation = { ...(pickAsset === undefined ? {} : { pickAsset }), ...(open === undefined ? {} : { open }) };
  const { projectId, path } = snapshot.identity;
  const statusFile = useLinkedFile(fs, projectId, path, "statusEffects", snapshot.statusEffect, [".ste"], true);
  const animationFile = useLinkedFile(fs, projectId, path, "animations", snapshot.animation, [".anm"], false);
  const programFile = useLinkedFile(fs, projectId, path, "programs", snapshot.program, [".prg"], false);
  const linkedStatus = statusFile.state === "found" ? describeLinkedStatusEffect(statusFile.bytes, statusFile.path) : null;
  return <main class="tkr-battle-data-editor" aria-label="Special move">
    <header><h1>Special move</h1></header>
    <Bar form={form} capabilities={capabilities} />
    <fieldset>
      <legend>Move</legend>
      <Text form={form} id="name" label="Name" value={snapshot.name} command={(value) => ({ type: "set-special-move-text", field: "name", value })} />
      <Lines form={form} id="description" label="Description" value={snapshot.description} hint="Line breaks are kept as the file stores them." command={(value) => ({ type: "set-special-move-text", field: "description", value })} />
    </fieldset>
    <fieldset>
      <legend>What it does in a fight</legend>
      <Amount form={form} id="damage" label="Damage (FP)" value={snapshot.damage} hint={damageHint(snapshot.damage)} command={(value) => ({ type: "set-special-move-amount", field: "damage", value })} />
      <Amount form={form} id="smpCost" label="SMP cost to the user" value={snapshot.smpCost} hint="Taken from the user's SMP. A negative cost restores SMP." command={(value) => ({ type: "set-special-move-amount", field: "smpCost", value })} />
      <Amount form={form} id="targetSmpDrain" label="SMP drained from the target" value={snapshot.targetSmpDrain} hint="Taken from the target's SMP. A negative value restores it." command={(value) => ({ type: "set-special-move-amount", field: "targetSmpDrain", value })} />
    </fieldset>
    <fieldset>
      <legend>Where it can be used</legend>
      <Flag form={form} label="Usable in battle" checked={snapshot.usableInBattle} hint={`Stored value ${snapshot.battleByte}: 0 means usable, any other value means not usable.`} command={(usable) => ({ type: "set-special-move-usable", context: "battle", usable })} />
      <Flag form={form} label="Usable from the menu" checked={snapshot.usableFromMenu} hint={`Stored value ${snapshot.menuByte}: 0 means usable, any other value means not usable.`} command={(usable) => ({ type: "set-special-move-usable", context: "menu", usable })} />
    </fieldset>
    <Link form={form} id="statusEffect" label="Status effect" value={snapshot.statusEffect} hint="A .ste file in the project, applied to the target." kind="statusEffects" extensions={[".ste"]} navigation={navigation} linked={statusFile} command={(value) => ({ type: "set-special-move-text", field: "statusEffect", value })}>
      {linkedStatus === null ? null : linkedStatus.ok
        ? <p role="status">{linkedStatus.text} Open it to change these numbers; it keeps its own undo history.</p>
        : <p role="status">{linkedStatus.message}</p>}
    </Link>
    <Link form={form} id="animation" label="Animation" value={snapshot.animation} hint="An .anm file in the project, played when the move is used." kind="animations" extensions={[".anm"]} navigation={navigation} linked={animationFile} command={(value) => ({ type: "set-special-move-text", field: "animation", value })} />
    <Link form={form} id="program" label="Program" value={snapshot.program} hint="A .prg file in the project, run when the move is used." kind="programs" extensions={[".prg"]} navigation={navigation} linked={programFile} command={(value) => ({ type: "set-special-move-text", field: "program", value })} />
    {snapshot.residueBytes > 0 && <p role="status">{snapshot.residueBytes} byte(s) after the last field are kept exactly as they are.</p>}
  </main>;
}
