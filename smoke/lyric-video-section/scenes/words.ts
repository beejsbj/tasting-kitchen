// Kitchen's no-model smoke scene: paper, the current line, each word appearing
// on its supplied onset. It proves the pinned engine renders the supplied
// timing; it is not a lyric video and makes no visual claim.
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, LIN } from '../engine/palette';

export default class Words extends Scene {
  text = new Layer2D();

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, lyrics } = this.ctx;
    clearRT(renderer, out, LIN.paper);
    const c = this.text.ctx;
    this.text.clear();
    const line = lyrics.lineAt(f.t) ?? lyrics.lastLine(f.t);
    if (line) {
      const size = 104;
      c.font = font(F.pop(100, 800), size);
      c.textBaseline = 'middle';
      c.textAlign = 'center';
      const widths = line.words.map((w) => c.measureText(`${w.w} `).width);
      const rows: number[][] = [[]];
      let used = 0;
      for (const [i, width] of widths.entries()) {
        if (used + width > W - 240 && rows.at(-1)!.length) { rows.push([]); used = 0; }
        rows.at(-1)!.push(i); used += width;
      }
      rows.forEach((row, r) => {
        const total = row.reduce((sum, i) => sum + widths[i]!, 0);
        let x = (W - total) / 2;
        const y = H / 2 + (r - (rows.length - 1) / 2) * size * 1.25;
        for (const i of row) {
          const w = line.words[i]!;
          const on = f.t >= w.start;
          c.fillStyle = on ? rgba('ink') : rgba('ink', 0.12);
          c.fillText(w.w, x + widths[i]! / 2, y);
          x += widths[i]!;
        }
      });
    }
    comp.draw(renderer, this.text.upload(), out);
    return { hud: 0 };
  }
}
