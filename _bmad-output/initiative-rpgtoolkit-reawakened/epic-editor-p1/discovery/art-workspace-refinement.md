# Epic 13 artwork workspace refinement — approved decisions

Owner approved the story split and repository/GitHub publication. Research baseline: f228bbe74; publication rebased onto e57acbd8390a10db572f6ed69d054ec26d921feb. Existing story IDs are preserved; retired 13.17 remains retired. Added IDs 21–30 are recorded in tickets.toml with their GitHub tracker IDs.

## Owner decisions

- Build an owned, integrated art editor, with permissively licensed components, adapted code and selective forks allowed; editor interaction can use browser capabilities within the existing model, document and host boundaries (PR #2300 merged at baseline f228bbe74).
- Editable artwork saves and reopens with layers, animation frames and editable recipes/adjustments, separately from generated game assets. This decides preservation requirements, not a file extension, codec, schema or runtime animation contract.
- Complete, not captive: everything needed for successful artwork creation should be provided by us, but successful game creation must not require our drawing tools. Third-party tools and artist workflows are first-class supported paths.
- Standardizing on formats that work well for TKR is acceptable. Third-party workflow support does not require adopting every application's editable format or promising lossless interchange. No additional specific format was selected by this decision.
- Decision: the owner approved the complete proposed story split (existing 19 stories plus additions 13.21–13.30): “looks good to me.” Approval is for the breakdown, not implementation of unresolved source/timing contracts. The owner subsequently approved repository and GitHub publication: “go for it.”

## Mandatory outcomes for the revised stories

1. A creator can make a reusable art kit entirely with the supplied tools, including sheet-first drawing, contextual seam repair, animation, recipes, terrain and isometric construction.
2. A creator can make or revise artwork externally, import or reimport it, and use it in a playable game without opening our drawing UI or rebuilding the artwork with our tools.
3. Mixed workflows preserve the external original, provenance, source-to-output relationships and stable references. Reimport previews changes and handles pending edits and removed or moved regions explicitly; it never silently flattens or overwrites editable originals.
4. Native editing, importing rendered output, handing off original application files and structurally importing those files are separate capabilities. No application-specific editable format or lossless round trip is promised without a named contract, parser/writer and verification.
5. Generated outputs are not the only saved copy of editable source. Save/reopen preserves layers, frames, recipe parameters and source references. Preview and browser interaction do not imply runtime behavior or a new runtime reader.
6. Shared edits and local variants disclose their affected owners; source changes do not silently reinterpret existing tile identities. Multi-document saves follow the existing per-file reporting and recovery contract, not a new atomicity promise.

## Refinement sequence

- Preserve the small legacy tracer (13.1) and refine the reuse evidence decision (13.2) for the already-chosen owned editor.
- Specify editable source persistence and output conversion before implementing richer source save/reopen. Reconcile with Epic 27's tile/pack contracts; do not invent a competing native family as an incidental UI decision.
- Separate source persistence, sheet-first editing, contextual variants, animation creation, reusable recipes, terrain construction/sandbox, isometric construction and external-tool workflow into independently verifiable delivery boundaries.
- Retain the full T-36 operation inventory in 13.3 and existing legacy round-trip requirements in 13.4–13.6; do not replace them with the new workflows.
- Consume Epic 11 lifecycle/navigation/host services, Epic 12 browser/scene/animation/collision ownership and Epic 27 native contracts rather than recreating those providers.
- Keep TOML tables in build order, retain stable IDs, add only real dependency edges, and place the sweep and closing acceptance after all added work.
- Closing acceptance must include wholly internal, wholly external and mixed artist journeys, with failure/cancellation and preservation checks.

## Still to resolve

- Define the standard artwork interchange contract: image/sheet layout, transparency, frame order/timing and metadata needed for reliable reimport. PNG remains the existing authored-image policy, not a new selection here. Application-specific editable adapters are separate scope, not prerequisites for an externally authored game.
- Exact source representation and its relationship to the existing tile/pack contracts; normative format changes require their own approval and docs-before-code work.
- Multi-cell animation timing/lowering semantics; existing TAN and animation-clip semantics must not be silently broadened.

These are explicit deliverables of proposed story 13.21, with an owner approval gate and normative docs before code. The breakdown proposes the required capabilities; it does not pretend these contracts are already settled.
