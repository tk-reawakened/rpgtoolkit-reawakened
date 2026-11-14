# ADR 0034 — Tiered licence review for direct and transitive dependencies

* **Status:** Accepted (2026-11-14; explicit owner acceptance).
* **Date:** 2026-11-14
* **Owner direction:** On 2026-11-14, the owner directed that licence scrutiny should focus on first-tier dependencies directly used by the project, while transitive dependencies may use less-permissive licences so long as they are not copyleft.
* **Context documents:** [ADR 0003](0003-permissive-licences-acceptable.md), [guardrails](../guardrails.md) G6, [Monaco CSP evidence](../findings/monaco-csp/README.md), story [#1705](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1705).

## Summary

1. Keep the Blue Oak Bronze-or-better test for each third-party production dependency directly selected by a shippable project package.
2. For transitive production dependencies and third-party files bundled inside a selected dependency, remove the Blue Oak rating requirement. Permit a known, redistributable, non-copyleft licence, while continuing to block copyleft, restricted/source-available, and unknown or unlicensed material.
3. Keep complete dependency inventories and `THIRD_PARTY_NOTICES`; carry each applicable licence text, attribution, and modification notice into the shipped artefact.
4. Make the CI gate distinguish direct from transitive dependencies and explain which policy applies to each.

## Context

G6 currently applies Blue Oak Bronze-or-better to the entire production dependency tree. That is stricter than the owner's desired boundary: the project chooses its direct libraries, while those libraries choose their own dependencies. It also blocks some non-copyleft licences that do not appear on Blue Oak's permissive list. For example, the Monaco package's bundled Codicons font is identified as CC-BY-4.0 in the [CSP evidence](../findings/monaco-csp/README.md); that licence is not on the pinned Blue Oak list, although it is non-copyleft and requires attribution.

The policy must still prevent copyleft obligations from reaching shipped products, preserve the project's ability to redistribute and modify its products, and retain required third-party notices. A package's root licence cannot stand in for the licences of the files and packages it includes.

## Decision

1. **Direct production dependencies retain the current rating test.** A direct dependency is a third-party runtime package or component directly selected by a shippable artifact's production dependency declaration or build/package manifest. Its declared licence **MUST** be rated Bronze or better on the repository's pinned Blue Oak list, unless an explicit G6 ADR exception applies. Copyleft, restricted, and unknown licences remain blocked; an exception cannot authorize copyleft. Development-only tools remain governed by ADR 0002 and the existing dev-tool exception process.
2. **Transitive production dependencies use a different test.** A dependency reached through another dependency, or third-party content shipped as part of a selected dependency, does not need a Blue Oak rating. It **MUST** have an identified licence that permits the project's actual redistribution and use, and it **MUST NOT** impose copyleft, source-available, non-commercial, field-of-use, no-redistribution, or similarly restrictive conditions. A known licence may be less permissive or absent from the Blue Oak list and still pass this test. Unknown, missing, or unclassifiable terms remain blocked. A new transitive licence does not require an ADR solely because it is absent from Blue Oak.
3. **No copyleft at either tier.** Copyleft of any strength remains blocked for all shipped components, whether direct or transitive. The prohibition includes, but is not limited to, GPL, LGPL, AGPL, MPL, EPL, EUPL, MS-PL, and SSPL. A direct dependency's permissive root licence does not override a copyleft licence on code or an asset it bundles.
4. **Keep notices complete.** Every shipped package and bundled third-party file **MUST** remain in `THIRD_PARTY_NOTICES` with applicable licence text and attribution, source/release identification, and modification notices where the licence requires them. The licence gate continues to verify the exact production closure and bundled-asset records.
5. **Directly selected standalone assets keep the existing rule.** Assets selected and bundled by this project, rather than supplied inside a selected dependency, remain subject to the current G6 asset rule and any existing path-scoped ADR exception. Content supplied inside a direct dependency is handled under Decision 2, with its notice obligations preserved.
6. **Automate the tier boundary.** The required licence check **MUST** report whether each shipped third-party component is direct or transitive. It **MUST** apply the Blue Oak rating threshold only to direct dependencies, and it **MUST** fail on copyleft, restricted, unknown, or unlicensed material at either tier. The checker must use pinned, reviewable licence metadata and remain fail-closed when it cannot classify a licence; the inventory and notices must still cover the full production closure.

## Consequences

**Positive**

* Directly selected libraries remain subject to the project's existing permissive-licence standard.
* Shipped dependencies can bring known non-copyleft licences that are less permissive than Blue Oak Bronze, without requiring an ADR for every transitive package.
* The policy can admit the Monaco-bundled CC-BY-4.0 Codicons font once its exact shipped files and attribution are verified.

**Risks and mitigations**

* A transitive licence can impose obligations even when it is not copyleft. **Mitigation:** require identified terms that permit the actual use and redistribution; continue to block restrictive, non-commercial, source-available, unknown, and unlicensed terms; preserve all notices and attribution.
* Automated copyleft identification can miss a licence expression or bundled file. **Mitigation:** keep the checker fail-closed for unclassified terms, inventory bundled files and exact production trees, and add regression coverage for direct/transitive classification and compound SPDX expressions.
* A vendor may change the contents or notices of a package without changing its root licence. **Mitigation:** pin dependency versions and lockfiles, inspect shipped assets, and keep notices and inventory tied to the exact release.

## Alternatives rejected

* **Keep Bronze-or-better for every transitive dependency.** Rejected because it treats a library's choices as if the project selected them and blocks the owner's desired reuse of non-copyleft components.
* **Allow every transitive licence except an explicit copyleft-name list.** Rejected because unknown and restricted licences could pass, and the licence expression may not be classifiable. The gate remains fail-closed for unknown, unlicensed, or restrictive terms.
* **Allow any licence that is not copyleft, including non-commercial or no-redistribution terms.** Rejected because those terms can prevent the project from distributing its own products even without copyleft.

## Implementation

The checker keeps Blue Oak Council List v16 as the pinned source for direct-dependency ratings. For known non-Blue-Oak transitive licences, `tools/licences/config.json` contains the reviewed exact-ID allowlist in `transitiveNonCopyleft`; an identifier absent from both the Blue Oak list and that allowlist fails closed. The current entry is `CC-BY-4.0`; its attribution and notice duties remain in force. Copyleft and explicitly blocked licences are rejected at either tier.

The workspace gate derives direct production packages from the workspace's production dependency graph. Release audits derive them from the artifact's direct package manifest and label every audited package as direct or transitive.

## Deferred

* This ADR does not approve a specific Monaco version, a specific Codicons payload, or the 11.7 editor integration. The exact files, upstream terms, notices, and production bundle still need verification before #1705 can ship.
* The existing standalone-asset policy is unchanged; any broader change to that policy needs a separate owner decision.
