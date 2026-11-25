---
type: feature
title: "Build a runnable visual event tracer"
ticket: 2
status: draft
risk: high
---

# Build a runnable visual event tracer

## Scope

Creates one editable structured event with typed parameters and generated RPGCode in the shared document, then validates and runs that saved program using the existing language and run services.

Use the same document identity and AD-19 host lifecycle; Monaco serves browser and standalone, while VS Code retains native text; never claim arbitrary conversion.

## Acceptance and verification

In browser and VS Code a creator adds a supported message action, saves the generated program, gets clean diagnostics and observes it run, while unsupported handwritten text stays intact.

## Dependencies and decisions

Requires 14.1, 11.2, 11.3, 11.7 and 11.8. Use the **Show message** example and opaque-code boundary in [TOOL-12](../../../docs/spec/engine/rpgcode-tooling.md#tool-12-visual-events). This tracer admits only that message action.
