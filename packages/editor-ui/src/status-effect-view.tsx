import type { StatusEffectCommand, StatusEffectDocumentSnapshot, StatusEffectFlagField } from "@tk-reawakened/editor-model";
import type { JSX } from "preact";
import { FlagRow, LinkRow, NumberRow, SaveBar, TextRow, useBattleDataForm, useLinkedFile, type BattleDataFormProps } from "./battle-data-form.tsx";
import type { ViewDocument } from "./mount.ts";

export type StatusEffectViewDocument = ViewDocument<StatusEffectDocumentSnapshot, StatusEffectCommand>;
export type StatusEffectViewProps = BattleDataFormProps<StatusEffectDocumentSnapshot, StatusEffectCommand>;

// The rows are generic in the command type; binding it here keeps each command's literal fields exact.
const Text = TextRow<StatusEffectCommand>;
const Amount = NumberRow<StatusEffectCommand>;
const Flag = FlagRow<StatusEffectCommand>;
const Link = LinkRow<StatusEffectCommand>;
const Bar = SaveBar<StatusEffectCommand>;

const amountHint = (amount: number, what: string, off: boolean): string => {
  const sign = amount < 0 ? `Heals ${-amount} ${what} each round.` : `Removes ${amount} ${what} each round.`;
  return `${sign} A negative amount heals.${off ? ` It is stored but not applied while "Change ${what} each round" is off.` : ""}`;
};

/**
 * The status effect editor (story 13.10, T-58; `docs/editor-features.md#special-move-status-effect-editors`). One form of
 * every stored field. A flag box is on exactly when its stored value is non-zero; turning one on writes 1 and an authored
 * -1 or 7 is kept until the box is turned off. The form states nothing about rounds below 1: the battle rules decide that.
 */
export function StatusEffectView(props: StatusEffectViewProps): JSX.Element {
  const form = useBattleDataForm(props, "status effect");
  const { snapshot } = form;
  const { fs, pickAsset, open, capabilities } = props;
  const navigation = { ...(pickAsset === undefined ? {} : { pickAsset }), ...(open === undefined ? {} : { open }) };
  const programFile = useLinkedFile(fs, snapshot.identity.projectId, snapshot.identity.path, "programs", snapshot.program, [".prg"], "exact");
  const raw = snapshot.rawFlags;
  const flag = (field: StatusEffectFlagField, label: string, checked: boolean): JSX.Element => (
    <Flag form={form} label={label} checked={checked} hint={`Stored value ${raw[field]}: any non-zero value is on.`} command={(enabled) => ({ type: "set-status-effect-flag", field, enabled })} />
  );
  return <main class="tkr-battle-data-editor" aria-label="Status effect">
    <header><h1>Status effect</h1></header>
    <Bar form={form} capabilities={capabilities} />
    <fieldset>
      <legend>Status effect</legend>
      <Text form={form} id="name" label="Name" value={snapshot.name} command={(value) => ({ type: "set-status-effect-text", field: "name", value })} />
      <Amount form={form} id="rounds" label="Rounds" value={snapshot.rounds} hint="How many rounds it lasts. The battle rules decide what a value below 1 does." command={(value) => ({ type: "set-status-effect-number", field: "rounds", value })} />
    </fieldset>
    <fieldset>
      <legend>How fast the fighter charges</legend>
      {flag("speedUp", "Speed up", snapshot.speedUp)}
      {flag("slowDown", "Slow down", snapshot.slowDown)}
      {flag("disable", "Disable", snapshot.disable)}
    </fieldset>
    <fieldset>
      <legend>Each round</legend>
      {flag("hpEnabled", "Change HP each round", snapshot.hpEnabled)}
      <Amount form={form} id="hpPerRound" label="HP per round" value={snapshot.hpPerRound} hint={amountHint(snapshot.hpPerRound, "HP", !snapshot.hpEnabled)} command={(value) => ({ type: "set-status-effect-number", field: "hpPerRound", value })} />
      {flag("smpEnabled", "Change SMP each round", snapshot.smpEnabled)}
      <Amount form={form} id="smpPerRound" label="SMP per round" value={snapshot.smpPerRound} hint={amountHint(snapshot.smpPerRound, "SMP", !snapshot.smpEnabled)} command={(value) => ({ type: "set-status-effect-number", field: "smpPerRound", value })} />
      {flag("runProgram", "Run a program each round", snapshot.runProgram)}
      <Link form={form} id="program" label="Program" value={snapshot.program} hint="A .prg file in the project, run for the affected fighter each round." kind="programs" extensions={[".prg"]} navigation={navigation} linked={programFile} command={(value) => ({ type: "set-status-effect-text", field: "program", value })} />
    </fieldset>
    {snapshot.residueBytes > 0 && <p role="status">{snapshot.residueBytes} byte(s) after the program are kept exactly as they are.</p>}
  </main>;
}
