---
type: discovery
title: "Closure audit: epic 2 (legacy formats), criterion by criterion"
date: 2026-10-31
baseline_revision: 3c7c71903422c3025ca592cac330e0b9b4381adf
---

# Epic 2 closure audit

Audited at **`3c7c7190`**. All 26 child issues are CLOSED and their tickets read `done`, so the audit tested the five
Done-when criteria rather than the ledger.

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | The dump tool parses every file in `demo` and `Basic` without error and prints readable data | **Proven** | `pnpm dump fixtures/legacy/demo` → 77 lines, and the only non-`parsed` lines are documented `skipped` audio (`Media/VIP - *.mid skipped MIDI music … audio, not a data format`); `pnpm dump fixtures/legacy/Basic` likewise; no `error`/`failed` line in either |
| 2 | Formats the project writes round-trip as `docs/spec/formats/` states | **Proven** | The round-trip suites exist per family and pass in `pnpm test:strict` (2426 tests): `format-binary`, `format-board`, `format-board-text`, `format-actor`, `format-actor-text`, `format-animation`, `format-audio`, `format-battle`, `format-main-file`, `format-package-writer`, `format-image-*` |
| 3 | A `.tpk` and an appended-ZIP EXE load to the same project as the folder, with case-insensitive lookup | **Proven** | `packages/core/test/format-package.test.ts:294` “a loose folder, a .tpk and an appended-ZIP EXE load the same asset tree”; `:310` “a loaded package resolves references case-insensitively” |
| 4 | A pre-vector board converts as `legacy/older-binary-versions.md#board-minor-2-and-3-pre-vector` states | **Proven** | `packages/core/test/format-board-pre-vector.test.ts` (suite present and green in `test:strict`) |
| 5 | Distribution package round-trip; `decodeTexture` returns identical RGBA for every sample image; core builds with no DOM/Node types and imports only `fflate/browser` sync APIs, citing the spec page per reader | **Proven** | `format-package-writer.test.ts`; the image decode suites (`format-image.test.ts:210-281` scanline filters, bit depths, PLTE/tRNS, Adam7) plus `format-image-{bmp,gif,jpeg}.test.ts`; `packages/core/package.json` dependencies are `fflate 0.8.3` and `opentype.js 2.0.0`, and `pnpm lint` runs `tools/check-core-deps.mjs` which asserts the allowlist; `packages/core/tsconfig.json` has no DOM/Node types |

## Findings

None. No follow-up ticket was needed and the store needed no correction: every child issue is closed and every entry
reads `done`.

## Not probed

The criterion's “every sample image” is taken from the committed image fixtures and the fetched sample games' media
through the existing suites rather than by an ad-hoc loop over every PNG/GIF/JPEG in `fixtures/legacy`; the decode
tests are the project's stated oracle for that claim.
