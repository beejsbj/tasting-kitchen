// Cut to a track: Kitchen's schematic smoke picture. Seven shots, each a field
// of one colour with a shape crossing it; the cuts land with the track at 4.8,
// 9.6, 15.0 and 25.2 s and against it at 12.0 and 19.0 s. The soundtrack is the
// supplied track itself. A pure function of time.
globalThis.Scene = {
  background: "#101820",
  fps: 24,
  shots: [
    { id: "kick-run", start: 0, end: 115, bg: "#101820", fg: "#f2aa4c" },
    { id: "bar-two", start: 115, end: 230, bg: "#f2aa4c", fg: "#101820" },
    { id: "before-the-stop", start: 230, end: 288, bg: "#2c5f2d", fg: "#ffe77a" },
    { id: "into-silence", start: 288, end: 360, bg: "#e7e8d1", fg: "#a7beae" },
    { id: "drone", start: 360, end: 456, bg: "#1b1b3a", fg: "#ff6f59" },
    { id: "against-the-grid", start: 456, end: 605, bg: "#ff6f59", fg: "#1b1b3a" },
    { id: "boom", start: 605, end: 720, bg: "#0b0b0b", fg: "#ffffff" },
  ],
  shotAt(t) { const frame = Math.floor(t * this.fps + 1e-6); return this.shots.find((shot) => frame < shot.end) ?? this.shots.at(-1); },
  draw(ctx, t, w, h) {
    const shot = this.shotAt(t), local = t - shot.start / this.fps, length = (shot.end - shot.start) / this.fps;
    ctx.fillStyle = shot.bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shot.fg; ctx.beginPath();
    ctx.arc(w * (0.15 + 0.7 * (local / length)), h * 0.5, h * 0.18, 0, Math.PI * 2); ctx.fill();
  },
};
