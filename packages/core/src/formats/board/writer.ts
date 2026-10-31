/**
 * Writing a vector board ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)).
 *
 * Pure (G2): it fills a `BinaryWriter` and never touches a host. It emits the
 * version it was given and reproduces the bytes `readBoard` consumed exactly
 * (AD-18): the stored runs, the stored `closed` flags (including the legacy
 * `-1`), every empty slot and the residue are re-emitted verbatim, so an
 * unmodified board writes back byte for byte. A value the reader would refuse
 * is refused here — an unencodable string, an out-of-range `i16` scalar or
 * count, a magic or version this layout cannot write, a negative dimension, a
 * tile matrix past the vector layout's cell limit, or an inconsistent tile matrix — and
 * comes back as a located `FormatError`.
 */

import { err, ok, type Result } from "../result.ts";
import { BinaryWriter } from "../binary/writer.ts";
import {
  BOARD_LAYOUT_SECTION,
  BOARD_MAGIC,
  BOARD_MAX_CELLS,
  BOARD_VECTOR_MINOR,
  boardGrid,
  type Board,
  type BoardPoint,
} from "./model.ts";

/** A located error for a value the writer cannot encode (AD-18). */
function fail(writer: BinaryWriter, message: string): Result<never> {
  return err({ offset: writer.toBytes().length, section: BOARD_LAYOUT_SECTION, message });
}

/** The stored `i16` range a board scalar must fit. */
const I16_MIN = -32_768;
const I16_MAX = 32_767;

/**
 * Check the stored tile runs against the grid and the decompressed matrix
 * ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). The writer serialises the stored runs, so they must be
 * the runs `readBoard` would read back — its `readTileMatrix` stops at the run
 * that completes the grid, so the runs must cover at least `sizeL × width ×
 * height` cells with no run after the completing one (only a final run may
 * overshoot), and must expand to `tileMatrix` cell for cell. A malformed run
 * (a non-integer or short count) is left to the run loop, which reports it
 * with its own message.
 */
function checkTileMatrix(writer: BinaryWriter, model: Board): Result<never> | undefined {
  const grid = boardGrid(model.sizeX, model.sizeY, model.coordType);
  const totalCells = grid.width * grid.height * model.sizeL;

  let covered = 0;
  for (const run of model.tileRuns) {
    if (!Number.isInteger(run.count) || run.count < 1) {
      return undefined;
    }
    covered += run.count;
  }
  if (covered < totalCells) {
    return fail(
      writer,
      `the tile runs cover ${covered} cells but the grid needs ${totalCells}`,
    );
  }
  const last = model.tileRuns[model.tileRuns.length - 1];
  if (last !== undefined && covered - last.count >= totalCells) {
    return fail(
      writer,
      `the grid is already complete before the final run; the reader stops at the run that completes the grid, so no run may follow it`,
    );
  }

  let cell = 0;
  for (const run of model.tileRuns) {
    for (let i = 0; i < run.count; i += 1) {
      if (model.tileMatrix[cell] !== run.lutIndex) {
        return fail(
          writer,
          `tile cell ${cell} of the tile matrix is ${model.tileMatrix[cell]} but the stored runs give ${run.lutIndex}; the writer serialises the stored runs, so the runs must be rebuilt from the matrix before writing`,
        );
      }
      cell += 1;
    }
  }
  if (model.tileMatrix.length !== covered) {
    return fail(
      writer,
      `tile cell ${covered} of the tile matrix is ${model.tileMatrix[covered]} beyond the ${covered} cells the stored runs cover; the writer serialises the stored runs, so the runs must be rebuilt from the matrix before writing`,
    );
  }
  return undefined;
}

/** The stored `i16` upper bound for `count` entries: `-1` for none, else `count - 1`. */
function bound(count: number): number {
  return count === 0 ? -1 : count - 1;
}

/**
 * Write a list's `i16` upper bound after checking it fits:
 * a count above 32768 would wrap `count - 1` and re-read as "none", so it is
 * refused (AD-18).
 */
