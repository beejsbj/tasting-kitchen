// Invent a style and hold it: Kitchen's schematic smoke picture in the style
// "Quarter Tiles" (see STYLE.md). Two tiles meet and push; at 20 s they press
// hardest. A pure function of time.
globalThis.Scene = {
  background: "#f4efe4",
  draw(ctx, t, w, h) {
    const unit = w / 12;
    ctx.fillStyle = this.background; ctx.fillRect(0, 0, w, h);
    // Rule 1 and 2: everything sits on a 12-unit grid and moves in quarter-unit steps.
    const step = (value) => Math.round(value * 4) / 4;
    const push = step(Math.min(4.5, Math.max(0, (t - 4) * 0.28)));
    const squeeze = t > 18 && t < 22 ? step(0.5 * Math.sin(((t - 18) / 4) * Math.PI)) : 0;
    ctx.fillStyle = "#1f3a5f"; ctx.fillRect(unit * (1 + push), unit * 5, unit * (3 - squeeze), unit * 2);
    ctx.fillStyle = "#d1495b"; ctx.fillRect(unit * (8 - push + squeeze), unit * 5, unit * 3, unit * 2);
    // Rule 3: one horizon line, never broken.
    ctx.fillStyle = "#1f3a5f"; ctx.fillRect(0, unit * 7, w, unit / 8);
  },
  // Rule 5: one bass note per quarter-unit step.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, beat = t % 0.5, fade = Math.min(1, t / 1, (duration - t) / 1);
      out[i] = 0.3 * fade * Math.exp(-beat * 8) * Math.sin(2 * Math.PI * (t > 18 && t < 22 ? 82.4 : 65.4) * t);
    }
    return out;
  },
};
