import { ASSET_FOLDERS, DEFAULT_EDITOR_PREFERENCES, createPendingEdits, kindById, type AnyDocument, type AssetKind, type ApplyResult, type BoardPicture, type BoardPreviewRequest, type EditorPreferences, type PendingEdits, type ConflictChoice, type ConflictResult, type DocumentSnapshot, type PickOutcome, type SaveResult, type SpriteDocumentSnapshot } from "@tk-reawakened/editor-model";
import { platformError, type Capability, type DirectoryEntry, type PlatformResult } from "@tk-reawakened/platform-services";
import { createBrowserSession, type BrowserSession, type BrowserState, type BrowserStatePatch } from "@tk-reawakened/editor-ui/browser-session";

/** What a view asks to choose: an asset of `kind` for a field, accepting `extensions` (lower-case with the dot; empty accepts any). */
export interface AssetPickRequest {
  readonly kind: AssetKind;
  readonly extensions: readonly string[];
  /** What the field is called, in words for the confirmation. */
  readonly field: string;
}

/** The result of following a link to another document. */
export type VisitOutcome = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly message: string };
/** The result of going back from a visit; `message` says when the origin had to be opened again. */
export type ReturnOutcome = { readonly ok: true; readonly path: string; readonly message: string | null } | { readonly ok: false; readonly message: string };

/** A snapshot as it crosses the bridge: plain data, whatever the kind (the kind says which fields it has). */
export type BridgedSnapshot = DocumentSnapshot<unknown>;
function isCharacterSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const character = value as Record<string, unknown>;
  const stats = character.stats;
  const stringList = (list: unknown, length: number): boolean =>
    Array.isArray(list) && list.length === length && list.every((entry: unknown) => typeof entry === "string");
  const numberList = (list: unknown, length: number): boolean =>
    Array.isArray(list) && list.length === length && list.every((entry: unknown) => typeof entry === "number" && Number.isInteger(entry));
  if (typeof character.name !== "string" || typeof character.profilePicture !== "string"
    || typeof character.specialMoveCategory !== "string" || typeof character.levelUpProgram !== "string"
    || !stringList(character.variableNames, 9) || !stringList(character.accessorySlots, 11)
    || !numberList(character.bodySlots, 7) || !numberList(character.levelIncreases, 4)) return false;
  if (typeof stats !== "object" || stats === null) return false;
  const fields = stats as Record<string, unknown>;
  for (const field of ["experience", "hp", "maxHp", "dp", "fp", "smp", "maxSmp", "level"]) {
    if (typeof fields[field] !== "number" || !Number.isInteger(fields[field])) return false;
  }
  for (const field of ["hasSpecialMoves", "firstLevelExp", "experienceIncrease", "maxLevel", "levelUpType"]) {
    if (typeof character[field] !== "number" || !Number.isInteger(character[field])) return false;
  }
  return Array.isArray(character.specialMoves) && character.specialMoves.length === 201
    && character.specialMoves.every((move: unknown) => {
      if (typeof move !== "object" || move === null) return false;
      const slot = move as Record<string, unknown>;
      return typeof slot.file === "string" && typeof slot.condVar === "string" && typeof slot.condValue === "string"
        && typeof slot.minExp === "number" && Number.isInteger(slot.minExp)
        && typeof slot.minLevel === "number" && Number.isInteger(slot.minLevel);
    });
}

