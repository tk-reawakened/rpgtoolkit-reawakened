---
id: 1
type: spike
title: "Compare low-cost website hosting and publishing"
parent: epic-documentation-website
tracker_id: "#2709"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/2709"
covers: ["CAP-19"]
after: []
hitl: true
risk: medium
---

# Compare low-cost website hosting and publishing

## Description

Which setup can serve TK Reawakened's website at very low initial cost and handle a burst of visits or downloads? Compare hosts before the production site and publishing workflow are planned. The owner chooses the host after reviewing the research.

## Approach

1. Compare GitHub Pages, Cloudflare Pages and Workers Static Assets, Netlify, and AWS Amplify. Use dated official plan limits and check build and traffic quotas, hard caps or overages, and what visitors see when a limit is reached.
2. Model a quiet launch, sustained growth and a short download spike. Show monthly cost and the first paid or service-limiting breakpoint. Account for the site, externally hosted builds and packs or object storage, and the forum as distinct costs. State which figures are measured and which are estimates.
3. Use the same small static site and one original game example across the top two candidates. Include versioned docs and search, a work-in-progress entry with screenshots and a browser play link, and a Vault entry. Add or update a catalogue record through a reviewed pull request, publish the static build and try a rollback. Use preview addresses and available free allowances for the trial.
4. Check the work to connect `tk-reawakened.com`, retain its Porkbun mail forwarding, link to a separate forum and move the static site to another host. Apply Modern Web Guidance in the prototype. Record any access or account prerequisite that prevents a live check.

## Acceptance criteria

- [ ] A comparison records each provider's dated pricing source, workload assumptions, baseline and spike costs, and the first cost or availability limit. Forum and downloads are accounted for even when a separate service supplies them.
- [ ] Two candidate trials use the same fixture and record build, review, deploy and rollback results. The report shows functional versioned docs and search, browser play from the published catalogue, and an accessible Vault entry. Any check that could only be evaluated from documentation is labelled as such.
- [ ] The report recommends a low-cost launch setup with a fallback, monthly operating costs, what would trigger a move or upgrade, and what remains open. Put it in Epic 17's discovery folder and link it from the hosting decision. The production host is a separate owner decision.

## References

- [Epic 17 and CAP-19](https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/1362)
- [Website initiative and hosting comparisons](https://github.com/tk-reawakened/rpgtoolkit-reawakened/pull/2706)
- [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance)

## Notes

- Open question. What recurring costs are acceptable once the initial site exceeds a free allowance?
- Risk rationale. A host chosen without comparing quotas and operating work can make the site costly or unavailable as the community grows.
