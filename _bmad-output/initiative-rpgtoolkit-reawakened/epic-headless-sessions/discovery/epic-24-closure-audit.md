---
type: discovery
title: "Closure audit: epic 24 (headless sessions), criterion by criterion"
date: 2026-10-31
baseline_revision: de43ad735ee4e1014aa9ea67165fa76f61edf492
---

# Epic 24 closure audit

Audited at **`de43ad73`**. This epic is unimplemented by design: its first entry, 24.1, is the specification that gates
every other entry (G7), and 24.1 is owner-gated (`hitl: true`) and open.

## Verdicts

| # | Done when | Verdict | Evidence |
|---|---|---|---|
| 1 | The reference in `docs/` describes the manifest, fixtures, mocks, captures and protocol, with help text | **Unproven** | No session reference exists in `docs/` (`git ls-tree -r origin/main docs/ \| grep -i session` returns nothing); ADR 0012 is the design input and is not the reference. Owned by 24.1 / #719 |
| 2 | A manifest starts from `boot`, `scene`, `save` or `prefix`, applies typed fixtures and mocks every request kind | **Unproven** | No manifest type, fixture compiler or mock responder exists in `packages/runner-harness` or `runner-headless`; the CLI exposes `golden`, `closing`, `corpus`, `dump` only. Owned by 24.2–24.3 |
| 3 | Screenshots, PNG-frame and WAV masters and (with FFmpeg installed) MP4 with sound are produced from a session | **Unproven** | No capture, PNG writer, master or MP4 path exists in the runners. Owned by 24.4–24.6 |
| 4 | The stdio protocol drives a session live, and the resolved manifest replays it exactly | **Unproven** | No JSON-RPC session protocol exists. Owned by 24.7 |
| 5 | Entry 24.8 records the evidence, with goldens unchanged | **Unproven** | 24.8 / #726 is open and depends on 24.9's outputs; the goldens are currently unchanged (`pnpm golden` 24 compared, `pnpm closing` 8/8) |

## Findings

None at epic level: every criterion maps to an open entry, and the epic's own scheduling puts 24.1 first. There is
nothing to file — filing a follow-up per criterion would duplicate 24.1–24.8.

One observation worth keeping for 24.1's refinement (not a ticket): the epic's cross-cutting acceptance says captures
are scheduled in ticks and replay byte for byte, and the harness already has the exact primitives that need — a
tick-scheduled driver (`driver.ts`), a deterministic rasteriser (`core/raster` surface pixels) and a null-audio sink —
so the reference can cite those rather than invent a second scheduling model.

## What this audit did not do

It did not touch the epic, its entries or its ADR; it changed no code or golden.
