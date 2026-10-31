---
id: 18
type: bug
title: "Reserved plugin ids resolve to Object.prototype members"
tracker_id: "#537"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/537"
parent: epic-rpgcode-platform
created: '2026-10-31'
status: 'built'
baseline_revision: '7f47bcd1'
route: 'oneshot'
route_source: 'auto'
risk: 'medium'
review: 'quick'
context: []
---

## Intent

A manifest plugin id such as `constructor`, `__proto__` or `toString` passed validation but was looked up in a plain object, so an inherited `Object.prototype` member was selected as the plugin definition and boot threw `TypeError: plugin.commands is not iterable` instead of reporting the documented, located `plugin.unresolved` diagnostic (E-02 step 3).

## Implementation Notes

Every id-keyed lookup is now own-property-safe: `resolveManifestPlugins` checks `Object.hasOwn` before reading `ENGINE_PLUGIN_TABLE`; the legacy plugin-file map is checked the same way, so `constructor.dll` maps to no stock package; the harness builds a null-prototype table and its resolver checks `Object.hasOwn` before reading it; the resolver's duplicate marker is a `Set`.

## Verification

- `pnpm exec tsc -b` passed.
- `node --test packages/core/test/engine-boot.test.ts packages/runner-harness/test/script-plugin-resolver.test.ts`: 61 passed, 3 fixture skips; the new cases cover each reserved id in boot and in the harness with both a plain and a null-prototype table, the duplicate check for ordinary ids, and `constructor.dll` as a legacy row.
- `pnpm lint`, `pnpm golden` passed.
