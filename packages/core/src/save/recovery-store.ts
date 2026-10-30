/**
 * Interruption-recovery candidate promotion and selection
 * (docs/spec/engine/interruption-recovery.md#reference-recovery-store-layout).
 *
 * This module is the host-agnostic half of #783: it decides *when* a candidate
 * may become the durable recovery generation and *which* generation may be
 * returned, over an injected `RecoveryStorage`. It performs no I/O and knows
 * nothing about what a candidate contains: the caller's validator checks
 * identity, version, integrity, completeness and ledger consistency and returns
 * the validated `tick` and `ledgerHash`, or throws. The store only compares the
 * values that validator returned, so game-specific rules never leak in here.
 *
 * Promotion writes a separate generation, validates the read-back, records the
 * validation in the generation metadata and only then atomically replaces the
 * game-scoped pointer. A failure before the pointer switch leaves the previous
 * pointer selected; a pointer read-back failure restores the previous pointer
 * when it was readable. Selection never returns bytes that did not just pass
 * the validator, falls back newest-first to an older validated generation when
 * the pointer or the pointed generation is unusable, and repairs the pointer
 * best-effort.
 *
 * The path layout, generation naming, pointer and metadata shapes are the
 * reference layout in the spec. Hosts may store the same guarantees differently
 * but must provide an atomic pointer switch and the current plus one previous
 * validated generation; a host without removal simply keeps extra generations,
 * which stays safe because selection revalidates every candidate it reads.
 */

import { canon, utf8Decode, utf8Encode } from "../canon/index.ts";
import { isRecord } from "../script/cells.ts";

/** The pointer and candidate-metadata format version written by this module. */
export const RECOVERY_STORE_VERSION = 1;

/** How a generation number is rendered in paths; lexical order is numeric order. */
const GENERATION_DIGITS = 12;

/** The largest generation this module can name. */
const MAX_GENERATION = 999_999_999_999;

/**
 * The bytes host storage for one game's recovery area.
 *
 * Every path is relative to the game's durable save area and is supplied by
 * this module; a host maps it onto its own storage and performs no discovery of
 * its own. `read` returns `null` for a path that does not exist. `write` may be
 * a non-atomic replacement; `writeAtomic` must commit the whole value or leave
 * the previous value in place. `list` returns the paths under a prefix in any
 * order. `remove` is optional: without it, promotion retains older generations
 * instead of pruning them, and selection remains safe because it revalidates.
 */
export type RecoveryStorage = {
  read(path: string): Uint8Array | null;
  write(path: string, bytes: Uint8Array): void;
  writeAtomic(path: string, bytes: Uint8Array): void;
  list(prefix: string): readonly string[];
  remove?(path: string): void;
};

/**
 * The durable pointer naming the selected generation. `tick` and `ledgerHash`
 * are the values the validator returned for that generation's read-back.
 */
export type RecoveryPointer = {
  readonly version: 1;
  readonly gameId: string;
  readonly generation: number;
  readonly tick: number;
  readonly ledgerHash: string;
};

/** The read-back validation result recorded next to one candidate generation. */
export type RecoveryCandidateMeta = {
  readonly version: 1;
  readonly generation: number;
  readonly tick: number;
  readonly ledgerHash: string;
};

/** A candidate whose stored bytes just passed validation. */
export type ValidatedRecovery = {
  readonly generation: number;
  readonly tick: number;
  readonly ledgerHash: string;
  readonly bytes: Uint8Array;
};

/** What a validator returns for one candidate; it throws to refuse the bytes. */
export type RecoveryValidation = {
  readonly tick: number;
  readonly ledgerHash: string;
};

/**
 * Validate one candidate's stored bytes. The callback owns game identity,
 * version, integrity, completeness and ledger consistency; it must not mutate
 * live game state. It returns the candidate's tick and ledger hash, or throws.
 */
export type RecoveryValidate = (bytes: Uint8Array) => RecoveryValidation;

/** The candidate to promote: its bytes and the game/profile that owns it. */
export type RecoveryPromoteOptions = {
  readonly gameId: string;
  readonly bytes: Uint8Array;
};

/** The game/profile whose selected recovery generation to read. */
export type RecoverySelectOptions = {
  readonly gameId: string;
};

/** A promotion or selection failure with a stable machine-readable `code`. */
export class RecoveryStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryStoreError";
    this.code = code;
  }
}

function pointerPath(gameId: string): string {
  return `${gameId}/recovery/current.json`;
}

function generationsPrefix(gameId: string): string {
  return `${gameId}/recovery/generations/`;
}

function generationDirectory(gameId: string, generation: number): string {
  return `${generationsPrefix(gameId)}${String(generation).padStart(GENERATION_DIGITS, "0")}`;
}

