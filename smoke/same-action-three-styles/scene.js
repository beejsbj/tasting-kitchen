// Same action, three styles: Kitchen's schematic smoke picture. A ball is tossed
// into a bucket, three times: flat shapes on navy (0-8 s), line drawing on paper
// in a wide and a close shot (8-16 s), and chunky pixels on green (16-24 s).
// A pure function of time.
globalThis.Scene = {
  background: "#1d3557",
  fps: 24,
  shots: [
    { id: "flat", start: 0, end: 192 },
    { id: "line-wide", start: 192, end: 288 },
    { id: "line-close", start: 288, end: 384 },
    { id: "pixel", start: 384, end: 576 },
  ],
  shotAt(t) { const frame = Math.floor(t * this.fps + 1e-6); return this.shots.find((shot) => frame < shot.end) ?? this.shots.at(-1); },
  // The action, 0-8 s: the ball's place in a unit frame, and whether it has landed.
  ball(u) { const p = Math.min(1, Math.max(0, (u - 1) / 5)); return { x: 0.15 + 0.7 * p, y: 0.75 - 1.6 * p * (1 - p) - (p >= 1 ? -0.05 : 0) }; },
  draw(ctx, t, w, h) {
    const shot = this.shotAt(t), u = t % 8, { x, y } = this.ball(u);
    if (shot.id === "flat") {
      ctx.fillStyle = "#1d3557"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#e63946"; ctx.fillRect(w * 0.8, h * 0.7, w * 0.1, h * 0.2);
      ctx.fillStyle = "#f1faee"; ctx.beginPath(); ctx.arc(x * w, y * h, 40, 0, Math.PI * 2); ctx.fill();
    } else if (shot.id.startsWith("line")) {
      const zoom = shot.id === "line-close" ? 2.2 : 1, cx = shot.id === "line-close" ? x : 0.5, cy = shot.id === "line-close" ? y : 0.5;
      ctx.fillStyle = "#fbf8f0"; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(zoom, zoom); ctx.translate(-cx * w, -cy * h);
      ctx.strokeStyle = "#222"; ctx.lineWidth = 5;
      ctx.strokeRect(w * 0.8, h * 0.7, w * 0.1, h * 0.2);
      ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(x * w, y * h, 40, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      const px = 40;
      ctx.fillStyle = "#2a9d3f"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#264653"; ctx.fillRect(Math.round(w * 0.8 / px) * px, Math.round(h * 0.7 / px) * px, px * 5, px * 5);
      ctx.fillStyle = "#e9c46a"; ctx.fillRect(Math.round((x * w) / px) * px - px, Math.round((y * h) / px) * px - px, px * 2, px * 2);
    }
  },
  // A rising whistle for each toss and a knock when the ball lands, three times.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, u = t % 8;
      const whistle = u > 1 && u < 6 ? 0.12 * Math.sin(2 * Math.PI * (300 + 60 * u) * u) : 0;
      const knock = u >= 6 ? 0.4 * Math.exp(-(u - 6) * 12) * Math.sin(2 * Math.PI * 90 * (u - 6)) : 0;
      out[i] = whistle + knock;
    }
    return out;
  },
};
