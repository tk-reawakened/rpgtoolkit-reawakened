---
id: 5
type: bug
title: "Web editor frame-ancestors CSP is ignored in meta-delivered policy"
parent: none
covers: []
after: []
assignee: ""
tracker_id: "#2184"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2184"
refined: true
hitl: false
risk: medium
severity: P2
---

# Web editor frame-ancestors CSP is ignored in meta-delivered policy

## Description

`tools/browser/editor-web/index.html` delivers `frame-ancestors 'none'` in a `<meta http-equiv="Content-Security-Policy">`. Chromium 156 logs: "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element." The embedding restriction therefore is not enforced by this directive.

## Reproduction

Load the page from `tools/browser/editor-web/index.html` in Chromium and read the console. The warning appeared in the Epic 11 dock/Monaco browser and Electron spikes at base `0872e406`.

## Acceptance Criteria

1. **The framing restriction is enforced where supported**
   **Given** the applicable deployments of the web editor
   **When** the page is served
   **Then** the intended framing restriction is delivered through a supported response-header mechanism, or the supported deployment boundary is explicitly documented and tested
2. **A cross-origin frame is shown to be refused**
   **Given** the web editor page
   **When** a browser proof embeds it in a cross-origin frame
   **Then** the frame is refused, and the proof does not rely only on checking the policy string
3. **Other CSP directives are preserved**
   **Given** the existing policy
   **When** the change lands
   **Then** every other directive is unchanged

## References

- code — `tools/browser/editor-web/index.html`
- issue — [#2184](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2184)

## Notes

- Ticket created from the issue text only. Criterion 1 is an either/or in the issue, so choosing between the header and the documented boundary is a design decision for the build; it may need an ADR.
