# QRNG lottery source packet

`fixtures/upstream/` contains byte-for-byte copies of selected public files from
`beejsbj/qrng-lottery` at commit
`e45ab2f08cc1b52ab1a1c8641bb9f0e8ced27040`. They are references, not runtime
dependencies. `source-provenance.json` records every copied path, Git blob SHA,
and SHA-256 digest.

The upstream application is a React/Wagmi/RainbowKit project. Its components
also import Zustand, Howler, local images/cursors, a font, and a live-contract
store. Those imports and binary assets are intentionally not mounted as runnable
dependencies: static-web-v1 has no React build step, wallet, network, or
contract deployment. The provided `src/` fixture modules are an explicit,
plain-browser adaptation of the upstream board, ticket counter, wallet approval
panel, receipt language, and red/black/yellow paper-slip visual grammar. They
must be copied into the published result and imported by the styleguide. The
vendored star SVG is supplied as an authentic optional decorative asset; the
upstream paper JPG and custom font are omitted, so a result must not refer to
them unless it supplies its own published replacement.

All interactions are local and deterministic. No fixture requires a runtime
upstream fetch.