function candidatePath(gameId: string, generation: number): string {
  return `${generationDirectory(gameId, generation)}/candidate.bin`;
}

function metadataPath(gameId: string, generation: number): string {
  return `${generationDirectory(gameId, generation)}/meta.json`;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_GENERATION;
}

function isTick(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Reject a game id that would escape or change the game-scoped path prefix. */
function gameDirectory(gameId: string): string {
  if (typeof gameId !== "string" || gameId.length === 0) {
    throw new RecoveryStoreError("recovery.game-id", "a recovery gameId must be a non-empty string");
  }
  if (gameId === "." || gameId === "..") {
    throw new RecoveryStoreError("recovery.game-id", "a recovery gameId must name one path segment");
  }
  for (let index = 0; index < gameId.length; index += 1) {
    const code = gameId.charCodeAt(index);
    if (code === 0 || code === 47 || code === 92) {
      throw new RecoveryStoreError("recovery.game-id", "a recovery gameId must not contain a path separator or NUL");
    }
  }
  return gameId;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(utf8Decode(bytes)) as unknown;
  } catch {
    // A pointer or metadata file that is not valid UTF-8 JSON is corrupt.
    return null;
  }
}

function asPointer(value: unknown): RecoveryPointer | null {
  if (!isRecord(value) || !exactKeys(value, ["version", "gameId", "generation", "tick", "ledgerHash"])) return null;
  if (value.version !== RECOVERY_STORE_VERSION) return null;
  if (typeof value.gameId !== "string" || value.gameId.length === 0) return null;
  if (!isGeneration(value.generation) || !isTick(value.tick)) return null;
  if (typeof value.ledgerHash !== "string" || value.ledgerHash.length === 0) return null;
  return { version: RECOVERY_STORE_VERSION, gameId: value.gameId, generation: value.generation, tick: value.tick, ledgerHash: value.ledgerHash };
}

function asMetadata(value: unknown): RecoveryCandidateMeta | null {
  if (!isRecord(value) || !exactKeys(value, ["version", "generation", "tick", "ledgerHash"])) return null;
  if (value.version !== RECOVERY_STORE_VERSION) return null;
  if (!isGeneration(value.generation) || !isTick(value.tick)) return null;
  if (typeof value.ledgerHash !== "string" || value.ledgerHash.length === 0) return null;
  return { version: RECOVERY_STORE_VERSION, generation: value.generation, tick: value.tick, ledgerHash: value.ledgerHash };
}

function encodePointer(pointer: RecoveryPointer): Uint8Array {
  return utf8Encode(canon({ version: pointer.version, gameId: pointer.gameId, generation: pointer.generation, tick: pointer.tick, ledgerHash: pointer.ledgerHash }));
}

function encodeMetadata(meta: RecoveryCandidateMeta): Uint8Array {
  return utf8Encode(canon({ version: meta.version, generation: meta.generation, tick: meta.tick, ledgerHash: meta.ledgerHash }));
}

function samePointer(actual: RecoveryPointer | null, expected: RecoveryPointer): boolean {
  return actual !== null
    && actual.version === expected.version
    && actual.gameId === expected.gameId
    && actual.generation === expected.generation
    && actual.tick === expected.tick
    && actual.ledgerHash === expected.ledgerHash;
}

function readBytes(store: RecoveryStorage, path: string): Uint8Array | null {
  const bytes = store.read(path);
  return bytes instanceof Uint8Array ? bytes : null;
}

/** Selection tolerates a host read failure on one path by treating it as absent. */
function maybeReadBytes(store: RecoveryStorage, path: string): Uint8Array | null {
  try {
    return readBytes(store, path);
  } catch {
    // A failed read is not proof of a valid candidate; selection falls back.
    return null;
  }
}

function generationOf(prefix: string, path: string): number | null {
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const slash = rest.indexOf("/");
  const segment = slash === -1 ? rest : rest.slice(0, slash);
  if (segment.length !== GENERATION_DIGITS) return null;
  for (let index = 0; index < segment.length; index += 1) {
    const code = segment.charCodeAt(index);
    if (code < 48 || code > 57) return null;
  }
  const generation = Number(segment);
  return isGeneration(generation) ? generation : null;
}

function generationsFromPaths(prefix: string, paths: readonly string[]): number[] {
  const generations = new Set<number>();
  for (const path of paths) {
    const generation = generationOf(prefix, path);
    if (generation !== null) generations.add(generation);
  }
  return [...generations];
}

