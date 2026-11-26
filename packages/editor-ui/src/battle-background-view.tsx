import type { BattleBackgroundCommand, BattleBackgroundDocumentSnapshot } from "@tk-reawakened/editor-model";
import { useLayoutEffect } from "preact/hooks";
import type { JSX } from "preact";
import { LinkRow, SaveBar, useBattleDataForm, useLinkedFile, type BattleDataFormProps, type LinkedFile } from "./battle-data-form.tsx";
import type { AuditionPanel } from "./board-audition.ts";
import type { ViewDocument } from "./mount.ts";
import { useDocumentSnapshot } from "./use-document.ts";

export type BattleBackgroundViewDocument = ViewDocument<BattleBackgroundDocumentSnapshot, BattleBackgroundCommand>;
export type BattleBackgroundViewProps = BattleDataFormProps<BattleBackgroundDocumentSnapshot, BattleBackgroundCommand> & { readonly audition?: AuditionPanel };
const Link = LinkRow<BattleBackgroundCommand>;
const Bar = SaveBar<BattleBackgroundCommand>;
const IMAGE_EXTENSIONS = [".tbm", ".bmp", ".png", ".jpg", ".jpeg", ".gif"];

export function BattleBackgroundView(props: BattleBackgroundViewProps): JSX.Element {
  useLayoutEffect(() => {
    const audition = props.audition;
    return () => {
      audition?.controls.dispose();
      audition?.onDispose?.();
    };
  }, [props.audition]);
  const form = useBattleDataForm(props, "fight background", (latest, edit) => edit.type !== "hold-field-text" && latest[edit.field] === edit.value);
  const { snapshot } = form;
  const { fs, pickAsset, open, layout } = props;
  const navigation = { ...(pickAsset === undefined ? {} : { pickAsset }), ...(open === undefined ? {} : { open }), ...(layout === undefined ? {} : { layout }) };
  const identity = snapshot.identity;
  const image = useLinkedFile(fs, identity.projectId, identity.path, "bitmaps", snapshot.image, IMAGE_EXTENSIONS, "exact", layout);
  const music = useLinkedFile(fs, identity.projectId, identity.path, "media", snapshot.music, [".wav", ".mid", ".midi"], "exact", layout);
  const select = useLinkedFile(fs, identity.projectId, identity.path, "media", snapshot.selectSound, [".wav", ".mid", ".midi"], "exact", layout);
  const choose = useLinkedFile(fs, identity.projectId, identity.path, "media", snapshot.chooseSound, [".wav", ".mid", ".midi"], "exact", layout);
  const ready = useLinkedFile(fs, identity.projectId, identity.path, "media", snapshot.readySound, [".wav", ".mid", ".midi"], "exact", layout);
  const cantDo = useLinkedFile(fs, identity.projectId, identity.path, "media", snapshot.cantDoSound, [".wav", ".mid", ".midi"], "exact", layout);
  const field = (id: "image" | "music" | "selectSound" | "chooseSound" | "readySound" | "cantDoSound", label: string, value: string, kind: "bitmaps" | "media", extensions: readonly string[], linked: typeof image): JSX.Element => <Link
    form={form} id={id} label={label} value={value} kind={kind} extensions={extensions} navigation={navigation} linked={linked}
    command={(next) => ({ type: "set-battle-background-text", field: id, value: next })}
  />;
  return <main class="tkr-battle-data-editor" aria-label="Fight background" onFocusCapture={() => props.audition?.onFocus?.()} onPointerDownCapture={() => props.audition?.onFocus?.()}>
    <header><h1>Fight background</h1></header>
    <Bar form={form} capabilities={props.capabilities} />
    {props.audition !== undefined && <button type="button" onClick={() => props.audition!.commands.execute("battle-background.audition.stop")}>Stop battle-background audition</button>}
    {field("image", "Background picture", snapshot.image, "bitmaps", IMAGE_EXTENSIONS, image)}
    {field("music", "Battle music", snapshot.music, "media", [".wav", ".mid", ".midi"], music)}
    {snapshot.music !== "" && props.audition !== undefined && <AudioAudition panel={props.audition} field="music" linked={music} label="Battle music" />}
    {field("selectSound", "Menu cursor sound", snapshot.selectSound, "media", [".wav", ".mid", ".midi"], select)}
    {snapshot.selectSound !== "" && props.audition !== undefined && <AudioAudition panel={props.audition} field="selectSound" linked={select} label="Menu cursor sound" />}
    {field("chooseSound", "Menu choice sound", snapshot.chooseSound, "media", [".wav", ".mid", ".midi"], choose)}
    {snapshot.chooseSound !== "" && props.audition !== undefined && <AudioAudition panel={props.audition} field="chooseSound" linked={choose} label="Menu choice sound" />}
    {field("readySound", "Fighter ready sound", snapshot.readySound, "media", [".wav", ".mid", ".midi"], ready)}
    {snapshot.readySound !== "" && props.audition !== undefined && <AudioAudition panel={props.audition} field="readySound" linked={ready} label="Fighter ready sound" />}
    {field("cantDoSound", "Action unavailable sound", snapshot.cantDoSound, "media", [".wav", ".mid", ".midi"], cantDo)}
    {snapshot.cantDoSound !== "" && props.audition !== undefined && <AudioAudition panel={props.audition} field="cantDoSound" linked={cantDo} label="Action unavailable sound" />}
    {props.audition === undefined && <p role="status">Audio audition is unavailable in this host. The stored references are unchanged.</p>}
    {snapshot.residueBytes > 0 && <p role="status">{snapshot.residueBytes} byte(s) after the last sound are kept exactly as they are.</p>}
  </main>;
}

function AudioAudition({ panel, field: cue, linked, label }: { readonly panel: AuditionPanel; readonly field: "music" | "selectSound" | "chooseSound" | "readySound" | "cantDoSound"; readonly linked: LinkedFile; readonly label: string }): JSX.Element {
  const state = useDocumentSnapshot(panel.controls);
  return <div class="tkr-board-audition" role="group" aria-label={`${label} audition`}>
    <button type="button" disabled={linked.state !== "found"} onClick={() => {
      if (linked.state !== "found") return;
      void panel.commands.execute(`battle-background.audition.play.${cue}`);
    }}>Play {label.toLowerCase()}</button>
    <button type="button" onClick={() => panel.commands.execute("battle-background.audition.stop")}>Stop</button>
    <label><input type="checkbox" checked={state.loop} onChange={() => panel.commands.execute("battle-background.audition.loop")} />Loop playback</label>
    {state.note === null ? null : <p role="alert">{state.note}</p>}
  </div>;
}
