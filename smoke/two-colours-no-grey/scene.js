// Two colours, no grey: Kitchen's schematic smoke picture. A lamp drifts past a
// row of posts; light falls off in an ordered dither of 3-pixel cells, so every
// pixel is exactly ink or paper. Written with putImageData, so nothing is
// antialiased. A pure function of time.
globalThis.Scene = {
  background: "#14213d",
  ink: [0x14, 0x21, 0x3d],
  paper: [0xfc, 0xa3, 0x11],
  bayer: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
  draw(ctx, t, w, h) {
    const image = ctx.createImageData(w, h), data = image.data, cell = 3;
    const lx = w * (0.5 + 0.38 * Math.sin(t * 0.26)), ly = h * (0.42 + 0.12 * Math.cos(t * 0.4));
    for (let y = 0; y < h; y++) {
      const by = Math.floor(y / cell) & 3;
      for (let x = 0; x < w; x++) {
        // Posts stand in front of the light and stay in shadow; the floor below catches it.
        const post = (Math.floor((x + t * 40) / 180) % 2 === 0) && (x + t * 40) % 180 < 50 && y > h * 0.3;
        const d = Math.hypot(x - lx, (y - ly) * 1.2) / (w * 0.55);
        const light = post ? 0.02 : Math.max(0, 1 - d) ** 1.6;
        const on = light * 16 > this.bayer[by * 4 + (Math.floor(x / cell) & 3)] + 0.5;
        const [r, g, b] = on ? this.paper : this.ink, i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  },
  // A low hum that swells as the lamp passes the middle.
  sound(rate, duration) {
    const out = new Float32Array(Math.round(rate * duration));
    for (let i = 0; i < out.length; i++) {
      const t = i / rate, swell = 0.5 + 0.5 * Math.cos(t * 0.26 * 2), fade = Math.min(1, t / 1.5, (duration - t) / 1.5);
      out[i] = 0.18 * fade * (0.6 + 0.4 * swell) * (Math.sin(2 * Math.PI * 110 * t) + 0.3 * Math.sin(2 * Math.PI * 165 * t));
    }
    return out;
  },
};