export function isSpriteSnapshot(snapshot: BridgedSnapshot, kind: string): snapshot is SpriteDocumentSnapshot {
  const isStringList = (value: unknown): value is readonly string[] =>
    Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string");
  const isBasePair = (value: unknown): boolean => value === null || (
    Array.isArray(value) && value.length === 2 && value.every((base: unknown) =>
      typeof base === "object" && base !== null && "points" in base && Array.isArray(base.points) && base.points.length >= 3
      && base.points.every((point: unknown) => typeof point === "object" && point !== null && "x" in point && "y" in point
        && typeof point.x === "number" && Number.isInteger(point.x) && typeof point.y === "number" && Number.isInteger(point.y)))
  );
  if (!("actorType" in snapshot) || snapshot.actorType !== kind || (kind !== "character" && kind !== "item")) return false;
  if (!("actorName" in snapshot) || typeof snapshot.actorName !== "string" || !("minor" in snapshot) || typeof snapshot.minor !== "number" || !Number.isInteger(snapshot.minor)) return false;
  if (!("character" in snapshot) || (kind === "item" ? snapshot.character !== null : !isCharacterSnapshot(snapshot.character))) return false;
  const expectedBattleStances = kind === "character" ? snapshot.minor < 5 ? 0 : 5 : 1;
  if (!("battleAnimations" in snapshot) || !isStringList(snapshot.battleAnimations) || snapshot.battleAnimations.length !== expectedBattleStances) return false;
  if (!("customStances" in snapshot) || !Array.isArray(snapshot.customStances) || !snapshot.customStances.every((stance: unknown) =>
    typeof stance === "object" && stance !== null && "handle" in stance && typeof stance.handle === "string"
    && "animation" in stance && typeof stance.animation === "string")) return false;
  if (!("speed" in snapshot) || (snapshot.speed !== null && typeof snapshot.speed !== "number")) return false;
  if (!("idleTime" in snapshot) || (snapshot.idleTime !== null && typeof snapshot.idleTime !== "number")) return false;
  if (!("vectorBases" in snapshot) || !isBasePair(snapshot.vectorBases)) return false;
  return "graphicsUnavailable" in snapshot && (snapshot.graphicsUnavailable === null || typeof snapshot.graphicsUnavailable === "string");
}

export type BridgeMessage =
  | { readonly type: "initialize"; readonly kind: string; readonly snapshot: BridgedSnapshot; readonly capabilities: readonly Capability[]; readonly browserState: BrowserState; readonly boardPreferences: EditorPreferences }
  | { readonly type: "board-preferences"; readonly preferences: EditorPreferences }
  | { readonly type: "snapshot"; readonly snapshot: BridgedSnapshot }
  | { readonly type: "browser-state"; readonly changes: BrowserStatePatch }
  | { readonly type: "edit-result"; readonly requestId: string; readonly result: ApplyResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "save-result"; readonly requestId: string; readonly result: SaveResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "conflict-result"; readonly requestId: string; readonly result: ConflictResult; readonly snapshot: BridgedSnapshot }
  | { readonly type: "preview-result"; readonly requestId: string; readonly picture: BoardPicture }
  | { readonly type: "read-project-result"; readonly requestId: string; readonly result: PlatformResult<Uint8Array> }
  | { readonly type: "visit-result"; readonly requestId: string; readonly outcome: VisitOutcome }
  | { readonly type: "return-result"; readonly requestId: string; readonly outcome: ReturnOutcome }
  | { readonly type: "pick-result"; readonly requestId: string; readonly outcome: PickOutcome }
  | { readonly type: "browser-list-result"; readonly requestId: string; readonly result: PlatformResult<readonly DirectoryEntry[]> }
  | { readonly type: "browser-read-result"; readonly requestId: string; readonly result: PlatformResult<Uint8Array> }
  /** The extension host is about to save, back up, revert or move the document: the webview answers `settled` once every edit it accepted has reached it (#2613). */
  | { readonly type: "settle"; readonly requestId: string };

export type EditorHostRequest =
  | { readonly type: "ready" }
  | { readonly type: "edit"; readonly command: unknown; readonly requestId: string }
  | { readonly type: "save"; readonly requestId: string }
  | { readonly type: "resolve-conflict"; readonly choice: ConflictChoice; readonly requestId: string }
  | { readonly type: "preview"; readonly requestId: string; readonly request?: BoardPreviewRequest }
  | { readonly type: "read-project"; readonly requestId: string; readonly path: string }
  | { readonly type: "visit"; readonly requestId: string; readonly path: string }
  | { readonly type: "return-visit"; readonly requestId: string }
  | { readonly type: "pick-asset"; readonly requestId: string; readonly request: AssetPickRequest }
  | { readonly type: "browser-context"; readonly changes: BrowserStatePatch }
  | { readonly type: "browser-list"; readonly requestId: string; readonly path: string }
  | { readonly type: "browser-read"; readonly requestId: string; readonly path: string }
  /** The answer to `settle`. It is sent after every edit the webview accepted, so the channel's order puts those edits before it. */
  | { readonly type: "settled"; readonly requestId: string };

