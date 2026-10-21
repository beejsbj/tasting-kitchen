# Conduit source snapshot

upstream/ contains byte-for-byte source files fetched from beejsbj/conduit-market-client at portfolio/showcase-2025 commit 6c3de0c9b493b5b00e231e08c4d95a753183d268. provenance.json gives each Git blob ID and SHA-256 digest.

The useful material is deliberately bounded: the real StyleGuide page establishes the page's tabbed composition; theme.css and typography.css establish token roles and voices; Button, Tabs, Badge and PageSection show primitive boundaries; ColorGuide and ButtonGuide show how those primitives were documented. The snapshot omits the rest of the application, including other StyleGuide guides, Card primitives, cn, Icon, React, Wouter, auto-animate, Tailwind compilation, assets and app configuration.

It therefore cannot be built or executed as copied. Under static-web-v1, port the provided roles into plain CSS and browser ES modules in src/, then have styleguide.js import those modules. To run the original TSX instead, restore the omitted dependency graph in a React/Vite checkout and use the upstream project's dependency tooling; that is outside this recipe's runtime boundary.
