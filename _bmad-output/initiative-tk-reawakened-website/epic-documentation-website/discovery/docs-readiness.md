---
type: discovery
title: "Documentation and website source/readiness audit"
date: 2026-10-17
baseline_revision: 875df18b
---

# Documentation and website source/readiness audit

Raw audit behind the inception of `epic-documentation-website` (epic 17). Each finding cites a repository file and line or a reproducible inventory fact. Claims not observable in the repository are marked **[INFERENCE]**. The last column names the suggested entries in `discovery/inception-proposal.md` that the finding blocks or shapes. This audit is planning evidence only; it does not select a site stack, hosting provider, domain or release owner.

## 1. What exists now

| ID | Finding | Evidence | Blocks / shapes |
|---|---|---|---|
| F-01 | There is no public documentation website or site package in the repository. The root's human-facing entry points are `README.md` and `CONTRIBUTING.md`; the `docs/` tree is engineering/spec material. | `README.md`, `CONTRIBUTING.md`, `docs/`; no site directory in the root listing (2026-10-17) | 2, 3, 4, 5 |
| F-02 | The normative specification is `docs/spec/`, not the old frozen specs. ADR 0007 says it describes Toolkit 3.1 formats and engine behaviour, and that `docs/editor-features.md` is not replaced. | `docs/adr/0007-docs-spec-is-the-normative-specification.md` Decision 1, 4; `docs/spec/README.md` | 1, 7, 13, 14, 15, 19 |
| F-03 | The spec has a complete format and engine page set, examples, listings, version examples and reference tools, but it is not a user manual: its stated purpose is a compatibility contract and its “How to read it” table is organized by formats/engine/tools. | `docs/spec/README.md`; `docs/spec/formats/`, `docs/spec/engine/`, `docs/spec/examples/`, `docs/spec/tools/` | 7, 9, 13, 14, 15, 19 |
| F-04 | The editor feature inventory names onboarding/help (tip of day, 9-step tutorial, HTML manual, RPGCode quick reference, what's new), but no current epic explicitly owns the written content. Editor-foundation's boundary includes T-01 to T-14; editor-p2 says tutorials but its envelope does not name the manual or quick reference. | `docs/editor-features.md:30` (T-09); `epic-editor-foundation/epic-editor-foundation.md` Boundaries; `epic-editor-p2/epic-editor-p2.md` Description and Done when | 9, 10, 11, 12, 21; handoffs to 11 and 14 |
| F-05 | The current README describes a project identity and future product promise, not a released installation or authoring workflow. It says “Send your game to a friend as a link”, “Nothing to install”, and that desktop/mobile/VS Code versions are planned; it also says nothing is playable or published yet. | `README.md:16,19,21,27-30` | 1, 9, 17, 18, 21; release gap |
| F-06 | Contributor instructions are real and useful but developer-facing: they give clean-room, guard-rail, licence and fixture rules and commands, and they are the source to keep aligned with contributor pages. | `CONTRIBUTING.md:1-60,` Commands section; root `package.json` scripts | 20 |
| F-07 | The repository currently has no editor, web runner, LSP/DAP, desktop or mobile packages in the checked-out `packages/` directory; those are planned package surfaces in the spine and epic envelopes. | `packages/` currently contains `core`, `plugin-tk2-compat`, `runner-harness`, `runner-headless`, `synth`; spine package map and epics 9-15 name future packages | 7, 8, 9, 10, 11, 12, 13, 14, 15 |
| F-08 | `media/icons/` already contains generated icon formats and `media/tkr.png` is the master used by `tools/icons/build.mjs`; this is an existing brand input, not proof that a site visual system is chosen. | `tools/icons/build.mjs:1-10`; `media/` | 3, 4, 21 |

## 2. Source-of-truth map

| Area the public docs will describe | Current authoritative source | Readiness | Suggested verifier / blocked entries |
|---|---|---|---|
| Product identity, tribute, licence, version line, native-format freedom | ADR 0005; root `README.md` | Ready for identity; native format name/container/migration policy remain open | terminology gate; 1, 19, 21 |
| Normative legacy formats and engine behaviour | `docs/spec/` under ADR 0007 | Ready as a link target; not a user workflow | anchor check; 7, 13, 14, 15, 19 |
| Editor feature inventory and priority | `docs/editor-features.md` T-xx and section 11 | Ready as planning inventory; actual labels and workflows wait on editor builds | surface inventory; 7, 10-12 |
| RPGCode syntax and semantics | `docs/spec/engine/rpgcode-language.md`, `rpgcode-runtime.md`, `rpgcode-dialects.md` | Ready as normative reference; samples and friendly explanations need the VM/LSP | executable sample runner; 13 |
| RPGCode built-in names/signatures | `docs/spec/engine/rpgcode-functions.md`; shipped registry once epic 3 and domain epics land | Spec has 282 names; current discovery catalogue has 282 names, but a publication reference must use the shipped registry and check both | generated reference and drift gate; 7, 14 |
| File types, package layout, import and migration | `docs/spec/formats/`, format registry, dump tool, loaders and corpus fixtures | Format docs are ready; some readers and TK2 gates are provider work; optional compiled `.prg` and `.sav` import remain spec/open-scope questions | import claims cite a gate/fixture; 15 |
| UI labels, commands, panels, shortcuts and settings | Future built editor surfaces; no machine-readable inventory today | Not ready; editor-foundation handoff required so docs do not screen-scrape or invent labels | surface inventory; 7, 9-12 |
| Web/desktop/mobile install and release channels | Architecture spine deployment diagram and future runner/host epics; no release owner | Not ready; product release epic/owner absent | owner D-13; 2, 5, 9, 24 |
| Diagnostics and debugging | AD-24, core diagnostics as they land, LSP/DAP provider | Contract exists; complete diagnostic list and host workflows do not yet exist | generated diagnostic index; 16 |
| Contributor setup and gates | `CONTRIBUTING.md`, `docs/guardrails.md`, root `package.json`, `.github/workflows/ci.yml` | Ready for current repo; future packages/site tooling change commands | clean-clone check; 20 |
| Site brand/icon assets | `media/tkr.png`, `tools/icons/build.mjs`, MIT root licence | Existing inputs only; image attribution and accessibility text still need policy | asset/provenance check; 3, 4, 8, 21 |

## 3. Product and architecture gaps

| ID | Finding | Evidence | Blocks / shapes |
|---|---|---|---|
| F-09 | The architecture spine explicitly assumes a static PWA host but does not choose one, and says there is no backend, accounts or telemetry by default. | `architecture-rpgtoolkit-reawakened.md:441-456`, Deployment and environments | 2, 3, 5, 15 |
| F-10 | Site generator, content format, theme, search implementation, hosting provider and domain are not chosen. No existing decision record answers them. | no site ADR or package; spine's static-host diagram and operations note | 1, 2, 3, 4, 5, 6 |
| F-11 | The spine defers publisher verification, signing, publish secrets and store accounts to “release epics, owners named at their inception”; no current initiative epic owns that work. | `architecture-rpgtoolkit-reawakened.md:500` | 5, 9, 24; owner decision D-13 |
| F-12 | The spine says accessibility and localisation have no cross-epic divergence point at this altitude. That is not a target or acceptance contract for a public site. | `architecture-rpgtoolkit-reawakened.md:503` | 4, 6, 22; owner decision D-9 |
| F-13 | The spine warns that Vite 8 pulls `lightningcss` (MPL-2.0) and requires an ADR before first install. Any site stack with that dependency must pass the same G6 decision; the epic must not silently choose Vite. | `architecture-rpgtoolkit-reawakened.md:504`; `docs/guardrails.md` G6 | 2, 3, 6 |
| F-14 | The package dependency graph is a closed list of product packages and does not include a docs-site package. If the site lives under `packages/`, `tools/deps/edges.json`, the diagram and graph check need an owned amendment; if it lives elsewhere, its build boundary still needs a documented licence/provenance scope. | `tools/deps/edges.json` package list; `tools/deps/graph.mjs` comments and source | 2, 3, 6, 20 |
| F-15 | The product's semver and PWA update policy are assumptions in the spine, not a published release runbook; `package.json` is private and currently has no release script. | spine Operations; root `package.json` | 5, 9, 20, 24 |
| F-16 | The repository's README promises link sharing, but the spine says no backend and current product epics describe package forms, not hosted game links. This is a product-scope conflict, not something docs can solve. | `README.md:16`; epic-web-runner-packaging Boundaries/Done when; spine Operations | 1, 17, 18; owner decision |

## 4. QA, provenance and licensing gaps

| ID | Finding | Evidence | Blocks / shapes |
|---|---|---|---|
| F-17 | The provenance scanner checks source extensions including HTML, CSS, JSON, YAML and TOML, but its root skip list excludes `docs/`, `_bmad-output/` and `fixtures/` **from scanning**; it does not list Markdown as a scanned extension. A site directory needs an explicit scope decision, especially if generated assets are committed. | `tools/provenance/markers.json:1-37` | 3, 6, 20 |
| F-18 | The licence gate checks workspace dependency trees and production notices, but a site generator's dependency and bundled fonts/icons still need to be included in the chosen build's G6 review. The current repo has no site dependency or site asset notice. | `tools/licences/check.mjs:1-8`; `docs/guardrails.md:110-115` | 2, 3, 6, 8 |
| F-19 | CI has required jobs for typecheck, lint, unit, golden, licence, provenance, graph and gate, but no Markdown link checker, accessibility checker, docs build, executable-doc sample job or release-site publish job. | `.github/workflows/ci.yml:1-125` | 3, 5, 6, 7, 24 |
| F-20 | The provenance scan skips `docs/`, which is correct for the current G7 process because docs are the clean-room source, but it means a published site source under `docs/` is not automatically protected against copied legacy GPL headers or text. A docs-specific provenance/rights check is needed; it must not make the normative spec impossible to maintain. | `tools/provenance/markers.json:28-34`; `docs/guardrails.md` G7 | 1, 3, 6, 8, 21 |
| F-21 | `docs/spec/examples/README.md` says the example game and art are generated by `build_example_game.py`, but it does not explicitly state an asset licence. Treating the art as MIT is an inference, not a source-backed fact. | `docs/spec/examples/README.md` opening paragraphs; root `LICENSE` | 8, 21; owner D-8 |
| F-22 | The recovered 3.1.0 user guide identifies three authors and a 2005/2007 copyright; the recovery digest reports GPLv3 for the 3.1.0 application, but does not state a licence for the guide text. It is safe as a topic checklist only; copying, translating or closely adapting it needs a rights decision. | `recovery-legacy-docs-and-plugins/docs.md:36-40,121-130`; `recovery-legacy-docs-and-plugins/README.md` guardrails | 1, 8, 13, 14 |
| F-23 | There is no consent workflow in the current site because no site exists. The README promises that nothing is published until people involved have had their say; a community gallery, recovered names, quotes or game downloads therefore need an explicit consent gate. | `README.md:29`, `docs/adr/0005-independent-product-v1-and-native-format.md` naming/tribute rules | 21 |
| F-24 | Terminology needs a machine check. ADR 0005 prohibits product framing as “v3”, “v4”, “next version” or “successor”; existing historical references to “RPG Toolkit 3” and “TK3” are valid only when clearly about the legacy tool or formats. | `docs/adr/0005-independent-product-v1-and-native-format.md` Decision 1, 5 | 1, 6, 19, 21 |
| F-25 | `tools/catalogue/generate.mjs --check` checks generated command stubs against a discovery JSON, but it is not a public-doc reference generator and its source comments still name old specs. The docs reference must consume the shipped registry and `docs/spec/engine/rpgcode-functions.md`, then decide how the planning catalogue is retired. | `tools/catalogue/generate.mjs:1-24`; `docs/spec/engine/rpgcode-functions.md` | 7, 13, 14 |

## 5. Validation readiness by proposed story

| Suggested entry | Ready inputs | Missing or blocked inputs | Validation that can be designed now |
|---|---|---|---|
| 1 policy ADR | ADR 0005, ADR 0007, G6/G7, README promise | owner rulings D-3, D-4, D-6, D-9, D-13, D-18, D-20; rights for legacy guide and example art | terminology policy, source-order table, rights/provenance policy |
| 2 stack/host spike | static-host architecture shape, G6/G7 criteria, existing Node/pnpm toolchain | no candidates compared, no domain/host supplied, Vite/MPL question | build three pages, licence/dependency table, deterministic output and accessibility probe |
| 3 tracer | README, current docs, CI and icon source | chosen stack, package boundary, hosting preview, provenance scope | one real page through local build and PR preview |
| 4 site shell | T-09 and editor feature inventory, existing brand asset | D-3/D-4/D-9/D-10; final page inventory | keyboard/reflow/search/anchor checks |
| 5 version/publish | spine semver and static-PWA assumptions | release epic/owner, credentials, domain, signing/store channels | staging tag with latest alias, old version and rollback |
| 6 QA gates | CI required-job model, ADR 0005 naming | checker choices, generated site shape, accessibility target | seeded-bad-page fixtures and clean pass |
| 7 surface/sample harness | `docs/spec` examples, registry/catalogue, runner-harness and LSP contracts | actual editor surface inventory; final diagnostic list; future package APIs | generated inventory, executable RPGCode/shell blocks, drift diff |
| 8 screenshots/examples | generated spec example game, icon tooling | example-art licence, editor builds, deterministic capture and asset notice | regenerate/check hashes, alt-text and licence manifest |
| 9-12 content | editor feature priority and T-09; providers' eventual labels and workflows | epics 9-15 not implemented; host/release decisions | clean-profile walkthroughs after provider completion |
| 13-14 RPGCode docs | normative language pages and function catalogue | final parser/registry and generated-reference shape | run every sample; compare generated names and signatures |
| 15 import/migration | `docs/spec/formats`, existing package/dump plans and TK2 corpus plan | optional format decisions (.sav, compiled .prg, text-era edges); provider gates | fetched corpus import/dump walkthrough |
| 16 debugging | AD-24, LSP/DAP envelope | final diagnostics and host surfaces | breakpoint/step walkthrough and code-index coverage |
| 17 package/share | T-70 to T-74, package writer/runner envelope | closed list of actual outputs; README link-sharing conflict | build and open each supported form |
| 18-21 reference/contributor/about | README, CONTRIBUTING, ADRs, spec, editor inventory | release owner, support channel, consent, final status | clean clone, terminology and links |
| 22 reader/a11y | proposed WCAG 2.2 AA target | named readers and owner target | keyboard, screen reader, 320 px/200% zoom, first-reader task log |
| 23-24 sweep/close | all preceding content and gates | live host/domain and product release process | full release-build, live-site, link, sample, drift and walkthrough checks |

## 6. Readiness conclusion

The documentation scope is clear enough to draft an envelope and suggested slices. It is **not ready for build**: the site stack and hosting are not chosen; no release owner or product release channel exists; the product/editor surfaces the pages must describe are still provider epics; accessibility, localisation, offline help and community consent have no binding owner rulings; the example art's licence is not explicit; and the current CI/provenance/graph tools do not cover a site automatically. These are not reasons to narrow the requested epic. They are the genuine decisions and handoffs the inception must expose.

The recommended next gate is: owner rules D-3, D-4, D-6, D-9, D-13, D-18 and D-20; a release epic or explicit release owners are added; then the platform lane can be incepted and the provider epics can be asked to accept the surface-inventory, tutorial and shareable-form handoffs. Only after that should the 24 suggested slices become a `tickets.toml` and receive entry-level `after` pins.
