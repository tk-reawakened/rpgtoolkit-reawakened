---
id: 26
type: bug
title: "Mobile CI fails when Maven Central rate-limits dependency downloads"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2721"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2721"
refined: true
hitl: false
risk: low
severity: P2
---

# Mobile CI fails when Maven Central rate-limits dependency downloads

## Description

The mobile lane failed on PR #2707 (run 43741557090, job 132895704349) because Gradle dependency downloads returned HTTP 429 Too Many Requests from `repo.maven.apache.org` (for example `javax.annotation-api:1.3.2`). The artifact upload then found no proof. The gate still passed, so the lane both lost its build and failed silently.

A second occurrence was recorded on PR #3330 (head 341afc6b7, run 44972435743, job 137055197083, mobile / Assemble debug APK): Gradle could not resolve `com.google.guava:guava:33.3.1-jre` and `org.jetbrains.kotlin:kotlin-stdlib-jdk8:2.2.0` from `dl.google.com` or `repo.maven.apache.org`, and the BUILD failed in 9s before any project code ran. That change only touched two core test files.

Two separate defects are recorded here: the rate-limited dependency resolution has no bounded recovery, and the mobile gate can pass while the mobile proof never ran or never uploaded. This is a CI infrastructure defect, not a change to PR #2707 or PR #3330.

## Reproduction

1. Run the `mobile` lane on a hosted runner while Maven Central or `dl.google.com` answers HTTP 429 (or is unreachable) for Gradle dependency resolution.
2. Actual: `./gradlew assembleDebug` fails before project code runs; `artifacts/mobile-proof/` is empty, and the gate does not fail for that reason.
3. Expected: dependency resolution retries within a bound and succeeds when the limit clears; a persistent failure fails the mobile job and the gate, and a successful run uploads its proof.

## Cause Hypothesis

Gradle resolves external dependencies once with no retry, so a transient 429 aborts the build. The mobile lane is advisory while mobile work is paused (issue #1935), and the gate does not depend on the mobile proof, so the empty artefact upload is not treated as a missing obligation.

## Acceptance Criteria

1. **A simulated 429 recovers within a bound**
   **Given** a dependency repository that answers HTTP 429 for a bounded number of requests
   **When** the mobile build resolves dependencies
   **Then** it retries with backoff and completes, rather than failing on the first response
2. **A persistent rate limit stays a failure**
   **Given** a repository that answers HTTP 429 indefinitely
   **When** the retries are exhausted
   **Then** the build fails with the rate-limit cause, and the failure is not hidden by a fallback or a passing gate
3. **The gate sees the mobile proof**
   **Given** a mobile run that produced no proof artefact
   **When** the workflow finishes
   **Then** the gate fails or otherwise reports the missing proof, instead of passing with an empty upload
4. **A successful run uploads its proof**
   **Given** dependency resolution succeeds
   **When** the mobile proof runs
   **Then** the proof artefact is produced and uploaded

## References

- issue — https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2721
- first failure — https://github.com/tk-reawakened/rpgtoolkit-reawakened/actions/runs/43741557090/job/132895704349
- second occurrence — run 44972435743, job 137055197083 (mobile / Assemble debug APK)
- lane — `.github/workflows/ci.yml` `mobile` job (`./gradlew assembleDebug`, `pnpm mobile:proof`, artefact upload)
- project — `packages/runner-mobile` (Capacitor Android project)
- gate hole — the advisory mobile lane does not feed the required gate

## Notes

- The mobile lane is advisory while mobile work is paused (#1935); fixing the gate hole must not silently turn a paused advisory lane into a blocking one without an owner decision, but it must not report a missing proof as a pass either.
- Do not pin away the failing dependency versions as the fix; the defect is the missing bounded recovery and the gate hole.
