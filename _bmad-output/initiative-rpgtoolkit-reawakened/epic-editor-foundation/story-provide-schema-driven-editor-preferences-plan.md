---
type: feature
title: "Provide schema-driven editor preferences"
ticket: 5
status: done
---

## Scope

Implement background image, splash and tip toggles, English UI language, syntax colors/styles and board behavior/colors, plus ruled scopes, precedence, persistence and accessibility.

## Acceptance

Invalid values remain explainable; user/workspace/resource precedence and JSON editing follow 11.1 only where ruled, and preference changes remain distinct from .gam data.

## Verification

Changing, validating and resetting each supported preference updates both hosts consistently without modifying authored game data.

## Decisions and prerequisites

Schema format, scope, migration and extension contribution remain 11.1 decisions.

Prerequisites: 11.4.

## Merged-state reconciliation, 2026-11-15

PR #2289 merged as `aa86e82225fffc51c68c4904ee13dfe897a28cae` and issue #1703 is closed. At `3e61f3c2aedd2cd86dc0c29b5ebd750f5708f7bf`, `preferences-view.test.ts` and `preferences.test.ts` passed in the focused foundation runs. This reconciles the shipped schema/scope/validation/reset behavior; it does not select the unresolved history-retention values owned by #1828.
