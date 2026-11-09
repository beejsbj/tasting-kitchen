// Build a toolchain image labelled with the toolchain hash it was built from.
// Kitchen refuses to check, equip or smoke with an image whose label differs.
// usage: node scripts/build-toolchain.mjs <toolchain-id>
import { spawnSync } from "node:child_process";
import path from "node:path";

import { loadToolchains, resolveToolchain, TOOLCHAIN_LABEL } from "../lib/taste/toolchains.mjs";

const root = path.resolve(import.meta.dirname, "..");
const id = process.argv[2];
if (!id) {
  console.error("usage: node scripts/build-toolchain.mjs <toolchain-id>");
  process.exit(2);
}
const toolchain = resolveToolchain(await loadToolchains(root), id);
const argv = ["build", "--progress=plain", "-f", toolchain.dockerfile, "--label", `${TOOLCHAIN_LABEL}=${toolchain.toolchainHash}`, "-t", toolchain.image, "."];
console.error(`docker ${argv.join(" ")}`);
const result = spawnSync(process.env.TASTE_DOCKER || "docker", argv, { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
