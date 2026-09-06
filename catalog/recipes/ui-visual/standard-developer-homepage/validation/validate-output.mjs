import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const required = ["index.html", "styles.css", "app.mjs", "data/content.json"];

// Bounded source checks only. This does not execute candidate code or DOM events.
export async function validateWorkspace(root = ".") {
  const files = [...required];
  async function visit(relative) {
    let info;
    try {
      info = await lstat(path.join(root, relative));
    } catch (error) {
      if (relative === "assets" && error.code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Symlink not allowed: ${relative}`);
    if (info.isDirectory()) {
      for (const name of await readdir(path.join(root, relative))) await visit(`${relative}/${name}`);
    } else if (info.isFile()) files.push(relative);
    else throw new Error(`Not a regular output: ${relative}`);
  }
  await visit("assets");
  const source = new Map();
  for (const file of files) {
    const location = path.join(root, file);
    const info = await lstat(location).catch(() => { throw new Error(`Missing output: ${file}`); });
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular output: ${file}`);
    const bytes = await readFile(location);
    const text = bytes.toString("utf8");
    if (!bytes.length || (/\.(?:html|css|mjs|js|json|svg)$/u.test(file) && !text.trim())) {
      throw new Error(`Empty output: ${file}`);
    }
    source.set(file, text);
    if (/\.(?:mjs|js)$/u.test(file)) {
      const check = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: text, encoding: "utf8" });
      if (check.status !== 0) throw new Error(`JavaScript syntax failed: ${file}\n${check.stderr ?? check.error}`);
    }
  }
  const content = JSON.parse(source.get("data/content.json"));
  if (!content || typeof content !== "object" || Array.isArray(content) || !Object.keys(content).length) {
    throw new Error("Content must be a nonempty JSON object");
  }
  const html = source.get("index.html").replace(/<!--[\s\S]*?-->/gu, "");
  for (const expression of [/<!doctype\s+html\s*>/iu, /<html\b/iu, /<title\b[^>]*>\s*[^<\s]/iu, /<body\b/iu, /<main\b/iu]) {
    if (!expression.test(html)) throw new Error("Missing HTML document shell, title or main landmark");
  }
  const tags = [...html.matchAll(/<(link|script|img|source|video|audio|iframe)\b([^>]*)>/giu)];
  const attributes = (text) => Object.fromEntries([...text.matchAll(/\b([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
  const parsed = tags.map((match) => ({ tag: match[1].toLowerCase(), attrs: attributes(match[2]) }));
  if (!parsed.some(({ tag, attrs }) => tag === "link" && attrs.rel?.toLowerCase() === "stylesheet" && /^(?:\.\/)?styles\.css$/u.test(attrs.href))) {
    throw new Error("HTML must link styles.css");
  }
  if (!parsed.some(({ tag, attrs }) => tag === "script" && attrs.type?.toLowerCase() === "module" && /^(?:\.\/)?app\.mjs$/u.test(attrs.src))) {
    throw new Error("HTML must load app.mjs as a module");
  }
  function localReference(value, owner) {
    if (/^(?:data:|#)/iu.test(value)) return;
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/)/iu.test(value)) throw new Error(`Nonlocal resource in ${owner}: ${value}`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(owner), decodeURIComponent(value.split(/[?#]/u)[0])));
    if (!files.includes(target)) throw new Error(`Missing or unpublished resource in ${owner}: ${value}`);
  }
  for (const { tag, attrs } of parsed) {
    if (attrs.src !== undefined) localReference(attrs.src, "index.html");
    if (attrs.poster !== undefined) localReference(attrs.poster, "index.html");
    if (tag === "link" && attrs.href !== undefined) localReference(attrs.href, "index.html");
  }
  for (const [file, text] of source) {
    if (!file.endsWith(".css")) continue;
    const css = text.replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/giu)) {
      localReference(match[1] ?? match[2] ?? match[3], file);
    }
  }
  return { files: files.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await validateWorkspace();
  console.log(`Output source checks passed (${result.files} files). Browser behavior and visual quality still need human review.`);
}
