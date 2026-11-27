---
id: 51
type: bug
title: "Visual fixture cards JSON-escape literal RPGCode path separators"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#3622"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/3622"
refined: true
hitl: false
risk: medium
severity: P1
---

# Visual fixture cards JSON-escape literal RPGCode path separators

Found in #3534 at `1cc30516a8`: JSON parsing hides a fixture with a single literal backslash, and JSON output writes a double separator. See [LEX-8](../../docs/spec/engine/rpgcode-language.md#lexical-rules) and the TOOL-12 source contract.

## Acceptance

- A single literal backslash projects and saves as a single backslash, including in nested values. The text parses and runs as TOOL-5 code.
- Keep opaque source, line endings and authored field values; do not generate strings that RPGCode cannot represent.
