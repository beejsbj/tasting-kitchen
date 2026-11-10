import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import test from "node:test";

import { isKeyProxyBaseUrl, startKeyProxy } from "../lib/taste/key-proxy.mjs";
import { openRouterUpstream } from "../lib/taste/openrouter.mjs";

const KEY = "sk-or-v1-real-key-only-the-proxy-holds";

/** A stand-in upstream: records each request, answers with a streamed body. */
async function fakeUpstream(t, handler) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body });
      if (handler) return handler(request, response);
      response.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "session=upstream" });
      response.write("data: one\n\n");
      setTimeout(() => response.end("data: two\n\n"), 20);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}/api/v1`, port: server.address().port, seen };
}

async function proxyFor(t, upstream) {
  const proxy = await startKeyProxy({ upstream, apiKey: KEY });
  t.after(() => proxy.close());
  return proxy;
}

test("the proxy swaps the attempt's dummy token for the real key and streams the pinned upstream's answer back", async (t) => {
  const upstream = await fakeUpstream(t);
  const proxy = await proxyFor(t, upstream.base);
  assert.match(proxy.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/u);
  assert.equal(proxy.token.includes(KEY), false);
  const response = await fetch(`${proxy.baseUrl}/chat/completions?stream=1`, {
    method: "POST",
    headers: { authorization: `Bearer ${proxy.token}`, "content-type": "application/json", cookie: "a=b", "x-api-key": "other", "x-title": "Tasting Kitchen" },
    body: JSON.stringify({ model: "google/gemini-4-argon" }),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "data: one\n\ndata: two\n\n");
  assert.equal(response.headers.get("set-cookie"), null);
  const [request] = upstream.seen;
  assert.equal(request.url, "/api/v1/chat/completions?stream=1");
  assert.equal(request.headers.authorization, `Bearer ${KEY}`);
  assert.equal(request.headers.cookie, undefined);
  assert.equal(request.headers["x-api-key"], undefined);
  assert.equal(request.headers["x-title"], "Tasting Kitchen");
  assert.equal(request.body, JSON.stringify({ model: "google/gemini-4-argon" }));
  assert.deepEqual(proxy.stats, { forwarded: 1, refused: 0 });
});

test("without the attempt's token, or outside the pinned base path, nothing reaches the upstream", async (t) => {
  const upstream = await fakeUpstream(t);
  const proxy = await proxyFor(t, upstream.base);
  const post = (pathname, token = proxy.token) => fetch(`http://127.0.0.1:${new URL(proxy.baseUrl).port}${pathname}`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: "{}" });
  assert.equal((await post("/api/v1/chat/completions", null)).status, 401);
  assert.equal((await post("/api/v1/chat/completions", KEY)).status, 401, "even the real key is not this attempt's token");
  assert.equal((await post("/api/v1/chat/completions", `${proxy.token}x`)).status, 401);
  const refused = await post("/api/v2/keys");
  assert.equal(refused.status, 404);
  assert.equal((await refused.text()).includes(KEY), false);
  assert.equal((await post("/api/v1/../../admin")).status, 404);
  assert.equal((await post("/api/v1/%2e%2e/%2fadmin")).status, 404);
  assert.equal((await post("/api/v1x/chat")).status, 404);
  // An absolute-form request naming another host is refused, not forwarded there.
  const raw = await new Promise((resolve, reject) => {
    const socket = connect(new URL(proxy.baseUrl).port, "127.0.0.1", () => {
      socket.write(`GET http://evil.example/api/v1/models HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer ${proxy.token}\r\nConnection: close\r\n\r\n`);
    });
    let text = "";
    socket.on("data", (chunk) => { text += chunk; });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });
  assert.match(raw, /^HTTP\/1\.1 404/u);
  assert.equal(upstream.seen.length, 0);
});

