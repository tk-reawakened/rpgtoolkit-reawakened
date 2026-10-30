---
title: "Define coherent interruption recovery checkpoints"
ticket: 17
status: done
---

Owner approved the full recovery contract on 2026-10-29. The reference recovery store (#783) and explicit/pre-battle capture (#782) are implemented and merged; ledger-first paused re-entry remains #779. Unresolved re-entry semantics are recorded in the #779 work: game startup program on recovery, installed listeners, item multitask start timing, trigger progress versus board entry, and changed board/entry assets.
