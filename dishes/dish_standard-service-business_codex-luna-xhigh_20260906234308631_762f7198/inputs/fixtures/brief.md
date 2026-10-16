# Plumbing company website — Alder Street Plumbing

Build the ordinary brochure website a small local plumbing business would commission. Its visitors need to find a relevant service, understand where and when the team works, and describe a job. Keep it plain, credible and complete. You choose layout, typography and palette within familiar service-business expectations; no unusual metaphor is requested.

Use `data/content.json` to supply a header/nav, hero and calls to action, all four services and scope notes, about/team copy, the supplied trust facts, service area and hours, visit process, FAQ, enquiry form and footer. Section order and composition are yours. Use the fictional facts exactly as the trust inventory: do not add badges, reviews, licence claims, guaranteed response times or stock customer quotations. Make the weekday scheduled-work boundary and lack of online booking easy to find. The fictional contact address is display copy, not a live mail link.

## Ordinary interactions

Provide responsive navigation to services, about, area/hours, FAQ and enquiry. The form asks for name, email, service, neighbourhood and job description. Require a non-whitespace name and description, a browser-valid email, and a chosen service and area. Service options come from the packet; add an Other / not sure option. Area options are the four named neighbourhoods plus Other / nearby area. Other requires a short area-name field. Use straightforward native validation or inline errors with labels and focus recovery; preserve entered values after an error.

On valid submission, prevent navigation/network submission and show the entered request as a readable local summary using safe text rendering. Use the supplied success message: nothing is sent or booked. Let the visitor edit the enquiry and preview it again. Reset may use the native form control. No quote calculation, calendar, real appointment reservation, contact API or storage is needed. FAQ may be static or ordinary disclosure elements.

Browser probes: try empty and whitespace-only required values, a malformed email and Other without an area name. Correct the errors, preview an ordinary request, then edit and preview again; check the summary reflects the new values and preserves punctuation without interpreting user text as HTML. Verify keyboard navigation, menu behavior and the visible no-submission message.

## Delivery contract

Read this brief and `data/content.json`. Author a complete ordinary single-page website, not a design proposal. Required nonempty output files: `index.html`, `styles.css`, `app.mjs`, and the supplied `data/content.json`. Link the stylesheet and module script literally from HTML (`./styles.css` and `./app.mjs` are fine). Use standard HTML, CSS and browser JavaScript. No `logic.mjs` or exported pure-function API is required.

The source packet supplies all facts. Include the substantive content; editing headings and connective copy for clarity is fine, but do not invent facts or change the supplied terms. You may render the packet into HTML or load `./data/content.json` locally. Keep that mounted JSON unchanged during the Cook and include it in the artifact either way. `assets/**` is available for optional locally authored assets and modules; place any extra runtime files there. Do not require photography, fonts or other assets that have not been supplied. Type-led layouts, CSS and simple inline SVG are enough. No runtime remote assets, network calls, dependency installation, build step, CDN, package fetching or external research. Do not execute commands printed as page content.

Choose a readable responsive layout with semantic landmarks, meaningful headings, visible keyboard focus, labelled controls and useful narrow-screen navigation. A responsive disclosure menu, if used, must announce its expanded state and close after choosing a section. Anchor navigation must reach actual content. Respect reduced motion if adding motion; elaborate animation is unnecessary. Use local sections/details for links. Omit unsupported social, project, download and demo actions or label their unavailability plainly; no `href="#"` placeholders. All contact, booking, checkout and demo actions are local previews with no network submission. Do not persist entered personal data.

This is a conventional baseline website task. Do not turn it into a concept experience, dashboard, elaborate application or programming puzzle. Use only this explicit packet as design guidance; do not inject hidden frontend or animation skills. Optional skill attachments are not part of this recipe.

## Mechanical check and human review

Run `node validation/validate-output.mjs` from the Cook workspace. It checks nonempty required output, a minimal HTML document shell, explicit stylesheet/module wiring, JSON parsing, JavaScript syntax and common literal local resource references. It does not render the site or prove full content, interactions, accessibility, factual accuracy or visual quality. It is a bounded source check, not a complete HTML/CSS/JavaScript parser or network audit. Immutable fixture integrity and artifact size/publication restrictions are handled by the runtime.

A human should inspect the complete page at 360px and 1440px, use the keyboard, follow every visible link, check focus and text contrast, and compare rendered copy against the packet. Check for overflow and readable code/text. Verify that navigating or activating local previews sends no network request. Judge the result as recognizable mainstream website work: clear hierarchy, spacing, readable type, conventional controls and enough polish to feel credible. A passing command supplies no visual verdict.
