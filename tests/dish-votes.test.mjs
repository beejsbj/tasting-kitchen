import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readDishVotes, saveDishVotes, syncDishVotes, voteFor, writeDishVote } from '../src/lib/dish-votes.ts';
import { createVoteServer, isTrustedRequest } from '../server/votes-server.mjs';

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test('dish votes persist one timestamped opinion per immutable Dish and preserve clear tombstones', () => {
  const storage = memoryStorage();
  const first = new Date('2026-09-07T20:00:00Z');
  let votes = writeDishVote('dish-a', 'up', {}, storage, first);
  assert.equal(voteFor(readDishVotes(storage), 'dish-a'), 'up');
  votes = writeDishVote('dish-b', 'down', votes, storage, first);
  assert.equal(voteFor(readDishVotes(storage), 'dish-b'), 'down');
  writeDishVote('dish-a', 'up', votes, storage, new Date('2026-09-07T20:01:00Z'));
  assert.equal(voteFor(readDishVotes(storage), 'dish-a'), null);
});

test('dish votes migrate legacy values and discard malformed stored values', () => {
  assert.deepEqual(readDishVotes(memoryStorage('{broken')), {});
  const votes = readDishVotes(memoryStorage(JSON.stringify({ good: 'up', bad: 'maybe', down: 'down' })));
  assert.equal(voteFor(votes, 'good'), 'up'); assert.equal(voteFor(votes, 'down'), 'down'); assert.equal(voteFor(votes, 'bad'), undefined);
});

test('trusted request classification accepts LAN and Tailscale but rejects Cloudflare', () => {
  assert.equal(isTrustedRequest({ headers: { 'x-forwarded-for': '192.168.0.12' } }), true);
  assert.equal(isTrustedRequest({ headers: { 'x-forwarded-for': '100.88.20.4' } }), true);
  assert.equal(isTrustedRequest({ headers: { 'x-forwarded-for': '8.8.8.8', 'cf-ray': 'public' } }), false);
  assert.equal(isTrustedRequest({ headers: { 'x-forwarded-for': '192.168.0.12', 'cf-ray': 'spoof-safe-deny' } }), false);
});

test('vote server merges latest records and rejects public writes', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tasting-votes-'));
  const dataPath = path.join(directory, 'votes.json');
  const server = createVoteServer({ dataPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const trusted = { 'x-forwarded-for': '100.88.20.4', 'content-type': 'application/json' };
  const record = { vote: 'up', changedAt: '2026-09-07T20:00:00.000Z' };
  const saved = await fetch(`${origin}/votes/sync`, { method: 'POST', headers: trusted, body: JSON.stringify({ votes: { dish_valid: record } }) });
  assert.equal(saved.status, 200); assert.equal((await saved.json()).mode, 'synced');
  const stale = { vote: 'down', changedAt: '2026-09-07T19:00:00.000Z' };
  const merged = await fetch(`${origin}/votes`, { method: 'PUT', headers: trusted, body: JSON.stringify({ votes: { dish_valid: stale } }) }).then(response => response.json());
  assert.deepEqual(merged.votes.dish_valid, record);
  assert.equal((await fetch(`${origin}/votes/sync`, { method: 'POST', headers: { ...trusted, 'cf-ray': 'public' }, body: '{}' })).status, 200);
  assert.equal((await fetch(`${origin}/votes`, { method: 'PUT', headers: { ...trusted, 'cf-ray': 'public' }, body: '{}' })).status, 403);
  assert.deepEqual(JSON.parse(await readFile(dataPath, 'utf8')).votes.dish_valid, record);
});

test('client sync retains local mode on public denial and accepts trusted merged votes', async () => {
  const storage = memoryStorage();
  const local = writeDishVote('dish_local', 'up', {}, storage, new Date('2026-09-07T20:00:00Z'));
  const denied = await syncDishVotes(local, async () => new Response('{}', { status: 403 }));
  assert.equal(denied.mode, 'local'); assert.equal(voteFor(denied.votes, 'dish_local'), 'up');
  const synced = await syncDishVotes(local, async () => Response.json({ mode: 'synced', votes: local }));
  assert.equal(synced.mode, 'synced');
  assert.equal(await saveDishVotes(local, async () => new Response('{}', { status: 200 })), 'synced');
});
