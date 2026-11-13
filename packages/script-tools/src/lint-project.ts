import {
  ENGINE_PLUGIN_TABLE,
  BinaryReader,
  IR_VERSION,
  PACKAGE_ROOT,
  assetKey,
  decodeCp1252,
  fnv1a64,
  foldAscii,
  mainFileLegacyPluginRows,
  projectFolder,
  readCharacter,
  readEnemy,
  readHydratableBoard,
  readItem,
  readSpecialMove,
  readStatusEffect,
  resolveAsset,
  resolveProgram,
  resolveReference,
  typeFolder,
  type AssetIndex,
  type AssetKind,
  type AssetRoot,
  type MainFile,
  type ProgramLoader,
  type ResolvedPlugin,
} from "@tk-reawakened/core";
import { buildIndex, type IndexDocument, type IndexProgramInput, type IndexStartup } from "./index-document.ts";

/** The file references the engine can start directly (main-file layout and E-02). */
function entryFiles(main: MainFile): string[] {
  return [
    main.startupPrg,
    main.runTimePrg,
    ...main.extKeys.map((entry) => entry.program),
    main.gameOverPrg,
    ...(main.useCustomFightPrg !== 0 ? [main.customFightPrg] : []),
  ].filter((name) => name !== "");
}

export function lintProjectRoot(main: MainFile, index: AssetIndex): AssetRoot {
  const project = { kind: "game", projectPath: main.projectPath } as const;
  const prefix = assetKey(projectFolder("", project));
  return main.projectPath !== "" && index.keys.some((key) => key.startsWith(prefix)) ? project : PACKAGE_ROOT;
}

/** Paths that can contain engine-called scripts, across the two project layouts. */
const HOOK_ASSETS = ["boards", "items", "characters", "enemies", "specialMoves", "statusEffects"] as const satisfies readonly AssetKind[];
const HOOK_FOLDERS = new Set(HOOK_ASSETS.map((kind) => foldAscii(typeFolder(kind))));

export function isLintHookAssetPath(path: string): boolean {
  const parts = assetKey(path).split("/");
  if (parts.length < 2) return false;
  if (parts[0] !== "game") return HOOK_FOLDERS.has(parts[0]!);
  return parts.slice(2, -1).some((part) => HOOK_FOLDERS.has(part));
}

function addAssetHooks(loader: ProgramLoader, main: MainFile, programs: IndexProgramInput[]): boolean {
  const { index, root } = loader;
  const prefixes = HOOK_ASSETS.map((kind) => ({
    kind,
    prefix: assetKey(root.kind === "game" ? resolveReference("", root, kind, "") : `${typeFolder(kind)}/`),
  }));
  const files: string[] = [];
  const add = (key: string, field: string, source: string): void => {
    if (source === "") return;
    if (foldAscii(source).endsWith(".prg")) files.push(source);
    else programs.push({ name: `${key}#${field}`, ref: { kind: "inline", text: source, ir: IR_VERSION, dialect: "tk3" } });
  };
  if (main.initBoard !== "" && !resolveAsset(index, root, "boards", main.initBoard).ok) return false;
  const seen = new Set<string>();
  for (const key of index.keys) {
    const asset = prefixes.find(({ prefix }) => key.startsWith(prefix));
    if (asset === undefined) continue;
    if (seen.has(key)) return false;
    seen.add(key);
    const bytes = loader.read(key);
    if (bytes === undefined) return false;
    const reader = new BinaryReader(bytes, key);
    if (asset.kind === "boards") {
      const parsed = readHydratableBoard(key, bytes).value;
      if (parsed === null) return false;
      files.push(parsed.properties.enterPrg, ...parsed.threads);
      files.push(...Object.values(parsed.links).filter((link) => foldAscii(link).endsWith(".prg")));
      for (const [index, trigger] of parsed.programs.entries()) add(key, `trigger-${index}`, trigger.program);
      for (const [index, sprite] of parsed.sprites.entries()) {
        if (sprite.itemFile === "") continue;
        add(key, `activate-${index}`, sprite.activationPrg);
        add(key, `multitask-${index}`, sprite.multitaskPrg);
      }
    } else if (asset.kind === "items") {
      const parsed = readItem(reader);
      if (!parsed.ok) return false;
      const item = parsed.value;
      files.push(item.onEquipProgram, item.onRemoveProgram, item.menuUseProgram, item.battleUseProgram);
      add(key, "activate", item.activationProgram);
      add(key, "multitask", item.multitaskProgram);
    } else if (asset.kind === "characters") {
      const parsed = readCharacter(reader);
      if (!parsed.ok) return false;
      files.push(parsed.value.levelUpProgram);
    } else if (asset.kind === "enemies") {
      const parsed = readEnemy(reader);
      if (!parsed.ok) return false;
      files.push(parsed.value.aiProgram, parsed.value.defeatProgram, parsed.value.runAwayProgram);
    } else if (asset.kind === "specialMoves") {
      const parsed = readSpecialMove(reader);
      if (!parsed.ok) return false;
      files.push(parsed.value.program);
    } else {
      const parsed = readStatusEffect(reader);
      if (!parsed.ok) return false;
      if (parsed.value.runProgram !== 0) files.push(parsed.value.program);
    }
  }
  return files.every((name) => {
    if (name === "") return true;
    const key = resolveProgram(loader, name);
    return key !== undefined && loader.read(key) !== undefined && /\.(prg|rnc)$/i.test(key);
  });
}

