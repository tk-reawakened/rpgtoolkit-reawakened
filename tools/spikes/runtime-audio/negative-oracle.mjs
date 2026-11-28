// Runner-side expectations are independent of the page's lane execution and reporting.
const expectedSourceDiagnostics = new Map([
  [102, "source.failed"],
  [103, "format.malformed"],
  [104, "format.unsupported"],
  [105, "source.failed"],
]);

export const negativeCaptureSeconds = 0.8;

export function matchesNegativeLanes(evidence, rate) {
  if (evidence?.nativeRejectsMalformed !== true || evidence.missingAssetNotInMediaIndex !== true
      || !Number.isFinite(rate) || rate <= 0
      || !Array.isArray(evidence.diagnostics) || evidence.diagnostics.length !== expectedSourceDiagnostics.size) return false;
  const minimumFrames = Math.ceil(rate * 0.6);
  const observed = new Set();
  for (const { voice, codes, framesAfterPlay, peak } of evidence.diagnostics) {
    if (observed.has(voice) || !expectedSourceDiagnostics.has(voice) || !Array.isArray(codes)
        || !Number.isInteger(framesAfterPlay) || framesAfterPlay < minimumFrames || peak !== 0
        || codes.length !== 2 || codes[0] !== expectedSourceDiagnostics.get(voice) || codes[1] !== "protocol.state") return false;
    observed.add(voice);
  }
  return true;
}
