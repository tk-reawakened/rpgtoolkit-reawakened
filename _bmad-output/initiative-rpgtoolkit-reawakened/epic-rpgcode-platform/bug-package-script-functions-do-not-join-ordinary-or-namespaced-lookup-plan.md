---
title: 'Package script functions do not join ordinary or namespaced lookup'
type: 'bug'
ticket: '21'
status: 'blocked'
blocked_reason: 'Package-function collision rules and applicable package-loader policy remain pending owner review.'
tracker_id: '#1051'
risk: 'high'
---

# Plan

Issue #1051 records the built-harness reproduction, existing PKG-4 clause, pending PKG-7 ruling and required lookup and regression checks. Do not assume the proposed loader policy is approved.

Jensen ruled 2026-11-02 (option 2): package script functions must be reachable both bare and package-qualified. The [collision and restore rules](../../../docs/spec/engine/rpgcode-modules-and-objects.md#pkg-script-function-lookup-proposal) are a proposal awaiting owner approval, not an implementation authorization. Decide package/package ambiguity, cross-source precedence, and duplicate-package and same-package export collisions before building; PKG-7's location policy remains separately pending.
