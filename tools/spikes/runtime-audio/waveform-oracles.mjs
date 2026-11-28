// These assertions operate on captured worklet PCM, not on cue timestamps alone.
function landmark(samples, around, radius) {
  let frame = null, peak = 0.35; // The authored impulse is stronger than the 0.2-amplitude tone.
  for (let i = Math.max(0, around - radius); i <= around + radius && i * 2 < samples.length; i++) {
    const magnitude = Math.abs(samples[i * 2]);
    if (magnitude > peak) { frame = i; peak = magnitude; }
  }
  return frame;
}

export function loopLandmarks(first, repeated, firstPlayFrame, repeatsFromFrame, nominalPeriodFrames, rate) {
  const a = new Float32Array(first.data), b = new Float32Array(repeated.data);
  const impulse = Math.round(rate / 2), radius = Math.round(rate * 0.075);
  const firstPeak = landmark(a, firstPlayFrame - first.startFrame + impulse, radius);
  const seam = repeatsFromFrame - repeated.startFrame + nominalPeriodFrames;
  const repeatedPeak = landmark(b, seam + impulse, radius);
  if (firstPeak === null || repeatedPeak === null) return null;
  const firstImpulseLocation = first.startFrame + firstPeak - firstPlayFrame;
  const measuredPeriodFrames = repeated.startFrame + repeatedPeak - repeatsFromFrame - firstImpulseLocation;
  let before = seam - 1, after = seam;
  while (before >= 0 && Math.abs(b[before * 2]) <= 0.01) before--;
  while (after < repeated.frames && Math.abs(b[after * 2]) <= 0.01) after++;
  if (before < 0 || after === repeated.frames) return null;
  return {
    measuredPeriodFrames, nominalPeriodFrames,
    frameError: measuredPeriodFrames - nominalPeriodFrames,
    impulseFrames: [first.startFrame + firstPeak, repeated.startFrame + repeatedPeak],
    thresholdSilenceFrames: after - before - 1,
    thresholdSilenceMilliseconds: (after - before - 1) * 1000 / rate,
  };
}

export function matchesLoop(evidence, correlation) {
  return correlation > 0.9 && Number.isFinite(evidence?.frameError) && Math.abs(evidence.frameError) <= 1
    && evidence.thresholdSilenceMilliseconds >= 480 && evidence.thresholdSilenceMilliseconds <= 530;
}

// Worklet play markers locate the two voices, but only observed addition of the two waveforms proves overlap.
export function mixContribution(capture, solo, rate) {
  const music = capture.starts.find((start) => start.cue === 1), effect = capture.starts.find((start) => start.cue === 2);
  if (music === undefined || effect === undefined) return null;
  const from = effect.frame + Math.round(0.35 * rate), to = effect.frame + Math.round(0.75 * rate);
  const seek = capture.seeks.find((event) => event.voice === music.voice && event.frame <= effect.frame);
  if (seek === undefined || from < capture.startFrame || to > capture.startFrame + capture.frames
      || capture.seeks.some((event) => event.voice === music.voice && event.frame > seek.frame && event.frame < to)) return null;
  const mix = new Float32Array(capture.data), reference = new Float32Array(solo.data);
  const origin = music.frame - solo.startFrame;
  const musicAtFrom = Math.round(seek.positionTicks * rate / 60) + from - seek.frame;
  const effectAtFrom = from - effect.frame;
  if (origin < 0 || origin + Math.max(musicAtFrom, effectAtFrom) + (to - from) > solo.frames) return null;
  let bothError = 0, musicOnlyError = 0, effectOnlyError = 0;
  for (let i = 0; i < to - from; i++) {
    const actual = mix[(from - capture.startFrame + i) * 2];
    const m = reference[(origin + musicAtFrom + i) * 2], e = reference[(origin + effectAtFrom + i) * 2];
    bothError += (actual - m - e) ** 2;
    musicOnlyError += (actual - m) ** 2;
    effectOnlyError += (actual - e) ** 2;
  }
  const rms = (error) => Math.sqrt(error / (to - from));
  return { frames: to - from, bothErrorRms: rms(bothError), musicOnlyErrorRms: rms(musicOnlyError), effectOnlyErrorRms: rms(effectOnlyError) };
}

export function matchesOverlap(evidence) {
  return evidence?.bothErrorRms < 0.001 && evidence.musicOnlyErrorRms > 0.01 && evidence.effectOnlyErrorRms > 0.01;
}
