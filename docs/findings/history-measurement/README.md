# History measurement (story 11.14, issue #1828)

Reports measured board-corpus sizes and a synthetic single-board storage
scenario for the proposed per-project history policy in ADR 0022 D12.8.
Reproduce with `pnpm history:measure`. Raw output is in `results.json`.
Unit tests for the window model: `pnpm history-measure:test`.

## Method

- **Measured board sizes.** The corpus statistics are exact byte sizes for 1,689
  `.brd` records from the asset inventory
  (`docs/findings/native-data-boundaries/data/assets.jsonl`). Round-tripping
  committed boards through `readBoard` and `writeBoard` produced byte-identical
  results for 12 of 14 files. The two failures are `board_minor2.brd` and
  `board_minor3.brd`, which use the pre-vector layout the reader does not
  convert (ticket 2.8).
- **Synthetic save sequence.** The model generates 500 single-cell saves for
  `village.brd`, re-reads each result, and checks it against the matrix. No
  timestamps or elapsed duration are recorded, so this is not a measured
  editing-hour trace. 473 saves have distinct digests; 27 repeat an earlier
  digest, and the cause is not explained.
- **Merge-window scenario.** A deterministic model places saves at a constant
  rate across an hour. A fixed window opens at the first save; saves inside it
  merge into one entry. These are scenario inputs, not observed save timings.
- **Storage scenario.** Each row applies the modeled entry count to one board
  size at a time for 24 hours, assuming a full-size entry and no content
  deduplication. It is a single-board scenario, not a project-wide model or
  upper bound. 1 MB = 10^6 bytes.

## Results

Measured board sizes (bytes):

| Set | Count | Median | p90 | Max |
|---|---:|---:|---:|---:|
| Corpus boards | 1,689 | 36,547 | 149,373 | 482,379 |
| Synthetic saves (`village.brd`) | 500 | 1,590 | 1,594 | 1,594 |

The corpus figures match the ADR evidence table (36.5 KB, 149 KB, 482 KB).

Single-board synthetic storage scenario per 24 hours (not a project estimate):

| Window | Modeled saves/h | Modeled entries/h | One p90-size board | One max-size board | Synthetic-save mean |
|---:|---:|---:|---:|---:|---:|
| 10 s | 60 | 60 | 215 MB | 695 MB | 2.2 MB |
| 10 s | 360 | 360 | 1,291 MB | 4,168 MB | 13.0 MB |
| 10 s | 3,600 | 360 | 1,291 MB | 4,168 MB | 13.0 MB |
| 60 s | 60 | 60 | 215 MB | 695 MB | 2.2 MB |
| 60 s | 360 | 60 | 215 MB | 695 MB | 2.2 MB |
| 60 s | 3,600 | 60 | 215 MB | 695 MB | 2.2 MB |
| 300 s | 60 | 12 | 43 MB | 139 MB | 0.4 MB |
| 300 s | 360 | 12 | 43 MB | 139 MB | 0.4 MB |
| 300 s | 3,600 | 12 | 43 MB | 139 MB | 0.4 MB |

For example, **695 MB/day is only the synthetic scenario for one board of
maximum corpus size (482,379 bytes)** at 60 modeled entries per hour for 24
hours, with no deduplication. It is not a project upper bound and is not
evidence for a 1 GB warning threshold. No per-project aggregation was measured.

## Owner decision unresolved (historical — superseded by the timed trace below)

This section records the state **before** the 2026-11-16 timed editing-hour trace; it is kept for the record and its
"unresolved" status no longer describes the ADR, which now records the trace and the values it supports (D12.11).
This artifact measures board sizes and runs the scenario model only. It does
not select retention parameters. A timed editing trace and project-wide
storage model are still needed before the owner can decide:

- **60 s merge window:** proposal only; no timestamped trace supports it.
- **1 GB per-project warning:** proposal only; no project-wide model supports
  it.
- **24-hour autosave floor:** proposal only; no measured editing hour supports
  it.

These values remain unset and unadopted. The previously rejected 30 days /
90 days / 500 MB values also remain unadopted; this report neither re-adopts
nor rules them out.

## Limits

- Tilesets are not measured. They reach 4.3 MB and are covered by the
  file-type allow-list in D12.8, not by this board-size corpus.
- The synthetic saves are single-cell. Bulk edits (paint, fill) produce larger
  deltas per save but fewer saves. Their cost is not measured here.
- The scenario assumes each merge window produces one full-size entry. Real
  entries may be smaller if a storage format is later added.

## Timed editing-hour trace (2026-11-16)

`tools/history-measure/trace.mjs` ran for 3,600.005 s and wrote `events.jsonl`, `start.json` and
`summary.json`. Those three receipts are committed unmodified in `trace/` with `SHA256SUMS`, so the aggregate can be
recomputed without re-running the hour: `node tools/history-measure/analyze.mjs docs/findings/history-measurement/trace`.
`tools/history-measure/analyze.mjs` turns them into `trace-results.json`, and
[ADR 0022 D12.11](../../adr/0022-shared-editor-authoring-contracts.md#d12--history-and-checkpoint-groups)
records the values it supports. Reproduce with `node tools/history-measure/trace.mjs --out <dir> --seconds 3600`
and `node tools/history-measure/analyze.mjs <dir>`.

What it is: an **automated, seeded, paced workload** through the real editor document, board writer and a
durable file store (write + fsync per file). The gesture schedule (bursts, gaps, pauses, board dwell,
manual-save rate, run saves) is the script's own assumption, stated in `start.json`; it is not a person.

What was measured:

- 462 accepted gestures and 383 saves in the hour (377 `auto`, 4 `manual`, 2 `before-run`); 382 distinct
  contents; 0 history failures; 4.2 s of process CPU; the machine was shared (load 1 min median 2.75, p90 5.37).
- Saved bytes: median 5,730 B, p90 12,223 B, mean 6,659 B.
- Save latency: median 20.5 ms (p90 27.6, p99 51.4, max 85.7); history work within it: median 10.8 ms.
- Gesture gaps: median 2.34 s, p90 8.49 s; 91.3% within 10 s, 97.6% within 60 s, 99.8% within 300 s.
- Replayed merge windows: 10 s -> 121 entries/h, 60 s -> 42, 300 s -> 20 (against 383 raw saves).
- Storage per editing hour at the measured mean size: 0.77 / 0.27 / 0.13 MiB for 10 / 60 / 300 s.
- Corpus scale: 60 games, covered authored bytes median 0.71 MB, p90 27.1 MB, max 66.7 MB; no covered file
  over 8 MiB (largest board 482 KB, largest tileset 4.34 MB).

Limits: one hour, one machine, one scripted workload; no multi-day observation, so the autosave floor is
recommended for its measured cost, not for an observed multi-day need. Legacy-sized boards and tilesets are
shown as size assumptions in `trace-results.json`, not as traced content.
