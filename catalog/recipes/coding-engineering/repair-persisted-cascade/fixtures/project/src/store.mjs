export function saveState(storage, blocks) {
  storage.value = JSON.stringify({ blocks: [blocks[0]] });
}

export function loadState(storage) {
  return JSON.parse(storage.value).blocks;
}
