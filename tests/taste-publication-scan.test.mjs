import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeConfigHash, computeRecipeHash, sha256 } from "../lib/taste/catalog.mjs";
import { classifyFailure } from "../lib/taste/faults.mjs";
import { assertPublicTextSafe, chefTextFindings, pathExists, publicManifestFindings, publicTextFindings, publicTraceFindings, RANKING_LANGUAGE, scanPublicTree } from "../lib/taste/files.mjs";
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
  // Any other path inside this attempt's cook directory is shown relative to it, never absolute.
  assert.equal(sanitizePublicResponse(`${SCORE} See ${path.join(workspace, "draft.md")}.`, options), `${SCORE} See run/workspace/draft.md.`);
  assert.equal(sanitizePublicResponse(`Patterns are in \`${path.join(root, "scratch")}/\`, outside the folder.`, options), "Patterns are in `run/scratch/`, outside the folder.");
  assert.equal(sanitizePublicResponse(`Ran node room/room.mjs play ${path.join(root, "scratch", "step01.js")}`, options), "Ran node room/room.mjs play run/scratch/step01.js");
  // A path that only shares the prefix, climbs out, or lies elsewhere is still refused.
  assert.throws(() => sanitizePublicResponse(`See ${root}-other/notes.md`, options), /assistant response \(absolute path\)/);
  assert.throws(() => sanitizePublicResponse(`See ${root}/scratch/../../secret.txt`, options), /Public artifact scan failed/);
  assert.throws(() => sanitizePublicResponse(`See /srv/elsewhere/notes.md`, options), /assistant response \(absolute path\)/);
  // A path joined to another by a colon or @ stays absolute and is refused, so nothing after it slips through.
  for (const joined of [`${root}/workspace/notes.txt:/etc/hosts`, `${root}/scratch:/var/tmp/other/workspace/secret.txt`, `PATH ${root}/bin:/opt/private-tools/bin`, `${root}/scratch@host`]) {
    assert.throws(() => sanitizePublicResponse(joined, options), /Public artifact scan failed/, joined);
  }
  // A cook directory at the filesystem root is never rewritten.
  assert.equal(sanitizePublicResponse("read //etc/shadow and / done", { workspace: "/workspace", selectedFiles: [] }), "read //etc/shadow and / done");
});

test("in a public trace only the model's response may use ranking words; prompts and everything else may not", () => {
  const trace = (turn, extra = {}) => JSON.stringify({ schemaVersion: 1, recipeId: "demo", ...extra, turns: [{ id: "opening", role: "prompt", prompt: "Write a theme.", response: "Done.", usage: null, actions: [], ...turn }] });
  assert.deepEqual(publicTraceFindings(trace({})), []);
  assert.deepEqual(publicTraceFindings(trace({ response: SCORE })), []);
  assert.deepEqual(publicTraceFindings(trace({ prompt: "Give the piece a score out of ten." })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ prompt: "Give the piece a score out of ten.", response: SCORE })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ id: "scoring" })), [RANKING_LANGUAGE]);
  // An action's path names a file the model chose (#93): the ranking rule skips it, as it skips the response.
  assert.deepEqual(publicTraceFindings(trace({ actions: [{ event: "item.completed", type: "file_change", path: "score.md" }] })), []);
  assert.deepEqual(publicTraceFindings(trace({ actions: [{ event: "item.completed", type: "file_change", path: "assets/score.json" }, { type: "tool_call" }] })), []);
  // The rest of an action is Kitchen's vocabulary and keeps the rule.
  assert.deepEqual(publicTraceFindings(trace({ actions: [{ event: "scoring", type: "file_change", path: "notes.md" }] })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ actions: [{ type: "file_change", path: { score: "x" } }] })), [RANKING_LANGUAGE]);
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

