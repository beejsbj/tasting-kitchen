import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeConfigHash, computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { classifyFailure } from "../lib/taste/faults.mjs";
import { assertPublicTextSafe, chefTextFindings, pathExists, publicTextFindings, publicTraceFindings, RANKING_LANGUAGE, scanPublicTree } from "../lib/taste/files.mjs";
import { loadNoDishes, publishNoDish } from "../lib/taste/no-dishes.mjs";
import { finalizeAttempt, sanitizePublicResponse } from "../lib/taste/publication.mjs";
import { PLATE_SCAN } from "../lib/taste/receipts.mjs";
import { loadDishes } from "../lib/taste/registry.mjs";
import { createVerdict, validateVerdict } from "../lib/taste/verdicts.mjs";

// The ranking-language rule keeps Kitchen's and its owner's own text from ranking
// models. What the model wrote (its response, the files it delivered) may say
// "score"; every leak rule still applies to it.

const SCORE = "I evaluated the score from the page and kept the scoring for strings.";
/** Text that must never publish, whoever wrote it, with the reason it trips. */
const LEAKS = [
  ["The key is sk-proj1234567890abcdefghij.", "credential-like token"],
  ["The key is ghp_abcdefghijklmnopqrstuvwxyz0123.", "credential-like token"],
  ["Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop", "JWT-like credential"],
  ["access_token = abc", "authentication-token field"],
  ["I read /home/someone/notes.md first.", "absolute home path"],
  ["I read /Users/someone first.", "absolute home path"],
  ["See /etc/passwd.", "absolute path"],
  ["Open file:///tmp/x.", "file URL"],
  ["Saved to ~/secret.txt.", "home path form"],
  ["Read ../private/result.txt.", "path traversal"],
  ["Kept in attempts/private/result.txt.", "private directory reference"],
  ["session_id = abcdef123456", "private evidence identifier"],
  ["This follows CJ123.", "private evidence identifier"],
];

test("the model's own text may use ranking words; every leak rule still applies to it", () => {
  assert.deepEqual(publicTextFindings(SCORE), [RANKING_LANGUAGE]);
  assert.deepEqual(chefTextFindings(SCORE), []);
  assert.equal(assertPublicTextSafe(SCORE, "assistant response", { chefAuthored: true }), SCORE);
  assert.throws(() => assertPublicTextSafe(SCORE, "dish note"), /dish note \(numerical ranking language\)/);
  for (const word of ["leaderboard", "ratings", "ranking", "scoring", "scores"]) {
    assert.deepEqual(chefTextFindings(`The ${word} here.`), [], word);
    assert.deepEqual(publicTextFindings(`The ${word} here.`), [RANKING_LANGUAGE], word);
  }
  for (const [text, reason] of LEAKS) {
    assert.ok(publicTextFindings(text).includes(reason), `${reason}: ${text}`);
    // Dropping the one reason changes nothing else: same findings, with or without a ranking word beside the leak.
    assert.deepEqual(chefTextFindings(text), publicTextFindings(text), text);
    assert.deepEqual(chefTextFindings(`${SCORE} ${text}`), publicTextFindings(text), text);
    assert.throws(() => assertPublicTextSafe(`${SCORE} ${text}`, "assistant response", { chefAuthored: true }), /Public artifact scan failed/, text);
  }
});

test("an assistant response that says score is public-safe; one with a credential or a private path is not", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-chef-response-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const options = { workspace, selectedFiles: ["index.html"] };
  assert.equal(sanitizePublicResponse(SCORE, options), SCORE);
  assert.equal(sanitizePublicResponse(`${SCORE} See ${path.join(workspace, "index.html")}.`, options), `${SCORE} See artifact/index.html.`);
  for (const [text, reason] of LEAKS) {
    assert.throws(() => sanitizePublicResponse(`${SCORE} ${text}`, options), new RegExp(`assistant response \\(${reason}\\)`, "u"), text);
  }
  // An unselected workspace file is still a private path, ranking words or not.
  assert.throws(() => sanitizePublicResponse(`${SCORE} See ${path.join(workspace, "draft.md")}.`, options), /Public artifact scan failed/);
});

