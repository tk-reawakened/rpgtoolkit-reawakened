# ADR 0003 — Permissive licences are acceptable (Blue Oak Bronze or better)

* **Status:** Accepted (2026-10-10)
* **Date:** 2026-10-10
* **Amends:** [guardrails.md](../guardrails.md) G6; [architecture-options.md](../architecture-options.md) §7
* **Context documents:** [ADR 0002](0002-core-pixels-and-deterministic-maths.md), [guardrails.md](../guardrails.md)

## Summary

One change, in plain terms: G6 stops being a fixed list of licence names. A dependency is fine if its licence is rated **Bronze or better** on the Blue Oak Council's list of permissive licences. Copyleft, restricted and unknown licences are still out. The names that were on the old list stay as examples, and the Blue Oak Model License itself joins them.

## Terms

* **Blue Oak Council licence list:** a public list of permissive licences, rated by the Council's lawyers into tiers: **Model**, **Gold**, **Silver**, **Bronze** and **Lead**. It is published at <https://blueoakcouncil.org/list> as a web page, as JSON and as the npm package `@blueoak/list`. The list covers permissive licences only; copyleft licences are not on it.
* **Bronze or better:** Model, Gold, Silver or Bronze. The Council says most organisations are comfortable accepting Bronze or better. Bronze licences are permissive but lack a nonessential element, for example BSD-3-Clause adds a ban on using the authors' names to promote a product.
* **Lead:** permissive in spirit but missing essential elements, or unusually burdensome, often with unclear or jocular wording (for example WTFPL and Beerware).
* **Copyleft:** the licence requires some or all of what you build with the software to be released under the same terms. Strength varies (GPL and AGPL strong; LGPL, MPL and EPL weaker), and all of it is out.
* **Restricted:** the licence limits who may use the software or for what (non-commercial, purchased, per-seat, or "source-available" licences such as the Defold Licence).

## Context

G6 listed seven licence names. The first real dependency tree showed the problem: ESLint's tree includes `minimatch` under BlueOak-1.0.0, which is permissive in every sense that matters but was not on the list. The same author's `glob` and `path-scurry` use it too, so it will recur, and a fixed list needs an ADR for every unfamiliar but fine licence (`Unlicense`, `Python-2.0`, and so on).

What G6 protects is the project's freedom to be used, changed and sold by anyone. That is a property of a licence, not of its name. The Blue Oak list is a maintained, public statement of that property, designed to be referenced by policies like this one.

One check against the list: every name on the old G6 list is Bronze or better (MIT, Apache-2.0, BSD-2-Clause and ISC are Silver; BSD-3-Clause, Zlib, 0BSD and CC0-1.0 are Bronze; BlueOak-1.0.0 is the Model). A stricter "Silver and above" cut would have put BSD-3-Clause, Zlib, 0BSD and CC0-1.0 back into "needs approval". One licence the list rates Silver is not acceptable to us: **MS-PL**, which carries per-file copyleft terms and which G6 already blocked.

## Decision

1. **G6 uses the Blue Oak list as its test.** Shipped artefacts contain only dependencies whose licence is rated Bronze or better on the Blue Oak Council licence list, at a version pinned in the repo, and which is not on the repo's exception list. For data and assets: CC0-1.0, which is Bronze, or an explicitly approved asset exception recorded below. *Reason: the rule protects a property, and a maintained list is the most objective statement of it.*
2. **Blocked stays blocked.** Copyleft of any strength, restricted licences, and unknown or missing licences cannot be used in shipped software or unapproved assets. A licence rated Lead, or not on the list, needs an ADR exception. *Reason: those are the cases where a lawyer has to look.*
3. **The check stays automatic.** The licence job compares each dependency's SPDX identifier with the pinned list and the exception list and fails on any that does not pass. The list version only moves in a pull request that says so. Adding an identifier to the exception list is an ordinary pull request that states why. *Reason: a rule with no automatic check is not a guard-rail, and "unknown, so it fails until someone looks" is the safe default.*
4. **Dev-only tools keep ADR 0002's carve-out.** A dev-only tool that is never shipped, bundled or linked may use a licence that does not pass the test if an ADR names it (today only `ovsx`, EPL-2.0). The same job lists dev-only dependency licences and fails on any that neither pass the test nor are named in an ADR.
5. **Notices.** Shipped packages are listed in `THIRD_PARTY_NOTICES` with their licence text, as G6 rule 3 already requires.

