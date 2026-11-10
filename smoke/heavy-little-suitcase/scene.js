// Heavy little suitcase: Kitchen's no-model smoke reference. Not a Dish and not
// a benchmark answer; it exists to prove the toolchain renders, validates,
// sanitizes and plays a film of this Recipe's exact contract.
// The picture is a pure function of time: drawScene(ctx, t) for t in [0, 24).
(function (root) {
  const W = 1080, H = 1920;
  const PAPER = '#efe7d4', GRAPHITE = '#3b3a38', SOFT = 'rgba(59,58,56,0.35)', TAG = '#c4512d';
  const FLOOR = 1500, PLATFORM = { x: 640, y: 1330, w: 380, h: 170 };
  const CASE = { w: 300, h: 210 };

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (v) => { const x = clamp(v); return x * x * (3 - 2 * x); };
  const span = (t, a, b) => ease((t - a) / (b - a));
  const lerp = (a, b, k) => a + (b - a) * k;
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // Paper grain is fixed; only the pencil wobble breathes, eight times a second.
  let grain = null;
  function paper(ctx) {
    if (!grain) {
      grain = [];
      const r = rng(11);
      for (let i = 0; i < 2600; i++) grain.push([r() * W, r() * H, 0.5 + r() * 1.6, 0.04 + r() * 0.08]);
    }
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    for (const [x, y, s, a] of grain) { ctx.fillStyle = `rgba(90,80,60,${a})`; ctx.fillRect(x, y, s, s); }
  }

  function pencil(ctx, t, seed, draw, width = 5) {
    const r = rng(seed * 97 + Math.floor(t * 8));
    for (let pass = 0; pass < 2; pass++) {
      ctx.save();
      ctx.translate((r() - 0.5) * 2.2, (r() - 0.5) * 2.2);
      ctx.strokeStyle = pass ? SOFT : GRAPHITE; ctx.lineWidth = pass ? width * 0.6 : width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); draw(); ctx.stroke();
      ctx.restore();
    }
  }

  // Suitcase pose: centre, rotation about its own centre, from the action beats.
  function casePose(t) {
    const restX = 380, restY = FLOOR - CASE.h / 2;
    // failed lift: rises 18 px, slips back
    const lift = span(t, 4.7, 5.4) * (1 - span(t, 5.9, 6.15)) * 18;
    // corner pivot: tilt onto the lower right corner, then lever over the platform edge
    const tilt = span(t, 12.2, 14.2);
    const lever = span(t, 14.4, 17.2);
    const slide = span(t, 17.2, 18.4);
    let angle = -0.55 * tilt + 0.55 * lever;
    let x = restX + tilt * 40 + lever * 230 + slide * 70;
    let y = restY - lift - tilt * 40 - lever * (FLOOR - PLATFORM.y + 30) + slide * 30;
    // landing: a short settle bounce at 18.4 s
    const settle = t > 18.4 ? Math.exp(-(t - 18.4) * 6) * Math.sin((t - 18.4) * 28) * 6 : 0;
    if (t >= 18.4) { x = restX + 340; y = PLATFORM.y - CASE.h / 2 + settle; angle = 0; }
    return { x, y, angle };
  }

  function drawCase(ctx, t) {
    const p = casePose(t);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.fillStyle = 'rgba(70,64,56,0.10)'; ctx.fillRect(-CASE.w / 2, -CASE.h / 2, CASE.w, CASE.h);
    pencil(ctx, t, 3, () => { ctx.rect(-CASE.w / 2, -CASE.h / 2, CASE.w, CASE.h); ctx.moveTo(-CASE.w / 2 + 20, -CASE.h / 2 + 36); ctx.lineTo(CASE.w / 2 - 20, -CASE.h / 2 + 36); }, 6);
    pencil(ctx, t, 4, () => { ctx.moveTo(-50, -CASE.h / 2); ctx.lineTo(-40, -CASE.h / 2 - 34); ctx.lineTo(40, -CASE.h / 2 - 34); ctx.lineTo(50, -CASE.h / 2); }, 6);
    ctx.fillStyle = TAG; ctx.beginPath(); ctx.moveTo(60, -CASE.h / 2 + 10); ctx.lineTo(100, -CASE.h / 2 + 10); ctx.lineTo(110, -CASE.h / 2 + 34); ctx.lineTo(70, -CASE.h / 2 + 34); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Traveler: hips, torso lean, knee bend and hand targets drive a simple rig.
  function travelerPose(t) {
    const breath = Math.sin(t * 2.4) * 3;
    let hipX = 600, crouch = 0, lean = 0, handTarget = null, sit = 0, hipY = FLOOR - 190;
    // anticipation and failed pull
    const crouchIn = span(t, 4.0, 4.6) * (1 - span(t, 6.2, 7.0));
    crouch = crouchIn * 70; lean = -0.35 * crouchIn;
    if (t >= 4.4 && t < 6.2) handTarget = 'handle';
    if (t >= 6.0 && t < 7.0) { hipX += span(t, 6.0, 6.5) * 50 - span(t, 6.5, 7.0) * 10; lean = 0.15 * (1 - span(t, 6.5, 7.0)); }
    // reset: step to the left side of the case, wider stance
    const step = span(t, 8.0, 10.2);
    hipX = lerp(hipX, 160, step);
    if (t >= 10.4) { crouch = 40 + 30 * span(t, 12.0, 13.0) * (1 - span(t, 16.5, 17.3)); lean = 0.45; handTarget = 'corner'; }
    // climb after it, then sit
    const climb = span(t, 18.8, 20.6);
    if (t >= 17.4) { handTarget = null; lean = 0.1; crouch = 20 * (1 - climb); }
    hipX = lerp(hipX, 790, climb);
    hipY = lerp(hipY, PLATFORM.y - 150, climb);
    sit = span(t, 20.6, 21.4);
    hipY += sit * 40; crouch += sit * 60;
    return { hipX, hipY: hipY + crouch, lean, handTarget, sit, breath: t > 21 ? breath * 2 : breath, stance: t >= 10.4 && t < 17.4 ? 70 : 45 };
  }

  function drawTraveler(ctx, t) {
    const p = travelerPose(t);
    const torso = 150, headR = 42;
    const neckX = p.hipX + Math.sin(p.lean) * torso, neckY = p.hipY - Math.cos(p.lean) * torso;
    const ground = p.sit > 0.5 || t >= 20 ? PLATFORM.y : FLOOR;
    const casePos = casePose(t);
    const hand = p.handTarget === 'handle' ? [casePos.x, casePos.y - CASE.h / 2 - 30]
      : p.handTarget === 'corner' ? [casePos.x - CASE.w / 2 * Math.cos(casePos.angle) + 10, casePos.y - CASE.h / 2 + 10]
      : [neckX + 60, neckY + 120 - p.breath];
    const footL = [p.hipX - p.stance, ground], footR = [p.hipX + p.stance, ground];
    if (p.sit > 0.5) { footL[0] = p.hipX + 60; footR[0] = p.hipX + 110; footL[1] = footR[1] = PLATFORM.y + 140; }
    const knee = (foot) => [(p.hipX + foot[0]) / 2 + 30, (p.hipY + foot[1]) / 2 - 10];
    pencil(ctx, t, 7, () => {
      for (const foot of [footL, footR]) { const k = knee(foot); ctx.moveTo(p.hipX, p.hipY); ctx.lineTo(k[0], k[1]); ctx.lineTo(foot[0], foot[1]); ctx.lineTo(foot[0] + 26, foot[1]); }
      ctx.moveTo(p.hipX, p.hipY); ctx.lineTo(neckX, neckY + p.breath);
      ctx.moveTo(neckX, neckY + 20); ctx.lineTo((neckX + hand[0]) / 2, (neckY + hand[1]) / 2 + 30); ctx.lineTo(hand[0], hand[1]);
      ctx.moveTo(neckX, neckY + 26); ctx.lineTo((neckX + hand[0]) / 2 - 20, (neckY + hand[1]) / 2 + 44); ctx.lineTo(hand[0] - 14, hand[1] + 8);
    }, 7);
    pencil(ctx, t, 9, () => { ctx.moveTo(neckX + headR, neckY - headR); ctx.arc(neckX, neckY - headR + p.breath * 0.3, headR, 0, Math.PI * 2); }, 6);
    // relief: a breath leaving, drawn as three soft strokes
    const exhale = span(t, 21.6, 22.2) * (1 - span(t, 22.8, 23.4));
    if (exhale > 0) pencil(ctx, t, 13, () => { for (let i = 0; i < 3; i++) { ctx.moveTo(neckX + 56, neckY - 40 + i * 12); ctx.lineTo(neckX + 56 + 60 * exhale, neckY - 46 + i * 16); } }, 3);
    // effort marks during the failed pull and the lever
    const strain = (t > 4.8 && t < 6.0) || (t > 14.4 && t < 17.0);
    if (strain) pencil(ctx, t, 17, () => { ctx.moveTo(neckX - 60, neckY - 110); ctx.lineTo(neckX - 80, neckY - 130); ctx.moveTo(neckX + 60, neckY - 110); ctx.lineTo(neckX + 80, neckY - 130); }, 3);
  }

  function drawScene(ctx, t) {
    t = clamp(t, 0, 24 - 1e-6);
    paper(ctx);
    pencil(ctx, t, 1, () => { ctx.moveTo(40, FLOOR); ctx.lineTo(W - 40, FLOOR); }, 4);
    pencil(ctx, t, 2, () => { ctx.rect(PLATFORM.x, PLATFORM.y, PLATFORM.w, FLOOR - PLATFORM.y); }, 5);
    ctx.fillStyle = 'rgba(70,64,56,0.08)'; ctx.fillRect(PLATFORM.x, PLATFORM.y, PLATFORM.w, FLOOR - PLATFORM.y);
    drawCase(ctx, t);
    drawTraveler(ctx, t);
  }

  root.HeavySuitcase = { W, H, FPS: 24, DURATION: 24, drawScene };
})(typeof window !== 'undefined' ? window : globalThis);