async function noDish(f, attemptId, { response, files, checks = null }) {
  const { attemptDir, workspace } = await workspaceFor(f, attemptId, files);
  return publishNoDish({
    repoRoot: f.root, catalog: f.catalog, recipe: f.recipe, variant: f.variant, attemptId, attemptDir, workspace, checks,
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

// ---------------------------------------------------------------------------
// JSON: a `\n` escape must not hide a token from a rule that starts with `\b` (#94).

test("a JSON file is scanned as raw text and as its decoded keys and string values", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-json-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, text) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  };
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  // The raw rules alone miss each of these: `\n` reads as `n<token>`, `\/` hides a slash.
  for (const raw of [JSON.stringify({ response: `x\n${token}` }), '{"response":"read \\/etc\\/passwd"}']) assert.deepEqual(publicTextFindings(raw), [], raw);

  await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: SCORE }] }));
  await write("dish.json", JSON.stringify({ id: "dish_demo" }));
  await write("artifact/data.json", JSON.stringify({ notes: `Setup.\n\n${SCORE}` }));
  await write("inputs/brief.json", JSON.stringify({ brief: "Write a theme." }));
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));

  // A credential after an escaped newline, in a value or a key, wherever the JSON file sits.
  for (const [relative, value] of [
    ["artifact/data.json", { notes: `${SCORE}\n${token}` }],
    ["artifact/data.json", { [`${SCORE}\n${token}`]: 1 }],
    ["trace.json", { turns: [{ id: "opening", prompt: "Write a theme.", response: `${SCORE}\n${token}` }] }],
    ["dish.json", { id: "dish_demo", note: `x\n${token}` }],
    ["inputs/brief.json", { brief: `x\n${token}` }],
    ["notes.json", { note: `x\n${token}` }],
  ]) {
    const before = await pathExists(path.join(root, relative)) ? await readFile(path.join(root, relative), "utf8") : null;
    await write(relative, JSON.stringify(value));
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), (error) => {
      assert.match(error.message, new RegExp(`${relative.replaceAll(".", "\\.")} \\(credential-like token\\)`, "u"));
      return true;
    }, relative);
    if (before === null) await rm(path.join(root, relative));
    else await write(relative, before);
  }
  // An escaped slash hides nothing either.
  await write("artifact/data.json", '{"notes":"read \\/etc\\/passwd"}');
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /artifact\/data\.json \(absolute path\)/);
  await write("artifact/data.json", JSON.stringify({ notes: SCORE }));

  // Decoding does not change where ranking words are allowed: still in the model's files and responses, still not in Kitchen's.
  await write("dish.json", JSON.stringify({ id: "dish_demo", note: "Setup.\n\nScore the piece." }));
  assert.deepEqual(publicTextFindings(await readFile(path.join(root, "dish.json"), "utf8")), [], "the raw rule alone misses it");
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /dish\.json \(numerical ranking language\)/);
  await write("dish.json", JSON.stringify({ id: "dish_demo" }));
  await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Setup.\n\nScore the piece.", response: "Done." }] }));
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /trace\.json \(numerical ranking language\)/);
  await write("trace.json", JSON.stringify({ turns: [{ id: "opening", prompt: "Write a theme.", response: "Setup.\n\nScore the piece." }] }));
  await write("artifact/data.json", JSON.stringify({ notes: "Setup.\n\nScore the piece." }));
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));

  // One finding per file and reason, even when the raw text and the decoded value both trip it.
  await write("artifact/data.json", JSON.stringify({ notes: `${token} and\n${token}` }));
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), (error) => {
    assert.equal(error.message, "Public artifact scan failed: artifact/data.json (credential-like token)");
    return true;
  });
  // A `.json` file that does not parse is still scanned as raw text.
  await write("artifact/data.json", `{"notes": "${token}"`);
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /artifact\/data\.json \(credential-like token\)/);
  await write("artifact/data.json", '{"notes": "fine"');
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));
});

// Source: an escape inside a quoted string hides text the same way (#113).

