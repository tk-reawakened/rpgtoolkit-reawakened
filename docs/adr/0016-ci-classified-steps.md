# ADR 0016 — Each CI job judges its own applicability: classified steps, no skipped jobs

* **Status:** Accepted. Approved ruling (owner: Jensen, 2026-11-01)
* **Date:** 2026-11-01
* **Amends:** [guardrails.md](../guardrails.md) G5 (Enforcement) and Rollout item 4, by one sentence each; no rule is weakened
* **Context documents:** [G5 and the rollout](../guardrails.md), issue #664 (prior art: closed PR #665, which skipped whole jobs; this ADR rejects that model)

## Summary

In plain terms:

1. **Every CI job still runs on every pull request and still reports a real result.** No job is ever skipped. `gate` still needs every job, and the ruleset's single required check, `gate`, keeps its meaning.
2. **A job decides for itself whether its expensive work is needed.** For a change that touches only inert files (prose and planning records, named below), the heavy steps (installs, builds, replays, emulators) are deferred. The job then says so, in one line, with the evidence, and reports success.
3. **Uncertainty always means "run".** The only way a job says "fine" is a positive, printed determination that nothing it guards could have changed.

## Context

CI runs a fifteen-shard unit matrix, goldens under Node and Bun, a browser lane, a three-OS desktop matrix, an Android emulator and the script dogfood lane. A prose-only pull request pays for all of it.

G5 says the headless golden suite **MUST** run on every pull request as a required check, that merges are blocked if it fails or is skipped, and the rollout says `gate` fails unless every required job succeeded, "so a skipped job cannot merge".

GitHub counts a job skipped by a condition as a success for required-check purposes, and a workflow skipped by a path filter leaves its checks pending. The active ruleset (checked 2026-11-01) requires only `gate`. So a central scheduler that removes jobs would either contradict G5 and the rollout text or need a `gate` that tolerates `skipped`, and a tolerated `skipped` is indistinguishable from a job that silently stopped working. Closed PR #665 took that route.

## Decision

### The model: intelligence lives inside the job

The owner's framing: **the job decides whether it needs to run; otherwise it reports that things are fine.** The job that owns a check is the one that judges whether the check applies. A central scheduler never deletes work before it is dispatched.

Mechanically, a `changes` job classifies the pull request's changed paths and publishes a verdict. Each of `golden`, `golden-bun`, `browser`, `desktop` (each matrix leg), `mobile` and `script-dogfood` always runs. Its first step prints the verdict. Every later step runs unless the verdict is exactly "defer". A job whose steps are all deferred still ends in `success`.

`checks`, `unit` and `gate` are never deferred. The licence audit and provenance scan must see every diff, and `gate` merges the coverage from every unit shard. `changes` and `gate` are never deferred either.

### "Fine" is evidenced, not asserted

When a job defers it prints one line naming the job, the verdict and the classifier's reason, which lists the inert paths examined:

```text
CI classifier [golden]: DEFER - nothing this job guards could have changed; inert: _bmad-output/example/plan.md
```

When it runs it prints the reason it was forced, so both directions are legible:

```text
CI classifier [golden]: RUN - full: tools/ci/classify-changes.mjs
```

A bare "skipped" is never acceptable: it looks the same as a job that stopped working.

### Uncertainty is never "fine"

The verdict is `defer` only when the classifier positively determined that every changed path is inert. Everything else selects `run`:

* a path that is not on the inert list (including anything under `packages/`, `tools/`, `stock/`, `golden/`, `docs/spec/` or `.github/workflows/`, even a `README.md` there);
* an empty diff, a non-`pull_request` event (so every push to `main`), or a malformed path (absolute, drive letter, `..`, `.` or empty segment, backslash, control character, replacement character);
* a missing or empty verdict, or a `changes` job that failed before publishing one, since a step defers only on the exact value `false`.

A **classifier failure** (git cannot produce the diff, the diff cannot be decoded or parsed, the classifier crashes or prints an incomplete or inconsistent verdict, its own unit tests fail) selects `run` **and fails the `changes` job**, which fails `gate`; the dependent jobs still run in full so the pull request gets every result. `gate` also fails if the verdict is absent, if a defer arrives without its `inert:` evidence, or if a defer arrives outside a `pull_request`. A pull request whose base has no classifier yet selects `run` with that stated reason; that is a verdict, not a failure.

