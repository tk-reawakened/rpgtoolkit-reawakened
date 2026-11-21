import { tileToPixel, type BoardPoint, type BoardVector } from "@tk-reawakened/core";
import { sceneCellCount, type Scene } from "@tk-reawakened/native-data";

type Edge = { readonly from: BoardPoint; readonly to: BoardPoint };
const pointKey = (point: BoardPoint): string => `${point.x},${point.y}`;
const edgeKey = (edge: Edge): string => `${pointKey(edge.from)}>${pointKey(edge.to)}`;

function footprint(scene: Scene, x: number, y: number): readonly BoardPoint[] {
  const centre = tileToPixel(scene.projection, scene.size.width, x + 1, y + 1);
  if (scene.projection === "2d") return [
    { x: centre.x - 16, y: centre.y - 31 }, { x: centre.x + 16, y: centre.y - 31 },
    { x: centre.x + 16, y: centre.y + 1 }, { x: centre.x - 16, y: centre.y + 1 },
  ];
  return [
    { x: centre.x, y: centre.y - 16 }, { x: centre.x + 32, y: centre.y },
    { x: centre.x, y: centre.y + 16 }, { x: centre.x - 32, y: centre.y },
  ];
}

function turn(from: BoardPoint, at: BoardPoint, to: BoardPoint): number {
  const ax = at.x - from.x;
  const ay = at.y - from.y;
  const bx = to.x - at.x;
  const by = to.y - at.y;
  const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function contourEdges(scene: Scene, slots: ReadonlySet<number>, floorIndex: number): Edge[] {
  const count = sceneCellCount(scene);
  const width = scene.projection === "iso-rotated" ? scene.size.width + scene.size.height : scene.size.width;
  const edges = new Map<string, Edge>();
  let cell = 0;
  for (const [runCount, paletteIndex] of scene.floors[floorIndex]?.tiles ?? []) {
    if (slots.has(paletteIndex)) for (let offset = 0; offset < runCount && cell + offset < count; offset += 1) {
      const position = cell + offset;
      const x = position % width;
      const y = Math.floor(position / width);
      const corners = footprint(scene, x, y);
      for (let side = 0; side < corners.length; side += 1) {
        const edge = { from: corners[side]!, to: corners[(side + 1) % corners.length]! };
        const reverse = `${pointKey(edge.to)}>${pointKey(edge.from)}`;
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(edgeKey(edge), edge);
      }
    }
    cell += runCount;
  }
  return [...edges.values()];
}

function loops(edges: readonly Edge[]): BoardPoint[][] {
  const orderedEdges = [...edges].sort((a, b) => a.from.y - b.from.y || a.from.x - b.from.x || a.to.y - b.to.y || a.to.x - b.to.x);
  const outgoing = new Map<string, Edge[]>();
  for (const edge of orderedEdges) {
    const key = pointKey(edge.from);
    const group = outgoing.get(key);
    if (group === undefined) outgoing.set(key, [edge]);
    else group.push(edge);
  }
  const visited = new Set<string>();
  const result: BoardPoint[][] = [];
  for (const first of orderedEdges) {
    if (visited.has(edgeKey(first))) continue;
    visited.add(edgeKey(first));
    const points = [first.from, first.to];
    while (pointKey(points[points.length - 1]!) !== pointKey(first.from)) {
      const at = points[points.length - 1]!;
      const previous = points[points.length - 2]!;
      const candidates = (outgoing.get(pointKey(at)) ?? []).filter((edge) => !visited.has(edgeKey(edge)));
      if (candidates.length === 0) break;
      candidates.sort((a, b) => turn(previous, at, a.to) - turn(previous, at, b.to) || a.to.y - b.to.y || a.to.x - b.to.x);
      const next = candidates[0]!;
      visited.add(edgeKey(next));
      points.push(next.to);
    }
    if (points.length > 2 && pointKey(points[points.length - 1]!) === pointKey(first.from)) points.pop();
    const simplified = points.filter((point, index) => {
      const previous = points[(index + points.length - 1) % points.length]!;
      const next = points[(index + 1) % points.length]!;
      return (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x);
    });
    if (simplified.length >= 3) result.push(simplified);
  }
  return result;
}

function signedArea(points: readonly BoardPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += point.x * next.y - next.x * point.y;
  }
  return area;
}

/** Build simplified deterministic union boundaries for one floor's selected palette slots. */
export function traceSceneBoundaries(scene: Scene, floorIndex: number, paletteSlots: readonly number[]): BoardVector[] {
  const selected = new Set(paletteSlots);
  const contours = loops(contourEdges(scene, selected, floorIndex));
  const startIndex = (points: readonly BoardPoint[]): number => points.reduce((best, point, index) =>
    point.y < points[best]!.y || point.y === points[best]!.y && point.x < points[best]!.x ? index : best, 0);
  contours.sort((a, b) => {
    const first = startIndex(a);
    const second = startIndex(b);
    const firstPoint = a[first]!;
    const secondPoint = b[second]!;
    const firstDirection = (Math.atan2(a[(first + 1) % a.length]!.y - firstPoint.y, a[(first + 1) % a.length]!.x - firstPoint.x) + Math.PI * 2) % (Math.PI * 2);
    const secondDirection = (Math.atan2(b[(second + 1) % b.length]!.y - secondPoint.y, b[(second + 1) % b.length]!.x - secondPoint.x) + Math.PI * 2) % (Math.PI * 2);
    return firstPoint.y - secondPoint.y || firstPoint.x - secondPoint.x || firstDirection - secondDirection;
  });
  return contours.map((points) => {
    const hole = signedArea(points) < 0;
    const first = points.reduce((best, point, index) => point.y < points[best]!.y || point.y === points[best]!.y && point.x < points[best]!.x ? index : best, 0);
    const ordered = [...points.slice(first), ...points.slice(0, first)];
    return { points: hole ? ordered : [...ordered, ordered[0]!], attributes: 0, closed: hole ? -1 : 0, layer: floorIndex + 1, type: 1, handle: "" };
  });
}
