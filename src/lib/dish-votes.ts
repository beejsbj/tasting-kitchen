export type DishVote = 'up' | 'down';
export type DishVoteRecord = { vote: DishVote | null; changedAt: string };
export type DishVotes = Record<string, DishVoteRecord>;
export type VoteMode = 'local' | 'synced';

const STORAGE_KEY = 'tasting-kitchen:dish-votes:v1';
const LEGACY_DATE = '1970-01-01T00:00:00.000Z';

type VoteStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): VoteStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function validRecord(value: unknown): value is DishVoteRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DishVoteRecord>;
  return (record.vote === 'up' || record.vote === 'down' || record.vote === null) && typeof record.changedAt === 'string' && Number.isFinite(Date.parse(record.changedAt));
}

function persist(votes: DishVotes, storage = browserStorage()) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(votes)); } catch { /* Keep voting usable when browser storage is unavailable. */ }
}

export function readDishVotes(storage = browserStorage()): DishVotes {
  if (!storage) return {};
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([dishId, record]) => {
      if (record === 'up' || record === 'down') return [[dishId, { vote: record, changedAt: LEGACY_DATE }]];
      return validRecord(record) ? [[dishId, record]] : [];
    }));
  } catch { return {}; }
}

export function voteFor(votes: DishVotes, dishId: string): DishVote | null | undefined {
  return votes[dishId]?.vote;
}

export function writeDishVote(dishId: string, vote: DishVote, votes: DishVotes, storage = browserStorage(), now = new Date()): DishVotes {
  const next = { ...votes };
  if (next[dishId]?.vote === vote) next[dishId] = { vote: null, changedAt: now.toISOString() };
  else next[dishId] = { vote, changedAt: now.toISOString() };
  persist(next, storage);
  return next;
}

export async function syncDishVotes(votes: DishVotes, fetcher: typeof fetch = fetch): Promise<{ mode: VoteMode; votes: DishVotes }> {
  try {
    const response = await fetcher('/api/votes/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ votes }) });
    if (!response.ok) return { mode: 'local', votes };
    const payload = await response.json() as { mode?: unknown; votes?: unknown };
    if (payload.mode !== 'synced' || !payload.votes || typeof payload.votes !== 'object') return { mode: 'local', votes };
    const merged = Object.fromEntries(Object.entries(payload.votes).filter((entry): entry is [string, DishVoteRecord] => validRecord(entry[1])));
    persist(merged);
    return { mode: 'synced', votes: merged };
  } catch { return { mode: 'local', votes }; }
}

export async function saveDishVotes(votes: DishVotes, fetcher: typeof fetch = fetch): Promise<VoteMode> {
  try {
    const response = await fetcher('/api/votes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ votes }) });
    return response.ok ? 'synced' : 'local';
  } catch { return 'local'; }
}
