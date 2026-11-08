// Synthesized, seeded sound for the smoke reference: room tone, the dropped
// lift, the scrape of the pivot, the landing and the breath. The same function
// fills the player's AudioBuffer and the exported WAV, so they agree.
(function (root) {
  function synthesize(rate, seconds = 24) {
    const n = Math.round(rate * seconds);
    const out = new Float32Array(n);
    let s = 2024;
    const noise = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; };
    let low = 0, band = 0;
    const thump = (t, at, freq, decay, gain) => (t >= at ? gain * Math.exp(-(t - at) * decay) * Math.sin(2 * Math.PI * freq * (t - at) * (1 - 0.3 * (t - at))) : 0);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const w = noise();
      low += 0.02 * (w - low);
      band += 0.25 * (w - band);
      let v = 0.04 * low; // room tone
      v += thump(t, 6.05, 55, 9, 0.55) + thump(t, 18.4, 48, 7, 0.65); // the drop and the landing
      if (t > 12.4 && t < 16.8) v += 0.12 * (band - low) * (0.6 + 0.4 * Math.sin(t * 9)) * Math.sin(Math.PI * (t - 12.4) / 4.4); // scrape
      if (t > 4.8 && t < 5.9) v += 0.05 * Math.sin(2 * Math.PI * 140 * t) * Math.sin(Math.PI * (t - 4.8) / 1.1); // strain hum
      if (t > 21.6 && t < 22.9) v += 0.10 * (w - band) * Math.sin(Math.PI * (t - 21.6) / 1.3); // the breath
      const fade = Math.min(1, t / 0.3, (seconds - t) / 0.3);
      out[i] = v * fade;
    }
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    const scale = 0.5 / peak; // -6 dBFS sample peak leaves true-peak headroom after AAC
    for (let i = 0; i < n; i++) out[i] *= scale;
    return out;
  }
  root.HeavySuitcaseSound = { synthesize };
})(typeof window !== 'undefined' ? window : globalThis);