### Transport

The diff is `git diff --no-renames --name-only -z <base sha> <merge sha>` with `fetch-depth: 0`. `--no-renames` makes a rename contribute both its old and its new path. Paths travel through files and the environment, never through a shell command line. The classifier executed is the **base branch's copy** (`git show <base sha>:tools/ci/classify-changes.mjs`), so a pull request cannot loosen the rules that judge it. The pull request's own copy is tested first, in `changes`, before any verdict is published.

### The inert set

Only these paths are inert, because they are read by people and not by any lane:

| Path | Why it cannot move a hash or change a lane |
|---|---|
| root-level `*.md` (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`...) | Prose for people; no job reads them |
| `docs/guardrails.md` | The rules as prose; the checks that enforce them live in code |
| `docs/adr/**/*.md` | Decision records |
| `_bmad-output/**/*.md` | Plans and tickets; not read by any lane |
| `.github/ISSUE_TEMPLATE/**/*.{md,yml,yaml}` | Issue forms; GitHub reads them, CI does not |

It deliberately **excludes**: all of `packages/`, `tools/`, `stock/` and `golden/` (even Markdown there; fixtures and generators are inputs); `docs/spec/` (the normative spec, and `docs/spec/examples` is dump-checked by `golden`); `.github/workflows/` and `.github/pull_request_template.md`; non-Markdown files under `_bmad-output/`; every other file in `docs/`; the lockfile, `package.json`, and every root file that is not Markdown; and any path nobody has classified. The `checks` job still runs provenance over every inert change.

### Which steps defer for an inert pull request

* `golden`: install, fixture cache and fetch, `fixtures:check`, build, golden, closing, Pillow install, `oracle:check`, corpus dump check.
* `golden-bun`: install, fixture cache and fetch, `golden:bun` (with the Node, pnpm and Bun setup).
* `browser`: install, build, fixture fetch, Playwright install, `browser:test`.
* `desktop` (each leg): install, fixture fetch, build, `make-package`, `desktop:build`, measurement, inventory, artefact upload.
* `mobile`: Java and Android SDK setup, install, build, fixture fetch, package, APK build, KVM check, emulator proof, artefact upload.
* `script-dogfood`: install, build, and the five `tkr script` baseline comparisons.

Each of those jobs keeps its decision-report step, which always runs. `script-dogfood` still waits for `checks` to succeed.

### Wording added to guardrails.md

G5 (Enforcement) and Rollout item 4 each gain one sentence stating this reading and pointing at this ADR. G5 rule 1 is unchanged: the required job still runs on every pull request.

## Consequences

* A prose-only pull request still starts every job but skips the installs, builds, replays and emulators. The saving is runner minutes, not job count.
* A classification mistake could hide a regression. Mitigations: a small positive list, a denylist that wins over the list, the trusted base copy of the classifier, a full default, adversarial unit tests, and a printed reason a reviewer can audit.
* A green job no longer means its checks ran. The printed `DEFER` line, with the paths examined, is the evidence, and `gate` still requires the job to have run and succeeded.
* Every new input to a lane (a new directory a job reads) must be checked against the inert list; the list is positive, so a new path runs everything until someone decides otherwise.
* This pull request, and any pull request that edits the classifier or the workflow, runs everything: they are not inert, and a base without a classifier selects `run`.

## Alternatives rejected

* **Design B: skip whole jobs** (a central `changes` job, job-level `if:`, a `gate` that accepts `skipped`). It contradicts G5's "merges are blocked if it fails or is skipped" and the rollout's "a skipped job cannot merge"; GitHub reports a conditionally skipped job as success, so it is easy to make `gate` pass vacuously; and a skipped job is indistinguishable from a broken one. Its only advantage was runner startup time.
* **Workflow-level `paths` filters.** A skipped workflow leaves required checks pending and the filter is not fail-closed.
* **Skipping `unit` or its shards.** The `gate` coverage merge and thresholds need every shard's report.
