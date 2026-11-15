---
type: discovery
title: "Inception proposal: epic documentation-website (epic 17)"
date: 2026-10-17
baseline_revision: 875df18b
---

# Inception proposal: documentation and public website

The owner asked for a new epic, to run after the product is finished, that delivers product documentation and a public website explaining how to install, use, create, migrate and share TK Reawakened games. This draft is for review, not a merge. It restates the scope, records every choice made for the owner as a decision or an assumption, gives the suggested breakdown and the cross-epic wiring, and lists what is still open. The raw audit behind it is `docs-readiness.md` (findings F-nn). The envelope is `../epic-documentation-website.md`.

Two things this draft does not do. It chooses no website stack, hosting provider or domain: those are owner decisions (D-3, D-4) with criteria below. And it enters no `tickets.toml` for the epic: epics 5 to 15 have none either, the providers' entries do not exist yet, and a breakdown that pins entries which have not been written would be guesswork. The breakdown in section 4 is a suggested slicing for the real inception, which runs once the providers are incepted (section 6).

## 1. Scope restatement

Epic 17 (a new capability, CAP-19, added to the spec as a draft) delivers:

- **User documentation:** getting started; installing or opening on each shipped host; the project workflow in each editor tool; the RPGCode guide and the built-in reference; file formats and importing legacy and TK2 games (what opens, what changes, what does not carry over); debugging and testing scripts; packaging and sharing; troubleshooting, requirements and a FAQ; reference (project layout, keys, settings, glossary, what is new).
- **Contributor and developer documentation:** setup, a repository tour, running the gates, the clean-room rules, writing a command pack or plugin, extension points.
- **The public website:** an information architecture, navigation and search, an accessible responsive layout, per-release versions, examples and screenshots, a publish step that runs when a release is cut, and landing, about and status pages.
- **Documentation QA:** link and anchor checks, a terminology check for the naming rules of ADR 0005, an accessibility check, an executable-samples harness, and a drift gate between the documentation and an inventory of the built product's surface.

Separation to hold: the **normative spec** (`docs/spec/`, ADR 0007) says what Toolkit 3.1 does and what Reawakened rules add, for implementers; the **user documentation** says how to use the product, for people. User pages link to the spec for byte-level or rule-level detail and never restate it. The user documentation is verified against **built product surfaces**, not against plans: a page that describes a screen, command or format the product does not ship is a defect.

Not in scope: the normative spec, ADRs, guard-rails and `docs/editor-features.md` (engineering documents); the in-app help and tutorial screens (editor epics; this epic supplies the content and the link contract); the product's release process (D-13); translations; a community platform, game gallery or hosting service; publishing recovered community material or naming living people without their say; any website or product code in this draft.

## 2. Decisions and assumptions

The Notes of the envelope carry the dated lines (A-1 to A-8). "Draft" rows are choices made for the owner and marked to confirm. Nothing here is recorded as decided by the owner except the one request in the first row.