test("an unreachable upstream answers 502 without naming the key; close() stops the listener", async (t) => {
  const upstream = await fakeUpstream(t);
  const proxy = await startKeyProxy({ upstream: upstream.base.replace(String(upstream.port), "1"), apiKey: KEY });
  const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${proxy.token}` }, body: "{}" });
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(KEY), false);
  await proxy.close();
  await assert.rejects(fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST" }));
});

test("the upstream is pinned: https or a loopback fake, never a real host under the test runner, and only a loopback override", async () => {
  await assert.rejects(startKeyProxy({ upstream: "http://openrouter.ai/api/v1", apiKey: KEY }), /must be https/);
  await assert.rejects(startKeyProxy({ upstream: "https://openrouter.ai/api/v1", apiKey: KEY }), /Refusing a real upstream/);
  await assert.rejects(startKeyProxy({ upstream: "https://user:pw@openrouter.ai/api/v1", apiKey: KEY }), /plain origin/);
  await assert.rejects(startKeyProxy({ upstream: "http://127.0.0.1:9/api/v1", apiKey: "" }), /needs the real key/);
  assert.equal(openRouterUpstream({}), "https://openrouter.ai/api/v1");
  assert.equal(openRouterUpstream({ TASTE_OPENROUTER_UPSTREAM: "http://127.0.0.1:4000/api/v1/" }), "http://127.0.0.1:4000/api/v1");
  assert.throws(() => openRouterUpstream({ TASTE_OPENROUTER_UPSTREAM: "https://collector.example/api/v1" }), /loopback fake/);
  assert.equal(isKeyProxyBaseUrl("http://127.0.0.1:41234/api/v1", "https://openrouter.ai/api/v1"), true);
  assert.equal(isKeyProxyBaseUrl("http://127.0.0.1:41234/api/v2", "https://openrouter.ai/api/v1"), false);
  assert.equal(isKeyProxyBaseUrl("https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1"), false);
  assert.equal(isKeyProxyBaseUrl("http://10.0.0.5:41234/api/v1", "https://openrouter.ai/api/v1"), false);
});

test("a client that sends its key as x-api-key (Anthropic Messages) gets the real key in that same header, and only there", async (t) => {
  const upstream = await fakeUpstream(t, (request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); });
  const proxy = await proxyFor(t, upstream.base);
  const viaHeader = await fetch(`${proxy.baseUrl}/messages`, { method: "POST", headers: { "x-api-key": proxy.token, "content-type": "application/json" }, body: "{}" });
  assert.equal(viaHeader.status, 200);
  assert.equal(upstream.seen[0].headers["x-api-key"], KEY);
  assert.equal(upstream.seen[0].headers.authorization, undefined);
  // A bearer token keeps the bearer style; a stray x-api-key beside it is dropped.
  await fetch(`${proxy.baseUrl}/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${proxy.token}`, "x-api-key": "other" }, body: "{}" });
  assert.equal(upstream.seen[1].headers.authorization, `Bearer ${KEY}`);
  assert.equal(upstream.seen[1].headers["x-api-key"], undefined);
  // A wrong token in either header reaches nothing.
  assert.equal((await fetch(`${proxy.baseUrl}/messages`, { method: "POST", headers: { "x-api-key": "wrong" }, body: "{}" })).status, 401);
  assert.equal(upstream.seen.length, 2);
});

test("a proxy base URL is recognised with or without a trailing slash, and on any base path the route records", () => {
  // Hermes records `…/api/v1/` for some calls; an OpenCode Go Anthropic Messages model records the base without /v1.
  assert.equal(isKeyProxyBaseUrl("http://127.0.0.1:41234/api/v1/", "https://openrouter.ai/api/v1"), true);
  assert.equal(isKeyProxyBaseUrl("http://127.0.0.1:41234/zen/go", "https://opencode.ai/zen/go/v1", { paths: ["/zen/go/v1", "/zen/go"] }), true);
  assert.equal(isKeyProxyBaseUrl("http://127.0.0.1:41234/zen/go/v1/", "https://opencode.ai/zen/go/v1", { paths: ["/zen/go/v1", "/zen/go"] }), true);
  assert.equal(isKeyProxyBaseUrl("http://127.0.0.1:41234/zen", "https://opencode.ai/zen/go/v1", { paths: ["/zen/go/v1", "/zen/go"] }), false);
  assert.equal(isKeyProxyBaseUrl("https://opencode.ai/zen/go/v1", "https://opencode.ai/zen/go/v1", { paths: ["/zen/go/v1", "/zen/go"] }), false);
});
