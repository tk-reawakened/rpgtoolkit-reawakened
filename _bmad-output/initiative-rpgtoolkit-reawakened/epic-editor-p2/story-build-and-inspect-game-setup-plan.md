---
type: feature
title: "Build and inspect game setup"
ticket: 6
status: draft
risk: high
---

# Build and inspect game setup

## Scope

Build the installable setup from the 12.9 game package with explicit destination, file and dependency review, launcher-owned installation and removal, and capability-gated host operations.

Follow the [T-72 setup contract](../../../docs/spec/formats/packaging-and-paths.md#reawakened-setup-delivery): bundle the 12.9 package, descriptor and instructions; use a compatible player app's Install and Remove for recipient proof. The editor creates the ZIP, not an installer or signer, and the browser reports unavailable operations without fallback.

## Acceptance and verification

A clean supported recipient installs, runs and uninstalls the packaged game as ruled, cancellation preserves inputs, and unsupported browser installation and signing are explained without fallback.

## Dependencies and decisions

Requires 14.1, 12.9. Follow the approved contracts and capability declarations; do not assume unimplemented provider behavior.
