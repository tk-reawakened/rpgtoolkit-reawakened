/**
 * The WebGL2 draw-list replayer (AD-3, AD-4, AD-27; guard-rail G4).
 *
 * A renderer receives a `DrawList` and produces pixels. It owns no loop, no game state and no logic, and every cache it
 * keeps can be flushed between frames without changing a pixel (G4 rule 3). What it does carry is the arithmetic of
 * AD-3's pixel pipeline: colour-key exclusion on the untinted source, `clamp(src + tint, 0, 255)`, and the three
 * blends. The agreement bound with the reference rasteriser is D-7: exact on key, tint and blend choice, at most one
 * unit per channel on the blend arithmetic.
 *
 * The draw list is drawn at its logical resolution — the canvas is sized to `DrawList.width × height` and presentation
 * scaling (integer letterbox or expand-viewport, AD-33) is the host's, so no command is ever drawn at a fractional
 * coordinate.
 *
 * Not yet drawn, and named rather than faked: `text` (a glyph atlas and the AD-15 metrics land with entry 9.4, which
 * also owns the exact match for ellipses and the `.iso` projection), and `iso2d` blits, which report a diagnostic. The
 * counters in `RenderStats` say how many commands were deferred, so a caller can never mistake a partial frame for a
 * complete one.
 */

import type { AssetKey, DrawList, SurfaceId } from "@tk-reawakened/core";

/** Decoded straight RGBA pixels, the shape `core/formats/image` produces and `surfacePixels` returns. */
export type TexturePixels = {
  readonly w: number;
  readonly h: number;
  readonly rgba: Uint8Array;
};

/** Where the renderer gets an asset's decoded pixels; `null` means the host cannot supply it. */
export type TextureProvider = (asset: AssetKey) => TexturePixels | null;
/** Where the renderer gets a surface's pixels at a revision (AD-27); `null` for an unknown or stale revision. */
export type SurfaceProvider = (id: SurfaceId, rev: number) => TexturePixels | null;

export type RenderStats = {
  readonly drawn: number;
  readonly deferred: number;
  readonly deferredByKind: { readonly [kind: string]: number };
  readonly diagnostics: readonly string[];
};

export interface Webgl2Renderer {
  /** Replay one frame; a second call is a new frame and keeps the caches. */
  render(list: DrawList, textures: TextureProvider, surfaces?: SurfaceProvider): RenderStats;
  /** Flush every cache; the next frame must produce identical pixels (G4 rule 3). */
  flush(): void;
  dispose(): void;
}

type Uploaded = { readonly texture: WebGLTexture; readonly w: number; readonly h: number; readonly cacheKey: string };

const VERTEX = `#version 300 es
in vec2 aUnit;
uniform vec4 uRect;
uniform vec2 uViewport;
out vec2 vLocal;
void main() {
  vec2 px = uRect.xy + aUnit * uRect.zw;
  vec2 clip = (px / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = aUnit;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
out vec4 outColor;
uniform sampler2D uTex;
uniform int uMode;
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uAlpha;
uniform int uKeyOn;
uniform vec3 uKey;
uniform ivec2 uSrcOrigin;
uniform ivec2 uSrcSize;
uniform ivec2 uDstSize;
void main() {
  if (uMode == 0 || uMode == 2) {
    // Nearest, with the reference rasteriser's mapping: source = src.origin + floor(dest * src / dst).
    ivec2 at = ivec2(int(floor(vLocal.x * float(uDstSize.x) + 0.0001)), int(floor(vLocal.y * float(uDstSize.y) + 0.0001)));
    ivec2 texel = ivec2(uSrcOrigin.x + at.x * uSrcSize.x / uDstSize.x, uSrcOrigin.y + at.y * uSrcSize.y / uDstSize.y);
    vec4 texelValue = texelFetch(uTex, texel, 0);
    if (texelValue.a == 0.0) discard;
    if (uKeyOn == 1 && texelValue.r * 255.0 == uKey.r && texelValue.g * 255.0 == uKey.g && texelValue.b * 255.0 == uKey.b) discard;
    // R-15: with a non-zero tint, pure white becomes 245 and pure black 10 before the tint is added (tiles.md#shading).
    vec3 src = texelValue.rgb * 255.0;
    if (uTint.r != 0.0 || uTint.g != 0.0 || uTint.b != 0.0) {
      src = vec3(
        src.r == 255.0 ? 245.0 : (src.r == 0.0 ? 10.0 : src.r),
        src.g == 255.0 ? 245.0 : (src.g == 0.0 ? 10.0 : src.g),
        src.b == 255.0 ? 245.0 : (src.b == 0.0 ? 10.0 : src.b));
    }
    vec3 c = clamp(src + uTint, 0.0, 255.0) / 255.0;
    // A normal blit copies the texture's own alpha; a blend is weighted by the command's alpha, never the texture's (AD-3).
    outColor = vec4(c, uMode == 0 ? texelValue.a : uAlpha);
    return;
  }
  outColor = vec4(uColor, uAlpha);
}`;