test("in a public trace only the model's response may use ranking words; prompts and everything else may not", () => {
  const trace = (turn, extra = {}) => JSON.stringify({ schemaVersion: 1, recipeId: "demo", ...extra, turns: [{ id: "opening", role: "prompt", prompt: "Write a theme.", response: "Done.", usage: null, actions: [], ...turn }] });
  assert.deepEqual(publicTraceFindings(trace({})), []);
  assert.deepEqual(publicTraceFindings(trace({ response: SCORE })), []);
  assert.deepEqual(publicTraceFindings(trace({ prompt: "Give the piece a score out of ten." })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ prompt: "Give the piece a score out of ten.", response: SCORE })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ id: "scoring" })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ actions: [{ event: "item.completed", type: "file_change", path: "score.md" }] })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({}, { note: "Kitchen's rating" })), [RANKING_LANGUAGE]);
  // Only a text `response` is the model's; an object in its place is scanned whole.
  assert.deepEqual(publicTraceFindings(trace({ response: { note: "a score" } })), [RANKING_LANGUAGE]);
  for (const [text, reason] of LEAKS) {
    assert.ok(publicTraceFindings(trace({ response: `${SCORE} ${text}` })).includes(reason), `response: ${text}`);
    assert.equal(publicTraceFindings(trace({ response: `${SCORE} ${text}` })).includes(RANKING_LANGUAGE), false, text);
    assert.ok(publicTraceFindings(trace({ prompt: text })).includes(reason), `prompt: ${text}`);
  }
  // A turn the model never answered has no response; the turns beside it are read as before.
  const turns = (...list) => JSON.stringify({ schemaVersion: 1, recipeId: "demo", partial: true, turns: list });
  assert.deepEqual(publicTraceFindings(turns({ id: "opening", prompt: "Write a theme.", response: SCORE }, { id: "correction", prompt: "Shorten it.", response: null })), []);
  assert.deepEqual(publicTraceFindings(turns({ id: "opening", prompt: "Write a theme.", response: SCORE }, { id: "correction", prompt: "Give it a score.", response: null })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(turns({ id: "opening", prompt: "Write a theme.", response: SCORE }, null, "a score")), [RANKING_LANGUAGE]);
  // Text that is not a trace gets every rule.
  for (const text of ["a score", JSON.stringify("a score"), JSON.stringify({ response: "a score" }), JSON.stringify({ turns: "a score" }), JSON.stringify([{ response: "a score" }])]) {
    assert.deepEqual(publicTraceFindings(text), [RANKING_LANGUAGE], text);
  }
});

