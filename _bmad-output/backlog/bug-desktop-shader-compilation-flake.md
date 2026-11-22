---
id: 25
type: bug
title: "Desktop smoke cannot tell a lost runner GPU context from a renderer defect"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2169"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2169"
refined: true
hitl: false
risk: low
severity: P2
---

# Desktop smoke cannot tell a lost runner GPU context from a renderer defect

## Description

On PR #2126 (run 43234720089) the `desktop (ubuntu-24.04)` job failed after 1m9s. The player startup smoke failed with `player startup failed Error: render-webgl2: shader compilation failed:` and an empty info log, immediately after `GPU state invalid after WaitForGetOffsetInRange` and `Exiting GPU process due to errors during initialization`. In the same run `desktop (macos-15)` failed after 20m18s, against a normal ~2 minutes.

The PR touched only `packages/script-spec`, its spec docs and test baselines. The parent PR #2112, which contains everything except the coverage module, passed the desktop jobs on all three OSes, and `main` CI was green around the same time. The renderer is therefore not proven to be at fault; the host runner losing its GPU context is the stronger reading.

The defect is in the proof: when the shader compiles to nothing because the GPU process has already exited, the desktop job reports a product failure. It neither retries the context nor reports the runner GPU state as an infrastructure failure.

## Reproduction

1. Run the `desktop` matrix job on a hosted runner for a change that touches no renderer or desktop code.
2. Watch the player startup smoke (`packages/runner-desktop/app/player-live.ts`) while the runner reports `Exiting GPU process due to errors during initialization` or `GPU state invalid after WaitForGetOffsetInRange`.
3. Actual: the job aborts with `render-webgl2: shader compilation failed` and an empty info log (`packages/render-webgl2/src/index.ts`).
4. Expected: the smoke either establishes a usable context with a bounded retry or software-GL fallback, or fails as an identified infrastructure problem rather than a product defect.

## Cause Hypothesis

The desktop smoke creates a WebGL2 context once and treats a failed shader compile as a renderer defect. Hosted runners can lose the GPU process before the compile (`Exiting GPU process` precedes the failure in the log), and the empty shader info log is consistent with a dead context rather than a bad shader. The proof has no bounded retry, no software-GL fallback and no infrastructure classification.

## Acceptance Criteria

1. **A lost GPU context does not fail the product proof**
   **Given** a runner that reports `Exiting GPU process` or `GPU state invalid` when the smoke starts
   **When** the desktop player startup smoke runs
   **Then** it retries within a bound or falls back to software GL, following the owner's pacing rule for host-driving proofs, and still exercises player startup
2. **Persistent GPU absence is named as infrastructure**
   **Given** a runner where no GPU context ever initializes
   **When** the bounded attempts are exhausted
   **Then** the job reports the lost or failed GPU context clearly as an infrastructure failure, with the runner's GPU messages, and does not claim a renderer defect
3. **Repeated reruns stay green**
   **Given** the fix
   **When** the desktop matrix is rerun repeatedly
   **Then** the job passes without the shader-compilation error and still uploads its measurement artefacts

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2169
- failing ubuntu job — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43234720089/job/131239677791
- failing macOS job — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43234720089/job/131239677872
- shader error — `packages/render-webgl2/src/index.ts`
- startup smoke — `packages/runner-desktop/app/player-live.ts`
- lane — `.github/workflows/ci.yml` `desktop` job; `tools/desktop/measure.mjs`
- pacing rule — `AGENTS.md`, "Prevent test and host overload" (Owner rule, 2026-11-07)

## Notes

- The issue recorded no renderer code change; do not disable the smoke or weaken its assertion to make the lane green.
- A software-GL fallback must still prove player startup, not merely that a context object was created.
