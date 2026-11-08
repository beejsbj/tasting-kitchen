import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import config from "../vite.config.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

function headerPlugin() {
  const plugin = config.plugins.flat(Infinity).find((candidate) => candidate?.name === "kitchen-artifact-headers");
  assert.ok(plugin, "kitchen-artifact-headers plugin is registered");
  return plugin;
}

// Run a request through every middleware the hook registers, as Connect would.
async function responseHeaders(hook, url) {
  const stack = [];
  hook({ middlewares: { use: (middleware) => stack.push(middleware) } });
  const headers = {};
  const response = { setHeader: (name, value) => { headers[name.toLowerCase()] = value; }, end() {}, statusCode: 200 };
  let index = 0;
  const next = () => { const middleware = stack[index++]; if (middleware) middleware({ url }, response, next); };
  next();
  return headers;
}

test("the preview server applies the artifact sandbox headers that vercel.json and nginx apply", async () => {
  const vercel = JSON.parse(await readFile(path.join(repoRoot, "vercel.json"), "utf8"));
  const expected = Object.fromEntries(
    vercel.headers.find((rule) => rule.source === "/dishes/:path*").headers.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  for (const hook of [headerPlugin().configurePreviewServer, headerPlugin().configureServer]) {
    const headers = await responseHeaders(hook, "/dishes/dish_a/artifact/index.html");
    for (const [name, value] of Object.entries(expected)) assert.equal(headers[name], value, name);
  }
});

test("the preview server leaves non-artifact routes without the sandbox", async () => {
  const headers = await responseHeaders(headerPlugin().configurePreviewServer, "/data/registry.json");
  assert.equal(headers["content-security-policy"], undefined);
  assert.equal(headers["access-control-allow-origin"], undefined);
});

test("only the URL path selects artifact routes, never the query string", async () => {
  for (const hook of [headerPlugin().configurePreviewServer, headerPlugin().configureServer]) {
    const headers = await responseHeaders(hook, "/?next=/dishes/");
    assert.equal(headers["content-security-policy"], undefined);
    assert.equal(headers["access-control-allow-origin"], undefined);
    assert.ok((await responseHeaders(hook, "/dishes/dish_a/artifact/index.html?v=1"))["content-security-policy"]);
  }
});