| ID | Item | Taken | Status | If ruled otherwise |
|---|---|---|---|---|
| D-0 | The request | A documentation and website epic after the product is finished; planning only | **Decided** (owner, 2026-10-17) | n/a |
| D-1 | Placement and capability | Epic 17, last in build order; new CAP-19, not an extension of CAP-12 | Draft (envelope, spec, initiative) | Extending CAP-12 muddles "the runners and a packaged game" with "documentation about them"; the epic could still be 17 with `covers = ["CAP-12"]` and the spec edit reverted |
| D-2 | Timing | Whole epic waits on the product epics; the platform lane (entries 1 to 8) needs only epic 1 and could be pulled earlier | Draft; **owner to rule** | If pulled earlier, the site, versioning and QA gates exist while the product is built, content is written as surfaces land and verified at the end; costs a second pass on every page. If not, nothing about the site is exercised until the last epic |
| D-3 | Site stack (generator, content format, theme, search engine) | **Not chosen.** Entry 2 compares candidates against criteria and records the owner's pick in an ADR | **Owner decision** | The breakdown does not change; entries 3, 4, 5 and 7 name the chosen stack only inside their plans |
| D-4 | Hosting and domain | **Not chosen.** Criteria in section 3; the domain is the owner's to supply | **Owner decision** | Entry 5's publish step and the preview deployment of entry 3 are written against the ruled host; a host without per-change previews drops that check |
| D-5 | Where the source lives, and gate coverage | In this repository (A-2); directory and package shape fall out of D-3. Whichever shape: `tools/provenance/markers.json` skips `docs/` but scans `.html`, `.css`, `.json`, `.yml`, `.toml`; `tools/deps/edges.json` is a closed package list; `pnpm licence` evaluates dev dependencies too (F-17 to F-19) | Draft | A separate repository means a second set of gates and a published contract between them; not recommended while the docs verify against this repo's build |
| D-6 | The spec on the public site | Link to `docs/spec/` at the matching revision or render the same files in place, never a second copy; whether to publish the spec at all is open | **Owner decision** | A copy drifts and breaks ADR 0007's one-spec rule; not publishing it means user pages link to the repository view |
| D-7 | What "verified against the built product" means | Three classes: **generated** from the product (built-in names and signatures, diagnostic codes, CLI flags, file types), **executed** (RPGCode samples and shell snippets run in CI), **walked** (UI steps and screenshots, by a person per release, recorded). The drift gate covers the first two; walked pages carry the release they were walked against | Draft | Fully automated UI verification would need a UI-automation harness no epic builds; fully manual would let the first two classes rot |
| D-8 | Legacy guide, example assets, licences | Write fresh (A-1); the legacy guide is a topic checklist only. Examples and screenshots use `docs/spec/examples/game/` and authored games (A-7); asset licence to confirm | Draft; rights questions are the owner's | Copying or translating the legacy guide needs a rights decision from its three authors and is outside this proposal |
| D-9 | Accessibility and responsive target | Proposed: WCAG 2.2 level AA, usable from 320 CSS px wide to a desktop, no horizontal scroll at 320 px, keyboard-only navigation, visible focus, text zoom to 200% [INFERENCE: the spine records no accessibility target, only "no cross-epic divergence point"] | **Owner decision** | A looser or stricter target changes the checks of entries 4, 6 and 22 |
| D-10 | Search | Client-side index built at publish time, no third-party service (A-5); a hosted service needs an owner ruling and a privacy note | Draft | A hosted search is better for a large site and adds a runtime third party and possibly tracking |
| D-11 | Versioning | One documentation set per released minor on the semver line, latest alias, earlier versions kept and marked; page URLs stable across versions where the page still exists | Draft | Latest-only is smaller and breaks a reader on an older release |
| D-12 | Naming, voice and the native format | ADR 0005: TK Reawakened or TKR; "a tribute to RPG Toolkit"; never "v3", "v4", "next version" or "successor"; "TK3" only for the legacy tool and formats; user pages on formats describe legacy formats as authoritative and mark the native format "not yet defined" until it is (F-24) | Draft; follows the ADR | Documenting a native format before its ADR would invent it |
| D-13 | Who owns the product's release process | Not epic 17. The spine defers publisher verification, signing, publish secrets and store accounts to "release epics" and none exists (F-23). Epic 17's entry 5 publishes the **documentation** when a release is cut | **Owner decision** | Options: add a release epic before epic 17 (recommended), or fold the work into epics 9, 11 and 15. Until one exists the install pages cannot say where to get the product |
| D-14 | Community material and support channels | Epic 17 publishes no community games, recovered material or names of living people without their consent (README: "nothing is published until the people involved have had their say"); no support channel is invented; the FAQ says only where the owner names one | **Owner decision** (channels and showcase) | A "play classic games" page needs redistribution permission per game; a community page needs the stakeholder consent step |
| D-15 | Analytics, cookies, telemetry | None by default (A-5) | Draft | Any analytics needs a notice and a ruling |
| D-16 | `README.md` and `CONTRIBUTING.md` | Both stay at the repository root as the GitHub-facing entry; the site's about and contributor pages point to them or are generated from the same source, never a second hand-edited copy | Draft | Two copies drift (CONTRIBUTING already carries the commands and the clean-room text) |
| D-17 | Localisation | English only at 1.0 (A-4) | Draft | A second language needs a translation workflow and a per-language verification pass |
| D-18 | In-app help | The editor is offline-first (spine, Operations). Either in-app Help opens the versioned site (needs a connection) or each release bundles an offline snapshot of the documentation (a build artefact of this epic, a size cost and a link contract for the editor epics). Neither is chosen | **Owner decision** | Linking only is smallest; bundling is the only option that works on a plane |
| D-19 | Entry count | 24 entries in one epic, past the typical 8 to 12 (A-8) | Draft | Split into a platform epic (entries 1 to 8, could start early) and a content epic; the shared seams are the site config and the surface inventory |
| D-20 | Who is the "first-time reader" | CAP-19's success check needs readers who did not write the documentation. The owner names them (community members, a beginner outside the project); this epic cannot invent them | **Owner decision** | Without named readers, entries 22 and 24 cannot close; an agent-run walkthrough is a drift check, not a reader |

