// One scene for the whole 35-second section.
import type { TimelineEntry } from './engine/engine';
import type { Lyrics } from './engine/lyrics';
import type { AudioData } from './engine/audio';

export function makeTimeline(_ly: Lyrics, au: AudioData): TimelineEntry[] {
  return [{ id: 'words', load: () => import('./scenes/words'), start: 0, end: au.duration }];
}
