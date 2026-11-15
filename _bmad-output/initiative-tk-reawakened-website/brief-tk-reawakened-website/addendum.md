# Website design and funding proposals

The owner supplied Gemini’s homepage mockup, layout notes, funding proposals and Cloudflare recommendation for review. The directions below are candidates for the website brief.

## 16-bit workshop

Keep the direct, compact layout of the original community sites and use the mockup’s deep blue RPG window frames, warm text and restrained gold. A proposed starting palette is obsidian `#12151C`, parchment `#EAE6DF`, blue panels and amber for the primary action. A clear modern sans such as Inter can carry navigation, docs and discussion text. IBM Plex Mono is a candidate for RPGCode and version labels. Use thin bevels and pixel icons at section boundaries, with accessible contrast and visible keyboard focus.

Test **Play · Create · The Vault · Docs · Community** in the header. Use a direct Download action on the home page and a prominent download link under Create. Keep Docs top-level. The first screen introduces the product and offers a build, a link to the first guide, or a featured game when available. The guide itself lives under Create or Docs. Keep the split compact. Use a project-owned scene or a creator-approved screenshot for the preview and give visitors an explicit play control. Resolve the red-wrapped sword source, permission and credit before using it in the brand. Confirm the public credit line with the owner before publishing it.

Below the main actions, show a responsive shelf of preserved games, recent releases and works in progress, with an obvious path to contribute a game. Pair it with public forum threads that are actually active and recent additions to a curated Vault. Work in Progress is a category in Games. Each project in it links to its own Community topic, where people can follow the work and give feedback. The topic links back to the project. Consider keeping the same page and topic as a project moves from work in progress to release. On mobile, stack the showcase, boards and Vault after the download and guide links. Show the live discussion or refresh its metadata when feasible, with direct links available regardless of the feed’s status. See [forum integration](../epic-documentation-website/discovery/hosting-options.md#forum-integration).

The Vault helps creators find usable, credited tiles, audio and scripts with version and licence information. The preservation archive keeps historical records and their context. Link to the existing public archive and feature approved items from it. Proposed badges for alumni and first-time creators can give people a way to introduce themselves in the forum.

Treat the named mockup entries as examples. Publish a Final Destiny play link only after permission and browser playback are verified. Open the Web Editor points to a shipped editor. Describe supported imports in the actual dropzone. The legacy `.gam` describes a project and may reference separate assets, so verify the package or folder that the runner can open before writing the label. Offer a keyboard-accessible browse action alongside drag and drop. Shareable hosted links, upload intake and account controls depend on their own service scope. [Main game file](../../../docs/spec/formats/main-file.md)

## Funding the project

Proposed public promise. The open-source engine, editor, exports, core assets, complete docs, public archive and public game playback are free. People can share their work without a subscription, including through links to builds they host themselves. Explain funding as **open-source tools with optional hosted services and patronage**.

| Proposal | Recommendation |
| --- | --- |
| Support the project | A simple Support page or footer link can show actual operating costs and what contributions fund. GitHub Sponsors and Open Collective are candidates. Consider opt-in cosmetic recognition. Include the voluntary one-time backer idea in the discussion. |
| Support the creator | Let a creator opt in to a link from their game or Vault page to their own support page. TK Reawakened can offer this without taking a platform fee or handling payouts. |
| Cloud Workshop | Consider cloud sync, backups, version history, team access and managed publishing as hosted services. Larger quotas, vanity addresses and embeds are ideas for a service pilot. Keep local saves and documented exports available. |
| Optional creator packs | Consider original or properly licensed soundfont expansions, templates and tilesets as standalone products. Maintain a free base for making games and keep community Vault contributions free. Verify redistribution rights and the shipped base bank before promising named packs. |

The reference proposals suggest a Cloud plan around $5–$8 a month, a $15/month or $150/year Patron option, a $75 one-time backer and $10–$15 packs. They also propose three free game slots at 100 MB per build and larger paid build limits. Use these as inputs for comparison. Measure demand and model storage, operations, support and moderation before quoting plans. A per-build ceiling still needs a total account budget and a policy for old builds and backups.

Preserve the intent of the downgrade promise. Keep exports available and let cancellation occur without automatic deletion of a public build. Define what happens to over-quota content, its URL, its updates and private sync data. Test a portable export and a restore, and choose a funded retention or migration window before promising how long links stay live. Maintain a recoverable copy of the public archive apart from the live site.

If paid services proceed, checkout and entitlements need a service owner. Ordinary Stripe Checkout can host the payment page. Stripe Managed Payments and Lemon Squeezy offer merchant-of-record handling for eligible transactions. Compare the actual obligations, coverage and costs at that point. [Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments) · [Lemon Squeezy tax handling](https://docs.lemonsqueezy.com/help/payments/sales-tax-vat)