function compile(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind);
  if (shader === null) throw new Error("render-webgl2: could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "no log";
    gl.deleteShader(shader);
    throw new Error(`render-webgl2: shader did not compile: ${log}`);
  }
  return shader;
}

/** The source rectangle on the texture for a blit: a tileset is a strip whose tile `n` starts at `(n-1)*32` (or 64). */
function sourceOrigin(command: Extract<DrawList["commands"][number], { kind: "blit" }>): { x: number; y: number; cacheKey: string; asset: AssetKey | null; surface: number | null; rev: number } {
  if ("asset" in command.source) {
    const tile = command.source.tile;
    const origin = tile === null ? 0 : (tile - 1) * (command.source.asset.endsWith(".iso") ? 64 : 32);
    return { x: origin + command.src.x, y: command.src.y, cacheKey: `asset:${command.source.asset}`, asset: command.source.asset, surface: null, rev: 0 };
  }
  return { x: command.src.x, y: command.src.y, cacheKey: `surface:${command.source.surface}:${command.source.rev}`, asset: null, surface: command.source.surface, rev: command.source.rev };
}

/**
 * Create the replayer for one WebGL2 context. The context must be created with `premultipliedAlpha: false` so a
 * `normal` blit copies the texture's straight RGBA exactly, as `core/raster` does.
 */
