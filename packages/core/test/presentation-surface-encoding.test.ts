import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createGameState } from "../src/save/state.ts";
import type { SurfaceId } from "../src/ports/keys.ts";
import { beginSurfaceBatch, colourSurface, createSurfacesSection, editSurface, editSurfaceWithBounds, encodeSurfaceBytes, endSurfaceBatch, flushSurfaceBatch, killSurface, materializePresentedSurfaces, presentSurfaceFrame, readSurfacePixels, replaceSurface, surfaceBytesEncodedForDiagnostics } from "../src/raster/surfaces.ts";
import { guardExternalPlugins } from "../src/engine/surface-guard.ts";
import type { CommandView, PluginDefinition, ResolvedPlugin } from "../src/script/plugin.ts";
import { snapshot } from "../src/save/snapshot.ts";
import { snapshotGameSave } from "../src/save/game-save.ts";
import { snapshotSceneCheckpoint } from "../src/engine/checkpoint.ts";
import { hashGameState } from "../src/save/hash.ts";

test("presented frames defer base64 encoding until a canonical state snapshot", () => {
  const state = createGameState({ seed: 1, width: 2, height: 1 });
  state.surfaces = createSurfacesSection(2, 1);
  const beforeHash = hashGameState(state);
  const before = surfaceBytesEncodedForDiagnostics();
  const first = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
  const latest = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);

  presentSurfaceFrame(state.surfaces, 2, 1, first);
  presentSurfaceFrame(state.surfaces, 2, 1, latest);
  equal(surfaceBytesEncodedForDiagnostics() - before, 0);
  const screen = state.surfaces.entries["0"]!;
  deepEqual(readSurfacePixels(state.surfaces, 0 as SurfaceId, screen.rev)?.rgba, latest);
  equal(hashGameState(state), beforeHash);

  const saved = JSON.parse(snapshot(state)) as { surfaces: { entries: Record<string, { bitmap: { w: number; h: number; b64: string } }> } };
  equal(hashGameState(state), beforeHash);
  equal(surfaceBytesEncodedForDiagnostics() - before, latest.byteLength);
  equal(saved.surfaces.entries["0"]?.bitmap.w, 2);
  equal(saved.surfaces.entries["0"]?.bitmap.h, 1);
  equal(saved.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(latest));
});

