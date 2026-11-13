/**
 * The running project the server analyses against
 * (docs/spec/engine/rpgcode-tooling.md#tool-1-project).
 *
 * A snapshot from the client becomes one immutable model: the dialect the
 * main file selects, the asset index and root its includes resolve through,
 * the original URI of every folded key and the lint configuration. Anything the
 * snapshot cannot establish leaves the project unassessed with a reason; this
 * module never guesses a root, a dialect or a file.
 */

import {
  BinaryReader,
  createAssetIndex,
  encodeCp1252,
  projectScriptDialect,
  readMainFile,
  type AssetIndex,
  type AssetKey,
  type AssetRoot,
  type MainFile,
  type ProgramLoader,
  type ScriptDialect,
} from "@tk-reawakened/core";
import { lintProjectRoot } from "@tk-reawakened/script-tools";
import { decodeBase64, isHookAssetPath, isProgramPath, projectRootUri, type ProjectSnapshot } from "./protocol.ts";

export type ProjectModel =
  | { readonly kind: "none"; readonly revision: number; readonly reason: string }
  | {
      readonly kind: "project";
      readonly revision: number;
      readonly mainUri: string;
      readonly main: MainFile;
      readonly inventoryComplete: boolean;
      readonly rootUri: string;
      readonly dialect: ScriptDialect;
      readonly index: AssetIndex;
      readonly root: AssetRoot;
      /** Canonical key to the original URI, first-wins like the resolver. */
      readonly uriOfKey: ReadonlyMap<string, string>;
      /** Document URI to its canonical key, for every inventory file. */
      readonly keyOfUri: ReadonlyMap<string, AssetKey>;
      /** Document URI to its root-relative path, the name `tkr script check` reports it under. */
      readonly pathOfUri: ReadonlyMap<string, string>;
      readonly bytes: ReadonlyMap<string, Uint8Array>;
      /** `tkr-lint.json` at the root, or `null` when the project has none. */
      readonly lintConfig: { readonly uri: string; readonly text: string } | null;
    };

/** No snapshot yet: the client has not told the server about a project. */
export const NO_PROJECT: ProjectModel = { kind: "none", revision: -1, reason: "no running project (.gam) is selected" };

function none(revision: number, reason: string): ProjectModel {
  return { kind: "none", revision, reason };
}

/** Build the model of a snapshot; a snapshot that does not establish a project gives the reason why. */
export function projectModel(snapshot: ProjectSnapshot): ProjectModel {
  const revision = snapshot.revision;
  if (snapshot.problem !== undefined) return none(revision, `the running project could not be read: ${snapshot.problem}`);
  if (snapshot.main === null) return none(revision, "no running project (.gam) is selected");
  const rootUri = projectRootUri(snapshot.main.uri);
  if (snapshot.rootUri !== undefined && snapshot.rootUri !== rootUri) {
    return none(revision, `the project root ${snapshot.rootUri} is not the root of ${snapshot.main.uri} (${rootUri})`);
  }
  const mainBytes = decodeBase64(snapshot.main.bytes);
  if (mainBytes === undefined) return none(revision, `the bytes of ${snapshot.main.uri} are not base64`);
  const main = readMainFile(new BinaryReader(mainBytes, snapshot.main.uri));
  if (!main.ok) return none(revision, `${snapshot.main.uri} is not a readable main file: ${main.error.message}`);

  const files = (snapshot.files ?? []).filter((file) => isProgramPath(file.path) || isHookAssetPath(file.path));
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const index = createAssetIndex(paths);
  const uriOfKey = new Map<string, string>();
  const keyOfUri = new Map<string, AssetKey>();
  const pathOfUri = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  for (const [position, file] of files.entries()) {
    const key = index.keys[position]!;
    const decoded = decodeBase64(file.bytes);
    if (decoded === undefined) return none(revision, `the bytes of ${file.uri} are not base64`);
    if (isProgramPath(file.path) && !isHookAssetPath(file.path)) {
      keyOfUri.set(file.uri, key);
      pathOfUri.set(file.uri, paths[position]!);
    }
    if (uriOfKey.has(key)) continue;
    uriOfKey.set(key, file.uri);
    bytes.set(key, decoded);
  }

  // A Toolkit folder keeps the project under Game/<projectPath>/; a loose folder or a
  // package is its own root and ignores projectPath (docs/spec/formats/packaging-and-paths.md).
  const root = lintProjectRoot(main.value, index);

  return {
    kind: "project",
    revision,
    mainUri: snapshot.main.uri,
    main: main.value,
    inventoryComplete: snapshot.files !== undefined && snapshot.hookInventoryComplete === true,
    rootUri,
    dialect: projectScriptDialect(main.value),
    index,
    root,
    uriOfKey,
    keyOfUri,
    pathOfUri,
    bytes,
    lintConfig: snapshot.lintConfig ?? null,
  };
}

