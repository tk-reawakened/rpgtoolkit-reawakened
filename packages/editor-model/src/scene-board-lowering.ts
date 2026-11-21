import { encodeCp1252, createEmptyBoard, type Board, type BoardShadeRecord, type BoardTileRun } from "@tk-reawakened/core";
import { checkScene, sceneCellCount, type Scene } from "@tk-reawakened/native-data";

type SceneColour = readonly [number, number, number];
type ScenePoint = readonly [number, number];

export type SceneBoardLoweringResult =
  | { readonly ok: true; readonly board: Board }
  | { readonly ok: false; readonly problems: readonly { readonly path: string; readonly message: string }[] };

const rgb = ([r, g, b]: SceneColour): { r: number; g: number; b: number } => ({ r, g, b });
const point = ([x, y]: ScenePoint): { x: number; y: number } => ({ x, y });
const flag = (value: boolean | undefined): number => value === true ? -1 : 0;
const draw = (type: "normal" | "parallax" | "stretch" | undefined): number => type === "parallax" ? 1 : type === "stretch" ? 2 : 0;
const vectorTypes = { none: 0, solid: 1, under: 2, unidirectional: 4, stairs: 8, waypoint: 16 } as const;
const lightTypes = { ellipse: 0, gradient: 1, "clipped-gradient": 2 } as const;

/** Decode the standard padded base64 already validated by checkScene, without host APIs. */
function decodeBase64(text: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array(text.length / 4 * 3 - padding);
  let out = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = (alphabet.indexOf(text[i]!) << 18) | (alphabet.indexOf(text[i + 1]!) << 12)
      | ((text[i + 2] === "=" ? 0 : alphabet.indexOf(text[i + 2]!)) << 6)
      | (text[i + 3] === "=" ? 0 : alphabet.indexOf(text[i + 3]!));
    if (out < bytes.length) bytes[out++] = (n >>> 16) & 255;
    if (out < bytes.length) bytes[out++] = (n >>> 8) & 255;
    if (out < bytes.length) bytes[out++] = n & 255;
  }
  return bytes;
}