export type VscodeApi = { postMessage(message: EditorHostRequest): void; getState(): unknown; setState(state: unknown): void };

/** What the bridge needs from the extension host's side of one custom document. */
export interface BridgedDocument {
  readonly model: AnyDocument;
  readonly capabilities: readonly Capability[];
  readonly browserSession: BrowserSession;
  browserList(path: string): Promise<PlatformResult<readonly DirectoryEntry[]>>;
  browserRead(path: string): Promise<PlatformResult<Uint8Array>>;
  didEdit(editId: string): void;
  saveThroughWorkbench(): Promise<SaveResult>;
  resolveConflict(choice: ConflictChoice): Promise<ConflictResult>;
  /** The picture of the board or tile bitmap as the one compositor draws it from the project's files, a board with only the layers and background the request shows; only those two have one. */
  preview(request?: BoardPreviewRequest): Promise<BoardPicture>;
  /** The board-editor preferences in force for this document's project (T-33). */
  boardPreferences(): EditorPreferences;
  visit(path: string): Promise<VisitOutcome>;
  returnFromVisit(): Promise<ReturnOutcome>;
  pickAsset(request: AssetPickRequest): Promise<PickOutcome>;
  readProject(path: string): Promise<PlatformResult<Uint8Array>>;
  /** A webview answered a `settle` request: every edit it had accepted has reached this document (#2613). */
  viewSettled?(requestId: string): void;
}

