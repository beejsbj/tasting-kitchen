import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runChecks } from '../lib/taste/checks.mjs';

const ids = ['respond-to-short-journal', 'support-short-journal', 'challenge-short-journal'];
test('journal comparisons share exact material and reject incomplete or misbound responses', async () => {
  const entries = [];
  for (const id of ids) {
    const recipe = JSON.parse(await readFile(new URL(`../catalog/recipes/conversation-journaling/${id}/recipe.json`, import.meta.url)));
    entries.push(recipe.turns[0].content.split('\n\n').slice(1).join('\n\n'));
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'journal-contract-'));
    try {
      await mkdir(path.join(workspace, 'output'));
      const turn = { id: 'respond', role: 'prompt', prompt: `${recipe.setup.instructions}\n\n${recipe.turns[0].content}`, response: 'A complete response.', actions: [] };
      const valid = { schemaVersion: 1, recipeId: id, turns: [turn] };
      const cases = [
        [valid, true],
        [{ ...valid, recipeId: 'another-recipe' }, false],
        [{ ...valid, turns: [] }, false],
        [{ ...valid, turns: [turn, turn] }, false],
        [{ ...valid, turns: [{ ...turn, response: '  ' }] }, false],
        [{ ...valid, turns: [{ ...turn, prompt: 'Different input' }] }, false],
      ];
      for (const [artifact, expected] of cases) {
        await writeFile(path.join(workspace, 'output/session.json'), JSON.stringify(artifact));
        assert.equal((await runChecks(recipe, workspace)).passed, expected);
      }
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
  assert.ok(entries[0].includes('finishes through.'));
  assert.equal(new Set(entries).size, 1);
});