export function createWebgl2Renderer(gl: WebGL2RenderingContext): Webgl2Renderer {
  const program = gl.createProgram();
  if (program === null) throw new Error("render-webgl2: could not create a program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`render-webgl2: program did not link: ${gl.getProgramInfoLog(program) ?? "no log"}`);
  }
  const uniform = (name: string): WebGLUniformLocation => {
    const location = gl.getUniformLocation(program, name);
    if (location === null) throw new Error(`render-webgl2: missing uniform ${name}`);
    return location;
  };
  const uRect = uniform("uRect");
  const uViewport = uniform("uViewport");
  const uMode = uniform("uMode");
  const uSrcOrigin = uniform("uSrcOrigin");
  const uSrcSize = uniform("uSrcSize");
  const uDstSize = uniform("uDstSize");
  const uColor = uniform("uColor");
  const uTint = uniform("uTint");
  const uAlpha = uniform("uAlpha");
  const uKeyOn = uniform("uKeyOn");
  const uKey = uniform("uKey");
  const uTex = uniform("uTex");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const aUnit = gl.getAttribLocation(program, "aUnit");

  /** Uploaded textures by cache key; a flush drops them all (G4 rule 3). */
  let uploaded = new Map<string, Uploaded>();
  let disposed = false;

  function upload(cacheKey: string, pixels: TexturePixels, previous?: Uploaded): Uploaded {
    const existing = uploaded.get(cacheKey);
    if (existing !== undefined) return existing;
    const texture = previous?.texture ?? gl.createTexture();
    if (texture === null) throw new Error("render-webgl2: could not create a texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, pixels.w, pixels.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels.rgba);
    const result: Uploaded = { texture, w: pixels.w, h: pixels.h, cacheKey };
    uploaded.set(cacheKey, result);
    return result;
  }

  /** Scratch targets for `pushTarget`/`popTarget`: frame-scoped, cleared at push (AD-27). */
  const scratchStack: { texture: WebGLTexture; framebuffer: WebGLFramebuffer }[] = [];

  function bindDefaultFramebuffer(): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** The blend state AD-3 sets for one command; the alpha channel is the CPU's, never the blend's. */
  function setBlend(mode: "normal" | "translucent" | "additive"): void {
    if (mode === "normal") {
      gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
      return;
    }
    gl.blendFuncSeparate(gl.SRC_ALPHA, mode === "additive" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  }

  /** A quad in logical pixels; `source` is the texel rectangle it samples, in the texture's own pixels. */
  type Source = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  function drawQuad(rect: { x: number; y: number; w: number; h: number }, source?: Source): void {
    gl.uniform4f(uRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform2i(uDstSize, rect.w, rect.h);
    if (source === undefined) gl.uniform2i(uSrcSize, 0, 0);
    else {
      gl.uniform2i(uSrcOrigin, source.x, source.y);
      gl.uniform2i(uSrcSize, source.w, source.h);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  return {
    render(list: DrawList, textures: TextureProvider, surfaces?: SurfaceProvider): RenderStats {
      if (disposed) throw new Error("render-webgl2: renderer was disposed");
      let drawn = 0;
      let deferred = 0;
      const deferredByKind: { [kind: string]: number } = {};
      const diagnostics: string[] = [];
      const defer = (kind: string, why: string): void => {
        deferred += 1;
        deferredByKind[kind] = (deferredByKind[kind] ?? 0) + 1;
        if (!diagnostics.includes(why)) diagnostics.push(why);
      };

      if (gl.drawingBufferWidth !== list.width || gl.drawingBufferHeight !== list.height) {
        gl.canvas.width = list.width;
        gl.canvas.height = list.height;
      }
      gl.viewport(0, 0, list.width, list.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aUnit);
      gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uViewport, list.width, list.height);
      gl.uniform1i(uTex, 0);
      gl.enable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (const command of list.commands) {
        switch (command.kind) {
          case "fill": {
            gl.uniform1i(uMode, 1);
            gl.uniform1i(uKeyOn, 0);
            gl.uniform3f(uColor, command.rgb.r / 255, command.rgb.g / 255, command.rgb.b / 255);
            gl.uniform1f(uAlpha, 1);
            setBlend("normal");
            drawQuad({ x: 0, y: 0, w: list.width, h: list.height });
            drawn += 1;
            break;
          }
          case "rect": {
            gl.uniform1i(uMode, 1);
            gl.uniform1i(uKeyOn, 0);
            gl.uniform3f(uColor, command.rgb.r / 255, command.rgb.g / 255, command.rgb.b / 255);
            gl.uniform1f(uAlpha, 1);
            setBlend("normal");
            if (command.filled) drawQuad(command.rect);
            else {
              const { x, y, w, h } = command.rect;
              drawQuad({ x, y, w, h: 1 });
              drawQuad({ x, y: y + h - 1, w, h: 1 });
              drawQuad({ x, y, w: 1, h });
              drawQuad({ x: x + w - 1, y, w: 1, h });
            }
            drawn += 1;
            break;
          }
          case "line":
          case "ellipse": {
            // The 1-pixel Bresenham line and the integer midpoint ellipse are a rasterisation rule, not a quad: drawing
            // a box and calling it a line would be a wrong pixel with no trace. Deferred by name until 9.4.
            defer(command.kind, `webgl2.${command.kind}-deferred: exact ${command.kind} rasterisation is entry 9.4's`);
            break;
          }
          case "blit": {
            if (command.iso2d) {
              defer("blit", "webgl2.iso2d-deferred: the .iso projection is entry 9.4's");
              break;
            }
            const origin = sourceOrigin(command);
            let pixels: TexturePixels | null;
            let cacheKey: string;
            if (origin.asset !== null) {
              pixels = textures(origin.asset);
              cacheKey = origin.cacheKey;
            } else if (surfaces !== undefined && origin.surface !== null) {
              pixels = surfaces(origin.surface as SurfaceId, origin.rev);
              cacheKey = origin.cacheKey;
            } else {
              defer("blit", "webgl2.no-source: a surface blit with no surface provider");
              break;
            }
            if (pixels === null) {
              defer("blit", `webgl2.missing-texture: ${origin.asset ?? `surface ${String(origin.surface)}`}`);
              break;
            }
            const texture = upload(cacheKey, pixels);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture.texture);
            gl.uniform3f(uTint, command.tint.r, command.tint.g, command.tint.b);
            if (command.key === null) gl.uniform1i(uKeyOn, 0);
            else {
              gl.uniform1i(uKeyOn, 1);
              gl.uniform3f(uKey, command.key.r, command.key.g, command.key.b);
            }
            gl.uniform1f(uAlpha, command.alpha / 255);
            gl.uniform1i(uMode, command.blend === "normal" ? 0 : 2);
            setBlend(command.blend);
            drawQuad(command.dst, { x: origin.x, y: origin.y, w: command.src.w, h: command.src.h });
            drawn += 1;
            break;
          }
          case "pushTarget": {
            const texture = gl.createTexture();
            const framebuffer = gl.createFramebuffer();
            if (texture === null || framebuffer === null) throw new Error("render-webgl2: could not create a scratch target");
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, list.width, list.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.viewport(0, 0, list.width, list.height);
            scratchStack.push({ texture, framebuffer });
            drawn += 1;
            break;
          }
          case "popTarget": {
            // The reference pops the target stack and nothing else: a scratch target is frame-scoped state that no
            // blit source can name (AD-27), so popping restores the parent and draws no pixel.
            const top = scratchStack.pop();
            if (top === undefined) {
              defer("popTarget", "webgl2.unbalanced-pop: popTarget without pushTarget");
              break;
            }
            gl.deleteFramebuffer(top.framebuffer);
            gl.deleteTexture(top.texture);
            const parent = scratchStack.at(-1);
            if (parent === undefined) bindDefaultFramebuffer();
            else gl.bindFramebuffer(gl.FRAMEBUFFER, parent.framebuffer);
            drawn += 1;
            break;
          }
          case "text": {
            defer("text", "webgl2.text-deferred: the glyph atlas and AD-15 metrics are entry 9.4's");
            break;
          }
          default: {
            const _never: never = command;
            throw new TypeError(`render-webgl2: unknown draw command ${JSON.stringify(_never)}`);
          }
        }
      }
      for (const entry of scratchStack.splice(0)) {
        gl.deleteFramebuffer(entry.framebuffer);
        gl.deleteTexture(entry.texture);
      }
      bindDefaultFramebuffer();
      gl.disable(gl.BLEND);
      return { drawn, deferred, deferredByKind, diagnostics };
    },
    flush(): void {
      for (const entry of uploaded.values()) gl.deleteTexture(entry.texture);
      uploaded = new Map();
    },
    dispose(): void {
      if (disposed) return;
      for (const entry of uploaded.values()) gl.deleteTexture(entry.texture);
      uploaded = new Map();
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      disposed = true;
    },
  };
}

