// Shoot coverage, then cut: Kitchen's schematic smoke rushes. The event, 16 s:
// a ball rolls along a table, drops off the edge at 9 s and tips a cup at 10 s.
// Scene.variant is the camera: wide, close, high or low, each one continuous
// take with its own framing and ground colour. A pure function of time.
globalThis.Scene = {
  background: "#d9cbb0",
  variant: "wide",
  cameras: {
    wide: { bg: "#d9cbb0", zoom: 1, cx: 0.5, cy: 0.5, follow: false },
    close: { bg: "#3a3f58", zoom: 2.6, cx: 0.5, cy: 0.5, follow: true },
    high: { bg: "#8fb9a8", zoom: 1.4, cx: 0.62, cy: 0.62, follow: false, tilt: 0.55 },
    low: { bg: "#f4d35e", zoom: 1.8, cx: 0.72, cy: 0.66, follow: false },
  },
  // The event in a unit room: ball position and cup tilt at time t.
  event(t) {
    const roll = Math.min(1, t / 9), x = 0.2 + 0.45 * roll;
    const fall = Math.max(0, Math.min(1, t - 9));
    const ball = { x: x + 0.05 * fall, y: 0.5 + 0.25 * fall * fall };
    const tip = Math.max(0, Math.min(1, (t - 10) / 1)) * (Math.PI / 2);
    return { ball, tip };
  },
  draw(ctx, t, w, h) {
    const cam = this.cameras[this.variant], { ball, tip } = this.event(t);
    const cx = cam.follow ? ball.x : cam.cx, cy = cam.follow ? ball.y : cam.cy;
    ctx.fillStyle = cam.bg; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(cam.zoom, cam.zoom * (cam.tilt ?? 1)); ctx.translate(-cx * w, -cy * h);
    ctx.fillStyle = "#5b3a29"; ctx.fillRect(w * 0.1, h * 0.52, w * 0.55, h * 0.03);
    ctx.fillStyle = "#33312e"; ctx.fillRect(w * 0.1, h * 0.78, w * 0.85, h * 0.02);
    ctx.save(); ctx.translate(w * 0.75, h * 0.78); ctx.rotate(tip); ctx.fillStyle = "#c8553d"; ctx.fillRect(0, -h * 0.08, w * 0.04, h * 0.08); ctx.restore();
    ctx.fillStyle = "#1b4965"; ctx.beginPath(); ctx.arc(ball.x * w, ball.y * h - h * 0.02, h * 0.02, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },
  // Room tone for the cuts; the rushes are silent.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, fade = Math.min(1, t / 1, (duration - t) / 1);
      out[i] = 0.1 * fade * (Math.sin(2 * Math.PI * 120 * t) + 0.4 * Math.sin(2 * Math.PI * 180.5 * t));
    }
    return out;
  },
};
