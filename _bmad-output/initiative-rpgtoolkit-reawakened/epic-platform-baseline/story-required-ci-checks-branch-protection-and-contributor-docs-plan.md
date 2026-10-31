---
title: 'Required CI checks, branch protection and contributor docs'
type: 'chore'
ticket: '10'
created: '2026-10-10'
status: done
baseline_revision: '7118dddfbddbc52ebd585522b4fc14bf462db8e8'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 1
context: ['{project-root}/docs/guardrails.md', '{project-root}/_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Seven per-check workflow files exist, but nothing makes them required (live: protection 404, `rules/branches/main` `[]`), and a *skipped* job can still merge. A gate cannot sit beside them: `needs` is per-file, and `workflow_run` checks cannot satisfy a required check. `fixtures:check` runs in the required `golden` job (entry 1.9 deferral), so `fixtures` stays non-required. `CONTRIBUTING.md` lists four commands and claims "one workflow per check".

**Approach:** Move the seven jobs verbatim into one `ci.yml` and add a `gate` job (`needs:` all seven, `if: always()`) failing unless every `needs.*.result` is `success`. Delete the seven old files, keep `fixtures.yml` non-required, document every command and the required names in `CONTRIBUTING.md`; a person sets branch protection.

## Boundaries & Constraints

**Always:** Job ids stay `typecheck`, `lint`, `unit`, `golden`, `licence`, `provenance`, `graph`; the workflow is `name: CI`. No `if:` on any of the seven required jobs, and no `paths:`/`paths-ignore:` anywhere in `ci.yml`; the gate's `if: ${{ always() }}` is the single permitted `if:`. Node 24.21.0, frozen install, `permissions`/triggers as today. Required = the seven job names plus the gate; job names stay unique repo-wide.

**Never:** Add any check, job, script or a `fixtures` required check; use `workflow_run`, `workflow_call` or the statuses API; weaken a check; add a path filter or `if:` to a required job; merge steps into fewer jobs; edit `packages/`, `tools/` or the check tooling; touch the ticket tree (the sole `docs/` edit is the Rollout §4 line above).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All pass | every result `success` | Gate prints them, exit 0 | No error |
| A required job fails | `unit` fails | Gate still runs (`always()`), prints `unit: failure`, exit 1 | Merge blocked |
| A required job is skipped | a later `if:` gives `skipped` | Exit 1; GitHub alone reports a skipped job as `Success` and merges | Merge blocked |
| Workflow does not run | path filter or `[skip ci]` | Required checks stay `expected`/pending | Merge blocked (filters are banned) |
| Job renamed or dropped from `needs` | id or `needs` edited | Its check never reports, stuck `expected` | Merge blocked; the seven job names carry this |
| `needs.*.result` empty | `needs:` emptied | Exit 1 on the empty guard | The seven names stay `expected` and block; the guard is redundant |
| `fixtures` fails | red | Gate unaffected; `fixtures:check` still runs in required `golden` | Non-required; merge allowed |
| File shape | `ci.yml` | Parses; no `if:` on a required job; jobs == required set + `gate`; `name: CI` | Shape assertion fails |
| Protection strictness | "Require branches to be up to date before merging" | A green run against a stale base cannot merge | Enforcement is the human's |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` -- new, `name: CI`. The seven required jobs verbatim from the files below, plus `gate`.
- `.github/workflows/{typecheck,lint,unit,graph,licence,provenance,golden}.yml` -- deleted; each job moves into `ci.yml` under the same id.
- `.github/workflows/fixtures.yml` -- unchanged. Non-required; its `fixtures:test` is the only run of `tools/fixtures/test/`.
- `CONTRIBUTING.md` -- commands rewritten to exactly what CI runs, required-check list added, "one workflow per check" fixed.
- `docs/guardrails.md` -- Rollout §4's enumeration line only (add `graph` and the gate).
- `.github/pull_request_template.md` -- one line: where to run the checks locally. The G1-G7 checklist, cite-the-docs checkbox, exception marker and golden-change note already exist.
- `package.json` -- unchanged; only `synth` has per-package `build`/`typecheck`/`lint`/`test` (`core`/`runner-harness`/`runner-headless` have `typecheck:tests`).
- Branch protection -- no file; the human action in Tasks.

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/ci.yml` -- the seven `jobs:` blocks verbatim, plus `gate` (`needs:` all seven, `if: ${{ always() }}`, `timeout-minutes: 5`, one step naming every non-`success` result and exiting 1) -- CAP-13, ticket verify clause
- [x] delete the seven workflow files -- one job per name, no orphaned checks
- [x] `CONTRIBUTING.md` -- document exactly the CI command chain given in Verification, in the order listed in Verification; note the `*:test` scripts are CI's tool self-tests, `graph:write` is a dev aid CI never runs, and `license`/`license:test` are aliases; add the required-check list and rename rule -- contributor path
- [x] `docs/guardrails.md` -- Rollout §4 list becomes `typecheck, lint, unit, graph, golden, licence, provenance` plus the gate -- the norm then matches the enforced set
- [x] `.github/pull_request_template.md` -- pointer to the CONTRIBUTING commands -- the last gap
- [x] verify locally, then hand the human the copy-pasteable protection block in Verification -- hitl

**Acceptance Criteria:**
- Given a PR with a required job failing or skipped, then `gate` fails and the PR cannot merge (ticket verify).
- Given a deliberate violation of G1-G4, G6 or G7, or an edge absent from `tools/deps/edges.json`, then that job fails and the gate fails (Done-when 2).
- Given any PR, then `golden` runs, fetches `demo` and `Basic`, and commits none (Done-when 3).
- Given the seven job names plus the gate set in protection, a red or skipped job blocks the merge box (Done-when 4); a fresh clone runs every CONTRIBUTING command as its CI job does.

## Implementation Notes

- **What changed.** One `ci.yml` holds the seven required jobs (moved verbatim, same ids) plus `gate`; the seven per-check files are deleted; `fixtures.yml` is unchanged and non-required. `CONTRIBUTING.md` documents the CI command list, the required-check names and the rename rule; `docs/guardrails.md` Rollout 4 matches the enforced set; the PR template points at the commands.
- **Supersedes** entry 1.2's "one workflow file per check / later entries add files only" and the epic's 2026-10-10 sequencing note, confirmed by the human at the 1.10 checkpoint: a `needs` gate cannot span workflow files.
- **The one open item (hitl).** Branch protection is unset (live: 404 on the classic endpoint, no rulesets). The human applies it after the first green run of `ci.yml`; this plan is `built`, not `done`, until that is verified with the read-backs in Verification.
- **Corrected at build time.** The actionlint download needs `gh release download --repo rhysd/actionlint` (the bare form reads the repo as a tag); the classic protection read-back errors 404 "Branch not protected" when unset rather than printing an empty list.
- **Hand-off closed (2026-10-11).** The human saved a ruleset instead of the classic rule (Decision 5 allowed either): "Gate Guards", id 24867688, enforcement `active`, target `~DEFAULT_BRANCH`. It holds `required_status_checks` with exactly `typecheck lint unit golden licence provenance graph gate` (all from the GitHub Actions app, integration id 15368) and `strict_required_status_checks_policy: true`, plus `deletion` and `non_fast_forward`. There is no `pull_request` rule, so pull requests are not required. The bypass list is empty (`current_user_can_bypass: never`). Read back with a set comparison of the live rule against the eight names and the up-to-date flag: `VERDICT: PASS`. The classic endpoint still answers 404, which is expected when a ruleset is used.
- **Later change (entry 1.11).** `fixtures.yml` no longer exists: its `pnpm fixtures:test` run moved into the required `unit` job, which supersedes Decision 3 below. The required set did not change.
- **Later change (2026-10-20, issue #538).** The ruleset now names `golden-bun` explicitly as a ninth required check (same GitHub Actions app, integration id 15368) alongside `gate`. Reason: `golden:bun` no longer re-runs the Node suites before replaying Bun — Node is covered by the required `golden` job — so the Bun replay is the only cross-runtime check and should report as a required check in its own right, not only through `gate`. `gate` still lists it in `needs`; the live set is `typecheck lint unit golden golden-bun licence provenance graph gate`. The live rule reads `strict_required_status_checks_policy: false` as of 2026-10-20, not the `true` recorded in the 2026-10-11 hand-off above; this change did not alter that setting.

- **Later change (2026-10-27, issue #705 "Consolidate CI checks and shard single-pass unit+coverage suite").** `ci.yml` was reduced to five jobs — `checks`, `unit`, `golden`, `golden-bun`, `gate` — where typecheck, lint, licence, provenance, graph, catalogue and command-docs are steps inside `checks` and the shard matrix inside `unit`. The live ruleset `Gate Guards` (id 24867688) was reduced in the same change to a single required context, `gate`, with `strict_required_status_checks_policy: false`. Two statements above are therefore no longer true and are kept only as history: "the live set is `typecheck lint unit golden golden-bun licence provenance graph gate`", and the rationale beside it that per-job contexts leave a dropped job stuck at `expected`. With one required context, a job dropped from `ci.yml` together with its `needs` entry now leaves `gate` green, so the protection is the `needs` list of the `gate` job plus its non-zero exit, reviewed in the same PR as any job rename. The eight-name read-back in Verification is likewise historical.

## Plan Change Log

## Review Triage Log

Independent context-free review by review-1-10 (report `/tmp/review-1-10-code.md`), with the deleted files recovered from `HEAD` for comparison. Result: 0 blockers, 1 major, 3 minor, 3 nit.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| M1 | `CONTRIBUTING.md` claimed every listed command is a `ci.yml` job, but `pnpm build` runs in no job and `pnpm fixtures:test` runs in the non-required `fixtures.yml` | major | patch | Sentence corrected: the seven required jobs are in `ci.yml`, `fixtures:test` is in `fixtures.yml`, and `build` is the `tsc -b` that `typecheck` and `test` already run. |
| m1 | The plan's actionlint download command fails (`gh` reads the repo as a tag) | minor | patch | Replaced with `gh release download --repo rhysd/actionlint …`; the `pnpm dlx` route is confirmed impossible. |
| m2 | The hand-off said an empty read-back means no protection; the classic one exits 404 | minor | patch | Hand-off now distinguishes the 404 from the ruleset's `[]`. |
| m3 | Decision 4 (up-to-date strictness) appeared in no task, matrix row or hand-off, which listed only read-backs | minor | patch | A strictness matrix row and the exact settings (contexts, up-to-date, UI path) added to the hand-off. |
| N1 | A task said "in job order" while Verification is grouped by tool | nit | patch | Reworded to "in the order listed in Verification". |
| N2 | `tools/provenance/test/provenance.test.mjs` uses the literal `.github/workflows/ci.yml` as a synthetic fixture path | nit | accept | Coincidence predating the file; the test is independent of the real workflow. |
| N3 | Plan task checkboxes were unchecked | nit | patch | The five implementation tasks are checked; the hitl task stays open, because branch protection is not set yet. |

Verified by the reviewer running it: the seven deleted jobs are dict-identical to their `ci.yml` counterparts; `fixtures.yml` untouched and still the only run of the tools' tests; no live stale reference to the deleted filenames; the gate exits 1 for failure/skipped/cancelled/empty and names the offending job; actionlint 1.7.12 clean on both workflows; the whole local chain green (78/78 tests, 8/8 graph tests, 26/26 licence tests, 56/56 provenance tests, 49/49 fixture tests, 24 golden steps compared, `pnpm audit --prod` clean).

## Design Notes

**Shape: one file, seven jobs, one gate.** `needs` is per-workflow, and a `workflow_run` gate cannot be required: the events whose workflow jobs are evaluated for a PR are `push`, `pull_request`, `pull_request_review`, `pull_request_target`, `deployment`, `deployment_status` — `workflow_run` is absent, so such checks "do not appear in a pull request's checks section or satisfy required status checks in a branch ruleset".

```yaml
  gate:
    needs: [typecheck, lint, unit, golden, licence, provenance, graph]
    if: ${{ always() }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - env:
          RESULTS: "${{ join(needs.*.result, ' ') }}"
          NEEDS: "${{ toJSON(needs) }}"
        run: |
          echo "$NEEDS" | jq -r 'to_entries[] | select(.value.result != "success") | "\(.key): \(.value.result)"'
          [ -n "$RESULTS" ] || { echo "no results"; exit 1; }
          for r in $RESULTS; do [ "$r" = success ] || { echo "gate failed: $NEEDS"; exit 1; }; done
          echo "all required jobs succeeded: $RESULTS"
```

A dependent job is skipped when a need fails and "may not block merging"; `always()` makes it report every time. A job skipped by a conditional "will report its status as 'Success' ... even if it is a required check", so the gate's exit code is what blocks. `join` keeps values only, so `toJSON(needs)` + `jq` (on `ubuntu-latest`) names the culprit.

**Why the seven job names are required too.** With only `gate` required, deleting a job and its `needs` entry leaves the gate green; with them required, a dropped job leaves its check stuck at `expected`. The context is the bare job id, proved live: workflows named `Typecheck`, `Lint`, … report checks `typecheck`, `lint`, … on `main`, so renaming the workflow to `CI` costs nothing — only a job-id rename does, and it blocks every merge until protection is updated in the same PR.

**Supersedes.** Entry 1.2's "one workflow file per check / later entries add files only" and the epic's 2026-10-10 sequencing note ("each adding its own workflow file"): a `needs` gate cannot span files. The human confirmed it at the 1.10 checkpoint; the epic Note is out of scope, so the hand-off asks for it.

**Rejected.** (a) Gate via `workflow_run`: ineligible, above; a commit status would need `statuses: write`. (b) Keep the eight files and duplicate the jobs in `ci.yml`: every job runs twice and two workflows report the same job names on one SHA, which GitHub warns "cause ambiguous status check results and block pull requests". (c) Reusable workflows: eight files remain, and the check names become the caller's job ids anyway. (d) One merged job: no per-check granularity. (e) `!cancelled()`: the ticket mandates `always()`. Kept added scope: the PR-template one-liner, which makes the CONTRIBUTING list reachable at review.

**Merge queue.** If one is ever enabled, `merge_group:` must be added to `ci.yml`'s `on:` or every required check silently stops reporting; log it in `deferred-work.md` at build time.

## Verification

**Commands (local, before hand-off):**
- the shape assertion below (not a `grep` for `if:`, which the gate's own `always()` would falsify) -- expected: `shape OK`

```python
import yaml
d=yaml.safe_load(open('.github/workflows/ci.yml')); on=d.get('on', d.get(True))
req={'typecheck','lint','unit','golden','licence','provenance','graph'}
assert d['name']=='CI' and set(d['jobs'])==req|{'gate'}, d
assert not any('if' in d['jobs'][j] for j in req)
g=d['jobs']['gate']; assert g['if']=='${{ always() }}' and set(g['needs'])==req
for k,v in on.items():
    assert not (isinstance(v,dict) and ({'paths','paths-ignore'} & set(v))), (k,v)
print('shape OK')
```

- `actionlint` 1.7.12 via `gh release download --repo rhysd/actionlint -p 'actionlint_*_darwin_arm64.tar.gz' -D /tmp/al` then `tar xzf` -- expected: exit 0; `pnpm dlx actionlint` cannot work (the npm package ships no binary), and the bare `gh release download rhysd/actionlint …` form fails because `gh` reads the repo as a tag.
- the gate step with fixed `RESULTS`/`NEEDS`: all-`success` → 0; `failure`, `skipped`, `cancelled`, empty → 1 (verified on this host)
- the local chain that is literally CONTRIBUTING's list, in job order → green: frozen install, `build`, `typecheck`, `test`, `lint`, `graph:test`, `graph`, `licence:test`, `licence`, `pnpm audit --prod`, `provenance:test`, `provenance`, `fixtures:test`, `fixtures:fetch`, `fixtures:check`, `golden`

**Hand-off (copy-pasteable).** Contexts, exactly: `typecheck lint unit golden licence provenance graph gate`. First merge or push the `ci.yml` PR and wait for a green run reporting all eight: a required check must have reported in the last seven days, and `gate` has never run. Then, in Settings -> Branches -> Add branch protection rule for `main`: tick "Require status checks to pass", tick the eight contexts above, and tick "Require branches to be up to date before merging". A `gh api` payload is optional, only if preferred. Read back either `gh api repos/tk-reawakened/rpgtoolkit-reawakened/branches/main/protection --jq '.required_status_checks.contexts'` (classic) or `gh api repos/tk-reawakened/rpgtoolkit-reawakened/rules/branches/main --jq '[.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context]'` (ruleset): the classic read-back errors with 404 "Branch not protected" when unset, while the ruleset read-back prints `[]`; absence of either means no protection is configured, not that checks are missing. Confirm the supersession above and amend the epic Note.

## Decisions (human, 2026-10-10, at the approval checkpoint)

1. **Consolidation confirmed.** The human approved moving the seven required jobs into one `ci.yml` and deleting the seven per-check files, superseding entry 1.2's "one workflow file per check / later entries add files only" decision and the epic's 2026-10-10 sequencing note.
2. **Required checks**: the seven job names plus the gate (option a).
3. **`fixtures.yml`**: left as a non-required signal; any trimming is entry 1.11's.
4. **Strictness**: require branches to be up to date before merging.
5. **Mechanism**: classic branch protection (the ticket's and the epic's wording); a ruleset would satisfy it equally and is verified by the second command in Verification.