test("a delivered source file's quoted strings are also read with their escapes decoded, as JavaScript and as CSS read them", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-source-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, text) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  };
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  const leaks = [
    ["artifact/app.js", `const t = "x\\n${token}";\n`, "credential-like token"],
    ["artifact/app.mjs", `export const k = 'x\\tsk-abcdefghijklmnopqrstu';\n`, "credential-like token"],
    ["artifact/app.ts", 'const notes = "\\/home\\/someone\\/notes.md";\n', "absolute home path"],
    ["artifact/app.tsx", "const p = `\\x2fetc\\x2fhosts`;\n", "absolute path"],
    ["artifact/app.jsx", 'const p = "\\u002fopt\\u002fprivate-tools\\u002fbin";\n', "absolute path"],
    ["artifact/app.js", 'const p = "\\u{2f}srv\\u{2f}data\\u{2f}x";\n', "absolute path"],
    ["artifact/style.css", '.a::after { content: "\\2f home\\2f someone"; }\n', "absolute home path"],
    ["artifact/style.css", '.a::after { content: "\\00002fUsers\\00002fsomeone"; }\n', "absolute home path"],
    ["artifact/index.html", `<script>const k = 'x\\n${token}';</script>\n`, "credential-like token"],
    ["artifact/index.html", '<style>.a::after { content: "\\2f etc\\2f hosts"; }</style>\n', "absolute path"],
    ["artifact/scene.strudel", 'note("c e g").name("x\\nE123")\n', "private evidence identifier"],
    ["artifact/config.yaml", `key: "x\\n${token}"\n`, "credential-like token"],
    ["artifact/app.js", "const climb = '\\x2e\\x2e/secret/notes.md';\n", "path traversal"],
    // A token is still a token after an escape outside a string: in a comment or a regex literal.
    ["artifact/app.js", `// The fixture key was x\\n${token}\n`, "credential-like token"],
    ["artifact/app.js", `const re = /x\\n${token}/u;\n`, "credential-like token"],
  ];
  for (const [relative, text, reason] of leaks) {
    // The raw rules alone miss each of these: `\n` reads as `n<token>`, an escaped slash is no slash.
    assert.ok(!publicTextFindings(text).includes(reason), `raw already finds ${reason}: ${text}`);
    await write(relative, text);
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), (error) => {
      assert.match(error.message, new RegExp(`${relative.replaceAll(".", "\\.")} \\(${reason}\\)`, "u"));
      return true;
    }, text);
    await rm(path.join(root, relative));
  }

  // Escapes outside a quoted string are not decoded: a regex literal's `\.` and `\/` are not a path.
  // Inside one, an escaped regex source stays escaped once decoded. Ranking words stay the model's.
  await write("artifact/app.test.mjs", [
    'assert.match(run("film.mjs").stderr, /edl\\.json/u);',
    "assert.match(bad, /rushes\\/b\\.mp4 is in rushes/u);",
    'if (!/styles\\.css/u.test(entry)) throw new Error("missing");',
    "const digits = /\\d/u.test(stated);",
    'const route = new RegExp("^\\\\/api\\\\/users\\\\/(\\\\d+)$");',
    'const label = "Line one\\nThe score is in 3/4.";',
    "const path = './assets/img/logo.svg';",
    "const note = `it's \\`quoted\\``;",
    // A quote or backtick inside a regex opens no string; a comment's code span is not decoded.
    "const escapeHtml = (s) => s.replace(/[&<>\"']/g, (c) => \"&#\" + c.charCodeAt(0) + \";\");",
    "const boundary = /(?:^|[\\s\"'`])\\/edl\\.json/u;",
    "// Matches `/rushes\\/b\\.mp4/` and `'\\/edl\\.json'` in prose.",
    "/* A block: `/a\\/b\\/c/` */",
    "",
  ].join("\n"));
  await write("artifact/style.css", '.a::before { content: "\\201C"; } .b { font-family: "Inter\\2c sans"; }\n');
  await write("artifact/index.html", '<p title="a\\nb">Don\'t / won\'t</p>\n');
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));
  // Kitchen's own source text gets the decoded read and every rule, ranking included.
  await write("notes.js", 'const n = "x\\nScore these.";\n');
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /notes\.js \(numerical ranking language\)/);
});