test("a plate scan relaxes ranking words only for the delivered files and the trace's responses", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-plate-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, text) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  };
  await write("artifact/notes.md", `${SCORE}\n`);
  await write("artifact/src/scoring.js", "export const score = (notes) => notes.length;\n");
  await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: SCORE }] }));
  await write("dish.json", JSON.stringify({ id: "dish_demo" }));
  await write("inputs/brief.md", "Write a theme.\n");
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));
  // Without the plate's layout nothing is relaxed.
  await assert.rejects(scanPublicTree(root, { verbatim: PLATE_SCAN.verbatim }), /artifact\/notes\.md \(numerical ranking language\)/);
  await assert.doesNotReject(scanPublicTree(path.join(root, "artifact"), { chefAuthored: true }));
  await assert.rejects(scanPublicTree(path.join(root, "artifact")), /numerical ranking language/);

  // Fixtures keep the rule even when the whole tree is called the model's, and entries must be named as arrays.
  await write("inputs/brief.md", "Give it a score.\n");
  await assert.rejects(scanPublicTree(root, { verbatim: ["inputs"], chefAuthored: true }), /inputs\/brief\.md \(numerical ranking language\)/);
  await write("inputs/brief.md", "Write a theme.\n");
  await assert.rejects(scanPublicTree(root, { ...PLATE_SCAN, chefAuthored: "artifact" }), /entries as arrays/);
  await assert.rejects(scanPublicTree(root, { ...PLATE_SCAN, verbatim: "inputs" }), /entries as arrays/);

  // Kitchen's and the owner's files keep the rule: fixtures, the manifest, receipts, the validation report, a stray note.
  for (const relative of ["inputs/brief.md", "inputs/data.csv", "dish.json", "no-dish.json", "receipt.json", "inputs.json", "validation.json", "notes.md", "verdict.json", "other/notes.md"]) {
    const before = await pathExists(path.join(root, relative)) ? await readFile(path.join(root, relative), "utf8") : null;
    await write(relative, JSON.stringify({ note: "Give it a score." }));
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), new RegExp(`${relative.replaceAll(".", "\\.")} \\(numerical ranking language\\)`, "u"), relative);
    if (before === null) await rm(path.join(root, relative));
    else await write(relative, before);
  }
  await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Give it a score.", response: "Done." }] }));
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /trace\.json \(numerical ranking language\)/);
  // A file merely named like the trace, inside another folder, is not the trace.
  await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: SCORE }] }));
  await write("other/trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: SCORE }] }));
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /other\/trace\.json \(numerical ranking language\)/);
  await rm(path.join(root, "other"), { recursive: true });
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));

  // Leaks stay refused in the delivered files and in the responses.
  for (const [text, reason] of LEAKS) {
    await write("artifact/notes.md", `${SCORE}\n${text}\n`);
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), new RegExp(`artifact/notes\\.md \\(${reason}\\)`, "u"), text);
    await assert.rejects(scanPublicTree(path.join(root, "artifact"), { chefAuthored: true }), new RegExp(`notes\\.md \\(${reason}\\)`, "u"), text);
    await write("artifact/notes.md", `${SCORE}\n`);
    await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: `${SCORE} ${text}` }] }));
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), new RegExp(`trace\\.json \\(${reason}\\)`, "u"), text);
    await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: SCORE }] }));
  }
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));
});

// ---------------------------------------------------------------------------
// Through publication: a Dish and a No Dish.

const profile = { id: "codex-linux-host-unsandboxed-v1", label: "via Codex CLI · host-unsandboxed fallback", runtime: "linux-host", sandbox: "danger-full-access", approvalPolicy: "never", nativeWeb: "disabled", networkPolicy: "not-enforced", filesystemBoundary: "not-a-secrecy-boundary" };

function configuration() {
  const value = { id: "codex-demo", provider: "openai", model: "gpt-5.6-sol", harness: "codex-cli", reasoningEffort: "high", serviceTier: "default", personality: "none", capabilities: ["files", "shell"], executionProfile: { ...profile } };
  return { ...value, configHash: computeConfigHash(value) };
}

async function recipeFixture(t, { brief = "A plain brief for the theme.\n" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-publication-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recipeDir = path.join(root, "catalog/recipes/music/demo");
  await mkdir(path.join(recipeDir, "fixtures"), { recursive: true });
  await writeFile(path.join(recipeDir, "fixtures/brief.md"), brief);
  const recipe = {
    schemaVersion: 1, id: "demo-theme", version: "1.0.0", status: "ready", title: "A demo theme recipe",
    summary: "A sufficiently detailed demo for publication scan tests.", origin: "textbook",
    originNote: "A conventional publication test.", tags: ["presence"], kind: "document",
    harness: { workspace: "write", web: "disabled", capabilities: ["files"] },
    setup: { instructions: "Read the mounted brief.", fixtures: [{ id: "brief", path: "fixtures/brief.md", mountAs: "brief.md", public: true, mediaType: "text/markdown" }] },
    turns: [{ id: "opening", role: "prompt", content: "Write the theme and your notes." }],
    output: { kind: "document", entry: "notes.md", include: ["notes.md", "theme/**"], limits: { maxFiles: 8, maxBytes: 32768 } },
    validation: { mode: "completeness", checks: [{ id: "entry", type: "file-exists", required: true, description: "The notes exist.", target: "notes.md" }] },
    sourcePath: "catalog/recipes/music/demo/recipe.json",
    fixtureHashes: { brief: sha256(brief) },
    fixtureIntegrityRequired: true,
  };
  recipe.recipeHash = computeRecipeHash(recipe, recipe.fixtureHashes);
  return { root, recipe, brief, catalog: { catalogHash: `sha256:${"4".repeat(64)}`, recipes: [recipe] }, variant: configuration() };
}

async function workspaceFor(f, attemptId, files) {
  const attemptDir = path.join(f.root, "private/runtime/attempts", attemptId);
  const workspace = path.join(attemptDir, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "brief.md"), f.brief);
  for (const [relative, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(workspace, relative)), { recursive: true });
    await writeFile(path.join(workspace, relative), text);
  }
  return { attemptDir, workspace };
}