test("editing a deferred screen materializes only the edit's canonical encoding", () => {
  const state = createSurfacesSection(1, 1);
  presentSurfaceFrame(state, 1, 1, new Uint8Array([10, 20, 30, 255]));
  const edited = new Uint8Array([40, 50, 60, 255]);
  const beforeEdit = surfaceBytesEncodedForDiagnostics();
  equal(editSurfaceWithBounds(state, 0 as SurfaceId, (rgba) => rgba.set(edited)), true);
  const afterEdit = surfaceBytesEncodedForDiagnostics();
  equal(afterEdit - beforeEdit, edited.byteLength);
  materializePresentedSurfaces(state);
  equal(surfaceBytesEncodedForDiagnostics(), afterEdit);
  equal(state.entries["0"]?.bitmap.b64, encodeSurfaceBytes(edited));
});
test("a no-op screen edit inside a batch keeps a changed-size presented frame canonical", () => {
  const state = createSurfacesSection(1, 1);
  const frame = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  presentSurfaceFrame(state, 2, 1, frame);
  beginSurfaceBatch(state);
  try {
    equal(editSurface(state, 0 as SurfaceId, () => {}), true);
    const before = surfaceBytesEncodedForDiagnostics();
    materializePresentedSurfaces(state);
    equal(surfaceBytesEncodedForDiagnostics() - before, frame.byteLength);
    const bitmap = state.entries["0"]?.bitmap;
    equal(bitmap?.w, 2);
    equal(bitmap?.h, 1);
    equal(bitmap?.b64, encodeSurfaceBytes(frame));
  } finally {
    endSurfaceBatch(state);
  }
});
test("a shared deferred screen materializes through a different section's snapshot", () => {
  const first = createSurfacesSection(1, 1);
  const frame = new Uint8Array([70, 80, 90, 255, 100, 110, 120, 255]);
  presentSurfaceFrame(first, 2, 1, frame);
  const second = { ...first, entries: { ...first.entries } };
  beginSurfaceBatch(first);
  try {
    equal(editSurface(first, 0 as SurfaceId, () => {}), true);
    const before = surfaceBytesEncodedForDiagnostics();
    materializePresentedSurfaces(second);
    equal(surfaceBytesEncodedForDiagnostics() - before, frame.byteLength);
    const bitmap = second.entries["0"]?.bitmap;
    equal(bitmap?.w, 2);
    equal(bitmap?.h, 1);
    equal(bitmap?.b64, encodeSurfaceBytes(frame));
  } finally {
    endSurfaceBatch(first);
  }
});
test("a snapshot inside a batched screen edit rebases that edit onto canonical pixels", () => {
  const game = createGameState({ seed: 1, width: 1, height: 1 });
  const surfaces = createSurfacesSection(1, 1);
  game.surfaces = surfaces;
  const frame = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  presentSurfaceFrame(surfaces, 2, 1, frame);
  beginSurfaceBatch(surfaces);
  try {
    equal(editSurface(surfaces, 0 as SurfaceId, (rgba) => {
      rgba[0] = 200;
      const intermediate = JSON.parse(snapshot(game)) as { surfaces: { entries: Record<string, { bitmap: { w: number; h: number; b64: string } }> } };
      const intermediateScreen = intermediate.surfaces.entries["0"]?.bitmap;
      equal(intermediateScreen?.w, 2);
      equal(intermediateScreen?.h, 1);
      equal(intermediateScreen?.b64, encodeSurfaceBytes(frame));
      rgba[4] = 210;
    }), true);
  } finally {
    endSurfaceBatch(surfaces);
  }
  const expected = new Uint8Array([200, 20, 30, 255, 210, 50, 60, 255]);
  equal(surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(expected));
});
test("a nested no-op alias batch preserves the outer screen edit across a snapshot", () => {
  const game = createGameState({ seed: 1, width: 1, height: 1 });
  const primary = createSurfacesSection(1, 1);
  game.surfaces = primary;
  const alias = { ...primary, entries: { ...primary.entries } };
  const aliasGame = createGameState({ seed: 1, width: 1, height: 1 });
  aliasGame.surfaces = alias;
  const frame = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  presentSurfaceFrame(primary, 2, 1, frame);
  beginSurfaceBatch(primary);
  try {
    equal(editSurface(primary, 0 as SurfaceId, (rgba) => {
      rgba[0] = 200;
      beginSurfaceBatch(alias);
      try {
        equal(editSurface(alias, 0 as SurfaceId, () => {}), true);
      } finally {
        endSurfaceBatch(alias);
      }
      const intermediate = JSON.parse(snapshot(aliasGame)) as { surfaces: { entries: Record<string, { bitmap: { b64: string } }> } };
      equal(intermediate.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(frame));
      rgba[4] = 210;
    }), true);
  } finally {
    endSurfaceBatch(primary);
  }
  const expected = new Uint8Array([200, 20, 30, 255, 210, 50, 60, 255]);
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(expected));
});
test("alias edits after canonicalization keep each committing buffer authoritative", () => {
  const primary = createSurfacesSection(2, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 2, height: 1 });
  game.surfaces = alias;
  const frame = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  presentSurfaceFrame(primary, 2, 1, frame);
  beginSurfaceBatch(primary);
  beginSurfaceBatch(alias);
  try {
    editSurface(primary, 0 as SurfaceId, () => {});
    editSurface(alias, 0 as SurfaceId, () => {});
    snapshot(game);
    editSurface(primary, 0 as SurfaceId, (rgba) => { rgba[0] = 200; });
    equal(readSurfacePixels(primary, 0 as SurfaceId, primary.entries["0"]!.rev)?.rgba[0], 200);
    editSurface(alias, 0 as SurfaceId, (rgba) => { rgba[4] = 210; });
    equal(readSurfacePixels(primary, 0 as SurfaceId, primary.entries["0"]!.rev)?.rgba[0], 200);
  } finally {
    endSurfaceBatch(alias);
    endSurfaceBatch(primary);
  }
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([200, 20, 30, 255, 210, 50, 60, 255])));
});

