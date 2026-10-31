---
id: 4
type: story
title: "Research: tracking what changed across packages in the monorepo"
tracker_id: "#668"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/668"
parent: epic-deferred-work
status: done
risk: low
context: ["tools/deps/edges.json", ".github/workflows/ci.yml", "tools/no-skips/run.mjs", "issue - #664", "issue - #666"]
---

# Research: tracking what changed across packages in the monorepo

## Goal

Answer which tool should tell CI — and later the release flow — what a change affects, beyond the
smart-gates path allowlist (#664), and what should produce version bumps and changelogs once Epic 10
publishes packages (#666). Comparison and recommendation only.

## Acceptance

1. pnpm filters, Lerna, Nx, Turborepo and the in-repo dependency graph tool are each compared on the
   two separate questions (CI selection; release accounting), with dated citations for release status.
2. The comparison is grounded in this repository's facts: five real packages, `tsc -b` project
   references, eight manually sharded test groups, non-package inputs (`golden/`, `fixtures/`,
   `stock/`), and AD-22's single checked-in edge list.
3. A recommendation with an explicit go/no-go per option, and the triggers that would reopen it.
4. No implementation: no workflow, config, dependency or package change.

## Exclusions

No `changes` job, no `turbo.json`/`nx.json`/`lerna.json`, no new dependency, no publishing setup.

## Verification

The document is the deliverable; there is no code path to run. The ticket's acceptance was checked
by reading it against `package.json`, `pnpm-workspace.yaml`, `tools/deps/edges.json`,
`tools/no-skips/run.mjs` and `.github/workflows/ci.yml` at `origin/main` (`e630c083`), and by
re-reading each cited source on 2026-10-30.

## Plan Change Log

- 2026-10-30 (built): `docs/findings/monorepo-change-detection.md` written. Recommendation: go on a
  zero-dependency path-table `changes` job whose package half is `pnpm --filter "...[origin/main]"`;
  no-go on Turborepo, Nx and Lerna while the tree has five private packages, no published artifacts
  and an already-incremental `tsc -b`. Revisit triggers recorded in §7 (first published package,
  real declared task outputs, eight+ narrow-sharded packages, one-file PR over ~10 minutes).
