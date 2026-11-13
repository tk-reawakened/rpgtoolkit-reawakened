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

| Window | Assumed saves/h | Modeled entries/h | One p90-size board | One max-size board | Synthetic-save mean |
|---:|---:|---:|---:|---:|---:|
| 10 s | 60 | 60 | 215 MB | 695 MB | 2.2 MB |
| 10 s | ≥360 | 360 | 1,291 MB | 4,168 MB | 13.0 MB |
| 60 s | ≥60 | 60 | 215 MB | 695 MB | 2.2 MB |
| 300 s | ≥60 | 12 | 43 MB | 139 MB | 0.4 MB |

For example, **695 MB/day is only the synthetic scenario for one board of
maximum corpus size (482,379 bytes)** at 60 modeled entries per hour for 24
hours, with no deduplication. It is not a project upper bound and is not
evidence for a 1 GB warning threshold. No per-project aggregation was measured.

## Owner decision unresolved

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

