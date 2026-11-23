// Answer-key check: README.md ends with one line `Unseen: <one line>` naming
// what happened off screen. Only the line's shape is checked; whether the film
// lets a viewer infer it is tasting, done before reading this line.
// Run from the delivery root: node validation/unseen.mjs
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function unseenLine(readme) {
  const lines = readme.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  const match = /^Unseen:[ \t]+(\S.*)$/u.exec(last);
  if (!match) return { passed: false, reason: `README.md must end with a line "Unseen: <one line>"; its last line is "${last.slice(0, 80)}"` };
  if (lines.filter((line) => /^Unseen:/u.test(line)).length > 1) return { passed: false, reason: "README.md has more than one Unseen: line" };
  return { passed: true, unseen: match[1] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = unseenLine(readFileSync("README.md", "utf8"));
  if (!result.passed) {
    console.error(`FAIL: ${result.reason}`);
    process.exit(1);
  }
  console.log("PASS: README.md ends with its Unseen: line. Whether the film lets a viewer infer it is for tasting; watch before reading it.");
}