test("a public trace finds a credential after an escaped newline in a response or a prompt", () => {
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  const trace = (turn) => JSON.stringify({ schemaVersion: 1, recipeId: "demo", turns: [{ id: "opening", role: "prompt", prompt: "Write a theme.", response: "Done.", usage: null, actions: [], ...turn }] });
  assert.deepEqual(publicTraceFindings(trace({ response: `${SCORE}\n${token}` })), ["credential-like token"]);
  assert.deepEqual(publicTraceFindings(trace({ prompt: `Write.\n${token}` })), ["credential-like token"]);
  assert.deepEqual(publicTraceFindings(trace({ prompt: "Setup.\n\nScore the piece." })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicTraceFindings(trace({ response: "Setup.\n\nScore the piece." })), []);
  // Not a trace: every rule, raw and decoded.
  assert.deepEqual(publicTraceFindings(JSON.stringify({ note: `x\n${token}` })), ["credential-like token"]);
});

test("a No Dish drops a validation receipt whose check detail hides a credential after an escaped newline", async (t) => {
  const f = await recipeFixture(t);
  const checks = (detail) => ({ passed: false, checks: [{ id: "entry", type: "file-exists", required: true, description: "The notes exist.", passed: false, detail }] });
  const kept = await noDish(f, "attempt_nodish_receipt", { response: "Done.", files: {}, checks: checks("notes.md is missing") });
  assert.deepEqual(kept.manifest.validation, { passed: false, report: "validation.json" });
  const dropped = await noDish(f, "attempt_nodish_receipt_leak", { response: "Done.", files: {}, checks: checks("notes.md is missing\nghp_abcdefghijklmnopqrstuvwxyz0123") });
  assert.equal(dropped.manifest.validation, null, "the receipt is dropped; the plate still publishes");
  assert.equal(await pathExists(path.join(dropped.directory, "validation.json")), false);
});

// ---------------------------------------------------------------------------
// File names the model chose (#93): exempt from the ranking rule only.

/** File names that must never publish, whoever chose them, with the reason they trip. */
const LEAKING_NAMES = [
  ["assets/ghp_abcdefghijklmnopqrstuvwxyz0123.json", "credential-like token"],
  ["assets/sk-proj1234567890abcdefghij.txt", "credential-like token"],
  ["assets/home/someone/notes.md", "absolute home path"],
  ["assets/Users/someone/notes.md", "absolute home path"],
  ["assets/%2e%2e%2fsecret.md", "encoded path traversal"],
  ["assets/private/notes.md", "private directory reference"],
  ["assets/CJ123.md", "private evidence identifier"],
];

test("a file name the model chose may say score in the trace and the manifest; every leak rule still applies to it", () => {
  const trace = (paths) => JSON.stringify({ schemaVersion: 1, recipeId: "demo", turns: [{ id: "opening", prompt: "Write a theme.", response: "Done.", actions: paths.map((name) => ({ event: "item.completed", type: "file_change", status: "completed", path: name })) }] });
  const manifest = (paths, extra = {}) => JSON.stringify({ id: "dish_demo", ...extra, artifact: { kind: "document", entry: "artifact/notes.md", files: paths.map((name) => ({ path: `artifact/${name}`, sha256: "0".repeat(64), bytes: 1 })), treeHash: "x" } });
  assert.deepEqual(publicTraceFindings(trace(["assets/score.json", "scoring.py"])), []);
  assert.deepEqual(publicManifestFindings(manifest(["notes.md", "assets/score.json", "theme/scoring.py"])), []);
  // Only the file names: the rest of the manifest is Kitchen's, the entry is the Recipe's.
  assert.deepEqual(publicManifestFindings(manifest(["notes.md"], { note: "a score" })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicManifestFindings(JSON.stringify({ artifact: { entry: "artifact/score.md", files: [{ path: "artifact/score.md" }] } })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicManifestFindings(JSON.stringify({ artifact: { files: [{ path: "notes.md", kind: "score" }] } })), [RANKING_LANGUAGE]);
  assert.deepEqual(publicManifestFindings(JSON.stringify({ artifact: { files: [{ path: ["score"] }] } })), [RANKING_LANGUAGE]);
  // Not manifest-shaped (no artifact files, as in a No Dish without a partial artifact): every rule.
  for (const text of [JSON.stringify({ artifact: null, note: "a score" }), JSON.stringify({ artifact: { files: "score.md" } }), "a score"]) {
    assert.deepEqual(publicManifestFindings(text), [RANKING_LANGUAGE], text);
  }
  for (const [name, reason] of LEAKING_NAMES) {
    assert.ok(publicTraceFindings(trace([name])).includes(reason), `trace: ${name}`);
    assert.ok(publicManifestFindings(manifest(["notes.md", name])).includes(reason), `manifest: ${name}`);
    // Beside a name that says score, only the leak is reported.
    assert.deepEqual(publicManifestFindings(manifest(["assets/score.json", name])), publicTextFindings(`artifact/${name}`), name);
  }
  // A traversal spelled after a space in a name is still traversal.
  assert.ok(publicManifestFindings(manifest(["draft ../secret.md"])).includes("path traversal"));
});

test("a plate scan reads dish.json and no-dish.json as manifests: delivered file names may say score", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-manifest-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, value) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), typeof value === "string" ? value : JSON.stringify(value));
  };
  const manifest = (name, extra = {}) => ({ id: "dish_demo", ...extra, artifact: { entry: "artifact/notes.md", files: [{ path: "artifact/notes.md" }, { path: `artifact/${name}` }] } });
  await write("artifact/notes.md", "Notes.\n");
  for (const file of ["dish.json", "no-dish.json"]) {
    await write(file, manifest("assets/score.json"));
    await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN), file);
    await write(file, manifest("assets/score.json", { note: "Give it a score." }));
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), new RegExp(`${file.replace(".", "\\.")} \\(numerical ranking language\\)`, "u"));
    for (const [name, reason] of LEAKING_NAMES) {
      await write(file, manifest(name));
      await assert.rejects(scanPublicTree(root, PLATE_SCAN), new RegExp(`${file.replace(".", "\\.")} \\(${reason}\\)`, "u"), name);
    }
    await rm(path.join(root, file));
  }
  // Only the plate's own manifests: the same file elsewhere, or a tree scanned without the plate's layout, keeps the rule.
  await write("other/dish.json", manifest("assets/score.json"));
  await assert.rejects(scanPublicTree(root, PLATE_SCAN), /other\/dish\.json \(numerical ranking language\)/);
  await rm(path.join(root, "other"), { recursive: true });
  await write("dish.json", manifest("assets/score.json"));
  await assert.rejects(scanPublicTree(root), /dish\.json \(numerical ranking language\)/);
  await assert.rejects(scanPublicTree(root, { ...PLATE_SCAN, manifests: "dish.json" }), /entries as arrays/);
});

