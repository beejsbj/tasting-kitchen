# Standard web recipes

[Standard Web](../catalog/menus/standard-web.json) selects exactly three new recipes for ordinary website work. All are textbook, `ready`, version `1.0.0`, single-prompt web recipes using `static-web-v1` with a null semantic runtime. Ready describes supported mechanics; these definitions have no authored website or accepted Dish from this pass.

| Recipe | Original fictional subject and supplied content | Ordinary interaction scope |
| --- | --- | --- |
| [Plumbing company website](../catalog/recipes/ui-visual/standard-service-business/recipe.json) (`standard-service-business`) | Alder Street Plumbing: four service descriptions and boundaries, four neighbourhoods, weekday hours, team/about copy, four trust facts, visit process, five FAQ answers and enquiry copy. No credentials, testimonials, prices or emergency service are invented. | Responsive section navigation; required name/email/service/area/description fields, Other-area validation, local request summary and edit/re-preview. No booking or submission. |
| [Developer portfolio](../catalog/recipes/ui-visual/standard-developer-portfolio/recipe.json) (`standard-developer-portfolio`) | Maya Chen: biography, availability, grouped skills, two jobs, education and three complete case studies with problem, approach, result and learning. Project descriptions are content, not additional implementation tasks. | Section navigation, All/Websites/Product UI filtering with 3/2/1 results, reachable local project details and contact copy. No fake social, demo, repository or CV-download links. |
| [Developer-tool homepage](../catalog/recipes/ui-visual/standard-developer-homepage/recipe.json) (`standard-developer-homepage`) | Patchlane: product copy, six features, three workflow steps, example installation/run commands, configuration and failure-output specimens, three monthly USD plans and six FAQ answers. The package and service are explicitly fictional. | Exact command copying with honest success/rejection/unavailable states and manual fallback; conventional FAQ disclosures; local plan previews. No execution, signup or checkout. |

The first two leave layout, type and palette open within mainstream expectations. The third deliberately asks for the familiar Tailwind UI idiom: neutral surfaces, a restrained accent, sans-serif type, standard nav/hero/buttons, feature cards, code, pricing and FAQ. This is a visual condition; it does not require Tailwind, a CDN or a compiler. No novel metaphor, elaborate application, hidden frontend/animation skill or bespoke logic API is requested.

Each recipe directory contains `recipe.json`, `fixtures/brief.md`, `fixtures/content.json`, `validation/validate-output.mjs` and `validator.test.mjs`. The brief, content and validator are public text fixtures, readable and editable through Recipe Book authoring. Their `editable: false` flag means they remain immutable **during a Cook**; it does not remove them from the authoring surface.

The Cook creates `index.html`, `styles.css` and `app.mjs`. The supplied content mounts at `data/content.json`; that runtime input is explicitly included in the output even if its copy is rendered directly into HTML. Optional extra runtime files belong under the declared `assets/**` include. The brief and immutable mounted validator are excluded from the published artifact. No photography, remote fonts/assets, package installation, network calls or build dependencies are required. All reserved fictional contact addresses are display copy, and all actions are local previews.

## Mechanical checks and their limits

Each self-contained validator uses Node built-ins. It checks required nonempty files, a minimal HTML shell/title/main landmark, explicit stylesheet and module references, content JSON parsing, JavaScript syntax in declared output, and common literal HTML resource attributes and CSS `url()` paths. It rejects missing/unpublished local resources and obvious nonlocal resource URLs in those inspected forms. The runtime separately enforces immutable fixture bytes and artifact publication limits.

These are deliberately modest source checks. They do not fully parse HTML/CSS/JavaScript, inspect every import, `srcset`, inline script, computed URL or network path, execute DOM events, verify complete rendered content, or establish accessibility or visual quality. A syntactically valid but poorly rendered or disconnected page can pass. There is no pure-function API or interaction test matrix imposed on a simple page.

The self-tests run the actual mounted command against temporary structural doubles, then remove them. Negative cases cover absent output, whitespace-only output, malformed JSON, invalid JavaScript, a missing main landmark, disconnected module wiring, a remote script and a missing CSS asset. A separate assertion checks public immutable inputs and the runtime-input/validator publication boundary. These doubles are not finished recipe answers.

Each brief and recipe names human browser/taste probes at 360px and 1440px: complete supplied content, conventional hierarchy, readable text, focus, keyboard use, all links, narrow-screen overflow and no network submission. The specific probes cover enquiry correction and re-preview; category changes and case-study reachability; clipboard success and denied/unavailable fallback, FAQ disclosure and all plan previews. No browser/taste verdict has been claimed for an uncooked page.

## Inspect and dry-plan

Run from the repository root; these commands do not execute models:

```sh
node bin/taste.mjs inspect --recipe standard-service-business --json
node bin/taste.mjs inspect --recipe standard-developer-portfolio --json
node bin/taste.mjs inspect --recipe standard-developer-homepage --json
node bin/taste.mjs inspect --menu standard-web --json
node bin/taste.mjs plan --menu standard-web --config codex-sol-high --json
npm run validate:catalog
node --test catalog/recipes/ui-visual/standard-*/validator.test.mjs
./node_modules/.bin/eslint catalog/recipes/ui-visual/standard-service-business catalog/recipes/ui-visual/standard-developer-portfolio catalog/recipes/ui-visual/standard-developer-homepage
```

Authoring verification: catalog validation, all 30 validator self-tests and scoped ESLint pass. The menu dry-plan supports exactly the three intended IDs on `codex-sol-high`. No Cook, dependency installation, accepted Dish, frozen revision, commit or deployment was performed.

All public subject matter and copy are original fictional content. The [ATCL reference](https://atclarabia.com/) informed only the familiar company-brochure archetype; its copy, claims, branding, assets and exact composition were not adapted. Existing repository files were consulted for schema/runtime and validation patterns only. Ignored provenance records were added only for these three identities. Integration, aggregate documentation changes and broader test wiring remain outside this authoring pass.