test("a snapshot inside a bounded edit keeps the editor's live buffer attached", () => {
  const game = createGameState({ seed: 1, width: 2, height: 1 });
  const surfaces = createSurfacesSection(2, 1);
  game.surfaces = surfaces;
  const frame = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  presentSurfaceFrame(surfaces, 2, 1, frame);
  beginSurfaceBatch(surfaces);
  try {
    editSurfaceWithBounds(surfaces, 0 as SurfaceId, (rgba) => {
      rgba[0] = 200;
      snapshot(game);
      rgba[4] = 210;
    });
  } finally {
    endSurfaceBatch(surfaces);
  }
  equal(surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([200, 20, 30, 255, 210, 50, 60, 255])));
});

test("presenting a replacement frame inside an edit discards the invalidated edit", () => {
  const game = createGameState({ seed: 1, width: 1, height: 1 });
  const surfaces = createSurfacesSection(1, 1);
  game.surfaces = surfaces;
  const initial = new Uint8Array([10, 20, 30, 255]);
  const replacement = new Uint8Array([40, 50, 60, 255, 70, 80, 90, 255]);
  presentSurfaceFrame(surfaces, 1, 1, initial);
  const beforeRevision = surfaces.entries["0"]!.rev;
  beginSurfaceBatch(surfaces);
  try {
    editSurface(surfaces, 0 as SurfaceId, (rgba) => {
      rgba[0] = 200;
      presentSurfaceFrame(surfaces, 2, 1, replacement);
    });
  } finally {
    endSurfaceBatch(surfaces);
  }
  equal(surfaces.entries["0"]?.rev, beforeRevision + 1);
  const canonical = JSON.parse(snapshot(game)) as { surfaces: { entries: Record<string, { bitmap: { w: number; h: number; b64: string } }> } };
  equal(canonical.surfaces.entries["0"]?.bitmap.w, 2);
  equal(canonical.surfaces.entries["0"]?.bitmap.h, 1);
  equal(canonical.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(replacement));
});
test("repeated snapshots during a failing bounded editor never commit its writes", () => {
  const game = createGameState({ seed: 1, width: 1, height: 1 });
  const surfaces = createSurfacesSection(1, 1);
  game.surfaces = surfaces;
  const frame = new Uint8Array([10, 20, 30, 255]);
  presentSurfaceFrame(surfaces, 1, 1, frame);
  beginSurfaceBatch(surfaces);
  let threw = false;
  try {
    try {
      editSurfaceWithBounds(surfaces, 0 as SurfaceId, (rgba) => {
        rgba[0] = 200;
        snapshot(game);
        snapshot(game);
        throw new Error("stop");
      });
    } catch {
      threw = true;
    }
  } finally {
    endSurfaceBatch(surfaces);
  }
  equal(threw, true);
  const canonical = JSON.parse(snapshot(game)) as { surfaces: { entries: Record<string, { bitmap: { b64: string } }> } };
  equal(canonical.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(frame));
});

test("rebasing during a bounded edit preserves a committed alias pixel", () => {
  const primary = createSurfacesSection(2, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 2, height: 1 });
  game.surfaces = alias;
  beginSurfaceBatch(primary);
  beginSurfaceBatch(alias);
  try {
    editSurfaceWithBounds(primary, 0 as SurfaceId, (rgba) => {
      rgba[0] = 200;
      editSurface(alias, 0 as SurfaceId, (other) => { other[4] = 210; });
      snapshot(game);
    });
  } finally {
    endSurfaceBatch(alias);
    endSurfaceBatch(primary);
  }
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([200, 0, 0, 0, 210, 0, 0, 0])));
});

test("a throwing stale editor cannot discard a replacement batch edit", () => {
  const game = createGameState({ seed: 1, width: 1, height: 1 });
  const surfaces = createSurfacesSection(1, 1);
  game.surfaces = surfaces;
  const replacement = new Uint8Array([40, 50, 60, 255, 70, 80, 90, 255]);
  beginSurfaceBatch(surfaces);
  let threw = false;
  try {
    try {
      editSurfaceWithBounds(surfaces, 0 as SurfaceId, () => {
        presentSurfaceFrame(surfaces, 2, 1, replacement);
        editSurfaceWithBounds(surfaces, 0 as SurfaceId, (rgba) => { rgba[0] = 200; });
        throw new Error("stop");
      });
    } catch {
      threw = true;
    }
  } finally {
    endSurfaceBatch(surfaces);
  }
  equal(threw, true);
  const canonical = JSON.parse(snapshot(game)) as { surfaces: { entries: Record<string, { bitmap: { w: number; h: number; b64: string } }> } };
  equal(canonical.surfaces.entries["0"]?.bitmap.w, 2);
  equal(canonical.surfaces.entries["0"]?.bitmap.h, 1);
  equal(canonical.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([200, 50, 60, 255, 70, 80, 90, 255])));
});