test("a Dish that delivers a file named score publishes and loads; a file named with a credential or a home path does not", async (t) => {
  const f = await recipeFixture(t);
  const published = await finalize(f, "attempt_named_score", { files: { "notes.md": "Notes.\n", "theme/score.md": "D F A\n", "theme/scoring.py": "print(1)\n" } });
  assert.equal(published.status, "accepted");
  assert.deepEqual(published.manifest.artifact.files.map((file) => file.path), ["artifact/notes.md", "artifact/theme/score.md", "artifact/theme/scoring.py"]);
  assert.deepEqual((await loadDishes(f.root)).map((dish) => dish.id), [published.dishId]);
  for (const [index, [name, reason]] of LEAKING_NAMES.entries()) {
    const file = name.replace(/^assets\//u, "theme/");
    await assert.rejects(finalize(f, `attempt_named_leak_${index}`, { files: { "notes.md": "Notes.\n", [file]: "x\n" } }), (error) => {
      assert.equal(error.stage, "publication");
      assert.match(error.message, new RegExp(`dish\\.json \\(${reason}\\)`, "u"));
      return true;
    }, name);
  }
  assert.deepEqual((await loadDishes(f.root)).map((dish) => dish.id), [published.dishId], "nothing else was published");
});

test("a No Dish keeps a partial artifact whose file is named score, and drops one whose file name leaks", async (t) => {
  const f = await recipeFixture(t);
  // The entry (notes.md) is missing: an output-contract fault with a partial artifact.
  const kept = await noDish(f, "attempt_nodish_named_score", { response: "Done.", files: { "theme/score.json": "{}\n" } });
  assert.deepEqual(kept.manifest.artifact.files.map((file) => file.path), ["artifact/theme/score.json"]);
  assert.equal(await pathExists(path.join(kept.directory, "artifact/theme/score.json")), true);
  const ids = [kept.noDishId];
  for (const [index, [name]] of LEAKING_NAMES.entries()) {
    const dropped = await noDish(f, `attempt_nodish_named_leak_${index}`, { response: "Done.", files: { "theme/motif.js": "export default 1;\n", [name.replace(/^assets\//u, "theme/")]: "x\n" } });
    assert.equal(dropped.manifest.artifact, null, `a leaking name drops the partial artifact: ${name}`);
    assert.equal(await pathExists(path.join(dropped.directory, "artifact")), false, name);
    ids.push(dropped.noDishId);
  }
  assert.deepEqual((await loadNoDishes(f.root)).map((plate) => plate.id).sort(), ids.sort());
});

// ---------------------------------------------------------------------------
// Found by the independent review: JSON that does not parse, or repeats a key, hides nothing either.

test("an escape hides nothing in JSON that does not parse or that repeats a key", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-json-shapes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (relative, text) => {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), text);
  };
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  for (const [text, reason] of [
    [`{"a":"x\\n${token}"`, "credential-like token"],
    [`{"a":"x\\n${token}","a":"y"}`, "credential-like token"],
    ['{"a":"\\/home\\/someone","a":"y"}', "absolute home path"],
    ['{"a":"see \\/etc\\/passwd"', "absolute path"],
  ]) {
    await write("artifact/a.json", text);
    await assert.rejects(scanPublicTree(root, PLATE_SCAN), new RegExp(`artifact/a\\.json \\(${reason}\\)`, "u"), text);
  }
  // Ordinary escapes in the model's JSON stay ordinary.
  await write("artifact/a.json", JSON.stringify({ lines: "First line.\nSecond line.\t\"Quoted\" \\ done.", url: "https://example.com/a/b", score: SCORE }, null, 2));
  await assert.doesNotReject(scanPublicTree(root, PLATE_SCAN));
});

test("a repeated key cannot hide a ranking word in Kitchen's fields of a manifest or a trace", () => {
  for (const text of [
    '{"artifact":{"files":[{"path":"Score these models","path":"artifact/a.md"}]}}',
    '{"artifact":{"files":[{"path":"x","label":"score"}]},"artifact":{"files":[{"path":"score"}]}}',
    '{"artifact":{"files":[{"path":"a.md"}]},"note":"x\\nScore it","note":"y"}',
  ]) assert.deepEqual(publicManifestFindings(text), [RANKING_LANGUAGE], text);
  for (const text of [
    '{"turns":[{"prompt":"rank by score","prompt":"hi","response":"ok"}]}',
    '{"turns":[{"prompt":"x\\nScore it","prompt":"hi","response":"ok"}]}',
    '{"turns":[{"prompt":"hi","actions":[{"type":"score","type":"file_change","path":"a.md"}],"response":"ok"}]}',
  ]) assert.deepEqual(publicTraceFindings(text), [RANKING_LANGUAGE], text);
  // As Kitchen writes them (indented, no repeated keys), the model's names and responses still pass.
  const manifest = { id: "dish_demo", artifact: { entry: "artifact/notes.md", files: [{ path: "artifact/notes.md" }, { path: "artifact/assets/score.json" }, { path: "artifact/theme/scoring.py" }] } };
  assert.deepEqual(publicManifestFindings(JSON.stringify(manifest, null, 2)), []);
  const trace = { turns: [{ id: "opening", prompt: "Write a theme.", response: `${SCORE}\nScore attached.`, actions: [{ type: "file_change", path: "assets/score.json" }] }] };
  assert.deepEqual(publicTraceFindings(JSON.stringify(trace, null, 2)), []);
});

test("a parent path written with an escaped slash is never masked as a safe internal path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-mask-escape-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "a/b"), { recursive: true });
  await writeFile(path.join(root, "logic.mjs"), "export const ready = true;\n");
  await writeFile(path.join(root, "a/b/ok.mjs"), 'import { ready } from "../../logic.mjs";\n');
  await assert.doesNotReject(scanPublicTree(root, { chefAuthored: true }));
  await writeFile(path.join(root, "a/b/c.json"), JSON.stringify({ c: "import x from '../..\\/..\\/..\\/..\\/etc\\u002fpasswd'" }).replaceAll("\\\\", "\\"));
  await assert.rejects(scanPublicTree(root, { chefAuthored: true }), /a\/b\/c\.json \(path traversal\)/);
  await rm(path.join(root, "a/b/c.json"));
  await writeFile(path.join(root, "a/b/c.mjs"), "import x from '../..\\/..\\/..\\/..\\/etc/passwd';\n");
  await assert.rejects(scanPublicTree(root, { chefAuthored: true }), /a\/b\/c\.mjs \(path traversal\)/);
});

test("a trace or manifest that does not parse is still read with its escapes decoded", () => {
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  // Broken JSON (a missing brace) with a credential after an escaped newline.
  const broken = `{"turns":[{"response":"x\\n${token}"}]`;
  assert.ok(publicTraceFindings(broken).length > 0, "malformed trace");
  assert.ok(publicManifestFindings(broken).length > 0, "malformed manifest");
});

test("a delivered JSON file with a very large array is scanned, not crashed on", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "taste-large-json-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "notes.json"), JSON.stringify(Array.from({ length: 200000 }, (_, index) => index % 2 ? "a" : 1)));
  assert.deepEqual(await scanPublicTree(root, { chefAuthored: true }), { passed: true, filesScanned: 1 });
});
