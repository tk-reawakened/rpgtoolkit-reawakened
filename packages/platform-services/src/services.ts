import type { FileSystemService } from "./fs.ts";
import type { PlatformResult } from "./result.ts";

/**
 * What a host can and cannot do (AD-20: "Each host declares a `capabilities` set"). `editor-ui` degrades by capability
 * instead of testing which host it runs in.
 */
export type Capability =
  /** The OS can open project files in this editor (T-82). */
  | "fileAssociation"
  /** The host can write into the project folder; without it, saving means a download (ADR 0022 D5.2). */
  | "folderWrite"
  /** `fs.watch` works (ADR 0022 D3.5). */
  | "fileWatch"
  /** The host gives a project handle that survives a restart; without it the project is a session copy (ADR 0022 D1.4). */
  | "stableProjectHandle"
  /**
   * The host keeps a backup of unsaved edits and offers it back after a reload or a crash (VS Code's hot exit). Without
   * it the editor never offers or implies recovery (ADR 0022 D3.6).
   */
  | "backup"
  /** The host can safely reload the intended document and reset its dirty state after a conflict. */
  | "conflictReload"
  /** The host can save the active conflicted document after the user chooses to keep its version. */
  | "conflictAutoSave"
  /** The host has source control to show (ADR 0022 D13.1). */
  | "scm"
  /** `shell.openExternal` works: the host can hand a project file to the operating system's default application (T-03). */
  | "openExternal"
  /** `dialogs.pickFile` works: the host can let the user choose a file from outside the project (T-05). */
  | "pickFile";

/** The set of capabilities a host declares. */
export type Capabilities = ReadonlySet<Capability>;

/** One project the host has open or remembers. `id` is the project handle of ADR 0022 D1.1 and is opaque. */
export interface ProjectHandle {
  readonly id: string;
  /** What to call the project in the interface, for example its folder name. */
  readonly name: string;
}

/** The `project` surface of AD-20: `open`, `recent`. */
export interface ProjectService {
  /** Let the user choose a project and make it the one `fs` works in. A cancelled choice is `unavailable`. */
  open(): Promise<PlatformResult<ProjectHandle>>;
  /** The projects the host remembers, most recent first. */
  recent(): Promise<PlatformResult<readonly ProjectHandle[]>>;
}

/** A value an editor setting can hold (ADR 0022 D6.2: boolean, number, string, and lists of those). */
export type SettingValue = boolean | number | string | readonly SettingValue[];

/** The layers a host stores (ADR 0022 D6.3). The effective value is worked out above this surface, in shared code. */
export type SettingsLayer = "user" | "project";

/** The `settings` surface of AD-20: where each layer's own values are kept. Authored game data never goes here (D6.1). */
export interface SettingsService {
  /** The value stored in `layer` for the setting `id`, or `null` when that layer holds none. */
  get(layer: SettingsLayer, id: string): Promise<PlatformResult<SettingValue | null>>;
  /** Store `value` in `layer`; `null` removes the layer's value (a reset, D6.3). */
  set(layer: SettingsLayer, id: string, value: SettingValue | null): Promise<PlatformResult<void>>;
}

/** The `document.edited { editId, label }` message of AD-19, sent for each accepted edit command. */
export interface DocumentEdited {
  /** The document's identity key (ADR 0022 D1). */
  readonly document: string;
  readonly editId: string;
  /** What the edit did, in words for an undo menu. */
  readonly label: string;
}

/** The `document` surface of AD-20 (AD-19): how an editor view tells the host about an edit. Hosts then call `undo(editId)`. */
export interface DocumentService {
  edited(event: DocumentEdited): void;
}

/** One answer a `dialogs.ask` question offers. */
export interface DialogChoice<Id extends string> {
  readonly id: Id;
  /** The button's words. */
  readonly label: string;
}

/** A question with a fixed set of answers, such as "save before closing?" (ADR 0022 D3.6). */
export interface DialogQuestion<Id extends string> {
  /** One sentence that names the document and what is about to happen, safe to show. */
  readonly message: string;
  /** A second sentence: what each answer does. */
  readonly detail: string;
  readonly choices: readonly DialogChoice<Id>[];
  /** The answer a dismissed dialog gives (Escape, the close box); one of the choices' ids. */
  readonly cancel: Id;
}

/** What `dialogs.pickSavePath` is asked. */
export interface SavePathRequest {
  /** The project-relative path of the document being saved under a new name. */
  readonly document: string;
  /** The path the dialog starts with. */
  readonly suggested: string;
}

/** What `dialogs.pickFile` is asked. */
export interface FilePickRequest {
  /** What the user is choosing, in words for the dialog's title. */
  readonly title: string;
  /** Lower-case extensions with the dot that the dialog offers first (`[".png", ".bmp"]`); the user may still see others. */
  readonly extensions: readonly string[];
}

/** A file the user chose from outside the project: its name as the host gave it, and its bytes. */
export interface OutsideFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * The `dialogs` surface of AD-20. Every host shows its own native or page dialog; `editor-model` and `editor-ui` only
 * ask. A dialog never decides on its own: dismissing it answers the question's `cancel`.
 */
export interface DialogService {
  /** Ask the user to choose one of `question.choices` and resolve with its id. */
  ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id>;
  /** Ask for the project-relative path to save a copy to (Save As, ADR 0022 D3.4); `null` when the user cancels. */
  pickSavePath(request: SavePathRequest): Promise<string | null>;
  /**
   * Ask the user to choose a file from outside the project and read it (T-05); `null` when the user cancels. Present only
   * on a host that declares the `pickFile` capability; a caller checks the capability and says so when it is missing.
   */
  pickFile?(request: FilePickRequest): Promise<OutsideFile | null>;
}

/** The `shell` surface of AD-20, as far as story 11.4 needs it. */
export interface ShellService {
  /**
   * Open the project file at `path` in the operating system's default application (T-03: a file that is not a Toolkit
   * document). `unavailable` when the host cannot; present only with the `openExternal` capability.
   */
  openExternal(path: string): Promise<PlatformResult<void>>;
}

/**
 * Package export host operations (AD-20 `export`, shaped by story 12.9). `sha256` supplies the descriptor's archive
 * digest. `downloadFile` is present only on a host that can hand the author an ordinary download of one file; it is
 * invoked by a direct user action and never writes into the project. A host without it saves the package its own way
 * (VS Code: Save As) or says that export is unavailable.
 */
export interface PackageExportService {
  sha256(bytes: Uint8Array): Promise<PlatformResult<string>>;
  downloadFile?(fileName: string, bytes: Uint8Array): Promise<PlatformResult<void>>;
}

/**
 * The part of AD-20 that stories 11.17, 11.3 and 12.9 need: `capabilities`, `fs`, `project`, `settings`, `document`,
 * `dialogs` and the package-export operations.
 *
 * AD-20 also lists `run`, `clipboard` and `language.connect()` (`shell.openExternal` is declared, for 11.4). They are not
 * declared yet: AD-20 names their methods but not their parameters, and the entries that first use them (11.9 run, the
 * program editor's language client) fix those shapes against a real caller. A host that implements this interface is
 * not asked for them until then.
 */
export interface PlatformServices {
  readonly capabilities: Capabilities;
  readonly fs: FileSystemService;
  readonly project: ProjectService;
  readonly settings: SettingsService;
  readonly document: DocumentService;
  readonly dialogs: DialogService;
  /** Present when the host declares `openExternal`. */
  readonly shell?: ShellService;
  /** Descriptor digest and download operations used by package export. */
  readonly packageExport?: PackageExportService;
}
