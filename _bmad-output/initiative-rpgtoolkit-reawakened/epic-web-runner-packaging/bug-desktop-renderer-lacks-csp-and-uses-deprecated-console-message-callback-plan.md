---
title: 'Desktop renderer lacks CSP and uses deprecated console-message callback'
type: 'bug'
ticket: '19'
status: in-review
tracker_id: '#1049'
risk: 'high'
---

# Plan

PR #1042 proposes the normal-player policy and event-object listener. Issue #1049 records the report-page coverage gap and the checks needed for enforced policies and preserved diagnostics.

## Notes

- Merged: PR #1155 (adbc5e93) gives every desktop/web player page the strict shared CSP and makes the test enumerate all player pages; desktop measurement passes end to end under the policy. Issue #1049 is closed.
- The remaining runtime-block verification gap is tracked by #1215; keep this plan in-review until Electron `app://` enforcement is proven.
- PR #1155 filed #1156 for the mobile player page CSP gap; that issue is now closed by merged PR #1159 (b215d1bd).
- Web HTTP runtime verification for #1215: `tools/browser/tests/csp-runtime.spec.ts` loads the shipped `/packages/runner-web/app/index.html?package=/fixtures/packages/demo.tpk`, observes successful `apps/player.js` loading and the demo package reaching tick 120 with a `loaded` report and no player/load error, injects an inline script that would set `window.__cspDisallowedScriptRan`, confirms it remains undefined, and observes `securitypolicyviolation` with `effectiveDirective=script-src-elem` and `blockedURI=inline`. This verifies web HTTP CSP blocking with a running package; it does not prove Electron.
- Perturbation proof: the same browser probe's `CSP_PROBE_WEAKENED=1` route removes the CSP meta tag from the runner-page response only. `CSP_PROBE_WEAKENED=1 pnpm exec playwright test tools/browser/tests/csp-runtime.spec.ts` failed as required because `window.__cspDisallowedScriptRan` was `true`; the shipped HTML was not weakened.
- Residual gap: execute an equivalent forbidden-inline-script runtime probe while the packaged desktop player is loaded under Electron's `app://` scheme, confirming the script does not execute, `securitypolicyviolation`/CSP refusal is observed, and allowed app resources still load. Entry 9.19 remains in-review until that evidence exists.