### Bundled font assets (2026-10-17 amendment)

6. **Bundled font assets.** By owner decision on 2026-10-17, OFL-1.1 is admitted only for the unmodified upstream **Liberation Sans, Liberation Serif and Liberation Mono** font files that this project itself bundles as data. Their upstream licence text, release/hash and Reserved Font Name `Liberation` terms must be included in `THIRD_PARTY_NOTICES`; the files must remain unmodified. This is an asset-only exception: it does not admit OFL-1.1 software dependencies, does not change the Bronze-or-better rule for code, and does not apply to fonts supplied by users. Any other font licence is judged case by case under Decision 2; if it is not on the pinned Blue Oak list, it needs its own explicitly approved ADR exception. Fonts are data and are never linked into executable code.

## Consequences

**Positive**
* New permissive dependencies install without an ADR each time, and the licence list stops being a source of delay.
* The rule says what it protects and points at a maintained source, so reviewers can apply it to a licence nobody has seen before.
* The licence job stays strict about everything that matters: copyleft, restricted, Lead and unknown licences all still fail.

**Negative / risks, with mitigations**
* *The list is someone else's judgement.* **Mitigation:** the version is pinned, the Council's ratings are public and reviewed, and we keep an exception list for any licence we disagree with.
* *Bronze licences carry small extra obligations (for example BSD-3-Clause's no-endorsement clause).* **Mitigation:** these are notice-and-attribution duties already covered by `THIRD_PARTY_NOTICES`.
* *Notice duty grows with the number of licences.* **Mitigation:** the licence job fails if a shipped package is missing from `THIRD_PARTY_NOTICES`.
* *The list could be updated to rate a licence higher than we would.* **Mitigation:** pinning plus the exception list.
* *The asset exception could be mistaken for a software exception.* **Mitigation:** it names three exact unmodified Liberation paths, requires the OFL text and hashes in `THIRD_PARTY_NOTICES`, and leaves OFL software dependencies and user-supplied fonts blocked.


## Alternatives considered

* **Add only BlueOak-1.0.0 to the old list.** Rejected: it fixes today's package and leaves the next permissive licence needing an ADR.
* **Silver and above.** Rejected: it excludes BSD-3-Clause, Zlib, 0BSD and CC0-1.0, which are all common and were already accepted.
* **Rely on OSI approval.** Rejected: OSI approves copyleft licences too, so it cannot tell permissive from copyleft.
* **Name `minimatch` as a dev-only tool, like `ovsx`.** Rejected: the licence would reappear on sibling packages and in shipped trees.
* **Avoid ESLint.** Rejected: it changes the spine's Stack and drops typescript-eslint's type-aware rules over a permissive licence.

## Guard-rail changes

This ADR amends [guardrails.md](../guardrails.md) G6 rules 1 and 2 and its Enforcement paragraph as described above. Everything not listed stays as it was. The G6 summary in `CLAUDE.md`, the G6 item in the pull-request template and the licence sentence in [architecture-options.md](../architecture-options.md) §7 item 2 are updated to match. Entry 1.5 (the licence gate) implements the pinned list, the exception list and the check; entry 4.9 adds a path-scoped check for the three approved Liberation font assets and their notices, without adding OFL-1.1 to the software list or Blue Oak data.


## References

* Blue Oak Council licence list, version 16: <https://blueoakcouncil.org/list>.
* Architecture spine (`_bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md`): Stack rows for ESLint and typescript-eslint.
* [guardrails.md](../guardrails.md): G6.
* [ADR 0002](0002-core-pixels-and-deterministic-maths.md): Decision 3 (dev-only tools).
* Font-library spike evidence: [discovery/font-library-spike.md](../../_bmad-output/initiative-rpgtoolkit-reawakened/epic-board-rendering/discovery/font-library-spike.md).

## Subsequent amendment

The owner accepted [ADR 0034](0034-tiered-dependency-licence-policy.md) on 2026-11-14. It amends this ADR's whole-production-tree Bronze-or-better rule: the rating threshold now applies to direct production dependencies, while known transitive dependencies and content bundled inside a selected dependency may use licences outside Blue Oak if they permit the project's actual use and redistribution and are not copyleft or otherwise restricted. Copyleft, restricted, unknown and unlicensed terms remain blocked at every tier. This ADR remains authoritative for the retained direct-dependency standard, dev-tool process, notices and standalone-asset rules, except where ADR 0034 expressly changes them.
