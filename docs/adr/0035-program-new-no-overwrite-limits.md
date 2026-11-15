# ADR 0035 — New program refuses detected collisions and discloses the race

* **Status:** Accepted (2026-11-15; explicit owner acceptance).
* **Date:** 2026-11-15
* **Owner direction:** On 2026-11-15, the owner clarified the New program no-overwrite requirement for story 11.7: refuse when an existing file is detected and report that it already exists; failure is preferable to replacing a detected file. A browser or VS Code host whose local API only permits check-then-write must disclose the remaining external concurrent-creation race. Use a true atomic exclusive-create operation where the host supports one; never claim a guarantee the API does not provide.
* **Context documents:** [TOOL-10](../spec/engine/rpgcode-tooling.md#tool-10), [ADR 0022](0022-shared-editor-authoring-contracts.md), [#1705](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1705), [#2714](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2714).

## Summary

1. New program refuses a selected path when its existence check detects a case-insensitive filename collision, reports that the file already exists, and creates nothing.
2. A host **MUST** use a genuine atomic exclusive-create operation when it provides one. A preliminary listing followed by an ordinary write is not an exclusive create.
3. Where the host has no such primitive, the implementation may check then write, but the editor and its records **MUST** disclose that an external actor can create the path between those steps and that the write may replace that concurrent file. Do not describe the behavior as race-free or as an absolute no-overwrite guarantee.
4. This decision accepts the disclosed limitation for the browser and VS Code file APIs used by story 11.7. It does not invent Electron functionality or change the native VS Code editor choice or line-ending contract.

## Context

TOOL-10 previously said that New program creates a file only if the selected path does not exist and “never replaces a file.” The implementation checks a directory listing and then calls the host's ordinary write operation. The existing-file check correctly refuses a collision it observes, but the separate check and write cannot protect against a file created by another actor after the check.

The browser File System Access API and VS Code's shared workspace filesystem API do not expose a portable atomic create-if-absent operation through the current host adapters. A writable stream's exclusivity does not make it a conditional create, and VS Code's ordinary `writeFile` replaces or creates. The work therefore needs a precise contract that protects detected files without promising protection the hosts cannot supply.

## Decision

1. **Detected collision.** Before writing, New program checks the selected filename without regard to A–Z case. If the host reports that the file already exists, the operation **MUST** fail with an “already exists” message, create nothing, and leave the existing file unchanged. A failed or unavailable directory listing must not be treated as proof that the destination is absent.
2. **Host-supported atomic creation.** If a host provides an operation that atomically creates a file only when its path is absent, the host **MUST** use it for New program. On a collision reported by that operation, New program **MUST** return the same already-exists refusal without replacing the file.
3. **Disclosed check/write fallback.** If the host has no atomic exclusive-create operation, it **MAY** perform the existing-file check followed by an ordinary write. The user-facing and normative description **MUST** say that an external actor can create the file in the interval and that the ordinary write may replace it. This known residual race is accepted; it is not a claim of race-free no-overwrite behavior.
4. **No invented host guarantee.** The current browser and VS Code adapters use the fallback in Decision 3. This ADR does not assert that Electron is implemented or that it provides an atomic operation. A future host or adapter must establish its actual API guarantee before selecting Decision 2.
5. **Unchanged scope.** This decision changes only the New program creation contract. It does not change ordinary saves, other file operations, G1–G7, the host-specific editor design, or TOOL-10's line-ending rules. In particular, the standalone/browser program document retains its specified per-break line endings; the existing native VS Code line-ending ruling remains limited to VS Code.

## Consequences

**Positive**

* A collision visible to the host is refused with a clear, actionable error rather than overwritten.
* The contract reflects what the current host APIs can actually guarantee and leaves room for stronger protection when a host adds a genuine atomic primitive.
* The editor and issue/PR records can distinguish an existing-file refusal from the external race without blocking the otherwise complete feature on a nonexistent cross-host primitive.

**Risks and mitigations**

* A concurrent external creation can be overwritten by the current fallback. **Mitigation:** disclose the check/write race wherever the guarantee is described, keep the code comment accurate, and prefer atomic exclusive create in any host that supports it.
* A host may incorrectly describe an API as exclusive create. **Mitigation:** require evidence that create-if-absent and file creation occur in one operation; a lock against only cooperating writers or an ordinary write does not qualify.

## Alternatives rejected

* **Promise absolute no-overwrite behavior for every host.** Rejected because the browser and VS Code APIs used here do not provide the needed atomic operation; the promise would be false.
* **Allow replacement of a collision detected before writing.** Rejected because the owner requires a clear refusal, with failure preferred to replacement.
* **Block New program in every host until a race-free cross-host primitive exists.** Rejected by the owner clarification accepting a disclosed check/write race for these APIs.
* **Assume an unimplemented Electron adapter can provide exclusive creation.** Rejected because no Electron functionality is part of this decision or implementation.

## Deferred

* Revisit the disclosed limitation if a supported host gains a genuine atomic exclusive-create operation or if the owner requests a stronger contract.
* Any proposed host-specific primitive must be independently verified against the host API; this ADR does not prescribe an API that does not exist today.