function writeUpperBound(writer: BinaryWriter, count: number, what: string): Result<void> {
  if (count > 32_768) {
    return fail(writer, `${what} has ${count} entries but the i16 upper bound holds at most 32768`);
  }
  writer.i16(bound(count));
  return ok(undefined);
}

/**
 * Check a group of named scalars and, only when they all fit, write them as
 * `i16`. `BinaryWriter.i16` silently wraps an out-of-range value, which would
 * turn a dimension negative or a field into a different number; a model the
 * reader would refuse must be refused here (AD-18).
 */
function writeI16s(
  writer: BinaryWriter,
  ...scalars: readonly (readonly [string, number])[]
): Result<void> {
  for (const [field, value] of scalars) {
    if (!Number.isInteger(value) || value < I16_MIN || value > I16_MAX) {
      return fail(writer, `${field} ${value} does not fit the stored i16 range ${I16_MIN}..${I16_MAX}`);
    }
  }
  for (const [, value] of scalars) {
    writer.i16(value);
  }
  return ok(undefined);
}

/** Write an upper-bounded list of strings ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
function writeStrings(writer: BinaryWriter, values: readonly string[]): Result<void> {
  const count = writeUpperBound(writer, values.length, "a string list");
  if (!count.ok) {
    return count;
  }
  for (const value of values) {
    const written = writer.str(value);
    if (!written.ok) {
      return written;
    }
  }
  return ok(undefined);
}

/** Write an upper-bounded list of `i32 x, i32 y` points ([vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later)). */
function writePoints(writer: BinaryWriter, points: readonly BoardPoint[]): Result<void> {
  const count = writeUpperBound(writer, points.length, "a point list");
  if (!count.ok) {
    return count;
  }
  for (const point of points) {
    writer.i32(point.x);
    writer.i32(point.y);
  }
  return ok(undefined);
}

/**
 * Serialise `model` to the [vector layout](../../../../../../docs/spec/formats/board.md#vector-layout-minor-4-and-later). Every
 * section's bound is derived back from the model's array length, so empty
 * slots round-trip and table indices stay stable.
 */
