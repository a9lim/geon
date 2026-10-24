
/* ---------- Fig. 4: the spacetime plate ---------- */
function r2_Plate() {
  const canvas = $('#cv-plate');
  const cap = captioner($('#cap-plate'));
  const bPlane = $('#pl-plane'), bST = $('#pl-st'), bToday = $('#pl-today'), bProp = $('#pl-prop');
  // Units: c = 1, the lab box is [-24, 24]², DEPTH of history below the present.
  const RATE = 5, DEPTH = 56, HALF = 24, SAMPLE = 0.25, BEAD = 2, PULSE = 4, CYCLE = 48, TRIP = 40, V = 0.6, G = 1.25;
  const U = [Math.cos(0.36), Math.sin(0.36)], HOME = [-15, -5], C2 = [11, 9];
  let tNow = 0, mode = 'prop', cam = { el: 0.5, az: -0.62 }, camTo = null, drag = null;
  const mod = (a, n) => ((a % n) + n) % n;
  const sAlong = p => p < TRIP / 2 ? V * p : p < TRIP ? V * (TRIP - p) : 0;
  const vAlong = p => p < TRIP / 2 ? V : p < TRIP ? -V : 0;
  const trav = t => { const p = mod(t, CYCLE), s = sAlong(p), v = vAlong(p); return [HOME[0] + U[0] * s, HOME[1] + U[1] * s, U[0] * v, U[1] * v]; };
  const circ = (R, v, ph) => { const w = v / R; return t => [C2[0] + R * Math.cos(w * t + ph), C2[1] + R * Math.sin(w * t + ph), -R * w * Math.sin(w * t + ph), R * w * Math.cos(w * t + ph)]; };
  const bodies = [
    { name: 'home', m: 1, f: () => [HOME[0], HOME[1], 0, 0] },
    { name: 'traveller', m: 1, sel: true, f: trav },
    { name: 'a', m: 0.8, f: circ(2.6, 0.42, 0) },
    { name: 'b', m: 0.8, f: circ(2.6, 0.42, Math.PI) },
  ];
  for (const b of bodies) { b.hist = []; b.tau = 0; b.nextPulse = PULSE; }
  let photons = [];

  // Light pulses between the twins, along the line of the trip: home's every 4 of its time
  // outward, the traveller's every 4 of its own time back toward home.
  function emit(from, t) {
    if (from === 0) {
      const p = mod(t, CYCLE); if (p <= 0.01 || p >= TRIP - 0.01) return;
      // catch the traveller: the pulse is at s = t′ − t, the traveller at sAlong, and their gap
      // closes at 1 − v ≥ 0.4, so one bisection finds the meeting
      let a = t, b = t + 80;
      for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (m - t - sAlong(mod(m, CYCLE)) >= 0) b = m; else a = m; }
      photons.push({ x: HOME[0], y: HOME[1], t, dx: U[0], dy: U[1], ta: b, D: 1, to: 1 });
    } else {
      const [x, y, vx, vy] = trav(t), s = sAlong(mod(t, CYCLE)); if (s < 0.05) return;
      const bn = -(vx * U[0] + vy * U[1]);
      photons.push({ x, y, t, dx: -U[0], dy: -U[1], ta: t + s, D: 1 / (G * (1 - bn)), to: 0 });
    }
  }
  function sample(t) {
    for (let k = 0; k < bodies.length; k++) {
      const b = bodies[k], last = b.hist[b.hist.length - 1];
      for (let tt = last ? last.t + SAMPLE : t - DEPTH - 4; tt <= t + 1e-9; tt += SAMPLE) {
        const [x, y, vx, vy] = b.f(tt);
        if (b.hist.length) b.tau += SAMPLE * Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy));
        b.hist.push({ x, y, t: tt, tau: b.tau });
        if (k < 2 && b.tau >= b.nextPulse) { b.nextPulse += PULSE; emit(k, tt); }
      }
      while (b.hist.length && b.hist[0].t < t - DEPTH - 4) b.hist.shift();
    }
    photons = photons.filter(p => p.ta > t - DEPTH - 4);
  }
  function step(dt) {
    tNow += dt * RATE; sample(tNow);
    if (camTo) {
      const k = Math.min(1, dt * 1.6);
      cam.el += (camTo.el - cam.el) * k; cam.az += (camTo.az - cam.az) * k;
      if (Math.abs(camTo.el - cam.el) < 0.002 && Math.abs(camTo.az - cam.az) < 0.002) camTo = null;
    } else if (!drag && cam.el < 1.45) cam.az += dt * 0.02;
  }
  const sk = makeSketch(canvas, { layout() {}, step, draw });
  tNow = CYCLE * 2 + 13; sample(tNow);

  const setCam = w => { bPlane.setAttribute('aria-pressed', String(w === 'plane')); bST.setAttribute('aria-pressed', String(w === 'st')); };
  const setMode = m => { mode = m; bToday.setAttribute('aria-pressed', String(m === 'today')); bProp.setAttribute('aria-pressed', String(m === 'prop')); sk.draw(); };
  bPlane.addEventListener('click', () => { camTo = { el: Math.PI / 2, az: Math.round(cam.az / (Math.PI / 2)) * (Math.PI / 2) }; setCam('plane'); if (!sk.running) { cam = { ...camTo }; camTo = null; sk.draw(); } });
  bST.addEventListener('click', () => { camTo = { el: 0.5, az: Math.abs(cam.az) < 0.1 ? -0.62 : cam.az }; setCam('st'); if (!sk.running) { cam = { ...camTo }; camTo = null; sk.draw(); } });
  bToday.addEventListener('click', () => setMode('today'));
  bProp.addEventListener('click', () => setMode('prop'));
  setCam('st'); setMode('prop');
  canvas.addEventListener('pointerdown', e => { camTo = null; drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.az += (e.clientX - drag[0]) * 0.008; cam.el = clamp(cam.el - (e.clientY - drag[1]) * 0.006, 0.16, Math.PI / 2);
    drag = [e.clientX, e.clientY]; setCam(cam.el > 1.5 ? 'plane' : 'st'); if (!sk.running) sk.draw();
  });
  const end = () => { drag = null; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);

  function draw() {
    if (!sk.ready) return;
    const c = sk.ctx, W = sk.w, H = sk.h, prop = mode === 'prop';
    c.fillStyle = tok.canvas; c.fillRect(0, 0, W, H);
    const el = cam.el, ce = Math.cos(el), se = Math.sin(el), ca = Math.cos(cam.az), sa = Math.sin(cam.az);
    const tilt = clamp(ce / Math.cos(0.5), 0, 1);
    const Sp = Math.min(W / (2.5 * HALF), (H - 56) / (2.25 * HALF)), St = Math.min(W / (3.3 * HALF), (H - 50) / (DEPTH * ce + 2.9 * HALF * se + 0.1 * HALF));
    const S = Sp + (St - Sp) * tilt, cx = W / 2 + (W > 760 && tilt > 0.3 ? 40 * tilt : 0), cy = H / 2 + 6;
    const P = (X, Y, T) => { const X1 = X * ca - Y * sa, Dp = X * sa + Y * ca; return [cx + S * X1, cy - S * ((T + DEPTH / 2) * ce + Dp * se)]; };
    const fade = T => clamp(1 + T / DEPTH, 0, 1);
    const ink = tok.text, red = tok.accent;
    const pc = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => P(x * HALF, y * HALF, 0));
    // under the sheet of the present, seen through it
    const under = (p) => { if (!prop || tilt < 0.05) return false; let sgn = 0; for (let i = 0; i < 4; i++) { const a = pc[i], b = pc[(i + 1) % 4], cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); const s = Math.sign(cr); if (s && sgn && s !== sgn) return false; if (s) sgn = s; } return true; };
    const SEEN = 0.42;

    // the lab box's corners and floor
    if (tilt > 0.02) {
      c.lineWidth = 1; c.setLineDash([2, 4]); c.strokeStyle = rgba(ink, 0.14 * tilt); c.beginPath();
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const a = P(x * HALF, y * HALF, 0), b = P(x * HALF, y * HALF, -DEPTH); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      const fl = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => P(x * HALF, y * HALF, -DEPTH));
      fl.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
      c.stroke(); c.setLineDash([]);
    }

    // world lines, beaded at equal proper time
    const traveller = bodies[1];
    for (const b of bodies) {
      const Hh = b.hist, col = b.sel ? red : ink;
      c.lineWidth = b.sel ? 1.6 : 1.15;
      let prev = null, key = '';
      for (const e of Hh) {
        const T = e.t - tNow; if (T < -DEPTH) { prev = null; continue; }
        const p = P(e.x, e.y, T);
        if (prev) {
          const hid = under(p), a = (0.2 + 0.75 * fade(T)) * (b.sel ? 1 : 0.8) * (hid ? SEEN : 1);
          const k2 = (hid ? 'h' : 's') + Math.round(a * 25);
          if (k2 !== key) { if (key) c.stroke(); key = k2; c.strokeStyle = rgba(col, a); c.beginPath(); c.moveTo(prev[0], prev[1]); }
          c.lineTo(p[0], p[1]);
        }
        prev = p;
      }
      if (key) c.stroke();
      let next = Math.ceil((Hh[0] ? Hh[0].tau : 0) / BEAD) * BEAD;
      for (const e of Hh) {
        if (e.tau < next) continue; next += BEAD;
        const T = e.t - tNow; if (T < -DEPTH) continue;
        const p = P(e.x, e.y, T);
        c.fillStyle = rgba(col, (0.25 + 0.7 * fade(T)) * (b.sel ? 1 : 0.85) * (under(p) ? SEEN : 1));
        c.beginPath(); c.arc(p[0], p[1], b.sel ? 2.1 : 1.8, 0, TAU); c.fill();
      }
    }

    // light pulses on 45° lines, from emission to the event that receives them
    const recv = [];
    for (const ph of photons) {
      const t0 = Math.max(ph.t, tNow - DEPTH), t1 = Math.min(ph.ta, tNow);
      if (t1 <= t0) continue;
      const col = prop ? dopplerInk(ph.D) : tok['ink-ochre'];
      const n = 8;
      for (let k = 0; k < n; k++) {
        const ta = t0 + (t1 - t0) * k / n, tb = t0 + (t1 - t0) * (k + 1) / n;
        const pa = P(ph.x + ph.dx * (ta - ph.t), ph.y + ph.dy * (ta - ph.t), ta - tNow), pb = P(ph.x + ph.dx * (tb - ph.t), ph.y + ph.dy * (tb - ph.t), tb - tNow);
        c.strokeStyle = rgba(col, (prop ? 0.3 + 0.6 * fade(tb - tNow) : 0.45) * (under(pb) ? SEEN : 1)); c.lineWidth = prop ? 1.15 : 1;
        c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.stroke();
      }
      if (ph.ta <= tNow) recv.push(ph);
    }
    if (prop) for (const ph of recv) {
      const T = ph.ta - tNow, p = P(ph.x + ph.dx * (ph.ta - ph.t), ph.y + ph.dy * (ph.ta - ph.t), T);
      c.strokeStyle = rgba(ph.to === 1 ? red : ink, (0.35 + 0.6 * fade(T)) * (under(p) ? 0.6 : 1)); c.lineWidth = 1.1;
      c.fillStyle = tok.canvas; c.beginPath(); c.arc(p[0], p[1], 3, 0, TAU); c.fill(); c.stroke();
    }

    // the traveller's past light cone
    const [ax, ay] = traveller.f(tNow);
    if (tilt > 0.05) {
      const depths = [6, 12, 18, 24];
      const ring = (d, a0, a1, dashed) => {
        c.setLineDash(dashed ? [3, 4] : []); c.beginPath();
        const n = 64;
        for (let k = 0; k <= n; k++) { const ps = a0 + (a1 - a0) * k / n, ph = ps - cam.az, p = P(ax + d * Math.cos(ph), ay + d * Math.sin(ph), -d); k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
        c.stroke(); c.setLineDash([]);
      };
      // In this projection a ring point at ψ = φ + az is on the silhouette where sin ψ = tan(el).
      const tz = Math.tan(el), sil = prop && tz < 1;
      const p1 = sil ? Math.asin(tz) : 0, p2 = Math.PI - p1;
      depths.forEach(d => {
        const a = 0.46 * tilt * (1.1 - d / 40);
        c.lineWidth = 1;
        if (sil) {
          c.strokeStyle = rgba(red, a); ring(d, p2 - TAU, p1, false);
          c.strokeStyle = rgba(red, a * 0.75); ring(d, p1, p2, true);
        } else { c.strokeStyle = rgba(red, a * (prop ? 1 : 0.8)); ring(d, 0, TAU, false); }
      });
      if (sil) {
        const A = P(ax, ay, 0), dm = depths[depths.length - 1];
        c.strokeStyle = rgba(red, 0.4 * tilt); c.lineWidth = 1; c.beginPath();
        for (const ps of [p1, p2]) { const ph = ps - cam.az, q = P(ax + dm * Math.cos(ph), ay + dm * Math.sin(ph), -dm); c.moveTo(A[0], A[1]); c.lineTo(q[0], q[1]); }
        c.stroke();
      }
    }

    // the plane of the present, with lab rulers every 8
    c.beginPath(); pc.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath();
    c.fillStyle = rgba(ink, (tok.dark ? 0.05 : 0.035) * (0.4 + 0.6 * tilt)); c.fill();
    c.strokeStyle = rgba(ink, 0.42); c.lineWidth = 1; c.stroke();
    c.strokeStyle = rgba(ink, 0.08); c.beginPath();
    for (let k = -2; k <= 2; k++) {
      const q = k * 8;
      let a = P(q, -HALF, 0), b = P(q, HALF, 0); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
      a = P(-HALF, q, 0); b = P(HALF, q, 0); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
    }
    c.stroke();

    // bodies on the present
    const plane = cc => { cc.scale(1, -se); cc.rotate(cam.az); };
    for (const b of bodies) {
      const [x, y, vx, vy] = b.f(tNow), p = P(x, y, 0), v = Math.hypot(vx, vy), g = 1 / Math.sqrt(1 - v * v);
      const R = Math.max(4, 0.42 * S * Math.cbrt(b.m));
      if (prop) drawGlyph(c, p[0], p[1], R, { q: 0, ang: Math.atan2(vy, vx), g, tick: b.tau * 0.6, sel: b.sel, plane });
      else {
        c.save(); c.translate(p[0], p[1]); plane(c); c.rotate(Math.atan2(vy, vx)); c.scale(1 / g, 1);
        c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fillStyle = tok.muted; c.fill(); c.restore();
      }
    }

    // annotations, the key and the scales
    const phase = mod(tNow, CYCLE), tDep = tNow - phase;
    if (prop) {
      const hp = P(HOME[0], HOME[1], 0), tp = P(ax, ay, 0);
      const tauT = Math.min(phase, TRIP) / G, tauH = Math.min(phase, TRIP);
      if (phase < TRIP) {
        haloText(c, `home · τ ${tauH.toFixed(1)}`, hp[0] - 12, hp[1] - 10, { align: 'right' });
        haloText(c, `traveller · τ ${tauT.toFixed(1)}`, tp[0] + 12, tp[1] - 12, { color: red });
      } else haloText(c, 'home, and the traveller beside it', hp[0] - 12, hp[1] - 10, { align: 'right' });
      // the trip's three events, wherever they still lie within the history shown
      for (let k = 0; k < 3; k++) {
        const base = tDep - k * CYCLE;
        for (const [dt, name, at] of [[0, 'departure', HOME], [TRIP / 2, 'turnaround', [HOME[0] + U[0] * V * TRIP / 2, HOME[1] + U[1] * V * TRIP / 2]], [TRIP, 'reunion', HOME]]) {
          const T = base + dt - tNow; if (T > 0 || T < -DEPTH + 4) continue;
          const p = P(at[0], at[1], T);
          c.strokeStyle = red; c.lineWidth = 1.2; c.fillStyle = tok.canvas; c.beginPath(); c.arc(p[0], p[1], 4, 0, TAU); c.fill(); c.stroke();
          if (tilt > 0.3 && W > 560) {
            const txt = name === 'reunion' ? 'last reunion: home aged 40.0, the traveller 32.0' : name;
            haloText(c, txt, p[0] + 9, p[1] + 1, { color: tok.text2 });
          }
        }
      }
      if (W > 640) {
        cartouche(c, 14, H - 14, [
          { text: `world line, a bead every ${BEAD} of its own time`, draw: (c, x, y) => { c.strokeStyle = rgba(ink, 0.8); c.lineWidth = 1.15; c.beginPath(); c.moveTo(x - 10, y + 5); c.lineTo(x + 10, y - 5); c.stroke(); c.fillStyle = ink; for (const d of [-6, 0, 6]) { c.beginPath(); c.arc(x + d, y - d / 2, 1.7, 0, TAU); c.fill(); } } },
          { text: 'light pulse, every 4: red- or blueshifted', draw: (c, x, y) => { c.lineWidth = 1.2; for (const [D, o] of [[0.5, -5], [1, 0], [2, 5]]) { c.strokeStyle = dopplerInk(D); c.beginPath(); c.moveTo(x - 7 + o, y + 6); c.lineTo(x + 5 + o, y - 6); c.stroke(); } } },
          { text: 'a pulse received', draw: (c, x, y) => { c.strokeStyle = ink; c.lineWidth = 1.1; c.beginPath(); c.arc(x, y, 3, 0, TAU); c.stroke(); } },
          { text: 'the traveller’s past light cone', draw: (c, x, y) => { c.strokeStyle = rgba(red, 0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x - 8, y + 4); c.moveTo(x, y - 6); c.lineTo(x + 8, y + 4); c.stroke(); c.beginPath(); c.ellipse(x, y + 4, 8, 2.4, 0, 0, Math.PI); c.stroke(); c.setLineDash([2, 2]); c.beginPath(); c.ellipse(x, y + 4, 8, 2.4, 0, Math.PI, TAU); c.stroke(); c.setLineDash([]); } },
          { text: 'an event of the trip', draw: (c, x, y) => { c.strokeStyle = red; c.lineWidth = 1.2; c.beginPath(); c.arc(x, y, 4, 0, TAU); c.stroke(); } },
        ]);
      }
    }
    if (tilt > 0.1) {
      // the time axis, at the leftmost corner of the box
      let best = 0; pc.forEach((p, i) => { if (p[0] < pc[best][0]) best = i; });
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]][best], X0 = cs[0] * HALF, Y0 = cs[1] * HALF;
      c.font = `italic 13px ${FONT}`; c.fillStyle = rgba(tok.muted, tilt); c.textAlign = 'right'; c.textBaseline = 'middle';
      c.strokeStyle = rgba(ink, 0.3 * tilt); c.lineWidth = 1;
      const top = P(X0, Y0, 0), bot = P(X0, Y0, -DEPTH);
      c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(bot[0], bot[1]); c.stroke();
      for (let k = 8; k <= DEPTH; k += 8) { const q = P(X0, Y0, -k); c.beginPath(); c.moveTo(q[0] - 3, q[1]); c.lineTo(q[0] + 3, q[1]); c.stroke(); c.fillText(`${k} ago`, q[0] - 7, q[1]); }
      c.fillText('now', top[0] - 7, top[1]);
      // a dimension line along the front edge of the present
      if (prop) {
        // the front edge away from the time axis: from the nearest corner, the edge that doesn't reach the leftmost
        let low = 0; pc.forEach((p, i) => { if (p[1] > pc[low][1]) low = i; });
        const fe = ((low + 3) % 4) === best ? low : (low + 3) % 4;
        const a = pc[fe], b = pc[(fe + 1) % 4], ux = (b[0] - a[0]), uy = (b[1] - a[1]), L = Math.hypot(ux, uy), nx = uy / L, ny = -ux / L;
        // offset away from the plane's centre, so the dimension line sits outside its edge
        const gc = [(pc[0][0] + pc[2][0]) / 2, (pc[0][1] + pc[2][1]) / 2];
        const off = 14, sgn = (gc[0] - (a[0] + b[0]) / 2) * nx + (gc[1] - (a[1] + b[1]) / 2) * ny > 0 ? -1 : 1;
        c.strokeStyle = rgba(ink, 0.45); c.beginPath();
        const A = [a[0] + nx * off * sgn, a[1] + ny * off * sgn], B = [b[0] + nx * off * sgn, b[1] + ny * off * sgn];
        c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]);
        for (let k = 0; k <= 6; k++) { const X = A[0] + (B[0] - A[0]) * k / 6, Y = A[1] + (B[1] - A[1]) * k / 6, h = k % 3 === 0 ? 5 : 3; c.moveTo(X, Y); c.lineTo(X - nx * h * sgn, Y - ny * h * sgn); }
        c.stroke();
        c.font = `12px ${FONT}`; c.fillStyle = tok.muted; c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const k of [0, 3, 6]) { const X = A[0] + (B[0] - A[0]) * k / 6 + nx * 11 * sgn, Y = A[1] + (B[1] - A[1]) * k / 6 + ny * 11 * sgn; c.fillText(String(k * 8), X, Y); }
      }
    }

    // caption
    if (!prop) { cap('Today. The cone is four loose rings with no silhouette, nothing names the twins or marks the events, light is one ink, and lines below the present are drawn as if nothing stood in front of them.'); return; }
    const head = 'Proposed. The twin paradox at 0.60c (γ = 1.25) in lab coordinates.';
    if (phase < TRIP / 2) cap(`${head} Outbound, ${phase.toFixed(1)} since departure. Home’s pulses leave every 4 of its time and reach the traveller every 8 of the traveller’s, so the circles on the red world line fall on every fourth bead.`);
    else if (phase < TRIP) cap(`${head} Inbound. Home’s pulses now reach the traveller every 2 of its time, on every bead, four times as often as on the way out (Bondi’s k = 2, then 1/k). Lines below the sheet of the present are seen through it, lighter.`);
    else cap(`${head} Reunited. Between the same two events the traveller laid 16 beads and home 20: it aged 32.0 to home’s 40.0. Drag to turn the plate.`);
  }
  wirePause(sk, $('#pp-plate'));
}
INITS.push(r2_Plate);