function listGenerations(store: RecoveryStorage, gameId: string): number[] {
  const prefix = generationsPrefix(gameId);
  const paths = store.list(prefix);
  if (!Array.isArray(paths)) {
    throw new RecoveryStoreError("recovery.list", "recovery storage list must return an array of paths");
  }
  return generationsFromPaths(prefix, paths);
}

function nextGeneration(generations: readonly number[]): number {
  let highest = 0;
  for (const generation of generations) {
    if (generation > highest) highest = generation;
  }
  const next = highest + 1;
  if (next > MAX_GENERATION) {
    throw new RecoveryStoreError("recovery.generation", "the recovery area has exhausted its generation numbers");
  }
  return next;
}

function validateBytes(validate: RecoveryValidate, bytes: Uint8Array, label: string): RecoveryValidation {
  const result: unknown = validate(bytes);
  if (!isRecord(result) || !isTick(result.tick) || typeof result.ledgerHash !== "string" || result.ledgerHash.length === 0) {
    throw new RecoveryStoreError("recovery.validate", `${label} validation must return a non-negative tick and a non-empty ledger hash`);
  }
  return { tick: result.tick, ledgerHash: result.ledgerHash };
}

function readPointer(store: RecoveryStorage, gameId: string): RecoveryPointer | null {
  const bytes = maybeReadBytes(store, pointerPath(gameId));
  return bytes === null ? null : asPointer(decodeJson(bytes));
}

function loadGeneration(store: RecoveryStorage, gameId: string, generation: number, validate: RecoveryValidate): ValidatedRecovery | null {
  const bytes = maybeReadBytes(store, candidatePath(gameId, generation));
  if (bytes === null) return null;
  const metadataBytes = maybeReadBytes(store, metadataPath(gameId, generation));
  if (metadataBytes === null) return null;
  const meta = asMetadata(decodeJson(metadataBytes));
  if (meta === null || meta.generation !== generation) return null;
  let validation: RecoveryValidation;
  try {
    validation = validateBytes(validate, bytes, `recovery generation ${generation}`);
  } catch {
    // A refused, malformed or throwing validation makes this generation unusable.
    return null;
  }
  if (validation.tick !== meta.tick || validation.ledgerHash !== meta.ledgerHash) return null;
  return { generation, tick: validation.tick, ledgerHash: validation.ledgerHash, bytes };
}

function repairPointer(store: RecoveryStorage, gameId: string, recovery: ValidatedRecovery): void {
  const pointer: RecoveryPointer = {
    version: RECOVERY_STORE_VERSION,
    gameId,
    generation: recovery.generation,
    tick: recovery.tick,
    ledgerHash: recovery.ledgerHash,
  };
  try {
    store.writeAtomic(pointerPath(gameId), encodePointer(pointer));
  } catch {
    // The candidate already validated; a failed repair does not invalidate it.
  }
}

/**
 * Prune generations that are neither the promoted one nor one preceding
 * validated generation. Best effort: without `remove`, or on any host failure,
 * the extra generations stay and selection still validates what it reads.
 */
function pruneGenerations(store: RecoveryStorage, gameId: string, current: number, previous: number | null): void {
  if (store.remove === undefined) return;
  const prefix = generationsPrefix(gameId);
  let paths: readonly string[];
  try {
    const listed = store.list(prefix);
    if (!Array.isArray(listed)) return;
    paths = listed;
  } catch {
    // Retention is best effort; keep whatever the host already holds.
    return;
  }
  const listed = generationsFromPaths(prefix, paths);
  if (listed.length === 0) return;

  const keep = new Set<number>([current]);
  if (previous !== null && previous !== current && listed.includes(previous)) {
    keep.add(previous);
  } else {
    let fallback: number | null = null;
    for (const generation of listed) {
      if (generation === current) continue;
      if (fallback === null || generation > fallback) fallback = generation;
    }
    if (fallback !== null) keep.add(fallback);
  }

  for (const path of paths) {
    const generation = generationOf(prefix, path);
    if (generation === null || keep.has(generation)) continue;
    try {
      store.remove?.(path);
    } catch {
      // Best effort only: a host that cannot remove a path keeps the generation.
    }
  }
}

function previousGeneration(gameId: string, previousPointerBytes: Uint8Array | null): number | null {
  if (previousPointerBytes === null) return null;
  const pointer = asPointer(decodeJson(previousPointerBytes));
  return pointer !== null && pointer.gameId === gameId ? pointer.generation : null;
}

function restorePreviousPointer(store: RecoveryStorage, gameId: string, previousPointerBytes: Uint8Array | null): void {
  if (previousPointerBytes === null) return;
  try {
    store.writeAtomic(pointerPath(gameId), previousPointerBytes);
  } catch {
    // Nothing better is available; the host's atomic write must leave the old pointer in place.
  }
}