test("stale bounded editors cannot mutate an unbatched alias's decoded cache", () => {
  const primary = createSurfacesSection(2, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  beginSurfaceBatch(primary);
  try {
    editSurfaceWithBounds(primary, 0 as SurfaceId, (rgba) => {
      rgba[0] = 200;
      editSurfaceWithBounds(alias, 0 as SurfaceId, (eager) => { eager[4] = 210; });
      rgba[4] = 220;
    });
  } finally {
    endSurfaceBatch(primary);
  }
  const pixels = readSurfacePixels(alias, 0 as SurfaceId, alias.entries["0"]!.rev)?.rgba;
  equal(pixels?.[0], 0);
  equal(pixels?.[4], 210);
  equal(alias.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([0, 0, 0, 0, 210, 0, 0, 0])));
});






test("a failed editor rollback keeps pixels committed by an alias", () => {
  const primary = createSurfacesSection(2, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 2, height: 1 });
  game.surfaces = alias;
  beginSurfaceBatch(primary);
  editSurfaceWithBounds(primary, 0 as SurfaceId, (rgba) => { rgba[0] = 10; }, { first: 0, last: 0 });
  let threw = false;
  try {
    try {
      editSurfaceWithBounds(primary, 0 as SurfaceId, (rgba) => {
        rgba[0] = 200;
        beginSurfaceBatch(alias);
        try {
          editSurface(alias, 0 as SurfaceId, (other) => { other[4] = 210; });
        } finally {
          endSurfaceBatch(alias);
        }
        snapshot(game);
        throw new Error("stop");
      }, { first: 0, last: 0 });
    } catch {
      threw = true;
    }
  } finally {
    endSurfaceBatch(primary);
  }
  equal(threw, true);
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([10, 0, 0, 0, 210, 0, 0, 0])));
});

test("a failed outer bounded edit preserves nested committed pixels but not its own", () => {
  const game = createGameState({ seed: 1, width: 3, height: 1 });
  const surfaces = createSurfacesSection(3, 1);
  game.surfaces = surfaces;
  beginSurfaceBatch(surfaces);
  let threw = false;
  try {
    try {
      editSurfaceWithBounds(surfaces, 0 as SurfaceId, (outer) => {
        outer[4] = 150;
        editSurfaceWithBounds(surfaces, 0 as SurfaceId, (nested) => {
          nested[0] = 210;
          nested[8] = 220;
        });
        snapshot(game);
        throw new Error("stop");
      });
    } catch {
      threw = true;
    }
  } finally {
    endSurfaceBatch(surfaces);
  }
  equal(threw, true);
  equal(surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([210, 0, 0, 0, 0, 0, 0, 0, 220, 0, 0, 0])));
});

