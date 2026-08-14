export function moveAndCascade(blocks, movedId, nextStart) {
  const copy = blocks.map((block) => ({ ...block }));
  const moved = copy.find((block) => block.id === movedId);
  if (!moved) throw new Error(`unknown block: ${movedId}`);
  moved.start = nextStart;
  copy.sort((a, b) => a.start - b.start);
  for (let index = 1; index < copy.length; index += 1) {
    const previous = copy[index - 1];
    const current = copy[index];
    const earliest = previous.start + previous.duration;
    if (current.start < earliest) current.start = earliest;
  }
  return copy;
}
