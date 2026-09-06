# Developer portfolio — Maya Chen

Build a typical frontend developer portfolio suitable for someone reviewing a job application or a small project enquiry. Let the work, skills and experience read clearly. You choose the layout, type and palette within mainstream portfolio expectations. This is not an interactive résumé game or an expressive concept site.

Use `data/content.json` for a header/nav, introductory hero with availability, selected projects, about, grouped skills, experience, education, contact and footer. Include all three projects with their supplied summary, role, year and stack. Make the full problem/approach/result/learning content available in local detail sections or accessible disclosures. These case studies are written content, not requests to rebuild their projects. Represent the two jobs and the education fact without embellishment. Do not invent impact metrics, endorsements, a headshot or additional employment. Contact is a plainly displayed reserved fictional email address with the supplied preview note.

## Ordinary interactions

Provide project, about, experience and contact navigation, plus a useful project category filter: All, Websites and Product UI. Start on All (three projects); Websites shows two and Product UI shows one. Announce the active category and result count accessibly, maintain keyboard focus on the filter control and provide a route back to All. Filter the project listing; full case-study anchors must stay reachable (keep detail sections outside the filtered listing, or reveal the target when needed). Do not fetch anything. No sorting engine, search API or custom state export is requested.

Project links must reach the supplied local detail content. No real demos, repositories, social profiles or CV download exist in this packet. Omit those links or state unavailable; never fabricate destinations. No contact form is required. Any added contact action must be a clearly labelled local preview.

Browser probes: activate each category using pointer and keyboard, check counts of 3/2/1, restore All and follow all three local project details. Ensure the case-study content stays readable and reachable after filtering. Follow experience/contact navigation, check that unsupported links are absent or honestly unavailable, and review the first screen as a conventional hiring portfolio.

## Delivery contract

Read this brief and `data/content.json`. Author a complete ordinary single-page website, not a design proposal. Required nonempty output files: `index.html`, `styles.css`, `app.mjs`, and the supplied `data/content.json`. Link the stylesheet and module script literally from HTML (`./styles.css` and `./app.mjs` are fine). Use standard HTML, CSS and browser JavaScript. No `logic.mjs` or exported pure-function API is required.

The source packet supplies all facts. Include the substantive content; editing headings and connective copy for clarity is fine, but do not invent facts or change the supplied terms. You may render the packet into HTML or load `./data/content.json` locally. Keep that mounted JSON unchanged during the Cook and include it in the artifact either way. `assets/**` is available for optional locally authored assets and modules; place any extra runtime files there. Do not require photography, fonts or other assets that have not been supplied. Type-led layouts, CSS and simple inline SVG are enough. No runtime remote assets, network calls, dependency installation, build step, CDN, package fetching or external research. Do not execute commands printed as page content.

Choose a readable responsive layout with semantic landmarks, meaningful headings, visible keyboard focus, labelled controls and useful narrow-screen navigation. A responsive disclosure menu, if used, must announce its expanded state and close after choosing a section. Anchor navigation must reach actual content. Respect reduced motion if adding motion; elaborate animation is unnecessary. Use local sections/details for links. Omit unsupported social, project, download and demo actions or label their unavailability plainly; no `href="#"` placeholders. All contact, booking, checkout and demo actions are local previews with no network submission. Do not persist entered personal data.

This is a conventional baseline website task. Do not turn it into a concept experience, dashboard, elaborate application or programming puzzle. Use only this explicit packet as design guidance; do not inject hidden frontend or animation skills. Optional skill attachments are not part of this recipe.

## Mechanical check and human review

Run `node validation/validate-output.mjs` from the Cook workspace. It checks nonempty required output, a minimal HTML document shell, explicit stylesheet/module wiring, JSON parsing, JavaScript syntax and common literal local resource references. It does not render the site or prove full content, interactions, accessibility, factual accuracy or visual quality. It is a bounded source check, not a complete HTML/CSS/JavaScript parser or network audit. Immutable fixture integrity and artifact size/publication restrictions are handled by the runtime.

A human should inspect the complete page at 360px and 1440px, use the keyboard, follow every visible link, check focus and text contrast, and compare rendered copy against the packet. Check for overflow and readable code/text. Verify that navigating or activating local previews sends no network request. Judge the result as recognizable mainstream website work: clear hierarchy, spacing, readable type, conventional controls and enough polish to feel credible. A passing command supplies no visual verdict.
