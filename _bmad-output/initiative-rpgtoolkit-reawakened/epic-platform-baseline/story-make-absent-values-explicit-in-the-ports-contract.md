---
id: 12
type: story
title: "Make absent values explicit in the ports contract"
parent: epic-platform-baseline
tracker_id: "#310"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/310"
tracker_status: done
covers: [CAP-12, CAP-13]
after: [9]
refined: true
hitl: false
risk: medium
---

# Make absent values explicit in the ports contract

## Description

Every optional field in the ports contract becomes a required field that holds `null` when it has no value, and the two exclusive reply unions become one shape with `bytes: Bytes | null`. Core gains one validator that checks an incoming event against the contract and names the field that is wrong, and entry 9's `parseRun` calls it in place of its own field checks.

Why: `undefined` and an absent key are different values across a Worker boundary and in a hash, and the difference first showed up as a late `canon` throw (entry 8 review F1, R2-1). A fixed set of keys per event removes the difference, and one validator keeps the rule in one place.

## Acceptance Criteria

1. **An empty value is written `null`**
   **Given** the contract types for `KeyInput.char`, `TexRef.tile` and `AudioCue.asset`, `loop` and `volume`
   **When** a fixture builds each type leaving one of those fields out
   **Then** the fixture fails to compile, and the same fixture with that field set to `null` or to a value of its type compiles
2. **`undefined` is not a value**
   **Given** the same five fields
   **When** a fixture sets any of them to `undefined`
   **Then** the fixture fails to compile
3. **A reply has one shape**
   **Given** `AssetReply` and `BlobLoaded`
   **When** a fixture builds each with `bytes` set to bytes, and again with `bytes` set to `null`
   **Then** both compile, and a fixture that sets `missing` on either fails to compile
4. **The validator accepts every valid event**
   **Given** one valid event of each of the 11 `InputEvent` kinds, including the `null` forms of `char` and `bytes`
   **When** the validator checks each
   **Then** each is accepted and none is changed
5. **The validator names the field it rejects**
   **Given** an event with an absent required key, a key set to `undefined`, a value of the wrong type, an unknown `kind`, or an extra key at any level
   **When** the validator checks it
   **Then** it rejects the event and the result names the path of the field
6. **`parseRun` has no field rules of its own**
   **Given** `parseRun` from entry 9 and the validator
   **When** a rule changes in the validator only
   **Then** `parseRun` accepts or rejects a record accordingly with no other edit, and its error still names the run file, record index and field
7. **`null` survives the log and the hash**
   **Given** an event with `char: null` and an event with the key absent in a plain-data record
   **When** each goes through `encodeLog`, `canon` and `decodeLog`
   **Then** the `null` comes back as `null`, and the two canonical forms differ
8. **The golden job passes on the new shapes**
   **Given** the committed run and golden from entry 9 re-recorded with `--record`
   **When** the golden job runs on a pull request
   **Then** it passes, and the commit message states each golden value that changed and why
9. **Docs match the contract**
   **Given** the architecture spine and `docs/`
   **When** they are searched for `missing: true`, an optional `char` or `tile`, and `exactOptionalPropertyTypes` without a description of the new rule
   **Then** none is found, and the doc that states the compiler-flag rule says it is a backstop

## Boundaries

- Must not change: the `InputEvent` kinds and their field names other than `missing`; hash and canonical-form output for data that holds no changed field; the RFC 8785 and FNV-1a vectors; entry 8's and entry 9's plans and Implementation Notes, which are the record.
- Must not change: `exactOptionalPropertyTypes` stays on in `tsconfig.base.json`.
- Not in scope: validating engine outputs (draw lists, audio cues); the contract types and fixtures cover those.

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/epic-platform-baseline.md
- plan — _bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-contract-types-canonical-form-and-hashes-plan.md, findings F1 and R2-1
- plan — _bmad-output/initiative-rpgtoolkit-reawakened/epic-platform-baseline/story-runner-harness-driver-synth-scaffold-and-the-golden-job-plan.md, parseRun
- spine — _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-3, AD-5, AD-14, AD-16

## Notes

- Decision: the validator lives in core and entry 9's `parseRun` calls it; this story follows entry 9 (2026-10-10).
- Decision: absent values are required `T | null`, not optional; `exactOptionalPropertyTypes` stays on as a backstop (2026-10-10).
- Decision: be explicit. An absent value is written `null` and spelled out in the type. The exception is a boundary where JSON is consumed and information is decoded from an untyped source, such as an API or a log. There the compiler cannot enforce the rule, so a validator enforces it at runtime and converts to the typed shape (2026-10-10).
- Note: this story builds that validator for input events only. Other boundaries that decode untyped JSON adopt the same rule when they are built.
- Assumption: the validator returns a result that names the path and does not throw on malformed data; `parseRun` turns the result into its error. Confirm.
- Assumption: the validator takes decoded data, after `decodeLog` has turned `{t:"bytes",hex}` back into bytes. Confirm.
- Open question: should `AudioCue` be nullable fields (`asset`, `loop`, `volume` always present, `null` when unused) or a discriminated union by `kind`? Default: nullable fields.
- Check: the plain-data fixture tsconfigs do not extend tsconfig.base.json and do not set the flag. Confirm whether they should, and say which in the commit.
- Fields in scope: KeyInput.char, TexRef.tile, AudioCue.asset/loop/volume, and the AssetReply and BlobLoaded unions (`bytes: Bytes | null` replaces `missing`).
- The round-trip log in canon.test.ts is typed PortData, so it will not catch shape drift. Update its literals by hand.
- Checked 2026-10-10: no golden or recorded log contained `missing`. Recheck after entry 9 adds its committed run.
