import { equal } from "node:assert/strict";
import { test } from "node:test";
import { pointerEventToLogical } from "../src/pointer.ts";

function makeCanvas(width: number, height: number, rect: { left: number; top: number; width: number; height: number }): HTMLCanvasElement {
  return {
    width,
    height,
    getBoundingClientRect: () => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }),
  } as unknown as HTMLCanvasElement;
}

function makeEvent(clientX: number, clientY: number): PointerEvent {
  return { clientX, clientY } as unknown as PointerEvent;
}

const viewSize = { width: 640, height: 480 };

test("1:1 layout maps client coordinates directly", () => {
  const canvas = makeCanvas(640, 480, { left: 0, top: 0, width: 640, height: 480 });
  const event = makeEvent(100, 200);
  const result = pointerEventToLogical(event, canvas, viewSize);
  equal(result.x, 100);
  equal(result.y, 200);
});

test("letterboxed layout subtracts the canvas offset and scales by the CSS ratio", () => {
  // CSS canvas is 960x720 (1.5x logical) and offset by (30, 40).
  const canvas = makeCanvas(640, 480, { left: 30, top: 40, width: 960, height: 720 });
  const event = makeEvent(30 + 150, 40 + 300);
  const result = pointerEventToLogical(event, canvas, viewSize);
  equal(result.x, 100);
  equal(result.y, 200);
});

test("downscaled portrait layout maps to logical pixels without overflow", () => {
  // A narrow CSS viewport: canvas drawn at 320x240 CSS px, centred with offset (10, 20).
  const canvas = makeCanvas(640, 480, { left: 10, top: 20, width: 320, height: 240 });
  const event = makeEvent(10 + 160, 20 + 120);
  const result = pointerEventToLogical(event, canvas, viewSize);
  equal(result.x, 320);
  equal(result.y, 240);
});

test("clamps clicks on the black surround to the nearest logical pixel", () => {
  const canvas = makeCanvas(640, 480, { left: 0, top: 0, width: 640, height: 480 });
  const event = makeEvent(700, 500);
  const result = pointerEventToLogical(event, canvas, viewSize);
  equal(result.x, 639);
  equal(result.y, 479);
});
