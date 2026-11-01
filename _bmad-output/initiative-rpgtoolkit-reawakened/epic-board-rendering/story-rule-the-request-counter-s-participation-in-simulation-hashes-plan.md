---
title: 'Rule the request counter participation in simulation hashes'
type: 'feature'
ticket: '40'
status: 'draft'
tracker_id: '#1047'
risk: 'high'
---

# Plan

**Approved ruling (owner: Jensen, 2026-11-01)** — the request-id counter is retained in saved state but excluded from the state-hash projection; the outstanding-request list including each id remains hashed. Implementation is unstarted; #1047 records the required docs-first sequence, tests and perturbation proofs.
