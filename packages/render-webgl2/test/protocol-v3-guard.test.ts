import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { DrawList, HostDisplayGeometry } from "@tk-reawakened/core";
import { createWebgl2Renderer } from "../src/index.ts";

test("WebGL replay refuses unversioned and unsupported frames before drawing", () => {
  let draws = 0;
  const canvas = { width: 0, height: 0 };
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    createProgram: () => ({}), createShader: () => ({}), createBuffer: () => ({}),
    getAttribLocation: () => 0, getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: () => ({}), drawArrays: () => { draws += 1; },
    drawArraysInstanced: () => { draws += 1; },
  };
  const gl = new Proxy({} as WebGL2RenderingContext, {
    get: (_target, key: string) => key === "canvas" ? canvas : methods[key] ?? (() => undefined),
  });
  const renderer = createWebgl2Renderer(gl);
  const geometry: HostDisplayGeometry = {
    content: { width: 1, height: 1 }, game: { x: 0, y: 0, width: 1, height: 1 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const frame = { tick: 0, width: 1, height: 1, commands: [{ kind: "fill", rgb: { r: 255, g: 0, b: 0 } }], marginCommands: [] };
  for (const invalid of [frame, { ...frame, protocolVersion: 2 }, { ...frame, protocolVersion: 4 }]) {
    throws(() => renderer.render(invalid as unknown as DrawList, geometry, { textures: () => null }), /unsupported draw-list protocol version/);
    equal(draws, 0);
    equal(canvas.width, 0);
  }
  renderer.dispose();
});