## 3. Genuine unresolved decisions (owner), with recommendations

1. **D-3 and D-4, stack, hosting and domain.** *Not chosen here.* The criteria for entry 2 to evaluate, from the repository's own rules and the spine: static output only, no backend, accounts or telemetry (spine, Operations); every tool and its transitive dependencies pass the licence gate, dev dependencies included (G6; the spine already records that Vite 8 pulls `lightningcss`, MPL-2.0, and needs an ADR as a dev-only tool, so a Vite-based generator inherits that question); reproducible builds from a lockfile on the pinned Node and pnpm; Markdown content with code blocks that the sample harness (entry 7) can extract; per-release versioning; client-side search; an accessible default theme; a per-change preview; rollback; HTTPS and a custom domain. *Recommend:* run entry 2 as a spike that builds the same three real pages in the top candidates, and put the owner's pick in an ADR. The domain stays "owner-supplied or deferred" in the ADR; no entry needs it before entry 5.
2. **D-13, the product release process.** The install pages, the "get it" links and the publish-on-release step all need to know where releases come from (npm, a PWA address, VS Code Marketplace and Open VSX, desktop installers, mobile builds) and who holds the accounts. *Recommend:* name an owner and, since the spine already says "release epics", add a release epic ahead of epic 17 and let epic 17 consume it. If the owner prefers, fold it into the runner, editor and desktop epics; epic 17 then waits on each.
3. **D-2, timing.** *Recommend:* keep the whole epic after the product as asked, but accept entries 1 to 8 as pullable once epic 1 is the only prerequisite, so the owner can spend effort early on the parts that do not depend on the product (rulings, stack, site, versioning, QA gates). Content starts when its provider epics land.
4. **D-18, in-app help.** *Recommend:* link to the versioned site and bundle an offline snapshot only if the owner wants help to work without a connection; decide before epic editor-foundation incepts, because it changes what that epic builds.
5. **D-20, the readers.** *Recommend:* the owner names at least one beginner and one returning TK3 author for entry 22 and again for entry 24; give them the published preview and a task list, not the authors' help.
6. **D-8, rights.** *Recommend:* confirm that the example game's art is under the repository licence, and decide whether the legacy guide may even be a topic checklist. Nothing here asks the guide's authors for anything.
7. **D-9, accessibility target.** *Recommend:* WCAG 2.2 AA as the stated target, with the automated checks gating and the manual audit of entry 22 carrying the rest.
8. **D-6, the spec on the site.** *Recommend:* render the spec in place from the same files, in its own section, if the owner wants it public; otherwise link to the repository.
9. **D-14, community pages.** *Recommend:* leave showcase and recovered-material pages out of this epic until the consent step has run; ship the "about" page without them.

Everything else in section 2 is an assumption with a recommended default; none blocks drafting.

## 4. Breakdown (suggested; not entered in a `tickets.toml`)