/**
 * Validate `options.bytes`, write it as a new generation, validate the read-back
 * and atomically promote the pointer (#783).
 *
 * Nothing is written until the in-memory candidate validates, the pointer is
 * replaced only after the read-back validates to the same `tick` and
 * `ledgerHash`, and a failure before the switch leaves the previous pointer
 * selected. The returned bytes are the stored read-back that passed validation.
 */
export function promoteRecovery(store: RecoveryStorage, options: RecoveryPromoteOptions, validate: RecoveryValidate): ValidatedRecovery {
  const gameId = gameDirectory(options.gameId);
  const first = validateBytes(validate, options.bytes, "recovery candidate");

  const generations = listGenerations(store, gameId);
  const previousPointerBytes = readBytes(store, pointerPath(gameId));
  const previous = previousGeneration(gameId, previousPointerBytes);
  const generation = nextGeneration(previous === null ? generations : [...generations, previous]);

  store.write(candidatePath(gameId, generation), options.bytes);
  const readBack = readBytes(store, candidatePath(gameId, generation));
  if (readBack === null) {
    throw new RecoveryStoreError("recovery.readback", `recovery generation ${generation} could not be read back`);
  }
  const second = validateBytes(validate, readBack, `recovery generation ${generation} read-back`);
  if (second.tick !== first.tick || second.ledgerHash !== first.ledgerHash) {
    throw new RecoveryStoreError("recovery.readback", `recovery generation ${generation} read-back does not match the validated candidate`);
  }

  const meta: RecoveryCandidateMeta = {
    version: RECOVERY_STORE_VERSION,
    generation,
    tick: second.tick,
    ledgerHash: second.ledgerHash,
  };
  const metadataBytes = encodeMetadata(meta);
  store.write(metadataPath(gameId, generation), metadataBytes);
  const metadataReadBack = readBytes(store, metadataPath(gameId, generation));
  const storedMeta = metadataReadBack === null ? null : asMetadata(decodeJson(metadataReadBack));
  if (storedMeta === null || storedMeta.generation !== generation || storedMeta.tick !== second.tick || storedMeta.ledgerHash !== second.ledgerHash) {
    throw new RecoveryStoreError("recovery.readback", `recovery generation ${generation} metadata could not be read back`);
  }

  const pointer: RecoveryPointer = {
    version: RECOVERY_STORE_VERSION,
    gameId,
    generation,
    tick: second.tick,
    ledgerHash: second.ledgerHash,
  };
  try {
    store.writeAtomic(pointerPath(gameId), encodePointer(pointer));
  } catch (error) {
    restorePreviousPointer(store, gameId, previousPointerBytes);
    throw error;
  }

  let pointerBytes: Uint8Array | null;
  try {
    pointerBytes = readBytes(store, pointerPath(gameId));
  } catch (error) {
    restorePreviousPointer(store, gameId, previousPointerBytes);
    throw error;
  }
  if (!samePointer(pointerBytes === null ? null : asPointer(decodeJson(pointerBytes)), pointer)) {
    restorePreviousPointer(store, gameId, previousPointerBytes);
    throw new RecoveryStoreError("recovery.pointer", `recovery pointer did not read back as generation ${generation}`);
  }

  pruneGenerations(store, gameId, generation, previous);
  return { generation, tick: second.tick, ledgerHash: second.ledgerHash, bytes: readBack };
}

/**
 * Return the validated recovery generation for a game, or `null` when no
 * generation validates (#783).
 *
 * The pointed generation is used only when its candidate and metadata
 * revalidate and agree with the pointer exactly. Otherwise every generation is
 * scanned newest-first and the newest fully valid one is returned after a
 * best-effort pointer repair. Bytes that did not just pass the validator are
 * never returned.
 */
export function selectRecovery(store: RecoveryStorage, options: RecoverySelectOptions, validate: RecoveryValidate): ValidatedRecovery | null {
  const gameId = gameDirectory(options.gameId);
  const pointer = readPointer(store, gameId);
  if (pointer !== null && pointer.gameId === gameId) {
    const selected = loadGeneration(store, gameId, pointer.generation, validate);
    if (selected !== null && selected.tick === pointer.tick && selected.ledgerHash === pointer.ledgerHash) return selected;
  }

  let generations: number[];
  try {
    generations = listGenerations(store, gameId);
  } catch {
    // Without a listing there is no fallback generation to validate.
    return null;
  }
  generations.sort((left, right) => right - left);
  for (const generation of generations) {
    const selected = loadGeneration(store, gameId, generation, validate);
    if (selected === null) continue;
    repairPointer(store, gameId, selected);
    return selected;
  }
  return null;
}
