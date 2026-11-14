import assert from "node:assert/strict";
import test from "node:test";

import { unseenLine } from "./validation/unseen.mjs";

test("README.md must end with exactly one Unseen: line", () => {
  assert.deepEqual(unseenLine("# Notes\n\nRebuild with bun.\n\nUnseen: the dog ate the letter.\n\n"), { passed: true, unseen: "the dog ate the letter." });
  assert.equal(unseenLine("# Notes\r\nUnseen: a door closed\r\n").passed, true);
  assert.match(unseenLine("Unseen: a door closed\n\n## Limitations\nNone.\n").reason, /must end with/u);
  assert.match(unseenLine("# Notes\nUnseen:\n").reason, /must end with/u);
  assert.match(unseenLine("# Notes\nunseen: lower case\n").reason, /must end with/u);
  assert.match(unseenLine("").reason, /must end with/u);
  assert.match(unseenLine("Unseen: first guess\n\nUnseen: second guess\n").reason, /more than one/u);
});
