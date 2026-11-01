# ADR 0016 — Classify CI work without skipping required jobs

* **Status:** Proposed — awaiting owner ruling; not authority to change CI
* **Date:** 2026-11-01
* **Context:** [G5 and the rollout](../guardrails.md), issue #664

## Context

CI runs costly test, replay and device jobs even for a prose-only pull request. G5 currently says the headless golden suite must **run** on every pull request, and the rollout requires every named job to succeed. A successful job that omits its replay does not literally run that suite. Whether to permit that exception is the owner's decision, not a conclusion this proposal can make.

The active default-branch ruleset requires only `gate`. GitHub treats a job skipped by a condition as successful for required-check purposes; a whole workflow skipped by path filtering can leave its check pending. Therefore neither branch protection nor a green skipped job proves the expensive work ran. See [GitHub's required-check documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks).

## Proposed decision: A

Keep all current jobs in `gate`'s `needs`, keep each job running, and keep the gate failing for every non-success result. A new `changes` job and `gate` must also succeed. Only after the owner accepts this decision may selected **steps** be conditional. Each job that omits work must report clearly that its steps were skipped and identify the documentation-only paths; its job result is still success. No ruleset or required-context change is proposed. A failed, cancelled, missing or ambiguous classifier must never select an omission; a failed required job must still fail the gate.

Classify the complete pull-request diff with the classifier from the trusted base revision, not the version under review. Obtain both sides of renames (for example `git diff --no-renames --name-only -z`), treat malformed bytes, missing history, diff or classifier errors and missing outputs as full-suite inputs, and force full work on pushes to `main`. Do not interpolate changed paths into shell commands. Test the classifier, transport and gate so an unexpected omission or error cannot pass unnoticed. The classifier change itself, workflow changes, and unclassified paths always select full work.

The only proposed inert paths are root-level `*.md`; `docs/guardrails.md`; `docs/adr/**/*.md`; `_bmad-output/**/*.md`; and `.github/ISSUE_TEMPLATE/**/*.{md,yml,yaml}`. These are prose, planning records or issue form metadata rather than lane inputs. `checks` still runs for them, including provenance. The allowlist deliberately does not include all Markdown or all `_bmad-output` files. Anything under `packages/`, `tools/`, `stock/`, `golden/`, `docs/spec/` or `.github/workflows/` always selects full work, even if named `README.md`; all other paths also select full work. An empty list, malformed or absolute path, traversal, backslash or unknown event selects full work.

### Proposed G5 clarification, requiring owner approval

If the owner chooses A, replace G5 rule 1 with this explicit sentence (and update its enforcement text consistently):

> A headless runner (Node/Bun, CPU rasteriser, null audio, scripted input) MUST exist from milestone 1, and its required CI job MUST run on every pull request; the golden execution steps MAY be omitted only when a fail-closed classifier proves that every changed path is in the ADR 0016 inert allowlist. All other changes MUST execute the golden suite.

Add to G5 enforcement: “An intended omission of golden execution steps is reported by the successful job; a failed, cancelled or skipped job, classifier failure, or unexpected omission blocks merge.” The rollout still requires all named jobs to succeed, but should expressly distinguish a successful job with an allowed step omission from a skipped job. This proposal does not amend guardrails or assert that current G5 already permits A.

## Current graph and proposed step scope

All eight rows remain required successful jobs. `script-dogfood` depends on `checks`; `gate` depends on all eight and merges unit coverage. “May omit” below means **only after approval**, for the exact inert-only PR above; it never means a GitHub job is skipped.

| Job | Guards and docs-only effect | Proposed step scope |
|---|---|---|
| `checks` | Typecheck, lint, dependency audit/licences, provenance, graph, fixture/corpus/catalogue and tool checks; documentation can affect its scans and generated-document checks. | Never omit steps. |
| `unit` | Fifteen strict test and coverage shards; `gate` consumes their LCOV artefacts. | Never omit steps: preserving coverage merge and its thresholds requires every shard. |
| `golden` | Node headless goldens, closing, reference oracle and corpus digests; inert prose cannot change their inputs. | May omit setup, fixture, build, replay and oracle/dump steps only with the proposed explicit G5 ruling. |
| `golden-bun` | Bun replay of golden and closing suites; inert prose cannot change their inputs. | May omit setup, fixture and replay steps only with the proposed rollout ruling. |
| `browser` | Real Chromium game and raster conformance; inert prose cannot change its inputs. | May omit setup, build, fixture, browser installation and test steps. |
| `desktop` | Electron package and measurements on Linux, macOS and Windows; inert prose cannot change its inputs. | May omit setup, fixture, build, measurement, inventory and artefact steps on each matrix runner. |
| `mobile` | Real Android build and emulator proof; inert prose cannot change its inputs. | May omit setup, SDK, build, emulator and proof artefact steps. |
| `script-dogfood` | Script CLI check, formatting, index, docs and test baselines; inert prose cannot change its inputs. | May omit setup, build and dogfood commands; all RPGCode, `stock/`, spec, packages and tooling changes run them. |

`changes` and `gate` themselves are never omitted. `gate` still checks all outcomes and always downloads, merges, checks and uploads coverage. A report-only step in each conditionally reduced job must always execute. Actual workflow wiring and real pull-request evidence are separate work after the owner ruling.

## Consequences

* Short documentation-only PRs still start every job and all unit shards, but can avoid several expensive installations, builds, replays and emulators. Coverage and the actual required status context remain intact.
* A classification mistake could hide a regression. The small positive allowlist, trusted base classifier, complete rename-aware diff, full default and adversarial tests reduce that risk; paths must be reviewed when the workflow gains new inputs.
* A successful reduced job no longer means its expensive checks executed. The visible report and gate's strict success checks make that distinction explicit; they do not replace the requested owner ruling or real CI verification.

## Rejected alternative: B

Skip whole jobs and let `gate` accept classifier-approved `skipped` results. That contradicts the current required-job success language and makes required-context semantics easy to misunderstand: GitHub can treat skipped jobs as successful. It would need an explicit guardrail amendment and a carefully reviewed gate and ruleset policy; avoiding runner startup is not worth that additional risk here.
