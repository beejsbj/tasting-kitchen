import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const contained = (root, relative) => {
  const resolved = path.resolve(root, relative);
  assert.ok(resolved.startsWith(`${path.resolve(root)}${path.sep}`), `Path escapes output: ${relative}`);
  return resolved;
};
export async function validateStatic(root, contract) {
  for (const relative of contract.required) {
    const filename = contained(root, relative);
    const info = await lstat(filename);
    assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0, `Missing/empty/linked required file: ${relative}`);
  }
  const files = [];
  async function visit(relative) {
    const filename = contained(root, relative);
    const info = await lstat(filename);
    assert.ok(!info.isSymbolicLink(), `Linked output: ${relative}`);
    if (info.isDirectory()) {
      for (const entry of await readdir(filename)) await visit(`${relative}/${entry}`);
    } else files.push(relative);
  }
  for (const relative of contract.required.filter(p => !p.includes("/"))) await visit(relative);
  for (const directory of ["source", "assets", "data"]) {
    try { await visit(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const links = new Map();
  for (const relative of files) {
    if (!/\.(mjs|js|css|html)$/.test(relative)) continue;
    const source = await readFile(contained(root, relative), "utf8");
    if (/\.(mjs|js)$/.test(relative)) {
      const result = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: source, encoding: "utf8" });
      assert.equal(result.status, 0, `${relative}: ${result.stderr}`);
    }
    const refs = [];
    if (/\.(mjs|js)$/.test(relative)) {
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)) refs.push(match[1]);
      for (const match of source.matchAll(/\bfetch\(\s*["']([^"']+)["']/g)) refs.push(match[1]);
    } else if (relative.endsWith(".css")) {
      for (const match of source.matchAll(/@import\s+["']([^"']+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) refs.push(match[1] ?? match[2]);
    } else {
      assert.match(source, /<html\b[^>]*\blang\s*=/i, "HTML needs a document language");
      assert.match(source, /name\s*=\s*["']viewport["']/i, "HTML needs a viewport");
      assert.match(source, /<script\b(?=[^>]*type\s*=\s*["']module["'])(?=[^>]*src\s*=\s*["'](?:\.\/)?app\.mjs["'])[^>]*>/i, "Load app.mjs as a browser module");
      for (const match of source.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(match[1]);
    }
    const resolvedRefs = [];
    for (const ref of refs) {
      if (ref.startsWith("data:") || ref.startsWith("#")) continue;
      assert.ok(ref.startsWith("./") || ref.startsWith("../") || (relative.endsWith(".html") && !/^[a-z]+:|^\//i.test(ref)), `Use local relative resources in ${relative}: ${ref}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), ref.split(/[?#]/)[0]));
      assert.ok(files.includes(target), `Unpublished or missing resource ${relative} -> ${target}`);
      resolvedRefs.push(target);
    }
    links.set(relative, resolvedRefs);
  }
  for (const [from, to] of contract.edges) assert.ok(links.get(from)?.includes(to), `Missing actual import/resource reference: ${from} -> ${to}`);
  for (const [relative, digest] of Object.entries(contract.immutable)) {
    const bytes = await readFile(contained(root, relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, `Immutable snapshot changed: ${relative}`);
  }
}
export function validateLogic(api, cases) {
  for (const test of cases) {
    assert.equal(typeof api[test.fn], "function", `Missing export ${test.fn}`);
    const args = structuredClone(test.args);
    const before = structuredClone(args);
    if (test.throws) assert.throws(() => api[test.fn](...args), { name: test.throws }, test.label);
    else assert.deepEqual(api[test.fn](...args), test.expected, test.label);
    assert.deepEqual(args, before, `Input mutation: ${test.label}`);
  }
}
export async function validateWorkspace(root, contract, cases) {
  await validateStatic(root, contract);
  const api = await import(pathToFileURL(contained(root, "logic.mjs")).href);
  validateLogic(api, cases);
  return { passed: true, vectors: cases.length, browserVerified: false };
}
