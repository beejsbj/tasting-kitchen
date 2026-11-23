// The thing we never see: Kitchen's schematic smoke picture. A vase on a shelf
// and a cat's tail; a face that turns at a crash we only hear; the shelf empty
// and shards on the floor. A pure function of time.
globalThis.Scene = {
  background: "#e8d8c3",
  fps: 24,
  shots: [
    { id: "shelf", start: 0, end: 280 },
    { id: "face", start: 280, end: 380 },
    { id: "floor", start: 380, end: 600 },
  ],
  shotAt(t) { const frame = Math.floor(t * this.fps + 1e-6); return this.shots.find((shot) => frame < shot.end) ?? this.shots.at(-1); },
  draw(ctx, t, w, h) {
    const shot = this.shotAt(t), local = t - shot.start / this.fps;
    if (shot.id === "shelf") {
      ctx.fillStyle = "#e8d8c3"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#6b4f3a"; ctx.fillRect(w * 0.2, h * 0.55, w * 0.6, 24);
      ctx.fillStyle = "#3d6b8c"; ctx.fillRect(w * 0.62, h * 0.55 - 180, 90, 180);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 18; ctx.beginPath();
      ctx.moveTo(w * 0.3, h * 0.55); ctx.quadraticCurveTo(w * 0.3 + 60 * Math.sin(local * 1.5), h * 0.45, w * 0.33, h * 0.35); ctx.stroke();
    } else if (shot.id === "face") {
      ctx.fillStyle = "#24283b"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f1c27d"; ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2); ctx.fill();
      const open = local < 1.2 ? 8 : 8 + Math.min(1, (local - 1.2) / 0.4) * 30;
      ctx.fillStyle = "#111"; for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(w / 2 + side * 90, h / 2 - 40, 26, open, 0, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.fillStyle = "#c9b79c"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#3d6b8c";
      for (let i = 0; i < 9; i++) ctx.fillRect(w * 0.3 + i * 110 + 10 * Math.sin(i * 7), h * 0.7 + 30 * Math.cos(i * 3), 50, 24);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(0, h * 0.7 + 60, w * Math.min(1, local / 9), 6);
    }
  },
  // Room tone, then a crash heard while we watch the face (12.5 s), then quiet.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    let seed = 7;
    const noise = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 1073741824 - 1; };
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, fade = Math.min(1, t / 1, (duration - t) / 1);
      const crash = t >= 12.5 ? Math.exp(-(t - 12.5) * 6) * 0.45 * noise() : 0;
      out[i] = fade * (0.06 * Math.sin(2 * Math.PI * 60 * t) + 0.02 * noise()) + crash;
    }
    return out;
  },
};
