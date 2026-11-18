# Shared project organization and friendly names

Status: first-pass owner direction; identity, storage and interaction details require design and verification before implementation.

Creators can organize assets in the Game drawer using optional groups within each asset category. Each asset has at most one group in its category; ungrouped assets remain directly under the category. This organization does not move files. Group nesting and the result of deleting a group are not yet decided.

A project can carry optional, shared editor metadata with a **friendly name** and a short description for an asset, including a program. The same idea applies to individual board placements, regions and interactions. A name for a board interaction describes that interaction, not necessarily the program it references. Existing game data remains authoritative for behavior and references; editor annotations must not become competing copies of those references. Changing a friendly name does not rename a file or change game behavior.

Descriptions are discoverable on hover or keyboard focus on a name. Provide equivalent screen-reader and touch access and a place to edit them. Contextual actions distinguish editing a friendly name from renaming a file; file rename must not silently break references. Show underlying filenames when useful. The program editor itself remains governed by its real host and language contracts; the interactive mockup is not its implementation specification.

A project without metadata still opens and runs. Names fall back to existing asset information or filenames, with exact precedence to be established. Metadata belongs to the shared project, not one user's preferences. Investigate existing metadata before choosing whether a new YAML file is needed. Define how metadata survives supported moves and renames, what happens on deletion or external changes, and how individual board objects are identified without accidentally reassigning annotations. Failure and ambiguous identity must not silently attach metadata to the wrong object.

Cross-category labels are permitted as a possible future secondary view, not committed work. Long-form design thoughts belong in a separate space if one is created; descriptions here are short explanations. The [connected editor mockup](connected-editor/README.md) illustrates the workspace and connections, not a completed implementation.
