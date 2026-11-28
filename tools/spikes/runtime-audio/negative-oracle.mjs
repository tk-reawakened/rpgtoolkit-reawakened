// Runner-side expectations are independent of the page's lane execution and reporting.
const expectedSourceDiagnostics = new Map([
  [102, "source.failed"],
  [103, "format.malformed"],
  [104, "format.unsupported"],
  [105, "source.failed"],
]);

export function matchesNegativeLanes(evidence) {
  if (evidence?.nativeRejectsMalformed !== true || evidence.missingAssetNotInMediaIndex !== true || evidence.peak !== 0
      || !Array.isArray(evidence.diagnostics) || evidence.diagnostics.length !== expectedSourceDiagnostics.size) return false;
  const observed = new Set();
  for (const { voice, codes } of evidence.diagnostics) {
    if (observed.has(voice) || !expectedSourceDiagnostics.has(voice) || !Array.isArray(codes)
        || codes.length !== 2 || codes[0] !== expectedSourceDiagnostics.get(voice) || codes[1] !== "protocol.state") return false;
    observed.add(voice);
  }
  return true;
}