async function finalize(f, attemptId, { response = "Done.", files = { "notes.md": "The theme is in D minor.\n" } } = {}) {
  const { attemptDir, workspace } = await workspaceFor(f, attemptId, files);
  return finalizeAttempt({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, attemptId, attemptDir, workspace,
    result: { cliVersion: "codex-cli 9.9.9-fake", turns: [{ finalMessage: response }] },
    observed: { model: f.variant.model, provider: "openai", reasoningEffort: "high", serviceTier: "default", verifiedBy: "test" },
    executedAt: "2026-11-13T12:00:00.000Z", finalizedAt: new Date("2026-11-13T12:01:00.000Z"),
  });
}

test("a Dish whose reply and delivered files say score publishes, and still loads through the registry's scan", async (t) => {
  const f = await recipeFixture(t);
  const published = await finalize(f, "attempt_says_score", {
    response: SCORE,
    files: { "notes.md": `# Notes\n\n${SCORE}\n`, "theme/motif.js": "export const score = ['D4', 'F4', 'A4'];\n" },
  });
  assert.equal(published.status, "accepted");
  assert.equal(published.dishDirectory, path.join(f.root, "dishes", published.dishId));
  assert.equal(JSON.parse(await readFile(path.join(published.dishDirectory, "trace.json"), "utf8")).turns[0].response, SCORE);
  assert.match(await readFile(path.join(published.dishDirectory, "artifact/notes.md"), "utf8"), /evaluated the score/u);
  assert.deepEqual((await loadDishes(f.root)).map((dish) => dish.id), [published.dishId]);
});

test("a Dish whose reply or delivered file holds a credential or a private path does not publish", async (t) => {
  const f = await recipeFixture(t);
  const refused = async (attemptId, options, pattern) => {
    await assert.rejects(finalize(f, attemptId, options), (error) => {
      assert.equal(error.name, "FinalizationError");
      assert.equal(error.stage, "publication");
      assert.match(error.message, pattern);
      assert.equal(classifyFailure(error).code, "publication");
      return true;
    }, attemptId);
  };
  await refused("attempt_reply_token", { response: `${SCORE} The key is sk-proj1234567890abcdefghij.` }, /assistant response \(credential-like token\)/);
  await refused("attempt_reply_path", { response: `${SCORE} I read /home/someone/notes.md first.` }, /assistant response \(absolute home path\)/);
  await refused("attempt_reply_traversal", { response: `${SCORE} Read ../private/result.txt.` }, /assistant response \(path traversal\)/);
  await refused("attempt_file_token", { files: { "notes.md": `${SCORE}\nghp_abcdefghijklmnopqrstuvwxyz0123\n` } }, /artifact\/notes\.md \(credential-like token\)/);
  await refused("attempt_file_path", { files: { "notes.md": `${SCORE}\nSee /Users/someone/Music.\n` } }, /artifact\/notes\.md \(absolute home path\)/);
  await refused("attempt_file_private", { files: { "notes.md": "ok\n", "theme/readme.md": `${SCORE}\nKept in attempts/private/x.txt\n` } }, /artifact\/theme\/readme\.md \(private directory reference\)/);
  assert.equal(await pathExists(path.join(f.root, "dishes")), false, "nothing was published");
});

