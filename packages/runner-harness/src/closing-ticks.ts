export type ClosingTickHash = {
  readonly tick: number;
  readonly stateHash: string;
  readonly drawHash: string;
};
export type ClosingBatchTrace = {
  readonly batch: number;
  readonly ticks: readonly ClosingTickHash[];
};


/** Compare observations from actual ticks, not only the frames and input checkpoints in the closing plan. */
export function compareClosingTickHashes(
  batch: number,
  expectedTicks: number,
  reference: readonly ClosingTickHash[],
  other: readonly ClosingTickHash[],
): string[] {
  const tag = `batch ${batch}`;
  const problems: string[] = [];
  if (reference.length !== expectedTicks) problems.push(`${tag}: reference has ${reference.length} per-tick hashes for ${expectedTicks} ticks`);
  if (other.length !== expectedTicks) problems.push(`${tag}: trace has ${other.length} per-tick hashes, reference has ${expectedTicks} ticks`);
  for (const [label, observations] of [["reference", reference], ["trace", other]] as const) {
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index];
      const expectedTick = index + 1;
      if (observation !== undefined && observation.tick !== expectedTick) {
        problems.push(`${tag}: ${label} tick sequence has tick ${observation.tick} at observation ${expectedTick}`);
      }
    }
  }

  const shared = Math.min(reference.length, other.length);
  for (let index = 0; index < shared; index += 1) {
    const expected = reference[index];
    const found = other[index];
    if (expected === undefined || found === undefined) continue;
    if (expected.tick !== found.tick) {
      problems.push(`${tag}: per-tick observation ${index + 1} is tick ${found.tick}, reference tick ${expected.tick}`);
      continue;
    }
    if (expected.stateHash !== found.stateHash || expected.drawHash !== found.drawHash) {
      problems.push(`${tag}: per-tick hashes differ at tick ${expected.tick}: state ${found.stateHash} / draw ${found.drawHash}, reference state ${expected.stateHash} / draw ${expected.drawHash}`);
    }
  }
  return problems;
}

/** Compare the Node/browser batch traces in plan order, preserving every planned batching. */
export function compareClosingBatchTickHashes(
  reference: readonly ClosingBatchTrace[],
  other: readonly ClosingBatchTrace[],
): string[] {
  const problems: string[] = [];
  if (other.length !== reference.length) problems.push(`batch trace has ${other.length} planned batches, reference has ${reference.length}`);
  const shared = Math.min(reference.length, other.length);
  for (let index = 0; index < shared; index += 1) {
    const expected = reference[index];
    const found = other[index];
    if (expected === undefined || found === undefined) continue;
    if (expected.batch !== found.batch) {
      problems.push(`planned batch ${index + 1} is ${found.batch}, reference ${expected.batch}`);
      continue;
    }
    problems.push(...compareClosingTickHashes(found.batch, expected.ticks.length, expected.ticks, found.ticks));
  }
  return problems;
}
