import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.VOTE_PORT ?? 3001);
const defaultDataPath = process.env.VOTE_DATA_PATH ?? '/data/votes.json';
const defaultAllowedOrigin = process.env.PUBLIC_ORIGIN ?? 'https://tasting-kitchen.burooj.dev';
const emptyStore = () => ({ version: 1, votes: {} });
let writeQueue = Promise.resolve();

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function firstForwardedAddress(request) {
  return String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim().replace(/^::ffff:/, '');
}

export function isTrustedRequest(request) {
  if (request.headers['cf-ray']) return false;
  const address = firstForwardedAddress(request);
  if (address === '127.0.0.1' || address === '::1') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/u.test(address)) return true;
  const tailscale = address.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u);
  if (tailscale && Number(tailscale[1]) >= 64 && Number(tailscale[1]) <= 127) return true;
  return address.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

function validVoteRecord(value) {
  return value && typeof value === 'object' && (value.vote === 'up' || value.vote === 'down' || value.vote === null) && typeof value.changedAt === 'string' && Number.isFinite(Date.parse(value.changedAt));
}

async function loadStore(storePath) {
  try {
    const value = JSON.parse(await readFile(storePath, 'utf8'));
    if (!value || value.version !== 1 || typeof value.votes !== 'object') return emptyStore();
    return { version: 1, votes: Object.fromEntries(Object.entries(value.votes).filter(([, vote]) => validVoteRecord(vote))) };
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

async function saveStore(storePath, store) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, storePath);
}

function mergeVotes(serverVotes, incomingVotes) {
  const merged = { ...serverVotes };
  for (const [dishId, incoming] of Object.entries(incomingVotes ?? {})) {
    if (!/^dish_[a-z0-9_-]+$/u.test(dishId) || !validVoteRecord(incoming)) continue;
    const current = merged[dishId];
    if (!current || Date.parse(incoming.changedAt) >= Date.parse(current.changedAt)) merged[dishId] = incoming;
  }
  return merged;
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createVoteServer({ dataPath = defaultDataPath, allowedOrigin = defaultAllowedOrigin } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/healthz') return json(response, 200, { ok: true });
      if (url.pathname === '/votes/sync' && request.method === 'POST' && !isTrustedRequest(request)) return json(response, 200, { mode: 'local' });
      if (!isTrustedRequest(request)) return json(response, 403, { mode: 'local' });
      if (request.method !== 'GET' && request.headers.origin && request.headers.origin !== allowedOrigin) return json(response, 403, { error: 'origin_not_allowed' });
      if (url.pathname === '/votes' && request.method === 'GET') return json(response, 200, { mode: 'synced', votes: (await loadStore(dataPath)).votes });
      if ((url.pathname === '/votes' && request.method === 'PUT') || (url.pathname === '/votes/sync' && request.method === 'POST')) {
        const input = await body(request);
        let result;
        writeQueue = writeQueue.then(async () => {
          const store = await loadStore(dataPath);
          store.votes = mergeVotes(store.votes, input.votes);
          await saveStore(dataPath, store);
          result = store;
        });
        await writeQueue;
        return json(response, 200, { mode: 'synced', votes: result.votes });
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      return json(response, error?.message === 'body_too_large' ? 413 : 400, { error: 'invalid_request' });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) createVoteServer().listen(port, '127.0.0.1');
