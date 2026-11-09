import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";

import { underTestRunner } from "./runtime-root.mjs";

/**
 * A loopback proxy that holds a provider key so the harness never does.
 *
 * Runs are unsandboxed and the tasted model has a shell, so a key in the
 * harness's environment or home is a key the model can read. For a bearer-key
 * route the runner starts one proxy per attempt: the harness gets a dummy token
 * and a `http://127.0.0.1:<port>/<base path>` URL, and the proxy swaps the token
 * for the real key and forwards to the one pinned upstream origin and base path.
 * The token may arrive as a bearer token or, from an Anthropic Messages client,
 * as `x-api-key`; the real key goes upstream in the same header, so the harness
 * authenticates exactly as it would without the proxy.
 * A request without the attempt's token, or for any other path, is refused
 * without reaching the network. The proxy lives exactly as long as the session.
 *
 * What it does not do: hide the key from the Kitchen process itself, or from
 * anything else running as the same user (see docs/agent-interface.md).
 */

export const KEY_PROXY_AUTH = "kitchen-key-proxy";
const MAX_BODY_BYTES = 64 * 1024 * 1024;
// Never forwarded either way: per-connection headers, and anything that carries or replaces a credential.
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);
const REQUEST_DROPPED = new Set([...HOP_BY_HOP, "authorization", "x-api-key", "cookie", "accept-encoding", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"]);
// The upstream body arrives decoded, so its encoding and length no longer describe it.
const RESPONSE_DROPPED = new Set([...HOP_BY_HOP, "content-encoding", "set-cookie"]);

function pinnedUpstream(upstream) {
  let url;
  try { url = new URL(upstream); }
  catch { throw new Error(`Key proxy upstream is not a URL: ${upstream}`); }
  if (url.search || url.hash || url.username || url.password) throw new Error("Key proxy upstream must be a plain origin and base path");
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !loopback) throw new Error("Key proxy upstream must be https (or a loopback fake)");
  return { origin: url.origin, basePath: url.pathname.replace(/\/+$/u, ""), loopback };
}

/**
 * Whether `value` is a Kitchen key proxy base URL for `upstream`: loopback, any port, and the upstream's
 * own base path, or one of `paths` when the route records several (an Anthropic Messages client drops /v1).
 * A trailing slash is the same URL.
 */
export function isKeyProxyBaseUrl(value, upstream, { paths = null } = {}) {
  if (typeof value !== "string") return false;
  const { basePath } = pinnedUpstream(upstream);
  const match = /^http:\/\/127\.0\.0\.1:\d{1,5}(?<path>\/[^?#]*)?$/u.exec(value);
  if (!match) return false;
  const recorded = (match.groups.path ?? "").replace(/\/+$/u, "");
  return (paths ?? [basePath]).some((candidate) => candidate.replace(/\/+$/u, "") === recorded);
}

function bearer(header) {
  const match = /^Bearer (\S+)$/u.exec(header ?? "");
  return match ? match[1] : null;
}

function single(header) {
  return typeof header === "string" ? header : null;
}

function sameSecret(a, b) {
  const left = Buffer.from(a ?? "");
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function refuse(response, status, message) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message: `Kitchen key proxy: ${message}`, code: status } }));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Start a proxy for one attempt. `upstream` is the pinned base URL (such as
 * https://openrouter.ai/api/v1); `apiKey` the real key, held only here.
 * Returns the loopback `baseUrl`, the dummy `token` the harness presents, the
 * forwarded and refused counts, and `close()`.
 */
export async function startKeyProxy({ upstream, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== "string" || apiKey.trim() === "") throw new Error("Key proxy needs the real key");
  const pin = pinnedUpstream(upstream);
  // No test may reach a real provider: under the test runner only a loopback fake is an upstream.
  if (!pin.loopback && underTestRunner()) throw new Error(`Refusing a real upstream (${pin.origin}) under the test runner; point TASTE_OPENROUTER_UPSTREAM at a loopback fake`);
  const token = `tk-proxy-${randomBytes(24).toString("hex")}`;
  const stats = { forwarded: 0, refused: 0 };
  const inflight = new Set();
  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    inflight.add(controller);
    response.on("close", () => { controller.abort(); inflight.delete(controller); });
    try {
      // The header the token came in is the header the key goes out in.
      const style = sameSecret(bearer(request.headers.authorization), token) ? "bearer" : sameSecret(single(request.headers["x-api-key"]), token) ? "x-api-key" : null;
      if (!style) { stats.refused += 1; return refuse(response, 401, "unknown token"); }
      // The path is resolved first, so `..` or an encoded slash cannot climb out of the base path or change the host.
      const target = new URL(request.url ?? "/", pin.origin);
      if (target.origin !== pin.origin || !(target.pathname === pin.basePath || target.pathname.startsWith(`${pin.basePath}/`)) || /%2f|%5c/iu.test(request.url ?? "")) {
        stats.refused += 1;
        return refuse(response, 404, "path outside the pinned upstream");
      }
      const headers = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (!REQUEST_DROPPED.has(name.toLowerCase()) && value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
      }
      if (style === "bearer") headers.authorization = `Bearer ${apiKey}`;
      else headers["x-api-key"] = apiKey;
      const body = ["GET", "HEAD"].includes(request.method) ? undefined : await readBody(request);
      let upstreamResponse;
      try {
        upstreamResponse = await fetchImpl(target, { method: request.method, headers, body, redirect: "manual", signal: controller.signal });
      } catch (error) {
        // The message names the cause only: never the key, never the request.
        stats.refused += 1;
        return refuse(response, 502, `upstream unreachable (${error?.name ?? "error"})`);
      }
      stats.forwarded += 1;
      const responseHeaders = {};
      upstreamResponse.headers.forEach((value, name) => { if (!RESPONSE_DROPPED.has(name.toLowerCase())) responseHeaders[name] = value; });
      response.writeHead(upstreamResponse.status, responseHeaders);
      if (!upstreamResponse.body) return response.end();
      Readable.fromWeb(upstreamResponse.body).on("error", () => response.destroy()).pipe(response);
    } catch (error) {
      stats.refused += 1;
      if (!response.headersSent) refuse(response, error?.status ?? 500, error?.status ? error.message : "internal error");
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}${pin.basePath}`,
    upstream: `${pin.origin}${pin.basePath}`,
    token,
    stats,
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of inflight) controller.abort();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
