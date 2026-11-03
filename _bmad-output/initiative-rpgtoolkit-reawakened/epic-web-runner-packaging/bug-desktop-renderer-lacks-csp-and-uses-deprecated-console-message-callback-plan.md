---
title: 'Desktop renderer lacks CSP and uses deprecated console-message callback'
type: 'bug'
ticket: '19'
status: done
tracker_id: '#1049'
risk: 'high'
---

# Plan

PR #1042 proposes the normal-player policy and event-object listener. Issue #1049 records the report-page coverage gap and the checks needed for enforced policies and preserved diagnostics.

## Notes

- Merged: PR #1155 (adbc5e93) gives every desktop/web player page the strict shared CSP and makes the test enumerate all player pages; desktop measurement passes end to end under the policy. Issue #1049 is closed.
- The remaining runtime-block verification gap was tracked by #1215 and is now closed by the runtime probe below.
- PR #1155 filed #1156 for the mobile player page CSP gap; that issue is now closed by merged PR #1159 (b215d1bd).
- Runtime verification for #1215: `tools/browser/tests/csp-runtime.spec.ts` loads the shipped `/packages/runner-web/app/index.html` page, observes successful `apps/player.js` loading and execution (`#report` leaves `booting…` and `window.__report` is populated), injects an inline script that would set `window.__cspDisallowedScriptRan`, confirms it remains undefined, and observes `securitypolicyviolation` with `effectiveDirective=script-src-elem` and `blockedURI=inline`. Verified on the enforced shipped meta policy by `pnpm browser:test` (38 browser tests passed).
- Perturbation proof: the same browser probe's `CSP_PROBE_WEAKENED=1` route removes the CSP meta tag from the runner-page response only. `CSP_PROBE_WEAKENED=1 pnpm exec playwright test tools/browser/tests/csp-runtime.spec.ts` failed as required because `window.__cspDisallowedScriptRan` was `true`; after that response-only perturbation, the unmodified shipped page passed the normal probe. No product CSP or HTML was weakened in the worktree.
- Issue #1215's final runtime-block criterion is now evidenced by the positive probe and the perturbation failure; status updated to done with `tickets.py mark`.