/** Lower only scene-owned fields. The caller resolves the palette and appends generated outputs. */
export function lowerSceneBoard(scene: Scene, palette: readonly string[] | null): SceneBoardLoweringResult {
  const problems: { path: string; message: string }[] = [...checkScene(scene)];
  if ((scene.terrainRegions?.length ?? 0) > 0) problems.push({ path: "terrainRegions", message: "Resolve authored terrain before lowering board cells." });
  if ((scene.tileOverrides?.length ?? 0) > 0) problems.push({ path: "tileOverrides", message: "Resolve explicit tile overrides before lowering board cells." });
  const boundedLists: readonly [string, number][] = [
    ["floors", scene.floors.length],
    ["tilePalette", scene.tilePalette?.length ?? 0],
    ["shading", scene.shading?.length ?? 0],
    ["lights", scene.lights?.length ?? 0],
    ["vectors", scene.vectors?.length ?? 0],
    ["triggers", scene.triggers?.length ?? 0],
    ["items", scene.items?.length ?? 0],
    ["images", scene.images?.length ?? 0],
    ["threads", scene.threads?.length ?? 1],
    ["constants", scene.constants?.length ?? 1],
  ];
  for (const [path, count] of boundedLists) {
    if (count > 32_768) problems.push({ path, message: `${count} entries exceed the board table limit of 32768.` });
  }
  for (const [path, count] of [
    ...((scene.lights ?? []).flatMap((light, i) => [[`lights[${i}].nodes`, light.nodes.length], [`lights[${i}].colors`, light.colors.length]] as const)),
    ...((scene.vectors ?? []).map((vector, i) => [`vectors[${i}].points`, vector.points.length] as const)),
    ...((scene.triggers ?? []).map((trigger, i) => [`triggers[${i}].points`, trigger.points?.length ?? 0] as const)),
  ]) {
    if (count > 32_768) problems.push({ path, message: `${count} entries exceed the board table limit of 32768.` });
  }
  if ((scene.tilePalette === undefined) !== (palette === null)) {
    problems.push({ path: "tilePalette", message: "The resolved palette must be absent exactly when the scene palette is absent." });
  } else if (palette !== null && scene.tilePalette !== undefined) {
    if (palette.length !== scene.tilePalette.length || palette.length === 0 || palette[0] !== "") {
      problems.push({ path: "tilePalette", message: "The resolved palette must preserve every slot and have an empty slot 0." });
    }
    scene.tilePalette.forEach((entry, i) => {
      const resolved = palette[i];
      if (typeof resolved !== "string" || (entry.legacy !== undefined && resolved !== entry.legacy)
        || (entry.legacy === undefined && entry.tileset === undefined && resolved !== "")
        || (entry.tileset !== undefined && resolved === "")) {
        problems.push({ path: `tilePalette[${i}]`, message: "The resolved reference does not represent this palette slot." });
      }
    });
  }
  if (problems.length > 0) return { ok: false, problems };

  const cells = sceneCellCount(scene);
  const floorNumbers = new Map(scene.floors.map((floor, index) => [floor.id, index + 1]));
  const layer = (ref: { readonly floor?: string; readonly layer?: number }): number => ref.floor === undefined ? (ref.layer ?? 1) : floorNumbers.get(ref.floor)!;
  const tileRuns: BoardTileRun[] = [];
  const tileMatrix: number[] = [];
  // Native scene runs are maximal within each floor, never across floors.
  const merged: { count: number; index: number }[] = [];
  for (const floor of scene.floors) {
    const boundary = merged.length;
    for (const [count, index] of floor.tiles ?? [[cells, 0]]) {
      const previous = merged.length > boundary ? merged[merged.length - 1] : undefined;
      if (previous !== undefined && previous.index === index) previous.count += count;
      else merged.push({ count, index });
    }
  }
  const tileExcess = scene.legacy?.excessTiles?.[0] ?? 0;
  for (let i = 0; i < merged.length; i++) {
    const run = merged[i]!;
    let remaining = run.count;
    const extra = i === merged.length - 1 ? tileExcess : 0;
    // Reserve at least one grid cell in the marker carrying the entire overshoot.
    while (remaining + extra > 32768) {
      const count = Math.min(32768, remaining - 1);
      tileRuns.push({ count, lutIndex: run.index, marker: count !== 1 });
      remaining -= count;
    }
    const count = remaining + extra;
    tileRuns.push({ count, lutIndex: run.index, marker: count !== 1 });
  }
  for (const run of tileRuns) for (let i = 0; i < run.count; i++) tileMatrix.push(run.lutIndex);

  const shadeLayers = (scene.shading ?? []).map((shade) => {
    const records: BoardShadeRecord[] = [];
    const runs: { count: number; r: number; g: number; b: number }[] = [];
    for (const [count, r, g, b] of shade.cells) {
      const prev = runs[runs.length - 1];
      if (prev !== undefined && prev.r === r && prev.g === g && prev.b === b) prev.count += count;
      else runs.push({ count, r, g, b });
    }
    const extra = shade.legacy?.excessCells?.[0] ?? 0;
    runs.forEach((run, i) => {
      let remaining = run.count;
      const tail = i === runs.length - 1 ? extra : 0;
      while (remaining + tail > 32767) {
        const count = Math.min(32767, remaining - 1);
        records.push({ runCount: count, r: run.r, g: run.g, b: run.b });
        remaining -= count;
      }
      records.push({ runCount: remaining + tail, r: run.r, g: run.g, b: run.b });
    });
    return { castLayer: layer(shade), records };
  });
  const background = scene.atmosphere?.background;
  const board: Board = {
    ...createEmptyBoard(),
    sizeX: scene.size.width, sizeY: scene.size.height, sizeL: scene.floors.length,
    coordType: ({ "2d": 0, "iso-stacked": 1, "iso-rotated": 2 } as const)[scene.projection] + (scene.pixelCoordinates ? 4 : 0),
    lut: palette === null ? [] : [...palette], tileRuns, tileMatrix, shadeLayers,
    lights: (scene.lights ?? []).map((l) => ({ layer: layer(l), type: lightTypes[l.type], nodes: l.nodes.map(point), colours: l.colors.map(rgb) })),
    vectors: (scene.vectors ?? []).map((v) => ({
      layer: layer(v), type: vectorTypes[v.type], closed: flag(v.closed), points: v.points.map(point), handle: v.handle ?? "",
      attributes: v.type === "under" ? (v.attributes ?? 0) : v.type === "stairs" ? (v.toFloor === undefined ? v.toLayer! : floorNumbers.get(v.toFloor)!) : 0,
    })),
    programs: (scene.triggers ?? []).map((t) => ({
      program: t.program ?? "", graphic: t.legacy?.graphic ?? "", initialVar: t.condition?.variable ?? "", initialValue: t.condition?.value ?? "",
      finalVar: t.afterRun?.variable ?? "", finalValue: t.afterRun?.value ?? "", activate: t.condition?.mode === "conditional" ? 1 : 0,
      activationType: (t.activation?.keyPress ? 1 : 0) | (t.activation?.repeat ? 2 : 0) | (t.activation?.stopsMovement ? 4 : 0),
      repeatDistance: t.activation?.repeatDistance ?? 0, layer: layer(t), points: (t.points ?? []).map(point), closed: flag(t.closed), handle: t.legacy?.reserved ?? "",
    })),
    sprites: (scene.items ?? []).map((s) => ({
      itemFile: s.item ?? "", activationPrg: s.activationProgram ?? "", multitaskPrg: s.multitaskProgram ?? "",
      initialVar: s.condition?.variable ?? "", initialValue: s.condition?.value ?? "", finalVar: s.afterRun?.variable ?? "", finalValue: s.afterRun?.value ?? "",
      loadingVar: s.loadCondition?.variable ?? "", loadingValue: s.loadCondition?.value ?? "", activate: s.condition?.mode === "conditional" ? 1 : 0,
      activationType: (s.activation?.keyPress ? 1 : 0) | (s.activation?.repeat ? 2 : 0), x: s.x, y: s.y, layer: layer(s), reserved: s.legacy?.reserved ?? -1,
    })),
    images: (scene.images ?? []).map((image) => ({ file: image.source ?? "", left: image.x, top: image.y, layer: layer(image), drawType: draw(image.type), transparent: rgb(image.transparent), reserved: image.legacy?.reserved ?? 100 })),
    threads: [...(scene.threads ?? [""])], constants: [...(scene.constants ?? [""])],
    layerTitles: [scene.legacy?.layerTitleZero ?? "", ...scene.floors.map((floor) => floor.title ?? "")],
    links: { north: scene.links?.north ?? "", south: scene.links?.south ?? "", east: scene.links?.east ?? "", west: scene.links?.west ?? "" },
    properties: {
      backgroundImage: background?.image ?? "", backgroundDrawType: draw(background?.type), backgroundColour: rgb(background?.color ?? [0, 0, 0]),
      backgroundMusic: scene.atmosphere?.music ?? "", enterPrg: scene.enterProgram ?? "", battleBackground: scene.battle?.background ?? "",
      battleSkill: scene.battle?.skill ?? 0, allowBattles: flag(scene.battle?.allowed), disableSaving: flag(scene.savingDisabled),
      ambient: rgb(scene.atmosphere?.ambient ?? [0, 0, 0]), start: { x: scene.start?.x ?? 64, y: scene.start?.y ?? 64, layer: scene.start === undefined ? 1 : layer(scene.start) },
    },
    residue: decodeBase64(scene.legacy?.trailingBytes ?? ""),
  };
  // Board strings are NUL-terminated. Check all of them, including resolved references,
  // at their model paths before the writer has a chance to produce an unreadable file.
  const checkStrings = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      const encoded = encodeCp1252(value);
      if (value.includes("\0")) problems.push({ path, message: "A board string cannot contain NUL." });
      else if (!encoded.ok) problems.push({ path, message: encoded.error.message });
    } else if (Array.isArray(value)) value.forEach((entry, i) => checkStrings(entry, `${path}[${i}]`));
    else if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) {
      for (const [key, entry] of Object.entries(value)) checkStrings(entry, path === "" ? key : `${path}.${key}`);
    }
  };
  checkStrings(board, "");
  return problems.length === 0 ? { ok: true, board } : { ok: false, problems };
}