/** Extension-host document actions are authoritative; UI saves enter VS Code's custom-editor lifecycle. */
export async function handleEditorHostRequest(
  document: BridgedDocument,
  request: EditorHostRequest,
  postMessage: (message: BridgeMessage) => unknown,
): Promise<void> {
  if (request.type === "ready") {
    await postMessage({
      type: "initialize",
      kind: document.model.kind,
      snapshot: document.model.getSnapshot(),
      capabilities: document.capabilities,
      browserState: document.browserSession.getSnapshot(),
      boardPreferences: document.boardPreferences(),
    });
  } else if (request.type === "browser-context") {
    applyBrowserStatePatch(document.browserSession, request.changes);
  } else if (request.type === "browser-list") {
    await postMessage({ type: "browser-list-result", requestId: request.requestId, result: await document.browserList(request.path) });
  } else if (request.type === "browser-read") {
    await postMessage({ type: "browser-read-result", requestId: request.requestId, result: await document.browserRead(request.path) });
  } else if (request.type === "edit") {
    // A command is data from a webview: it is applied only if it has the shape of this document's kind (never trust a webview).
    const result: ApplyResult = kindById(document.model.kind)?.isCommand(request.command) === true
      ? document.model.apply(request.command as never)
      : { ok: false, rejection: { reason: "invalid", message: `That is not an edit this ${document.model.kind} document understands.` } };
    if (result.ok) document.didEdit(result.editId);
    await postMessage({ type: "edit-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else if (request.type === "save") {
    const result = await document.saveThroughWorkbench();
    await postMessage({ type: "save-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  } else if (request.type === "settled") {
    document.viewSettled?.(request.requestId);
  } else if (request.type === "read-project") {
    await postMessage({ type: "read-project-result", requestId: request.requestId, result: await document.readProject(request.path) });
  } else if (request.type === "preview") {
    await postMessage({ type: "preview-result", requestId: request.requestId, picture: await document.preview(request.request) });
  } else if (request.type === "visit") {
    await postMessage({ type: "visit-result", requestId: request.requestId, outcome: await document.visit(request.path) });
  } else if (request.type === "return-visit") {
    await postMessage({ type: "return-result", requestId: request.requestId, outcome: await document.returnFromVisit() });
  } else if (request.type === "pick-asset") {
    await postMessage({ type: "pick-result", requestId: request.requestId, outcome: await document.pickAsset(request.request) });
  } else {
    const result = await document.resolveConflict(request.choice);
    await postMessage({ type: "conflict-result", requestId: request.requestId, result, snapshot: document.model.getSnapshot() });
  }
}

/** Whether a value from a webview is an asset request: a known asset kind, text extensions and a field name. Never trust a webview. */
function isAssetPickRequest(value: unknown): value is AssetPickRequest {
  return typeof value === "object" && value !== null
    && "kind" in value && typeof value.kind === "string" && Object.prototype.hasOwnProperty.call(ASSET_FOLDERS, value.kind)
    && "extensions" in value && Array.isArray(value.extensions) && value.extensions.every((extension) => typeof extension === "string")
    && "field" in value && typeof value.field === "string" && value.field !== "";
}

/** Whether a value from a webview asks for a picture the way `BoardPreviewRequest` says: layer numbers and a background flag, nothing else. */
function isPreviewRequest(value: unknown): value is BoardPreviewRequest {
  if (typeof value !== "object" || value === null) return false;
  const layers = "visibleLayers" in value ? value.visibleLayers : undefined;
  const background = "showBackground" in value ? value.showBackground : undefined;
  const layersOk = layers === undefined || (Array.isArray(layers) && layers.length <= 1024 && layers.every((layer) => Number.isInteger(layer) && layer >= 0));
  return layersOk && (background === undefined || typeof background === "boolean");
}

function isProjectPath(value: unknown): value is string {
  return typeof value === "string" && (value === "" || (
    !value.startsWith("/") && !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  ));
}

function isBrowserSelection(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const selection = value;
  return "kind" in selection && (selection.kind === "tiles" || selection.kind === "bitmaps")
    && "path" in selection && isProjectPath(selection.path)
    && "reference" in selection && typeof selection.reference === "string" && selection.reference !== ""
    && "label" in selection && typeof selection.label === "string"
    && "boardTile" in selection && (selection.boardTile === null || typeof selection.boardTile === "string")
    && "stamp" in selection && (selection.stamp === null || isStamp(selection.stamp));
}

/** A stamp is a tile bitmap's size in whole tiles; a webview's value is never trusted past this. */
function isStamp(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "width" in value && typeof value.width === "number" && Number.isInteger(value.width) && value.width > 0
    && "height" in value && typeof value.height === "number" && Number.isInteger(value.height) && value.height > 0;
}


function isBrowserStatePatch(value: unknown): value is BrowserStatePatch {
  if (!Array.isArray(value)) return false;
  return value.every((change) => {
    if (typeof change !== "object" || change === null || !("field" in change) || !("value" in change)) return false;
    if (change.field === "selection") return change.value === null || isBrowserSelection(change.value);
    if (change.field === "path") return change.value === null || isProjectPath(change.value);
    return change.field === "scrollTop" && typeof change.value === "number" && Number.isFinite(change.value) && change.value >= 0;
  });
}

function applyBrowserStatePatch(session: BrowserSession, changes: BrowserStatePatch): void {
  const update: { -readonly [Key in keyof BrowserState]?: BrowserState[Key] } = {};
  for (const change of changes) {
    if (change.field === "selection") update.selection = change.value;
    else if (change.field === "path") update.path = change.value;
    else update.scrollTop = change.value;
  }
  session.update(update);
}

export function isEditorHostRequest(value: unknown): value is EditorHostRequest {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "ready") return true;
  if (value.type === "browser-context") return "changes" in value && isBrowserStatePatch(value.changes);
  if (!("requestId" in value) || typeof value.requestId !== "string") return false;
  if (value.type === "browser-list" || value.type === "browser-read") return "path" in value && isProjectPath(value.path);
  if (value.type === "save" || value.type === "return-visit" || value.type === "settled") return true;
  if (value.type === "preview") return !("request" in value) || value.request === undefined || isPreviewRequest(value.request);
  if (value.type === "visit") return "path" in value && typeof value.path === "string" && value.path !== "";
  if (value.type === "pick-asset") return "request" in value && isAssetPickRequest(value.request);
  if (value.type === "resolve-conflict") return "choice" in value && (value.choice === "keep-local" || value.choice === "reload");
  if (value.type === "read-project") return "path" in value && typeof value.path === "string" && value.path !== "";
  return value.type === "edit" && "command" in value && typeof value.command === "object" && value.command !== null;
}

/** Extension-host snapshots are read-only to the webview; edits/save are requests routed through this proxy. */
export class RemoteDocument {
  private snapshot: BridgedSnapshot;
  readonly kind: string;
  readonly identity: BridgedSnapshot["identity"];
  readonly browserSession: BrowserSession;
  private readonly listeners = new Set<() => void>();
  private readonly pendingEdits = new Map<string, (result: ApplyResult) => void>();
  private readonly pendingSaves = new Map<string, (result: SaveResult) => void>();
  private readonly pendingResolutions = new Map<string, (result: ConflictResult) => void>();
  private readonly pendingPreviews = new Map<string, (picture: BoardPicture) => void>();
  private readonly pendingVisits = new Map<string, (outcome: VisitOutcome) => void>();
  private readonly pendingReturns = new Map<string, (outcome: ReturnOutcome) => void>();
  private readonly pendingProjectReads = new Map<string, (result: PlatformResult<Uint8Array>) => void>();
  private readonly pendingPicks = new Map<string, (outcome: PickOutcome) => void>();
  private readonly pendingBrowserLists = new Map<string, (result: PlatformResult<readonly DirectoryEntry[]>) => void>();
  private readonly pendingBrowserReads = new Map<string, (result: PlatformResult<Uint8Array>) => void>();
  private nextRequest = 0;
  private readonly vscode: VscodeApi;
  /**
   * The edits the views of this document have accepted but not yet handed over (#2613). A view registers here; the
   * extension host's `settle` request waits for it, so a save or close never leaves a queued edit behind.
   */
  readonly pendingEdits: PendingEdits = createPendingEdits();
  private applyingBrowserState = false;

  /** The board-editor preferences the extension host last sent; a view reads them when it acts. */
  readonly boardPreferences: { get(): EditorPreferences; subscribe(listener: () => void): () => void };
  private preferences: EditorPreferences;
  private readonly preferenceListeners = new Set<() => void>();

  constructor(kind: string, snapshot: BridgedSnapshot, browserState: BrowserState, vscode: VscodeApi, preferences: EditorPreferences = DEFAULT_EDITOR_PREFERENCES) {
    this.preferences = preferences;
    this.boardPreferences = {
      get: () => this.preferences,
      subscribe: (listener) => { this.preferenceListeners.add(listener); return () => void this.preferenceListeners.delete(listener); },
    };
    this.kind = kind;
    this.snapshot = snapshot;
    this.identity = snapshot.identity;
    this.vscode = vscode;
    this.browserSession = createBrowserSession(browserState);
    this.browserSession.subscribe((changes) => {
      if (!this.applyingBrowserState) this.vscode.postMessage({ type: "browser-context", changes });
    });
  }

  getSnapshot(): BridgedSnapshot { return this.snapshot; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  apply(command: unknown): Promise<ApplyResult> {
    const requestId = `edit-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingEdits.set(requestId, resolve);
      this.vscode.postMessage({ type: "edit", command, requestId });
    });
  }
  readProject(projectId: string, path: string): Promise<PlatformResult<Uint8Array>> {
    if (projectId !== this.identity.projectId) return Promise.resolve(platformError("unavailable", "The document's project is unavailable."));
    const requestId = `read-project-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingProjectReads.set(requestId, resolve);
      this.vscode.postMessage({ type: "read-project", requestId, path });
    });
  }

  save(): Promise<SaveResult> {
    const requestId = `save-${++this.nextRequest}`;
    this.snapshot = { ...this.snapshot, saving: true };
    this.notify();
    return new Promise((resolve) => {
      this.pendingSaves.set(requestId, resolve);
      this.vscode.postMessage({ type: "save", requestId });
    });
  }

  /** The board's picture, composed by the extension host from the project's files (the webview reads no files). */
  preview(request?: BoardPreviewRequest): Promise<BoardPicture> {
    const requestId = `preview-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingPreviews.set(requestId, resolve);
      this.vscode.postMessage({ type: "preview", requestId, ...(request === undefined ? {} : { request }) });
    });
  }

  browserList(path: string): Promise<PlatformResult<readonly DirectoryEntry[]>> {
    const requestId = `browser-list-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingBrowserLists.set(requestId, resolve);
      this.vscode.postMessage({ type: "browser-list", requestId, path });
    });
  }

  browserRead(path: string): Promise<PlatformResult<Uint8Array>> {
    const requestId = `browser-read-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingBrowserReads.set(requestId, resolve);
      this.vscode.postMessage({ type: "browser-read", requestId, path });
    });
  }

  /** Follow a link to the document at `path`; the extension host opens it in its own editor and remembers the way back. */
  visit(path: string): Promise<VisitOutcome> {
    const requestId = `visit-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingVisits.set(requestId, resolve);
      this.vscode.postMessage({ type: "visit", requestId, path });
    });
  }

  returnFromVisit(): Promise<ReturnOutcome> {
    const requestId = `return-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingReturns.set(requestId, resolve);
      this.vscode.postMessage({ type: "return-visit", requestId });
    });
  }

  /** Let the user choose an asset for a field, through the extension host's own pick list. */
  pickAsset(request: AssetPickRequest): Promise<PickOutcome> {
    const requestId = `pick-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingPicks.set(requestId, resolve);
      this.vscode.postMessage({ type: "pick-asset", requestId, request });
    });
  }

  resolveConflict(choice: ConflictChoice): Promise<ConflictResult> {
    const requestId = `resolve-${++this.nextRequest}`;
    return new Promise((resolve) => {
      this.pendingResolutions.set(requestId, resolve);
      this.vscode.postMessage({ type: "resolve-conflict", choice, requestId });
    });
  }

  receive(message: BridgeMessage): void {
    if (message.type === "settle") {
      const requestId = message.requestId;
      void this.pendingEdits.settle().then(() => this.vscode.postMessage({ type: "settled", requestId }));
      return;
    }
    if (message.type === "board-preferences") {
      this.preferences = message.preferences;
      for (const listener of [...this.preferenceListeners]) listener();
      return;
    }
    if (message.type === "browser-state") {
      this.applyingBrowserState = true;
      try {
        applyBrowserStatePatch(this.browserSession, message.changes);
      } finally {
        this.applyingBrowserState = false;
      }
      return;
    }
    if (message.type === "browser-list-result") {
      this.settle(this.pendingBrowserLists, message.requestId, message.result);
      return;
    }
    if (message.type === "browser-read-result") {
      this.settle(this.pendingBrowserReads, message.requestId, message.result);
      return;
    }
    if (message.type === "read-project-result") {
      this.settle(this.pendingProjectReads, message.requestId, message.result);
      return;
    }
    if (message.type === "preview-result") {
      this.settle(this.pendingPreviews, message.requestId, message.picture);
      return;
    }
    if (message.type === "visit-result") return void this.settle(this.pendingVisits, message.requestId, message.outcome);
    if (message.type === "return-result") return void this.settle(this.pendingReturns, message.requestId, message.outcome);
    if (message.type === "pick-result") return void this.settle(this.pendingPicks, message.requestId, message.outcome);
    if (message.type === "initialize") return;
    this.snapshot = message.type === "save-result" && !message.result.ok && message.snapshot.saveError === null
      ? { ...message.snapshot, saving: false, saveError: message.result.failure }
      : message.snapshot;
    if (message.type === "edit-result") this.settle(this.pendingEdits, message.requestId, message.result);
    else if (message.type === "save-result") this.settle(this.pendingSaves, message.requestId, message.result);
    else if (message.type === "conflict-result") this.settle(this.pendingResolutions, message.requestId, message.result);
    this.notify();
  }

  private settle<T>(pending: Map<string, (result: T) => void>, requestId: string, result: T): void {
    const resolve = pending.get(requestId);
    if (resolve === undefined) return;
    pending.delete(requestId);
    resolve(result);
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}