type ProjectIndex = {
  readonly document: IndexDocument;
  readonly sources: Readonly<Record<string, string>>;
  readonly gameFiles: readonly string[];
  readonly project?: { readonly closed: true; readonly entryPoints: readonly string[] };
};

/** Index the selected project's sources with the same loader that serves their includes. */
export function indexLintProject(
  main: MainFile,
  loader: ProgramLoader,
  plugins: readonly ResolvedPlugin[],
  inventoryComplete: boolean,
): ProjectIndex {
  const { index, root } = loader;
  const prefix = assetKey(root.kind === "game" ? resolveReference("", root, "programs", "") : "Prg/");
  const sources = Object.create(null) as Record<string, string>;
  const programs: IndexProgramInput[] = [];
  const seen = new Set<string>();
  let complete = inventoryComplete;
  for (const [position, key] of index.keys.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (!key.endsWith(".prg") && !key.endsWith(".rnc")) continue;
    if (seen.has(key)) {
      complete = false;
      continue;
    }
    seen.add(key);
    const bytes = loader.read(key);
    const name = index.paths[position]!;
    if (bytes === undefined) {
      complete = false;
      continue;
    }
    if (bytes[0] !== 0) sources[name] = decodeCp1252(bytes, 0, bytes.length);
    programs.push({
      name,
      ref: {
        kind: "file", path: `Prg/${key.slice(prefix.length)}`, sourceHash: fnv1a64(bytes), ir: IR_VERSION,
        ...(loader.dialect === undefined ? {} : { dialect: loader.dialect }),
      },
    });
  }
  complete &&= entryFiles(main).every((name) => {
    const key = resolveProgram(loader, name);
    return key !== undefined && seen.has(key) && loader.read(key) !== undefined;
  });
  const gameFiles = programs.map((program) => program.name);

  // A host can provide resolved package startups. Legacy DLLs without a mapping
  // install nothing (E-02); the two mapped rows can select stock RPGCode packages.
  const packageNames = new Set((main.packagePlugins ?? []).map(foldAscii));
  for (const { package: name } of mainFileLegacyPluginRows(main)) if (name !== null) packageNames.add(name);
  if (main.minor < 3 && main.packagePluginsExtension !== true && packageNames.size === 0 &&
      plugins.some((plugin) => plugin.package?.name === "stock_battle")) packageNames.add("stock_battle");
  const entryPoints = new Set<string>();
  const startups: IndexStartup[] = [];
  for (const name of packageNames) {
    if (Object.hasOwn(ENGINE_PLUGIN_TABLE, name)) continue;
    const matches = plugins.filter((plugin) => plugin.package?.name === name);
    const resolved = matches[0];
    if (matches.length !== 1 || resolved === undefined) {
      complete = false;
      continue;
    }
    if (resolved.startup === undefined) continue;
    // Package code can also call game functions and add runtime includes.
    const startupName = `<package:${name}>`;
    if (resolved.startup.kind === "inline") sources[startupName] = resolved.startup.text;
    programs.push({ name: startupName, ref: resolved.startup });
    startups.push({ program: startupName, package: name });
  }
  complete &&= addAssetHooks(loader, main, programs);
  const document = buildIndex(programs, { loader, startups });
  for (const startup of document.programs) {
    if (startup.startup.length === 0) continue;
    if (startup.diagnostics.length > 0) complete = false;
    for (const fn of startup.functions) if (fn.className === null) entryPoints.add(fn.name);
  }
  return { document, sources, gameFiles, ...(complete ? { project: { closed: true, entryPoints: [...entryPoints] } } : {}) };
}