/** What the server knows about one document: assessed against the project, or unassessed with the reason. */
export type DocumentContext =
  | { readonly kind: "assessed"; readonly project: Extract<ProjectModel, { kind: "project" }>; readonly key: AssetKey; readonly dialect: ScriptDialect }
  | { readonly kind: "unassessed"; readonly reason: string; readonly dialect: ScriptDialect };

/** The provisional reading of an unassessed document: its language mode, never a project fact. */
export function languageModeDialect(languageId: string): ScriptDialect {
  return languageId === "rpgcode-tk2" ? "tk2" : "tk3";
}

export function documentContext(project: ProjectModel, uri: string, languageId: string): DocumentContext {
  const provisional = languageModeDialect(languageId);
  if (project.kind === "none") return { kind: "unassessed", reason: project.reason, dialect: provisional };
  const key = project.keyOfUri.get(uri);
  if (key === undefined) {
    return { kind: "unassessed", reason: `this file is not a program of the running project ${project.mainUri}`, dialect: provisional };
  }
  return { kind: "assessed", project, key, dialect: project.dialect };
}

/**
 * The loader the compiler reads includes through. An open buffer supersedes the
 * snapshot's bytes for its URI. A buffer that cannot be written as Windows-1252
 * cannot supply project facts until the encoding problem is resolved.
 */
export function projectLoader(
  project: Extract<ProjectModel, { kind: "project" }>,
  openText: (uri: string) => string | undefined,
): ProgramLoader {
  return {
    index: project.index,
    root: project.root,
    dialect: project.dialect,
    read: (key) => {
      const uri = project.uriOfKey.get(key);
      const text = uri === undefined || !project.keyOfUri.has(uri) ? undefined : openText(uri);
      if (text !== undefined) {
        const encoded = encodeCp1252(text);
        return encoded.ok ? encoded.value : undefined;
      }
      return project.bytes.get(key);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check a notification's params against the snapshot shape. A params object
 * without a numeric revision is ignored; one with a revision but a malformed
 * body becomes a snapshot that reports the problem, so a broken client leaves
 * every document unassessed instead of keeping a stale project.
 */
export function readSnapshot(value: unknown): ProjectSnapshot | undefined {
  if (!isRecord(value) || typeof value.revision !== "number" || !Number.isFinite(value.revision)) return undefined;
  const revision = value.revision;
  const malformed = (what: string): ProjectSnapshot => ({ revision, main: null, problem: `the rpgcode/project snapshot is malformed (${what})` });
  if (typeof value.problem === "string") return { revision, main: null, problem: value.problem };
  const main = value.main;
  if (main !== null && !(isRecord(main) && typeof main.uri === "string" && typeof main.bytes === "string")) return malformed("main");
  if (main === null) return { revision, main: null };
  if (value.rootUri !== undefined && typeof value.rootUri !== "string") return malformed("rootUri");
  if (value.hookInventoryComplete !== undefined && typeof value.hookInventoryComplete !== "boolean") return malformed("hookInventoryComplete");
  const files = value.files;
  if (files !== undefined && !Array.isArray(files)) return malformed("files");
  for (const file of files ?? []) {
    if (!isRecord(file) || typeof file.path !== "string" || typeof file.uri !== "string" || typeof file.bytes !== "string") return malformed("files");
  }
  const lint = value.lintConfig ?? null;
  if (lint !== null && !(isRecord(lint) && typeof lint.uri === "string" && typeof lint.text === "string")) return malformed("lintConfig");
  return {
    revision,
    main: { uri: main.uri as string, bytes: main.bytes as string },
    ...(value.rootUri === undefined ? {} : { rootUri: value.rootUri as string }),
    ...(files === undefined ? {} : { files: files as NonNullable<ProjectSnapshot["files"]> }),
    ...(value.hookInventoryComplete === true ? { hookInventoryComplete: true } : {}),
    lintConfig: lint as { readonly uri: string; readonly text: string } | null,
  };
}