Table order is build order; the ids are the draft's order. `after` shows siblings by number and providers as `epic.entry` where the provider has entries today (epics 1, 2, 3, 16), or as `epic-<slug>` where the provider is not yet incepted (so its entries cannot be named). At the real inception each `epic-<slug>` becomes the provider's entries, and `tickets.py status` must report no `undeclared_after` (every provider epic is already in the initiative's `[[epic]]` table for epic 17).

`type` is `story` except entry 2 (`spike`). `hitl` is true where a person's ruling, account or reading is the check: entries 1, 2, 5, 9, 15, 21, 22 and 24. The lane column names the area the entry edits.

| # | Title | after | Risk | Lane | Check (abridged) |
|---|---|---|---|---|---|
| 1 | Documentation policy rulings (an ADR) | 1.13 | medium | docs | only `docs/` and the ADR; each D-row ruled or deferred naming the entry; OWNER markers; a person approves |
| 2 | Site stack, hosting and domain decision | 1, 1.5 | medium | docs | candidate table against the criteria in section 3; chosen tool's licences clean; a person approves; nothing chosen without the owner |
| 3 | **Tracer bullet:** one page from source to a published preview through CI | 2, 1.5, 1.6, 1.10 | high | site, CI | one page builds in CI as a required check; a preview of it is reachable; provenance, licence and graph checks cover the site's sources and dependencies |
| 4 | Site shell: information architecture, navigation, responsive accessible layout, search | 1, 3 | medium | site | the IA names every page slot of Done-when 1; keyboard, 320 px and 200% zoom checks; search finds a page; the ruled accessibility check passes |
| 5 | Versioned documentation and publish on release | 3, 4 | high | site, CI | a staging release publishes a versioned URL, the latest alias moves, an earlier version stays reachable, a rollback is shown; credentials are the owner's |
| 6 | Documentation QA gates | 3 | medium | CI | seeded defects fail each rule (broken link, bad anchor, a banned phrase, a missing alt text, a stub page, an inaccessible page); a clean tree passes; wired into the `gate` job |
| 7 | Surface inventory and the sample-verification harness | 3, 6, 3.17, epic-rpgcode-tooling, epic-editor-foundation, epic-web-runner-packaging | high | tools | the inventory is generated from the built product; renaming a built-in, a menu label or a CLI flag in a fixture fails the drift gate; a failing RPGCode or shell sample fails; regenerating gives no diff |
| 8 | Screenshot and example-project pipeline | 3, 7, epic-editor-assets-p0, epic-web-runner-packaging | medium | tools | a documented command regenerates every screenshot from the built editor and runner; each has alt text; a stale shot is flagged when its labels change; assets are listed in `THIRD_PARTY_NOTICES` |
| 9 | Getting started and installing or opening on each shipped host | 4, 7, 8, epic-web-runner-packaging, epic-editor-foundation, epic-desktop-shell | medium | content | each step walked on a clean browser profile, a clean VS Code profile and each shipped OS; a host that does not ship is not described |
| 10 | First-game tutorial, from an empty project to a played game | 9, 8, epic-editor-assets-p0, epic-editor-p2 | medium | content | followed once end to end in both hosts; agrees with the in-editor tutorial; every sample runs |
| 11 | Editor guides: the P0 tools | 10, 7 | low | content | one guide per shipped tool; every label exists in the surface inventory; walked once |
| 12 | Editor guides: the P1 and P2 tools | 11, epic-editor-p1, epic-editor-p2 | low | content | as entry 11 for each shipped tool |
| 13 | RPGCode language guide | 4, 7, 3.17 | medium | content | every runnable sample executes and lints clean; each rule links the `docs/spec/engine/` anchor instead of restating it |
| 14 | RPGCode built-in reference | 13, 7 | medium | content | one entry per built-in the shipped registry resolves (the count matches); every example runs; generated parts come from the registry |
| 15 | Importing and migrating legacy and TK2 games | 4, 7, 2.10, 2.11, 2.12, 16.9, 3.24, epic-editor-p1 | high | content | every "opens" or "does not open" claim cites a gate or fixture; a person imports a real legacy game from a fetched copy and follows the page |
| 16 | Debugging and testing scripts | 13, 7, epic-rpgcode-tooling, epic-editor-foundation | medium | content | every shipped diagnostic code has a page; a walkthrough sets a breakpoint and steps in each host |
| 17 | Packaging and sharing | 10, 7, 8, 2.12, epic-web-runner-packaging, epic-editor-assets-p0, epic-editor-p2 | medium | content | a closed list of the forms the product builds; each form built and opened as the page says; no link-sharing claim unless the product has it |
| 18 | Troubleshooting, FAQ and requirements | 9, 15, 16, 17 | low | content | each entry reproduces on the release build; requirements match the support envelope the product states |
| 19 | Reference: project layout, controls, settings, glossary, what is new | 11, 12, 17 | low | content | layout and file types match the format registry; controls match the shipped bindings; the what-is-new page is built from the release's change record |
| 20 | Contributor and developer documentation | 4, 7, 1.10, 3.23, 3.25, epic-editor-foundation | medium | content | followed once on a clean clone, every command runs; a plugin and a command pack example build; no divergence from `CONTRIBUTING.md` (D-16) |
| 21 | Landing, about, status and community pages | 4, 1 | low | content | the terminology gate passes; every named person approved; nothing from recovered material without consent (D-14) |
| 22 | First-reader walkthroughs and the accessibility audit | 9 to 21 | high | review | named readers (D-20) complete each flagship task from the preview; a screen-reader and keyboard audit; every finding fixed or ruled |
| 23 | Refactor sweep | 1 to 22 | low | sweep | no placeholder page reachable, no dead link or unused asset, gates pass, no content change |
| 24 | Closing suite: release-build verification and the documentation release | 23, 5 | high | gates | the whole drift, sample and link check passes against the release build; the release's documentation publishes; the flagship walkthrough is repeated on the live site |

### What can be seen first, and the riskiest entries

Entry 3 is the tracer: one page, authored as source, built in CI, deployed to a preview and checked by the gates, which touches every moving part (stack, hosting, gates). The riskiest are entry 2 (an owner choice with licence consequences), entry 7 (it depends on surfaces epics 9 to 11 must expose as data, see the handoff in the envelope), entry 5 (credentials and a release process that does not exist yet) and entry 15 (claims about legacy games that nothing in the repository can test beyond the fixtures).

### Source-of-truth and ownership

| Documentation area | Authoritative source | Verifier | Owner entry |
|---|---|---|---|
| Legacy formats, engine behaviour, Reawakened rules | `docs/spec/` (ADR 0007) | linked, never restated; anchor check | none: this epic only links |
| RPGCode built-ins | the shipped registry, cross-checked with `docs/spec/engine/rpgcode-functions.md` | generated reference and the drift gate | 7, 14 |
| RPGCode language | `docs/spec/engine/rpgcode-language.md` and the shipped parser | executed samples through the VM and LSP | 13 |
| UI labels, commands, shortcuts, settings | the built editor (surface inventory) | the drift gate; walked per release | 7, 9 to 12 |
| CLI | the built CLIs' own help | the drift gate | 7 |
| Importing and legacy support | the dump tool, importers and corpus gates | cited by test id | 15 |
| Diagnostics | the shipped diagnostic list (AD-24) | one page per code | 16 |
| Installing and release channels | the product release process (D-13) | walked per release | 9, 24 |
| Contributor setup | `CONTRIBUTING.md`, `docs/guardrails.md`, the root `package.json` scripts | followed on a clean clone | 20 |
| Naming and voice | ADR 0005 | terminology gate | 6, 21 |

## 5. Cross-epic `after` wiring

| This epic's entries | Provider pins | Initiative `[[epic]]` needs |
|---|---|---|
| 3 | 1.5 (licence gate), 1.6 (provenance scan), 1.10 (required checks, contributor docs) | epic 1 |
| 1 | 1.13 (ADR 0007) | epic 1 |
| 2 | 1.5 | epic 1 |
| 15, 17 | 2.10, 2.11, 2.12 (package loader, dump tool, package writer) | epic 2 |
| 15 | 16.9 (the TK2 corpus gate) | epic 16 |
| 7, 13, 14 | 3.17 (corpus and catalogue completeness) | epic 3 |
| 15 | 3.24 (native legacy packs and the legacy-name table) | epic 3 |
| 20 | 3.23, 3.25 (plugin contract beyond commands, manifest) | epic 3 |
| 7, 8, 9, 17 | `epic-web-runner-packaging` (not incepted) | epic 9 |
| 7, 16 | `epic-rpgcode-tooling` (not incepted) | epic 10 |
| 7, 9, 16, 20 | `epic-editor-foundation` (not incepted) | epic 11 |
| 8, 10, 11, 17 | `epic-editor-assets-p0` (not incepted) | epic 12 |
| 12, 15 | `epic-editor-p1` (not incepted) | epic 13 |
| 10, 12, 17 | `epic-editor-p2` (not incepted) | epic 14 |
| 9 | `epic-desktop-shell` (not incepted) | epic 15 |

Epic 17 also depends, through epic 9 and epic 11, on epics 4 to 8 and 16 (gameplay the guides explain); those are listed in its Notes, not pinned here. The initiative `[[epic]]` table for epic 17 lists epics 1, 2, 16, 3, 9, 10, 11, 12, 13, 14 and 15, so no provider named above is undeclared. Handoffs asked of the providers (draft, recorded in each provider's Notes and not yet accepted): epic 11, the surface inventory as data and a configurable documentation base URL; epic 14, the in-editor tutorial and the written first-game guide agree; epic 9, a closed list of shareable forms. Downstream: nothing waits on this epic.

## 6. Parallelism

- Rulings first (1), then the stack decision (2); both are docs only and owner-approved, so they are serial.
- Entry 3, the tracer, follows alone: it creates the site directory, the CI wiring and the gate coverage everything else extends.
- Then lanes, each with its own files: platform (4, then 5, then 6; 4 and 5 share the site configuration, 5 and 6 and 3 share `.github/workflows/`, so they run in order and 5's publish step goes in its own workflow file where the host allows); tools (7, then 8); content lanes after their providers land: [9, 10, 11, 12], [13, 14, 16], [15], [17], [19], [20], [21]; each lane writes its own page directory.
- Shared seams and owners: the navigation and section configuration is the IA of entry 4, one section per content entry, so a content entry edits only its own section; the CI workflow files (3, then 5, then 6); `tools/provenance/markers.json` and `tools/deps/edges.json` (3 only, if at all); the surface inventory schema (7, consumed by 8 to 20).
- The first-reader entry (22) and the sweep (23) wait on all content; the closing suite (24) waits on the sweep and on entry 5.
- Parked on purpose: translations, a community gallery, any documentation of the native format (D-12), in-app help screens (editor epics), link sharing (no product feature), legacy `.sav` import (an open question of the spec; the migration guide says "not supported" or "supported" as the product ends up).

## 7. Validation record

**Round 0 (author, 2026-10-17).** Walked the Tree, Set and Dependencies checks of `validate-checks.md` by hand against the drafted material: every requirement the brief names (the user documentation topics, contributor documentation, the information architecture, accessible responsive site, versioning, search, navigation, examples and screenshots, release publishing, documentation QA, the separation from the normative spec, verification against built surfaces) maps to an entry; the epic has Outcome, Done when, Boundaries, References and Notes; its `covers` cites a parent id (CAP-19, added to the spec as a draft); its `after` in the initiative table names what it needs from each epic. The initiative-level `tickets.py status` and `next` commands were run after the edits and completed, but the epic itself has no `tickets.toml`; the suggested slices are not yet executable tickets.

**Not yet done:** the independent reviewer round the epic-inception procedure requires. It needs a reviewer who has not read this draft's reasoning, handed `validate-checks.md` (sections Ticket, Set, Dependencies) and the provider breakdowns, and told not to edit. It belongs before the real inception, when the entries exist as a `tickets.toml`; reviewing prose slices for dependency errors would repeat the work. Likely findings, to check first: provider pins that name an entry that later changes; `verify` lines that need a surface no epic yet exposes (the surface inventory of entry 7 is the main one); entries 9, 17 and 18 relying on a release process that does not exist (D-13).
