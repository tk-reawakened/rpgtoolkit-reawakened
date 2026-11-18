---
title: "Deliver and prove the installable standalone editor PWA"
type: feature
ticket: 24
created: 2026-11-17
status: done
baseline_revision: 6f9d389a5af4bc210eb4be43806ceaa0a807bd0b
route: full
route_source: auto
risk: high
review: thorough
review_source: auto
lenses_ran: [PwaShellSafety, PwaProofIntegrity]
review_loop_iteration: 0
context:
  - "{project-root}/docs/guardrails.md"
---

<frozen-after-approval reason="delegated implementation decisions for Epic 11">

## Intent

**Problem:** The foundation acceptance calls for an installable standalone editor, but the tested browser page has no editor application manifest or service worker. Its existing browser tests do not establish that an installed application opens and saves a project.

**Approach:** Package the existing shared browser editor as an independently installable application, without changing its editor model or platform-service contract. Prove the installed application's folder-backed edit and save, and keep the player and its cache separate.

## Boundaries & Constraints

**Always:** Use the existing editor and host-web filesystem; preserve browser and VS Code behavior, current CSP, clean-room rules, project data and player service-worker ownership. Make the manifest and worker usable at the served editor path. Cache only application assets, not project contents. Report browser capability limits honestly.

**Never:** Treat an ordinary browser tab or `--app` window as proof of installation; reuse or broadly delete player caches; claim offline player support or persistent session-copy edits; introduce a new production dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior |
|---|---|---|
| Installed editor | Supported secure context; existing folder project | Installed application opens, edits and saves via platform services; independently inspected saved bytes contain the edit and unrelated bytes are unchanged. |
| Unsupported folder access | Browser lacks the required folder picker | User receives actionable capability guidance; session-copy limits remain explicit. |
| Worker lifecycle | Player and editor registrations/caches coexist | Editor controls only its own scope and does not delete player caches or cache project data. |
| Update/offline | Editor shell changes or network is unavailable | Updated shell is not silently pinned to stale assets; offline behavior is accurately stated and verified. |

</frozen-after-approval>

## Code Map

- `tools/browser/editor-web/index.html`, `page.ts`, `main.tsx`: existing standalone entry, editor host and strict CSP; reuse these rather than making a second editor.
- `tools/browser/build.mjs`, `serve.mjs`: produce/serve the existing editor and player bundles; editor worker and manifest must not replace the player artifacts.
- `packages/host-web/src/filesystem.ts`, `projects.ts`: existing folder-backed file access and durable handles; project file content must not enter a service-worker cache.
- `packages/runner-web/src/register-worker.ts`, `service-worker-core.ts`: existing player scope/cache contract, which remains independent.
- `tools/browser/tests/editor-web-host.spec.ts`: existing real UI/OPFS folder-handle scenarios; picker substitution and OPFS assertions alone do not prove an actual installed app or OS directory.
- `docs/editor-ecosystem/current-state.md`: existing browser launch and unsupported-browser guidance.

## Tasks & Acceptance

**Execution:**
- [x] `tools/browser/editor-web/` and `tools/browser/build.mjs` — provide an editor-specific valid manifest, appropriately scoped worker, and shell registration/build; choose asset/cache policy that cannot overwrite player or project data.
- [x] `tools/browser/serve.mjs` and browser proof tools — support and exercise the actual served/installed entry, scoped worker and independently observed persisted project bytes, including coexistence and failure paths.
- [x] `docs/editor-ecosystem/current-state.md` — document installation, required secure/browser capabilities and precise persistence/offline limits.
- [x] Validate the existing ordinary-browser and VS Code host paths, and obtain independent review and exact-head required CI.

**Acceptance Criteria:**
- Given the served editor in a supported browser, when installed and launched as the registered app, then its standalone window runs the existing editor and opens, edits and saves a folder-backed project; a separate reader sees the change and an untouched sibling remains unchanged.
- Given an editor and a player on the same origin, when the editor worker is installed, updated or removed, then the player registration/cache and authored project data remain intact.
- Given unavailable folder access or offline conditions, when the user attempts the relevant operation, then behavior and guidance match the actual supported capability, without silently claiming durable writes or offline player launch.

## Implementation Notes

- The editor receives a separate manifest and versioned, allowlisted shell cache; registration scope stays under its existing served path. The worker does not cache project content or take control of the separate player. Manifest identity is fixed to the current local deployment path; arbitrary subpath deployment is not claimed.
- The headed proof installs and launches the actual PWA with Chromium DevTools, asserts standalone display, opens a folder-backed project through the real editor/host, checks saved bytes from another page and reopens offline. The folder picker is explicitly substituted with OPFS, not an OS-selected directory; existing browser filesystem behavior remains separately tested.

## Plan Change Log

## Review Triage Log

- Independent `PwaShellSafety` review found no concrete shell, scope, CSP or cache finding.
- Independent `PwaProofIntegrity` review found an unbounded worker-ready wait and activation race (#3154), and failure-path installed-app cleanup (#3155). Replace readiness with a bounded activation/old-cache condition, uninstall in failure-safe cleanup, preserve the original error and always remove the temporary profile. Run deliberate missing-worker and post-install failure controls before the restored positive.
- `PwaProofIntegrity` re-reviewed both fixes and found no concrete remaining issue.

## Verification

Run the focused installed-application proof, editor browser regression and relevant worker/coexistence tests locally, plus scoped lint/type/build and ticket preflight. Record browser/OS versions, independent-byte oracle and any limitations. Run browser/native hosts serially with settling. Exact-head required CI and independent review precede merge.

- Local macOS arm64 / Chromium 156.0.8078.4: actual CDP install and standalone launch, UI edit/save, independent OPFS read of saved `.gam` and unchanged sibling, offline reopen, separate real player registration and its descriptor-cache sentinel all passed. The picker is substituted with OPFS, not a native OS picker. The original relative manifest ID was rejected by Chromium (#3151); its processed ID is now asserted. The first coexistence harness used a player-version cache that the player's own activation removed (#3153); the fixed proof uses its persistent descriptor cache.
- Browser unsupported-folder message and existing folder save/reload: 2/2 passed (new case 719 ms). Browser test TypeScript and scoped ESLint passed; provenance scanned 1,705 files with zero violations; stock/store preflight found #3148 and its plan.
- A deliberate failure after `PWA.install` returned nonzero, preserved the original error and printed successful uninstall; the restored positive passed. Denying the worker at the HTTP server returned the intended bounded 15-second activation diagnostic; the browser-route attempt did not intercept the worker and was removed (#3159). The restored positive and scoped proof lint passed afterward.
- Full serial local browser suite: 132/133 passed; the language-worker negative control was bypassed by the new shell cache (#3161). The same failure was observed in CI. Blocking service workers only in that negative case restores an actually refused language worker without changing its edit/save assertions; the targeted real-browser case then passed locally.
- PR #3160 merged as `73ad4adef0e91088c139fd541ddc60d8acc6341e` after its exact head `57b9028b96dfce650741bfeb35212deb3409a7de` passed the required gate in [CI run 44173953948](https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/44173953948), including browser, VS Code Web and all desktop lanes. The installed-host proof substitutes OPFS for the native folder picker; it does not establish OS-picker permissions or access to an external directory.
