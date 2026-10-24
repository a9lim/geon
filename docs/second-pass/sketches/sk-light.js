
/* ---------- Fig. 2: light you can see ---------- */
function r2_Light() {
  const canvas = $('#cv-light');
  const cap = captioner($('#cap-light'));
  const bToday = $('#lt-today'), bProp = $('#lt-prop'), bOrbit = $('#lt-orbit'), bFly = $('#lt-fly');
  // Units: c = 1; the sheet spans x in [-36, 36]. Velocity changes are kicks of finite length τ,
  // so each kink is a shell of thickness c·τ. A circular orbit is a ring of kicks back to back,
  // and its kinks join into the spiral of a charge in a cyclotron.
  const RATE = 7, HX = 36, HY = 18, NL = 22, NKICK = 48;
  const NUC = [-1, 1.5], ORB = { c: [-4, 0], R: 5.5, v: 0.55 };
  const rnd = mulberry32(5);
  let tNow = 0, mode = 'prop', scene = 'orbit', S = 1;
  let pos, vel, kick, lastNuc, tau, kicks, hist, photons, fade;

  function reset() {
    kick = null; lastNuc = -99; tau = 0; kicks = []; hist = []; fade = 0;
    if (scene === 'orbit') {
      pos = [ORB.c[0] + ORB.R, ORB.c[1]]; vel = [0, -ORB.v];
    } else {
      const y = (rnd() - 0.5) * 14, side = rnd() < 0.5 ? -1 : 1, b = 5 + rnd() * 4;
      pos = [-HX - 2, y];
      const tx = NUC[0], ty = NUC[1] + side * b, ux = tx - pos[0], uy = ty - pos[1], u = Math.hypot(ux, uy);
      vel = [0.62 * ux / u, 0.62 * uy / u];
    }
  }
  function startKick(va, dur, nPhot) {
    kick = { t0: tNow, tau: dur, x0: [...pos], vb: [...vel], va, x1: null };
    kicks.push(kick);
    // photons: the dipole pattern about the acceleration, beamed along the mean velocity
    const ax = va[0] - kick.vb[0], ay = va[1] - kick.vb[1], am = Math.hypot(ax, ay) || 1;
    const vm = [(va[0] + kick.vb[0]) / 2, (va[1] + kick.vb[1]) / 2], b = Math.hypot(vm[0], vm[1]), g = 1 / Math.sqrt(1 - b * b);
    const Dmax = Math.sqrt((1 + b) / (1 - b)), xe = [pos[0] + kick.vb[0] * dur / 2, pos[1] + kick.vb[1] * dur / 2];
    for (let n = 0, tries = 0; n < nPhot && tries < 400; tries++) {
      const th = rnd() * TAU, nx = Math.cos(th), ny = Math.sin(th);
      const D = 1 / (g * (1 - vm[0] * nx - vm[1] * ny)), s2 = 1 - ((nx * ax + ny * ay) / am) ** 2;
      if (rnd() * Dmax ** 3 > s2 * D ** 3) continue;
      photons.push({ x: xe[0], y: xe[1], t: tNow + dur / 2, nx, ny, D });
      n++;
    }
  }
  function advance(h) {
    if (kick) {
      const s = (tNow - kick.t0) / kick.tau;
      if (s >= 1) { vel = [...kick.va]; kick.x1 = [...pos]; kick = null; }
      else vel = [kick.vb[0] + (kick.va[0] - kick.vb[0]) * s, kick.vb[1] + (kick.va[1] - kick.vb[1]) * s];
    }
    pos = [pos[0] + vel[0] * h, pos[1] + vel[1] * h];
    tNow += h;
    tau += h * Math.sqrt(1 - Math.min(0.99, vel[0] ** 2 + vel[1] ** 2));
    if (kick) return;
    if (scene === 'orbit') {
      // the next arc of the orbit, steered back onto the circle
      const d = TAU / NKICK, cs = Math.cos(-d), sn = Math.sin(-d);
      const rx = pos[0] - ORB.c[0], ry = pos[1] - ORB.c[1], r = Math.hypot(rx, ry);
      let va = [vel[0] * cs - vel[1] * sn, vel[0] * sn + vel[1] * cs];
      const k = 0.02 * (r - ORB.R); va = [va[0] - k * rx / r, va[1] - k * ry / r];
      const m = Math.hypot(va[0], va[1]); va = [ORB.v * va[0] / m, ORB.v * va[1] / m];
      startKick(va, TAU * ORB.R / ORB.v / NKICK, rnd() < 0.55 ? 1 : 0);
      return;
    }
    if (Math.abs(pos[0]) > HX + 3 || Math.abs(pos[1]) > HY + 3) { reset(); return; }
    // the nucleus deflects the electron toward itself, the kick centred on closest approach
    const rx = NUC[0] - pos[0], ry = NUC[1] - pos[1], v2 = vel[0] ** 2 + vel[1] ** 2;
    const tca = (rx * vel[0] + ry * vel[1]) / v2, bx = rx - vel[0] * tca, by = ry - vel[1] * tca, bb = Math.hypot(bx, by);
    const DUR = 2.6;
    if (tca > 0 && tca < DUR / 2 && bb < 11 && tNow - lastNuc > 8) {
      lastNuc = tNow;
      const sign = Math.sign(vel[0] * ry - vel[1] * rx), d = sign * clamp(40 / (bb * bb + 4), 0.3, 1.1);
      const cs = Math.cos(d), sn = Math.sin(d);
      startKick([vel[0] * cs - vel[1] * sn, vel[0] * sn + vel[1] * cs], DUR, 10);
    }
  }
  function step(dt) {
    const T = dt * RATE, n = Math.ceil(T / 0.05);
    for (let k = 0; k < n; k++) advance(T / n);
    fade = Math.min(1, fade + dt * 1.5);
    hist.push({ x: pos[0], y: pos[1], t: tNow, tau });
    while (hist.length && hist[0].t < tNow - 36) hist.shift();
    photons = photons.filter(p => { const a = tNow - p.t; return Math.abs(p.x + p.nx * a) < HX + 6 && Math.abs(p.y + p.ny * a) < HY + 6; });
    while (kicks.length > 1 && tNow - kicks[0].t0 - kicks[0].tau > 110) kicks.shift();
  }

  photons = [];
  reset();
  const sk = makeSketch(canvas, { layout() {}, step, draw });
  for (let i = 0; i < 700; i++) step(1 / 60);

  const setMode = (m) => { mode = m; bToday.setAttribute('aria-pressed', String(m === 'today')); bProp.setAttribute('aria-pressed', String(m === 'prop')); sk.draw(); };
  const setScene = (s) => { scene = s; bOrbit.setAttribute('aria-pressed', String(s === 'orbit')); bFly.setAttribute('aria-pressed', String(s === 'fly')); photons = []; reset(); for (let i = 0; i < (s === 'orbit' ? 700 : 180); i++) step(1 / 60); sk.draw(); };
  bToday.addEventListener('click', () => setMode('today'));
  bProp.addEventListener('click', () => setMode('prop'));
  bOrbit.addEventListener('click', () => setScene('orbit'));
  bFly.addEventListener('click', () => setScene('fly'));
  setMode('prop');

  // Field lines of a uniformly moving charge are straight and radial from where it is now,
  // bunched toward its transverse plane: tan ψ = γ tan ψ′.
  function aberr(theta, V) {
    const b = Math.hypot(V[0], V[1]);
    if (b < 1e-6) return [Math.cos(theta), Math.sin(theta)];
    const al = Math.atan2(V[1], V[0]), g = 1 / Math.sqrt(1 - b * b), ps = theta - al;
    const phi = al + Math.atan2(g * Math.sin(ps), Math.cos(ps));
    return [Math.cos(phi), Math.sin(phi)];
  }
  const exitS = (X, d, C, R) => { const ox = X[0] - C[0], oy = X[1] - C[1], b = ox * d[0] + oy * d[1], cc = ox * ox + oy * oy - R * R, disc = b * b - cc; return disc < 0 ? 0 : -b + Math.sqrt(disc); };
  // One line, followed outward: radial from the electron inside its newest shell, across each
  // shell to the line of the same label in the era before, radial from where the electron
  // would now be had that kick never happened.
  function traceLine(theta, r0) {
    let X = pos, d = aberr(theta, vel), sP = r0;
    const pts = [[X[0] + d[0] * r0, X[1] + d[1] * r0]];
    for (let k = kicks.length - 1; k >= 0; k--) {
      const K = kicks[k], Rout = tNow - K.t0;
      let sA = sP;
      if (K.x1) sA = Math.max(sP, exitS(X, d, K.x1, tNow - K.t0 - K.tau));
      pts.push([X[0] + d[0] * sA, X[1] + d[1] * sA]);
      const Xp = [K.x0[0] + K.vb[0] * Rout, K.x0[1] + K.vb[1] * Rout], dp = aberr(theta, K.vb);
      const sB = exitS(Xp, dp, K.x0, Rout);
      pts.push([Xp[0] + dp[0] * sB, Xp[1] + dp[1] * sB]);
      X = Xp; d = dp; sP = sB;
      if (Rout > 95) return pts;
    }
    pts.push([X[0] + d[0] * (sP + 140), X[1] + d[1] * (sP + 140)]);
    return pts;
  }

  function draw() {
    if (!sk.ready) return;
    const c = sk.ctx, W = sk.w, H = sk.h;
    c.fillStyle = tok.canvas; c.fillRect(0, 0, W, H);
    S = Math.min(W / (2 * HX), H / (2 * HY));
    const cx = W / 2, cy = H / 2, P = (x, y) => [cx + S * x, cy + S * y];
    const prop = mode === 'prop';
    c.strokeStyle = rgba(tok.text, 0.045); c.lineWidth = 1; c.beginPath();
    for (let x = Math.ceil(-W / 2 / S / 4) * 4; x * S < W / 2; x += 4) { const X = Math.round(cx + x * S) + 0.5; c.moveTo(X, 0); c.lineTo(X, H); }
    for (let y = Math.ceil(-H / 2 / S / 4) * 4; y * S < H / 2; y += 4) { const Y = Math.round(cy + y * S) + 0.5; c.moveTo(0, Y); c.lineTo(W, Y); }
    c.stroke();
    // the cyclotron's uniform field, on the open octave lattice of Fig. 4
    if (prop && scene === 'orbit') {
      c.strokeStyle = rgba(tok['ink-verdigris'], 0.45); c.lineWidth = 1; c.beginPath();
      for (let y = -HY + 2; y < HY; y += 8) for (let x = -HX + 2; x < HX; x += 8) {
        const p = P(x, y), r = 3.6, k = r * 0.7;
        c.moveTo(p[0] + r, p[1]); c.arc(p[0], p[1], r, 0, TAU);
        c.moveTo(p[0] - k, p[1] - k); c.lineTo(p[0] + k, p[1] + k); c.moveTo(p[0] + k, p[1] - k); c.lineTo(p[0] - k, p[1] + k);
      }
      c.stroke();
    }

    const Re = 6.5, Rn = 15;
    if (prop) {
      c.strokeStyle = rgba(tok['ink-prussian'], (tok.dark ? 0.62 : 0.55) * fade); c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < NL; i++) {
        const pts = traceLine(TAU * i / NL + 0.11, (Re + 3) / S);
        pts.forEach((p, k) => { const q = P(p[0], p[1]); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
      }
      c.stroke();
    }

    // the electron's trail: beaded hairline proposed, a thick grey smudge today
    if (hist.length > 1) {
      if (prop) {
        c.strokeStyle = rgba(tok['ink-prussian'], 0.7); c.lineWidth = 1; c.beginPath();
        hist.forEach((e, i) => { const p = P(e.x, e.y); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
        c.stroke();
        let next = Math.ceil(hist[0].tau / 3) * 3;
        c.fillStyle = tok['ink-prussian'];
        for (const e of hist) { if (e.tau < next) continue; next += 3; const p = P(e.x, e.y); c.beginPath(); c.arc(p[0], p[1], 1.6, 0, TAU); c.fill(); }
      } else {
        c.lineWidth = 4; c.lineCap = 'round';
        for (let i = 0; i + 1 < hist.length; i++) {
          const a = hist[i], b = hist[i + 1];
          c.strokeStyle = rgba(mix(tok.muted, tok['ink-prussian'], 0.2), 0.55 * (1 - (tNow - a.t) / 36));
          const p = P(a.x, a.y), q = P(b.x, b.y); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
        }
        c.lineCap = 'butt';
      }
    }

    // photons: energy E′ = D·E₀, so the wavelength shortens by D
    for (const ph of photons) {
      const a = tNow - ph.t; if (a < 0) continue;
      const p = P(ph.x + ph.nx * a, ph.y + ph.ny * a);
      if (prop) drawWiggle(c, p[0], p[1], ph.nx, ph.ny, clamp(7.5 / ph.D, 3.6, 17), dopplerInk(ph.D));
      else { c.fillStyle = tok['ink-ochre']; c.beginPath(); c.arc(p[0], p[1], 2, 0, TAU); c.fill(); }
    }

    // the nucleus and the electron
    const ep = P(pos[0], pos[1]);
    const v = Math.hypot(vel[0], vel[1]), g = 1 / Math.sqrt(1 - v * v), ang = Math.atan2(vel[1], vel[0]);
    if (prop) {
      if (scene === 'fly') { const np = P(NUC[0], NUC[1]); drawGlyph(c, np[0], np[1], Rn, { q: 3, tick: 0.4 }); if (W > 560) haloText(c, 'nucleus', np[0] + Rn + 7, np[1] - Rn); }
      drawGlyph(c, ep[0], ep[1], Re, { q: -1, ang, g, tick: tau * 0.5 });
    } else {
      const parts = [[ep, Re, mix(tok.muted, tok['ink-prussian'], 0.2), ang]];
      if (scene === 'fly') parts.push([P(NUC[0], NUC[1]), Rn, mix(tok.muted, tok['ink-sienna'], 0.6), 0]);
      for (const [p, R, col, a] of parts) {
        c.save(); c.translate(p[0], p[1]); c.rotate(a); c.scale(a ? 1 / g : 1, 1); c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fillStyle = col; c.fill(); c.restore();
      }
    }
    if (prop && W > 640) {
      const rows = [
        { text: 'field line of the electron', draw: (c, x, y) => { c.strokeStyle = tok['ink-prussian']; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 10, y + 3); c.lineTo(x - 2, y + 3); c.lineTo(x + 3, y - 3); c.lineTo(x + 10, y - 3); c.stroke(); } },
        { text: 'photon, redshifted', draw: (c, x, y) => drawWiggle(c, x, y, 1, 0, 9, dopplerInk(0.5)) },
        { text: 'photon, unshifted', draw: (c, x, y) => drawWiggle(c, x, y, 1, 0, 6.5, dopplerInk(1)) },
        { text: 'photon, blueshifted', draw: (c, x, y) => drawWiggle(c, x, y, 1, 0, 4.2, dopplerInk(2)) },
      ];
      if (scene === 'orbit') rows.push({ text: 'uniform B, into the page', draw: (c, x, y) => { const r = 3.6, k = r * 0.7; c.strokeStyle = tok['ink-verdigris']; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r, 0, TAU); c.moveTo(x - k, y - k); c.lineTo(x + k, y + k); c.moveTo(x + k, y - k); c.lineTo(x - k, y + k); c.stroke(); } });
      cartouche(c, 14, H - 14, rows);
      scaleBar(c, S, W - 18, H - 18, 140, 'length, c = 1');
    }

    if (!prop) { cap('Today. Photons are 2-pixel dots in one ink, and nothing on the canvas marks how far the news of an acceleration has travelled.'); return; }
    if (scene === 'orbit') cap(`Proposed. An electron circling at ${ORB.v.toFixed(2)}c in a uniform field, its field lines traced through its Liénard–Wiechert field. Each stretch of the orbit sends out its kink at c, and the kinks join into a spiral, one turn per orbit, that sweeps outward like a lighthouse’s beam. The photons ride the spiral: tight indigo wiggles ahead of the motion, loose sienna ones behind.`);
    else {
      const K = kicks[kicks.length - 1];
      cap(K
        ? `Proposed. The electron was deflected ${(tNow - K.t0).toFixed(0)} ago, and the kink it left in its field lines is now ${(tNow - K.t0).toFixed(0)} out, on a circle growing at c. Outside the circle the field still points to where the electron would be had nothing happened. Its photons ride the kink.`
        : 'Proposed. A new electron approaches the nucleus. Its field lines are straight, radial from where it is now, and bunched toward its sides by its speed.');
    }
  }
  wirePause(sk, $('#pp-light'));
}
INITS.push(r2_Light);
