---
title: "Make the desktop smoke survive a lost runner GPU context"
type: bugfix
ticket: '25'
created: '2026-11-22'
status: 'ready-for-dev'
baseline_revision: 'd8a348c58298f6dc27a5097f939d54bd45b595d9'
route: 'oneshot'
route_source: 'auto'
risk: 'low'
review: 'none'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/docs/guardrails.md'
  - '{project-root}/AGENTS.md'
  - '{project-root}/.github/workflows/ci.yml'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The desktop player startup smoke creates one WebGL2 context and treats a failed shader compile as a product defect. On hosted runners the GPU process can exit first, so a green PR fails with `render-webgl2: shader compilation failed` and an empty info log, and neither retries nor names the runner GPU state as the cause.

**Approach:** Follow the issue's "what proves a fix": the desktop smoke either survives a lost or failed GPU context on the runner (bounded retry, or a software-GL fallback under the owner's pacing rule for host-driving proofs) or it reports that cause clearly as an infrastructure failure. Repeated reruns stay green.

## Boundaries & Constraints

**Always:** Keep the smoke proving player startup; keep the measurement artefacts; pace retries with bounded backoff rather than a single monolithic timeout; classify exhausted GPU attempts as infrastructure, with the runner's GPU messages.

**Never:** Disable the desktop lane or weaken its assertion to make it green; hide a real shader or renderer defect behind a blanket retry; change the renderer's composition rules or goldens in this ticket.

</frozen-after-approval>

## Verification

**Test strategy:**
- Exercise the desktop startup smoke end to end on a hosted-runner-like path and assert that a simulated lost/failed GPU context either recovers within the bound or exits as an identified infrastructure failure.
- Re-run the `desktop` matrix repeatedly and confirm the shader-compilation error does not reappear while the measurement records still upload.
- Perturbation: force the GPU context to be absent and confirm the bounded recovery or the infrastructure diagnostic is what succeeds, not an unrelated silent pass.

**Commands:**
- `pnpm desktop:build` and the desktop smoke command used by `.github/workflows/ci.yml`.
- `pnpm bmad:tickets:test`.

## Implementation Notes

## Perturbation Check

| Guard reverted | Test that failed |
|---|---|
| | |
