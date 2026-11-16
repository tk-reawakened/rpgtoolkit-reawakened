# Animation creation and recovery

Animation creation lets an author assemble images or 4×4 tile pictures into a saved animation and recover the files changed by a wizard. Both editor hosts use the same document and recovery services so a project can move between them.

## Creation

New animation explicitly asks for a project-relative `.anm` destination in the animation folder. It creates binary minor 3; opening an older text animation remains read-only. Choosing a name or cancelling does not create a file. Existing destinations require explicit overwrite consent before any target changes.

The image wizard stages a selection in normalized project-path order, shows the order and permits reordering before confirmation. Each frame keeps its image, transparency key and sound together. The first frame of a new animation supplies the canvas size and initial key. An existing animation keeps its canvas unless the author explicitly edits it.

The tile wizard stages one or more 4×4 compositions using the shared tileset browser. Each composition becomes a named `.tbm`; authors can reuse a composition as a template for another frame. The preview and names remain staged until confirmation. Confirmation validates every destination, including case-insensitive aliases and file-versus-directory collisions. Output follows displayed frame order, with the `.anm` written last so it never names files that have not yet been attempted.

## Persistent checkpoint groups

Before the first target write, the shared provider records all previous contents and explicitly records absent destinations. It stores whole byte contents deduplicated by SHA-256 under the reserved project-root `.tkr-history/` folder, together with a versioned group manifest identifying the project-relative paths, intended contents, reason, time and group identity. The stored data must be sufficient to recover after closing and reopening the project. Missing or corrupt manifests or content stop the affected recovery operation before destructive writes. A history write failure stops the wizard before any target is written.

A failed target write stops the commit. The editor lists each written, failed, skipped or pending file, retains the staged remaining contents, and offers **Retry remaining** and **Leave as is**. Failure may have left partial bytes; it never proves durable success merely because a read returns the attempted contents. Retrying must detect intervening changes and obtain fresh consent rather than overwrite them silently. Closing the view does not destroy the persistent group or recovery information.

**Restore group** is one action with a separate result for every file: restored, already as wanted or failed. It reinstates the original bytes and removes only files recorded as created by that operation. Before restoring, it records a new `before-restore` group, including any file it will remove, so restoring the restore can reinstate those files. Every restore remains retryable and no cross-file atomic rollback is promised.

Recovery must coordinate with authoritative open documents. Existing content is restored through accepted edits and the normal save lifecycle, preserving unsaved work and conflicts. A file that cannot safely be replaced or removed while open is refused with instructions to resolve or close that document; recovery must never write underneath an unsaved document or redirect a deletion after a project switch.

Group manifests and their referenced contents remain until the author explicitly deletes the group. This scoped provider does not select an autosave merge window, retention floor, capacity cap or thinning policy. The editor offers to ignore its history folder without silently changing ignore files. Distribution export excludes all history manifests and contents.

## References

- [Animation layout](formats/animation.md#layout).
- [Tile bitmap layout](formats/tiles.md#tile-bitmap-tbm).
- [Reserved history directory](formats/packaging-and-paths.md#distribution-package-this-projects-own).
- [Shared authoring contracts](../adr/0022-shared-editor-authoring-contracts.md), D2, D3, D4 and D12.
- Stories #1718 and #1828. General saved-version history, timelines and autosave retention remain separate work under #1828.
