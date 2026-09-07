import assert from 'node:assert/strict';
import test from 'node:test';
import { readDishVotes, writeDishVote } from '../src/lib/dish-votes.ts';

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test('dish votes persist one opinion per immutable Dish and toggle off', () => {
  const storage = memoryStorage();
  let votes = writeDishVote('dish-a', 'up', {}, storage);
  assert.deepEqual(readDishVotes(storage), { 'dish-a': 'up' });
  votes = writeDishVote('dish-b', 'down', votes, storage);
  assert.deepEqual(readDishVotes(storage), { 'dish-a': 'up', 'dish-b': 'down' });
  writeDishVote('dish-a', 'up', votes, storage);
  assert.deepEqual(readDishVotes(storage), { 'dish-b': 'down' });
});

test('dish votes discard malformed and unknown stored values', () => {
  assert.deepEqual(readDishVotes(memoryStorage('{broken')), {});
  assert.deepEqual(readDishVotes(memoryStorage(JSON.stringify({ good: 'up', bad: 'maybe', down: 'down' }))), { good: 'up', down: 'down' });
});