export function writeBoard(model: Board): Result<Uint8Array> {
  const writer = new BinaryWriter();

  // Everything the reader refuses is refused here first, so the writer never
  // hands back a file its own reader would reject (AD-18): the magic is fixed,
  // the version must select the vector layout, the dimensions must be
  // non-negative and the tile matrix must fit the vector layout's cell limit.
  if (model.magic !== BOARD_MAGIC) {
    return fail(
      writer,
      `the magic "${model.magic}" is not "${BOARD_MAGIC}"; the reader refuses any other value`,
    );
  }
  if (model.major < 0 || model.minor < BOARD_VECTOR_MINOR) {
    return fail(
      writer,
      `invalid board version ${model.major}.${model.minor}: the vector layout needs a non-negative major and minor >= ${BOARD_VECTOR_MINOR}`,
    );
  }
  if (model.sizeX < 0 || model.sizeY < 0 || model.sizeL < 0) {
    return fail(
      writer,
      `invalid negative board dimensions ${model.sizeX}×${model.sizeY}×${model.sizeL}`,
    );
  }
  const grid = boardGrid(model.sizeX, model.sizeY, model.coordType);
  const declaredCells = grid.width * grid.height * model.sizeL;
  if (declaredCells > BOARD_MAX_CELLS) {
    return fail(
      writer,
      `the tile matrix would hold ${declaredCells} cells (${grid.width}×${grid.height}×${model.sizeL}) but the limit is ${BOARD_MAX_CELLS}`,
    );
  }

  const magic = writer.str(model.magic);
  if (!magic.ok) {
    return magic;
  }
  const version = writeI16s(writer, ["major", model.major], ["minor", model.minor]);
  if (!version.ok) {
    return version;
  }
  const dimensions = writeI16s(
    writer,
    ["sizeX", model.sizeX],
    ["sizeY", model.sizeY],
    ["sizeL", model.sizeL],
    ["coordType", model.coordType],
  );
  if (!dimensions.ok) {
    return dimensions;
  }

  const lutCount = writeUpperBound(writer, model.lut.length, "the tile LUT");
  if (!lutCount.ok) {
    return lutCount;
  }
  for (const reference of model.lut) {
    const written = writer.str(reference);
    if (!written.ok) {
      return written;
    }
  }

  const tileMatrix = checkTileMatrix(writer, model);
  if (tileMatrix !== undefined) {
    return tileMatrix;
  }

  for (const run of model.tileRuns) {
    if (!Number.isInteger(run.lutIndex) || run.lutIndex < 0 || run.lutIndex > 32_767) {
      return fail(writer, `tile matrix LUT index ${run.lutIndex} does not fit a non-negative i16`);
    }
    if (!Number.isInteger(run.count) || run.count < 1 || run.count > 32_768) {
      return fail(writer, `a tile matrix run covers ${run.count} cells; a run-length marker holds 1..32768`);
    }
    if (run.marker) {
      writer.i16(-run.count);
    } else if (run.count !== 1) {
      return fail(writer, `an unmarked tile matrix entry covers ${run.count} cells; only a marker covers more than one`);
    }
    writer.i16(run.lutIndex);
  }

  const shadeLayers = writeUpperBound(writer, model.shadeLayers.length, "the shade-layer list");
  if (!shadeLayers.ok) {
    return shadeLayers;
  }
  // docs/spec/formats/board.md#vector-layout-minor-4-and-later stores a layer as records the reader
  // consumes until they cover the grid, so an under-covering layer would make the reader read the
  // next field as a shade record and misparse the rest of the file.
  const cellsPerLayer = grid.width * grid.height;
  for (const [index, layer] of model.shadeLayers.entries()) {
    const cells = (record: { readonly runCount: number }): number => record.runCount > 1 ? record.runCount : 1;
    const covered = layer.records.reduce((sum, record) => sum + cells(record), 0);
    if (covered < cellsPerLayer) {
      return fail(
        writer,
        `shade layer ${index} covers ${covered} cells but the grid has ${cellsPerLayer}; the reader consumes a record per cell until the layer is covered, so a short layer would be read into the following fields`,
      );
    }
    const last = layer.records[layer.records.length - 1];
    if (last !== undefined && covered - cells(last) >= cellsPerLayer) {
      return fail(
        writer,
        `shade layer ${index} is already complete before its final record; the reader stops at the record that covers the grid, so no record may follow it`,
      );
    }
    writer.i32(layer.castLayer);
    for (const record of layer.records) {
      const scalars = writeI16s(
        writer,
        ["shade runCount", record.runCount],
        ["shade red", record.r],
        ["shade green", record.g],
        ["shade blue", record.b],
      );
      if (!scalars.ok) {
        return scalars;
      }
    }
  }

  const lights = writeUpperBound(writer, model.lights.length, "the light list");
  if (!lights.ok) {
    return lights;
  }
  for (const light of model.lights) {
    writer.i32(light.layer);
    writer.i32(light.type);
    const nodes = writePoints(writer, light.nodes);
    if (!nodes.ok) {
      return nodes;
    }
    const colours = writeUpperBound(writer, light.colours.length, "the light colour list");
    if (!colours.ok) {
      return colours;
    }
    for (const colour of light.colours) {
      const scalars = writeI16s(
        writer,
        ["light red", colour.r],
        ["light green", colour.g],
        ["light blue", colour.b],
      );
      if (!scalars.ok) {
        return scalars;
      }
    }
  }

  const vectors = writeUpperBound(writer, model.vectors.length, "the vector list");
  if (!vectors.ok) {
    return vectors;
  }
  for (const vector of model.vectors) {
    const points = writePoints(writer, vector.points);
    if (!points.ok) {
      return points;
    }
    const scalars = writeI16s(
      writer,
      ["vector attributes", vector.attributes],
      ["vector closed", vector.closed],
      ["vector layer", vector.layer],
      ["vector type", vector.type],
    );
    if (!scalars.ok) {
      return scalars;
    }
    const handle = writer.str(vector.handle);
    if (!handle.ok) {
      return handle;
    }
  }

  const programs = writeUpperBound(writer, model.programs.length, "the program list");
  if (!programs.ok) {
    return programs;
  }
  for (const program of model.programs) {
    for (const value of [
      program.program,
      program.graphic,
      program.initialVar,
      program.initialValue,
      program.finalVar,
      program.finalValue,
    ]) {
      const written = writer.str(value);
      if (!written.ok) {
        return written;
      }
    }
    const activation = writeI16s(
      writer,
      ["program activate", program.activate],
      ["program activationType", program.activationType],
      ["program repeatDistance", program.repeatDistance],
      ["program layer", program.layer],
    );
    if (!activation.ok) {
      return activation;
    }
    const points = writePoints(writer, program.points);
    if (!points.ok) {
      return points;
    }
    const closed = writeI16s(writer, ["program closed", program.closed]);
    if (!closed.ok) {
      return closed;
    }
    const handle = writer.str(program.handle);
    if (!handle.ok) {
      return handle;
    }
  }

  const sprites = writeUpperBound(writer, model.sprites.length, "the sprite list");
  if (!sprites.ok) {
    return sprites;
  }
  for (const sprite of model.sprites) {
    for (const value of [
      sprite.itemFile,
      sprite.activationPrg,
      sprite.multitaskPrg,
      sprite.initialVar,
      sprite.initialValue,
      sprite.finalVar,
      sprite.finalValue,
      sprite.loadingVar,
      sprite.loadingValue,
    ]) {
      const written = writer.str(value);
      if (!written.ok) {
        return written;
      }
    }
    const placement = writeI16s(
      writer,
      ["sprite activate", sprite.activate],
      ["sprite activationType", sprite.activationType],
      ["sprite x", sprite.x],
      ["sprite y", sprite.y],
      ["sprite layer", sprite.layer],
      ["sprite reserved", sprite.reserved],
    );
    if (!placement.ok) {
      return placement;
    }
  }

  const images = writeUpperBound(writer, model.images.length, "the image list");
  if (!images.ok) {
    return images;
  }
  for (const image of model.images) {
    const file = writer.str(image.file);
    if (!file.ok) {
      return file;
    }
    writer.i32(image.left);
    writer.i32(image.top);
    const draw = writeI16s(writer, ["image layer", image.layer], ["image drawType", image.drawType]);
    if (!draw.ok) {
      return draw;
    }
    writer.color(image.transparent);
    const reserved = writeI16s(writer, ["image reserved", image.reserved]);
    if (!reserved.ok) {
      return reserved;
    }
  }

  const threads = writeStrings(writer, model.threads);
  if (!threads.ok) {
    return threads;
  }
  const constants = writeStrings(writer, model.constants);
  if (!constants.ok) {
    return constants;
  }

  if (model.layerTitles.length !== model.sizeL + 1) {
    return fail(
      writer,
      `the board has ${model.layerTitles.length} layer title(s) but sizeL ${model.sizeL} needs ${model.sizeL + 1} (indices 0…${model.sizeL})`,
    );
  }
  for (const title of model.layerTitles) {
    const written = writer.str(title);
    if (!written.ok) {
      return written;
    }
  }

  for (const link of [model.links.north, model.links.south, model.links.east, model.links.west]) {
    const written = writer.str(link);
    if (!written.ok) {
      return written;
    }
  }

  const properties = model.properties;
  const backgroundImage = writer.str(properties.backgroundImage);
  if (!backgroundImage.ok) {
    return backgroundImage;
  }
  writer.i32(properties.backgroundDrawType);
  writer.color(properties.backgroundColour);
  for (const value of [
    properties.backgroundMusic,
    properties.enterPrg,
    properties.battleBackground,
  ]) {
    const written = writer.str(value);
    if (!written.ok) {
      return written;
    }
  }
  const scalars = writeI16s(
    writer,
    ["battleSkill", properties.battleSkill],
    ["allowBattles", properties.allowBattles],
    ["disableSaving", properties.disableSaving],
    ["ambient red", properties.ambient.r],
    ["ambient green", properties.ambient.g],
    ["ambient blue", properties.ambient.b],
    ["start x", properties.start.x],
    ["start y", properties.start.y],
    ["start layer", properties.start.layer],
  );
  if (!scalars.ok) {
    return scalars;
  }

  writer.writeBytes(model.residue);
  return ok(writer.toBytes());
}
