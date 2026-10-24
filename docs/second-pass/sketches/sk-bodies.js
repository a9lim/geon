
/* ---------- Fig. 2: bodies and their histories, one drawing ---------- */
function r2_Bodies() {
  const canvas = $('#cv-bodies');
  const cap = captioner($('#cap-bodies'));
  const bToday = $('#bd-today'), bProp = $('#bd-prop');
  // Units: c = 1, the scene spans x in [-30, 30]; RATE sim units pass per real second.
  const RATE = 9, KEEP = 64, SAMPLE = 0.25, BEAD = 4, HALF = 30;
  let tNow = 0, mode = 'prop', sel = 1, geom = null;

  const circ = (cx, cy, R, v, ph, dir = 1) => {
    const w = dir * v / R;
    return t => [cx + R * Math.cos(w * t + ph), cy + R * Math.sin(w * t + ph), -R * w * Math.sin(w * t + ph), R * w * Math.cos(w * t + ph)];
  };
  const NUC = [-15, -2.6], BH = [17.5, -1], PS = [1.5, -7];
  const bodies = [
    { name: 'the nucleus', m: 6, q: 3, spin: 0.03, f: circ(NUC[0], NUC[1], 0.35, 0.02, 0) },
    { name: 'the inner electron', m: 0.45, q: -1, spin: 0.2, f: circ(NUC[0], NUC[1], 6.2, 0.55, 0) },
    { name: 'the outer electron', m: 0.45, q: -1, spin: -0.15, f: circ(NUC[0], NUC[1], 9.6, 0.3, 2.2, -1) },
    { name: 'the electron of positronium', m: 0.45, q: -1, spin: 0.25, f: circ(PS[0], PS[1], 2.4, 0.28, 0) },
    { name: 'the positron', m: 0.45, q: 1, anti: true, spin: -0.25, f: circ(PS[0], PS[1], 2.4, 0.28, Math.PI) },
    { name: 'the neutral body', m: 1.6, q: 0, spin: 0.08, f: t => { const w1 = 0.021, w2 = 0.033; return [2 + 8 * Math.sin(w1 * t), 6.5 + 3 * Math.sin(w2 * t + 1), 8 * w1 * Math.cos(w1 * t), 3 * w2 * Math.cos(w2 * t + 1)]; } },
    { name: 'the black hole', m: 9, bh: true, a: 0.8, f: () => [BH[0], BH[1], 0, 0] },
    { name: 'the body orbiting the hole', m: 1.1, q: 0, spin: 0.12, f: circ(BH[0], BH[1], 7.2, 0.62, 1) },
  ];
  for (const b of bodies) { b.hist = []; b.tau = 0; }

  function sample(t) {
    for (const b of bodies) {
      const last = b.hist[b.hist.length - 1];
      for (let tt = last ? last.t + SAMPLE : t - KEEP; tt <= t + 1e-9; tt += SAMPLE) {
        const [x, y, vx, vy] = b.f(tt);
        if (b.hist.length) b.tau += SAMPLE * Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy));
        b.hist.push({ x, y, t: tt, tau: b.tau });
      }
      while (b.hist.length && b.hist[0].t < t - KEEP) b.hist.shift();
    }
  }
  function step(dt) { tNow += dt * RATE; sample(tNow); }

  const sk = makeSketch(canvas, { layout() {}, step, draw });
  sample(0);
  for (let i = 0; i < 400; i++) step(1 / 60);

  const setMode = (m) => { mode = m; bToday.setAttribute('aria-pressed', String(m === 'today')); bProp.setAttribute('aria-pressed', String(m === 'prop')); sk.draw(); };
  bToday.addEventListener('click', () => setMode('today'));
  bProp.addEventListener('click', () => setMode('prop'));
  setMode('prop');

  canvas.addEventListener('click', e => {
    if (!geom) return;
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 34;
    bodies.forEach((b, k) => { const [x, y] = b.f(tNow), p = geom.P(x, y), d = Math.hypot(p[0] - mx, p[1] - my); if (d < bd) { bd = d; best = k; } });
    sel = best; sk.draw();
  });

  // r₊ = M(1 + √(1 − a²)) = 1.6M at a = 0.8M; drawn 2.2 units across the horizon
  const radius = (b, S) => b.bh ? S * 2.2 : S * 0.5 * Math.cbrt(b.m);

  function todayColor(b) {
    if (b.bh) return tok.text;
    const t = clamp(Math.abs(b.q) / 5, 0, 1);
    return b.q > 0 ? mix(tok.muted, tok['ink-sienna'], t) : b.q < 0 ? mix(tok.muted, tok['ink-prussian'], t) : tok.muted;
  }

  function draw() {
    if (!sk.ready) return;
    const c = sk.ctx, W = sk.w, H = sk.h;
    c.fillStyle = tok.canvas; c.fillRect(0, 0, W, H);
    const S = Math.min(W / (2 * HALF), H / 31), cx = W / 2, cy = H / 2;
    const P = (x, y) => [cx + S * x, cy + S * y];
    geom = { P };
    const prop = mode === 'prop';

    // the paper: lab rulers every 2 and 8 units
    for (const [step, a] of [[2, 0.045], [8, 0.08]]) {
      c.strokeStyle = rgba(tok.text, a); c.lineWidth = 1; c.beginPath();
      for (let x = Math.ceil(-W / 2 / S / step) * step; x * S < W / 2; x += step) { const X = Math.round(cx + x * S) + 0.5; c.moveTo(X, 0); c.lineTo(X, H); }
      for (let y = Math.ceil(-H / 2 / S / step) * step; y * S < H / 2; y += step) { const Y = Math.round(cy + y * S) + 0.5; c.moveTo(0, Y); c.lineTo(W, Y); }
      c.stroke();
    }

    // trails
    bodies.forEach((b, k) => {
      if (b.bh) return;
      const Hh = b.hist, n = Hh.length;
      if (!prop) {
        const col = todayColor(b);
        c.lineWidth = Math.max(2.5, S * 0.2); c.lineCap = 'round'; c.lineJoin = 'round';
        const chunk = 6;
        for (let i = 0; i + 1 < n; i += chunk) {
          const age = (tNow - Hh[i].t) / KEEP;
          c.strokeStyle = rgba(col, 0.55 * clamp(1 - age, 0, 1) ** 1.4);
          c.beginPath();
          for (let j = i; j <= Math.min(n - 1, i + chunk); j++) { const p = P(Hh[j].x, Hh[j].y); j === i ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]); }
          c.stroke();
        }
        c.lineCap = 'butt';
        return;
      }
      const isSel = k === sel, col = isSel ? tok.accent : chargeInk(b.q);
      c.lineWidth = isSel ? 1.4 : 1;
      const chunk = 8;
      for (let i = 0; i + 1 < n; i += chunk) {
        const age = (tNow - Hh[i].t) / KEEP;
        c.strokeStyle = rgba(col, (isSel ? 0.95 : 0.75) * clamp(1.05 - age, 0, 1));
        c.beginPath();
        for (let j = i; j <= Math.min(n - 1, i + chunk); j++) { const p = P(Hh[j].x, Hh[j].y); j === i ? c.moveTo(p[0], p[1]) : c.lineTo(p[0], p[1]); }
        c.stroke();
      }
      // beads at equal proper time
      let next = Math.ceil((n ? Hh[0].tau : 0) / BEAD) * BEAD;
      for (const e of Hh) {
        if (e.tau < next) continue;
        next += BEAD;
        const age = (tNow - e.t) / KEEP, p = P(e.x, e.y);
        c.fillStyle = rgba(col, (isSel ? 1 : 0.85) * clamp(1.1 - age, 0, 1));
        c.beginPath(); c.arc(p[0], p[1], isSel ? 2 : 1.6, 0, TAU); c.fill();
      }
    });

    // bodies
    bodies.forEach((b, k) => {
      const [x, y, vx, vy] = b.f(tNow), p = P(x, y), R = radius(b, S);
      const v = Math.hypot(vx, vy), g = 1 / Math.sqrt(1 - Math.min(0.99, v) ** 2), ang = Math.atan2(vy, vx);
      const tick = (b.spin || 0) * b.tau * 4;
      if (prop) {
        drawGlyph(c, p[0], p[1], R, { q: b.q, anti: b.anti, bh: b.bh, ergo: b.bh ? R * 2 / (1 + Math.sqrt(1 - b.a * b.a)) : 0, ang, g, tick, sel: k === sel });
        return;
      }
      // today: a flat disk tinted |q|/5 of the way to its ink, a thick spoke, a dashed ring for antimatter
      c.save(); c.translate(p[0], p[1]); c.rotate(ang); c.scale(1 / g, 1);
      c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fillStyle = todayColor(b); c.fill();
      if (!b.bh && R >= 4) {
        c.rotate(-ang); c.strokeStyle = mix(todayColor(b), tok.text, 0.65); c.lineWidth = Math.max(1.5, 0.18 * R);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(R * Math.cos(tick), R * Math.sin(tick)); c.stroke();
      }
      c.restore();
      if (b.anti) { c.setLineDash([3, 3]); c.strokeStyle = rgba(tok.text, 0.55); c.lineWidth = 1; c.beginPath(); c.arc(p[0], p[1], R + 3, 0, TAU); c.stroke(); c.setLineDash([]); }
    });

    if (prop) {
      // labels set like a plate's, beside the bodies they name
      const taken = [];
      const lab = (k, text, dx, dy, align = 'left') => { const [x, y] = bodies[k].f(tNow), p = P(x, y); haloText(c, text, p[0] + dx, p[1] + dy, { align }); taken.push([p[0], p[1], 40]); };
      if (W > 560) {
        lab(0, 'nucleus, +3', radius(bodies[0], S) + 7, -radius(bodies[0], S) - 4);
        lab(6, 'black hole, a = 0.8M', 0, radius(bodies[6], S) * 1.25 + 16, 'center');
        const ps = P(PS[0], PS[1] - 2.4 - 1.6); haloText(c, 'positronium', ps[0], ps[1] - 6, { align: 'center' });
      }
      // the key and the scale
      if (W > 640) {
        const ink = (q) => chargeInk(q);
        cartouche(c, 14, H - 14, [
          { text: 'positive charge', draw: (c, x, y) => drawGlyph(c, x, y, 6.5, { q: 1 }) },
          { text: 'negative charge', draw: (c, x, y) => drawGlyph(c, x, y, 6.5, { q: -1 }) },
          { text: 'antimatter, hollow', draw: (c, x, y) => drawGlyph(c, x, y, 6.5, { q: 1, anti: true }) },
          { text: 'neutral', draw: (c, x, y) => drawGlyph(c, x, y, 6.5, { q: 0 }) },
          { text: 'horizon; dashed, the ergosphere', draw: (c, x, y) => drawGlyph(c, x, y, 4.5, { bh: true, ergo: 7.5 }) },
          { text: `a bead every ${BEAD} of the body’s own time`, draw: (c, x, y) => { c.strokeStyle = rgba(ink(0), 0.8); c.lineWidth = 1; c.beginPath(); c.moveTo(x - 10, y); c.lineTo(x + 10, y); c.stroke(); c.fillStyle = ink(0); for (const d of [-7, 0, 7]) { c.beginPath(); c.arc(x + d, y, 1.6, 0, TAU); c.fill(); } } },
          { text: 'the selected body', draw: (c, x, y) => { c.strokeStyle = tok.accent; c.lineWidth = 1.25; c.beginPath(); c.arc(x, y, 6.5, 0, TAU); c.stroke(); } },
        ]);
        scaleBar(c, S, W - 18, H - 18, 140, 'length, c = 1');
      }
    }

    // caption
    if (!prop) cap('Today. A unit charge is tinted a fifth of the way to its ink, so the atom’s electrons, the positronium pair and the neutral bodies read as one grey; the black hole takes the text colour, so it turns white in the dark theme; the selected body is not marked at all.');
    else if (sel < 0) cap('Proposed. Every body carries its charge as an ink and a mark, antimatter is hollow, and a horizon is a void inside its dashed ergosphere. Trails are the plane view of the world lines, beaded every 4 of each body’s own time. Click a body to select it.');
    else {
      const b = bodies[sel], [, , vx, vy] = b.f(tNow), v = Math.hypot(vx, vy), g = 1 / Math.sqrt(1 - v * v);
      cap(b.bh
        ? `Proposed. The black hole spins at a = 0.80M, so its horizon sits at 1.6M, inside the ergosphere’s dashed 2M. The faster it spins, the wider that gap. Every body carries its charge as an ink and a mark; antimatter is hollow.`
        : `Proposed. ${b.name[0].toUpperCase() + b.name.slice(1)} moves at ${v.toFixed(2)}c. Its trail is the plane view of its world line, with a bead every ${BEAD} of its own time, which is every ${(BEAD * g).toFixed(1)} of the lab’s. Charge is an ink and a mark (+ sienna, − prussian, graphite when neutral), and antimatter is hollow.`);
    }
  }
  wirePause(sk, $('#pp-bodies'));
}
INITS.push(r2_Bodies);
