export type DishVote = 'up' | 'down';
export type DishVotes = Record<string, DishVote>;

const STORAGE_KEY = 'tasting-kitchen:dish-votes:v1';

type VoteStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): VoteStorage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

export function readDishVotes(storage = browserStorage()): DishVotes {
  if (!storage) return {};
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, DishVote] => entry[1] === 'up' || entry[1] === 'down'));
  } catch { return {}; }
}

export function writeDishVote(dishId: string, vote: DishVote, votes: DishVotes, storage = browserStorage()): DishVotes {
  const next = { ...votes };
  if (next[dishId] === vote) delete next[dishId];
  else next[dishId] = vote;
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep voting usable when browser storage is unavailable. */ }
  return next;
}