test("a fixture that says score is still refused at publication, whatever the model wrote", async (t) => {
  const f = await recipeFixture(t, { brief: "Give the theme a score out of ten.\n" });
  await assert.rejects(finalize(f, "attempt_fixture_score"), /inputs\/brief\.md \(numerical ranking language\)/);
  assert.equal(await pathExists(path.join(f.root, "dishes")), false);
});

test("a brief that says score is still refused at publication: the trace's prompt is Kitchen's text", async (t) => {
  const f = await recipeFixture(t);
  f.recipe.turns[0].content = "Write the theme and give it a rating.";
  f.recipe.recipeHash = computeRecipeHash(f.recipe, f.recipe.fixtureHashes);
  await assert.rejects(finalize(f, "attempt_brief_rating", { response: SCORE }), /trace\.json \(numerical ranking language\)/);
});

async function noDish(f, attemptId, { response, files }) {
  const { attemptDir, workspace } = await workspaceFor(f, attemptId, files);
  return publishNoDish({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, attemptId, attemptDir, workspace,
    result: { cliVersion: "codex-cli 9.9.9-fake", turns: [{ finalMessage: response }] },
    fault: classifyFailure({ stage: "validation", chefFault: "output-contract" }), executedAt: "2026-11-13T12:00:00.000Z",
  });
}

test("a No Dish keeps a reply and partial files that say score, and still drops ones that leak", async (t) => {
  const f = await recipeFixture(t);
  // The entry (notes.md) is missing: an output-contract fault with a partial artifact.
  const kept = await noDish(f, "attempt_nodish_score", { response: SCORE, files: { "theme/motif.js": "export const score = ['D4'];\n" } });
  assert.equal(kept.manifest.publicTrace, "trace.json");
  assert.deepEqual(kept.manifest.artifact.files.map((file) => file.path), ["artifact/theme/motif.js"]);
  assert.equal(JSON.parse(await readFile(path.join(kept.directory, "trace.json"), "utf8")).turns[0].response, SCORE);

  const dropped = await noDish(f, "attempt_nodish_leak", { response: `${SCORE} The key is sk-proj1234567890abcdefghij.`, files: { "theme/motif.js": "// see /home/someone/theme\n" } });
  assert.equal(dropped.manifest.publicTrace, null, "a leaking reply leaves no trace");
  assert.equal(dropped.manifest.artifact, null, "a leaking file leaves no artifact");
  assert.equal(await pathExists(path.join(dropped.directory, "trace.json")), false);
  assert.equal(await pathExists(path.join(dropped.directory, "artifact")), false);
  assert.deepEqual((await loadNoDishes(f.root)).map((plate) => plate.id).sort(), [dropped.noDishId, kept.noDishId].sort());
});

test("a No Dish of a Recipe whose fixture says score is refused", async (t) => {
  const f = await recipeFixture(t, { brief: "Give the theme a score out of ten.\n" });
  await assert.rejects(noDish(f, "attempt_nodish_fixture", { response: "Done.", files: { "theme/a.js": "export default 1;\n" } }), /inputs\/brief\.md \(numerical ranking language\)/);
  assert.equal(await pathExists(path.join(f.root, "no-dishes")), false);
});

test("the owner's verdict note still may not rank", () => {
  const verdict = createVerdict({ plate: { id: "dish_demo", dishHash: `sha256:${"0".repeat(64)}` }, verdict: "failed", note: "Too long.", now: new Date("2026-11-13T12:00:00.000Z") });
  assert.doesNotThrow(() => validateVerdict(verdict));
  assert.throws(() => validateVerdict({ ...verdict, note: "A low score." }), /numerical ranking language/);
});
