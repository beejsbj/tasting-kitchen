// Titles for a film that doesn't exist: Kitchen's schematic smoke picture. The
// title and each supplied credit fade up on a dark field; SCHEDULE holds the
// times each is fully readable. A pure function of time.
globalThis.Scene = {
  background: "#0e0f13",
  // Filled in by render.mjs from fixtures/credits.json: [{ id, lines, on, off }].
  schedule: [],
  draw(ctx, t, w, h) {
    ctx.fillStyle = this.background; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const card of this.schedule) {
      const fade = 0.4, alpha = Math.max(0, Math.min(1, (t - card.on + fade) / fade, (card.off + fade - t) / fade));
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha; ctx.fillStyle = "#e8dcc2";
      if (card.id === "title") { ctx.font = "96px 'DejaVu Serif', serif"; ctx.fillText(card.lines[0], w / 2, h / 2); }
      else {
        ctx.font = "36px 'DejaVu Sans', sans-serif"; ctx.fillText(card.lines[0], w / 2, h / 2 - 36);
        ctx.font = "64px 'DejaVu Serif', serif"; ctx.fillText(card.lines[1], w / 2, h / 2 + 32);
      }
    }
    ctx.globalAlpha = 1;
  },
  // A low drone with a slow pulse, loud enough to be a soundtrack.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, fade = Math.min(1, t / 2, (duration - t) / 2), pulse = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t);
      out[i] = 0.25 * fade * pulse * (Math.sin(2 * Math.PI * 98 * t) + 0.5 * Math.sin(2 * Math.PI * 147 * t));
    }
    return out;
  },
};
