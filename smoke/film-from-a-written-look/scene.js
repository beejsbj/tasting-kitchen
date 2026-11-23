// Film from a written look: Kitchen's schematic smoke picture. Isobars that do
// not know what weather is drift over a paper map. A pure function of time.
globalThis.Scene = {
  background: "#e9e4d6",
  draw(ctx, t, w, h) {
    ctx.fillStyle = this.background; ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 6;
    for (let ring = 0; ring < 7; ring++) {
      const cx = w * (0.3 + 0.4 * Math.sin(t * 0.2 + ring)), cy = h * (0.35 + 0.3 * Math.cos(t * 0.15 + ring * 0.7));
      ctx.strokeStyle = ring % 2 ? "#2d4b73" : "#b5523b";
      ctx.beginPath(); ctx.ellipse(cx, cy, 80 + ring * 40, 50 + ring * 28, t * 0.1 + ring, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = "#2d4b73"; ctx.font = "bold 64px 'DejaVu Sans', sans-serif";
    ctx.fillText(t < 12 ? "H?" : "L?", w * 0.5 + 200 * Math.sin(t * 0.3), h * 0.8);
  },
  // A soft two-note pad, seeded by nothing: a pure function of the sample index.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, fade = Math.min(1, t / 2, (duration - t) / 2);
      out[i] = 0.12 * fade * (Math.sin(2 * Math.PI * 220 * t) + 0.6 * Math.sin(2 * Math.PI * (t < 12 ? 277.2 : 261.6) * t));
    }
    return out;
  },
};
