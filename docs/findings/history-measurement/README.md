# History measurement (story 11.14, issue #1828)

Measures the storage cost of the per-project file history in ADR 0022 D12.8.
Reproduce with `pnpm history:measure`. Raw output is in `results.json`.
Unit tests for the window model: `pnpm history-measure:test`.

## Method

- **Board sizes.** Round-trip every committed `.brd` through `readBoard` and
  `writeBoard`. 12 of 14 files are byte-identical. The 2 that fail are
  `board_minor2.brd` and `board_minor3.brd`. They use the pre-vector layout,
  which the reader does not convert (ticket 2.8). They are out of scope for
  the editor, which writes only the current layout.
- **Corpus.** Board sizes come from the asset inventory
  (`docs/findings/native-data-boundaries/data/assets.jsonl`, 1,689 `.brd`
  records). Sizes are exact for unedited boards because `writeBoard` output
  equals the file bytes (AD-18).
- **Session.** 500 single-cell edits to `village.brd`. Each save is re-read
  and checked against the in-memory matrix. The baseline re-write matches the
  file exactly. 473 of 500 saves produce a distinct byte stream. The other 27
  repeat an earlier state; the cause is not yet explained.
- **Merge window.** Fixed window opened at the first save. Saves inside it
  merge into one entry. A save at or after the window edge opens a new entry.
  Continuous saving is therefore bounded at `3600 / W` entries per hour.
- **Storage.** Worst case: no deduplication is credited, and each save is
  assumed to produce a new entry. Saves are sustained for 24 hours. This is an
  upper bound, not a usage estimate. 1 MB = 10^6 bytes.

## Results

Board sizes (bytes):

| Set | Count | Median | p90 | Max |
|---|---:|---:|---:|---:|
| Corpus boards | 1,689 | 36,547 | 149,373 | 482,379 |
| Session saves (`village.brd`) | 500 | 1,590 | 1,594 | 1,594 |

The corpus figures match the ADR evidence table (36.5 KB, 149 KB, 482 KB).

Storage per project per day, at sustained saving:

| Window | Saves/h | Entries/h | Corpus p90 board | Corpus max board | Session mean |
|---:|---:|---:|---:|---:|---:|
| 10 s | 60 | 60 | 215 MB | 695 MB | 2.2 MB |
| 10 s | ≥360 | 360 | 1,291 MB | 4,168 MB | 13.0 MB |
| 60 s | ≥60 | 60 | 215 MB | 695 MB | 2.2 MB |
| 300 s | ≥60 | 12 | 43 MB | 139 MB | 0.4 MB |

At 60 s, a 500 MB cap is reached by the largest board in about 17 hours of
continuous saving, and by a p90 board in about 56 hours. The 30 / 90 / 500 MB
values rejected in D12.8 are therefore not sized to editing sessions.

## Proposals for owner confirmation

These are derived from the table above. They are not adopted until the owner
confirms them.

- **Autosave merge window: 60 s.** A 10 s window costs six times as much
  storage for finer granularity that no measurement showed to be needed.
- **Per-project warning threshold: 1 GB.** At 60 s, the largest board reaches
  this in about 35 hours of continuous saving, and a p90 board in about 112
  hours. Past the threshold the store offers thinning. It never thins below the
  floors in D12.8.
- **Autosave floor: 24 hours.** Shorter than the non-autosave floor, which
  keeps every entry.

## Limits

- Tilesets are not measured. They reach 4.3 MB and are covered by the
  file-type allow-list in D12.8, not by this board model.
- Session edits are single-cell. Bulk edits (paint, fill) produce larger
  deltas per save but fewer saves. Their cost is not measured here.
- The model assumes every merge window produces one full-size entry. Real
  entries may be smaller if a storage format is later added.
