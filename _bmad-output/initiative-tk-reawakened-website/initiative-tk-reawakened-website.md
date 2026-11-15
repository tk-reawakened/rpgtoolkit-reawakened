---
type: initiative
title: "TK Reawakened Website"
parent: none
covers: ["CAP-19"]
risk: medium
---

# TK Reawakened Website

Publish the official home for TK Reawakened. Visitors can get the software and find documentation that matches their release. The community goal is to help creators and players discover projects, share progress and give feedback.

## Delivery

- [Epic 17](epic-documentation-website/epic-documentation-website.md) opens the initiative with the website platform and owns CAP-19, including versioned product and contributor docs. Its [GitHub issue](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1362) tracks that work.
- The [draft website brief](brief-tk-reawakened-website/brief-tk-reawakened-website.md) proposes the navigation and a first community participation flow. The showcase, prompts and feedback operations need scope and owners before inception.

## Repository and release handoff

The owner expects the website to live in a dedicated repository. This initiative lives in the product repository while the destination is chosen. At that point, move its entire folder, including Epic 17, its discovery notes, and the brief. Configure BMAD and the GitHub Project mirror in the destination, and update the product CAP-19 ownership link. Reconcile the existing Epic 17 issue and Project 3 entry with the new repository so they continue to point at one epic.

The product repository is the source of released builds and the normative specification. The website directs visitors to official builds and publishes public docs. Decide how the two repositories exchange release metadata and verification inputs, and where the guide source lives, before choosing the publication workflow.

The owner has chosen `tk-reawakened.com` as the site domain. The host is open. See the [hosting comparison](epic-documentation-website/discovery/hosting-options.md).


## Web implementation guidance

Use [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) for website implementation and review regardless of host, framework or forum choice. When the website repository is set up, carry this instruction into its agent guidance and make the [published skills](https://github.com/GoogleChrome/modern-web-guidance) available to the agents working there. The [source repository](https://github.com/GoogleChrome/modern-web-guidance-src) is the upstream authoring and evaluation reference.
