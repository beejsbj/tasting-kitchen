// Three styleframes, then a film: Kitchen's schematic smoke picture. Scene.variant
// picks a look: "a", "b" or "c" for the styleframes, "film" for the film made
// from look b. A pure function of time.
globalThis.Scene = {
  background: "#f1ede3",
  variant: "film",
  looks: {
    // A: a grid of arrows that point wherever they like.
    a(ctx, t, w, h) {
      ctx.fillStyle = "#f1ede3"; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = "#333"; ctx.lineWidth = 5;
      for (let y = 90; y < h; y += 180) for (let x = 90; x < w; x += 180) {
        const a = t * 0.8 + x * 0.01 + y * 0.02;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60 * Math.cos(a), y + 60 * Math.sin(a)); ctx.stroke();
      }
    },
    // B: soft pastel blobs labelled with numbers that mean nothing.
    b(ctx, t, w, h, drift = 1) {
      ctx.fillStyle = "#2b2140"; ctx.fillRect(0, 0, w, h);
      const colours = ["#f6bd60", "#f28482", "#84a59d"];
      colours.forEach((colour, i) => {
        ctx.fillStyle = colour; ctx.beginPath();
        ctx.ellipse(w * (0.3 + 0.2 * i) + 60 * Math.sin(t * drift + i), h * (0.3 + 0.2 * i), 220, 160, i, 0, Math.PI * 2); ctx.fill();
      });
    },
    // C: a single thermometer filling and emptying.
    c(ctx, t, w, h) {
      ctx.fillStyle = "#dfe7ec"; ctx.fillRect(0, 0, w, h);
      const level = 0.5 + 0.4 * Math.sin(t * 2);
      ctx.fillStyle = "#c0392b"; ctx.fillRect(w / 2 - 40, h * (0.9 - 0.7 * level), 80, h * 0.7 * level);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 6; ctx.strokeRect(w / 2 - 40, h * 0.2, 80, h * 0.7);
    },
    // The film: look b's palette, slower, without the literal shapes' edges.
    film(ctx, t, w, h) {
      this.b(ctx, t, w, h, 0.3);
      ctx.fillStyle = "rgba(43, 33, 64, 0.35)"; ctx.fillRect(0, 0, w, h);
    },
  },
  draw(ctx, t, w, h) { this.looks[this.variant](ctx, t, w, h); },
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, fade = Math.min(1, t / 2, (duration - t) / 2);
      out[i] = 0.15 * fade * (Math.sin(2 * Math.PI * 196 * t) + 0.5 * Math.sin(2 * Math.PI * 293.7 * t + Math.sin(t)));
    }
    return out;
  },
};