test("alias canonicalization retains nested commits through an outer rollback", () => {
  const primary = createSurfacesSection(3, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 3, height: 1 });
  game.surfaces = alias;
  beginSurfaceBatch(primary);
  let threw = false;
  try {
    try {
      editSurfaceWithBounds(primary, 0 as SurfaceId, (outer) => {
        outer[0] = 200;
        editSurfaceWithBounds(primary, 0 as SurfaceId, (nested) => { nested[4] = 210; });
        beginSurfaceBatch(alias);
        try {
          editSurface(alias, 0 as SurfaceId, (pixels) => { pixels[8] = 220; });
        } finally {
          endSurfaceBatch(alias);
        }
        snapshot(game);
        throw new Error("stop");
      });
    } catch {
      threw = true;
    }
  } finally {
    endSurfaceBatch(primary);
  }
  equal(threw, true);
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([0, 0, 0, 0, 210, 0, 0, 0, 220, 0, 0, 0])));
});
test("a later alias write survives an outer batch commit over the same pixels", () => {
  const primary = createSurfacesSection(3, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  beginSurfaceBatch(primary);
  beginSurfaceBatch(alias);
  editSurfaceWithBounds(primary, 0 as SurfaceId, () => {
    editSurfaceWithBounds(primary, 0 as SurfaceId, (nested) => { nested[0] = 210; });
    editSurface(alias, 0 as SurfaceId, (pixels) => { pixels[0] = 220; });
  }, { first: 0, last: 0 });
  endSurfaceBatch(alias);
  endSurfaceBatch(primary);
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([220, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
});

test("snapshot includes nested commits while a disjoint alias batch remains open", () => {
  const primary = createSurfacesSection(3, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 3, height: 1 });
  game.surfaces = alias;
  beginSurfaceBatch(primary);
  let intermediate = "";
  try {
    editSurfaceWithBounds(primary, 0 as SurfaceId, () => {
      editSurfaceWithBounds(primary, 0 as SurfaceId, (nested) => { nested[0] = 210; });
      beginSurfaceBatch(alias);
      try {
        editSurface(alias, 0 as SurfaceId, (pixels) => { pixels[8] = 220; });
        intermediate = snapshot(game);
      } finally {
        endSurfaceBatch(alias);
      }
    }, { first: 0, last: 0 });
  } finally {
    endSurfaceBatch(primary);
  }
  const expected = encodeSurfaceBytes(new Uint8Array([210, 0, 0, 0, 0, 0, 0, 0, 220, 0, 0, 0]));
  const snapshotState = JSON.parse(intermediate) as { surfaces: { entries: Record<string, { bitmap: { b64: string } }> } };
  equal(snapshotState.surfaces.entries["0"]?.bitmap.b64, expected);
  equal(primary.entries["0"]?.bitmap.b64, expected);
});

test("a snapshot preserves another active alias editor after materializing a nested commit", () => {
  const primary = createSurfacesSection(3, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 3, height: 1 });
  game.surfaces = alias;
  beginSurfaceBatch(primary);
  try {
    editSurfaceWithBounds(primary, 0 as SurfaceId, () => {
      editSurfaceWithBounds(primary, 0 as SurfaceId, (nested) => { nested[0] = 210; });
      beginSurfaceBatch(alias);
      try {
        editSurfaceWithBounds(alias, 0 as SurfaceId, (pixels) => {
          const intermediate = snapshot(game);
          equal(JSON.parse(intermediate).surfaces.entries["0"].bitmap.b64, encodeSurfaceBytes(new Uint8Array([210, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])));
          pixels[8] = 220;
        }, { first: 2, last: 2 });
      } finally {
        endSurfaceBatch(alias);
      }
    }, { first: 0, last: 0 });
  } finally {
    endSurfaceBatch(primary);
  }
  const expected = encodeSurfaceBytes(new Uint8Array([210, 0, 0, 0, 0, 0, 0, 0, 220, 0, 0, 0]));
  equal(primary.entries["0"]?.bitmap.b64, expected);
});

test("a nested rollback preserves later alias pixels rebased during the callback", () => {
  const primary = createSurfacesSection(2, 1);
  const alias = { ...primary, entries: { ...primary.entries } };
  const game = createGameState({ seed: 1, width: 2, height: 1 });
  game.surfaces = alias;
  beginSurfaceBatch(primary);
  try {
    editSurfaceWithBounds(primary, 0 as SurfaceId, () => {
      editSurfaceWithBounds(primary, 0 as SurfaceId, (pixels) => { pixels[0] = 10; });
      try {
        editSurfaceWithBounds(primary, 0 as SurfaceId, (pixels) => {
          beginSurfaceBatch(alias);
          try {
            editSurface(alias, 0 as SurfaceId, (aliasPixels) => { aliasPixels[0] = 20; });
            snapshot(game);
          } finally {
            endSurfaceBatch(alias);
          }
          pixels[0] = 30;
          throw new Error("rollback nested editor");
        }, { first: 0, last: 0 });
      } catch {}
    }, { first: 0, last: 0 });
  } finally {
    endSurfaceBatch(primary);
  }
  equal(primary.entries["0"]?.bitmap.b64, encodeSurfaceBytes(new Uint8Array([20, 0, 0, 0, 0, 0, 0, 0])));
});



test("game saves and scene checkpoints materialize the latest presented screen", () => {
  const state = createGameState({ seed: 1, width: 2, height: 1 });
  state.surfaces = createSurfacesSection(2, 1);
  const gameSavePixels = new Uint8Array([11, 12, 13, 255, 14, 15, 16, 255]);
  presentSurfaceFrame(state.surfaces, 2, 1, gameSavePixels);
  const gameSave = JSON.parse(snapshotGameSave(state)) as { surfaces: { entries: Record<string, { bitmap: { b64: string } }> } };
  equal(gameSave.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(gameSavePixels));

  const checkpointPixels = new Uint8Array([21, 22, 23, 255, 24, 25, 26, 255]);
  presentSurfaceFrame(state.surfaces, 2, 1, checkpointPixels);
  const checkpoint = JSON.parse(snapshotSceneCheckpoint(state, {
    holdProgramFrame: false,
    endedProgramThisTick: false,
    blockingWasAlive: false,
    outermostProgramStartAnimationId: 0,
    bakedOverlay: null,
  })) as { state: { surfaces: { entries: Record<string, { bitmap: { b64: string } }> } } };
  equal(checkpoint.state.surfaces.entries["0"]?.bitmap.b64, encodeSurfaceBytes(checkpointPixels));
});

test("external plugin commands see canonical pixels for the current presentation", () => {
  const state = createGameState({ seed: 1, width: 2, height: 1 });
  state.surfaces = createSurfacesSection(2, 1);
  const pixels = new Uint8Array([31, 32, 33, 255, 34, 35, 36, 255]);
  presentSurfaceFrame(state.surfaces, 2, 1, pixels);
  let observed = "";
  const definition: PluginDefinition = {
    id: "external",
    version: "1.0.0",
    commands: [{
      name: "peek",
      aliases: [],
      params: [],
      call: (view) => {
        observed = view.state?.surfaces.entries["0"]?.bitmap.b64 ?? "";
        return { value: null };
      },
    }],
  };
  const [guarded] = guardExternalPlugins([{ definition } satisfies ResolvedPlugin], new Set(), () => {
    flushSurfaceBatch(state.surfaces);
    materializePresentedSurfaces(state.surfaces);
  });
  const command = guarded?.definition.commands[0];
  if (command === undefined) throw new Error("expected guarded command");
  command.call({ state } as CommandView, [], () => ({ value: null }));
  equal(observed, encodeSurfaceBytes(pixels));
});

test("presented frames invalidate restored colour aliases for reserved surface zero", () => {
  const original = createSurfacesSection(1, 1);
  const state = { ...original, colours: { "0,0,0": 0 as SurfaceId } };
  const pixels = new Uint8Array([8, 9, 10, 255]);
  presentSurfaceFrame(state, 1, 1, pixels);
  equal(state.colours["0,0,0"], undefined);
  equal(colourSurface(state, { r: 0, g: 0, b: 0 }), 1 as SurfaceId);
});
test("public colour aliases are removed when a colour surface is replaced", () => {
  const state = createSurfacesSection(1, 1);
  const red = { r: 255, g: 0, b: 0 };
  const original = colourSurface(state, red);
  state.colours.alias = original;
  replaceSurface(state, original, 1, 1, new Uint8Array([0, 0, 255, 255]));
  equal(state.colours["255,0,0"], undefined);
  equal(state.colours.alias, undefined);
  equal(colourSurface(state, red), (original + 1) as SurfaceId);
});

test("escaped colour aliases are always checked against mutable state", () => {
  const state = createSurfacesSection(1, 1);
  const red = { r: 255, g: 0, b: 0 };
  const original = colourSurface(state, red);

  state.colours["255,0,0"] = 0 as SurfaceId;
  presentSurfaceFrame(state, 1, 1, new Uint8Array([255, 0, 0, 255]));
  equal(state.colours["255,0,0"], undefined);
  const replacement = colourSurface(state, red);
  equal(replacement, (original + 1) as SurfaceId);

  killSurface(state, replacement);
  equal(state.colours["255,0,0"], undefined);
  equal(colourSurface(state, red), (replacement + 1) as SurfaceId);
});
