
/* ---------- Fig. 5: fields, drawn like an atlas ---------- */
function r2_Fields() {
  const canvas = $('#cv-fields');
  const cap = captioner($('#cap-fields'));
  const btn = { grav: $('#fd-grav'), elec: $('#fd-elec'), mag: $('#fd-mag'), higgs: $('#fd-higgs') };
  // Units: the domain is [-30, 30] × [-14, 14]; fields are drawn inside it only, as in the sim.
  const DW = 30, DH = 14, NX = 128, NY = 60, RATE = 3;
  let mode = 'grav', tNow = 0, patterns = null, layer = null, maskC = null;
  const grid = new Float32Array(NX * NY);
  const gx = i => -DW + 2 * DW * i / (NX - 1), gy = j => -DH + 2 * DH * j / (NY - 1);

  // the scenes
  const gravBodies = t => {
    const w = 0.05, B = [-8, 1], r1 = 2.69, r2 = 4.31, wp = 0.012;
    return [
      { x: B[0] + r1 * Math.cos(w * t), y: B[1] + r1 * Math.sin(w * t), m: 8 },
      { x: B[0] - r2 * Math.cos(w * t), y: B[1] - r2 * Math.sin(w * t), m: 5 },
      { x: B[0] + 19 * Math.cos(wp * t + 0.6), y: B[1] + 10 * Math.sin(wp * t + 0.6), m: 1.2 },
      { x: 17 + 2 * Math.sin(0.01 * t), y: -5 + 1.5 * Math.cos(0.013 * t), m: 3 },
    ];
  };
  const elecCharges = t => [
    { x: -12 + 2 * Math.cos(0.02 * t), y: 1 + 2 * Math.sin(0.02 * t), q: 2 },
    { x: 5 + 1.5 * Math.cos(0.03 * t + 1), y: -5 + 1.5 * Math.sin(0.03 * t + 1), q: -1 },
    { x: 11 + 2 * Math.cos(-0.025 * t), y: 6 + 1.2 * Math.sin(-0.025 * t), q: -1 },
  ];
  const B0 = 0.02;
  const dipoles = t => [
    { x: -11 + 3 * Math.cos(0.015 * t), y: 2 + 2 * Math.sin(0.015 * t), mu: 9, q: 1 },
    { x: 13 + 2 * Math.cos(-0.02 * t + 2), y: -3 + 2 * Math.sin(-0.02 * t + 2), mu: -7, q: -1 },
  ];
  const Bz = (x, y, ds) => { let b = B0; for (const d of ds) { const r2 = (x - d.x) ** 2 + (y - d.y) ** 2 + 1.5; b -= d.mu / (r2 * Math.sqrt(r2)); } return b; };

  // the Higgs after a quench: Allen–Cahn, φ̇ = ∇²φ + φ − φ³, on a periodic grid
  const HX = 120, HY = 56;
  let phi = new Float32Array(HX * HY), phi2 = new Float32Array(HX * HY), since = 0, comps = { pos: 0, neg: 0, labels: [] }, compAge = 99;
  const rnd = mulberry32(21);
  const quench = () => { for (let k = 0; k < phi.length; k++) phi[k] = (rnd() - 0.5) * 0.2; since = 0; for (let s = 0; s < 110; s++) higgsStep(); };
  function higgsStep() {
    const dt = 0.12;
    for (let j = 0; j < HY; j++) for (let i = 0; i < HX; i++) {
      const k = j * HX + i, f = phi[k];
      const lap = phi[j * HX + (i + 1) % HX] + phi[j * HX + (i + HX - 1) % HX] + phi[((j + 1) % HY) * HX + i] + phi[((j + HY - 1) % HY) * HX + i] - 4 * f;
      phi2[k] = f + dt * (0.35 * lap + f - f * f * f);
    }
    [phi, phi2] = [phi2, phi];
    since += 0.12;
  }
  function components() {
    const lab = new Int32Array(HX * HY).fill(-1), out = { pos: 0, neg: 0, labels: [] };
    let id = 0;
    for (let s = 0; s < HX * HY; s++) {
      if (lab[s] >= 0) continue;
      const sign = phi[s] > 0, stack = [s]; lab[s] = id;
      let n = 0, sx = 0, sy = 0;
      while (stack.length) {
        const k = stack.pop(), i = k % HX, j = (k / HX) | 0; n++; sx += i; sy += j;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = (i + di + HX) % HX, jj = (j + dj + HY) % HY, kk = jj * HX + ii;
          if (lab[kk] < 0 && (phi[kk] > 0) === sign) { lab[kk] = id; stack.push(kk); }
        }
      }
      if (n >= 6) { if (sign) out.pos++; else out.neg++; }
      // label big domains at their deepest cell, which lies well inside them
      if (n > 260) {
        let best = s, bv = 0;
        for (let k = 0; k < HX * HY; k++) if (lab[k] === id && Math.abs(phi[k]) > bv) {
          const i = k % HX, j = (k / HX) | 0; if (i < 4 || i > HX - 5 || j < 3 || j > HY - 4) continue;
          // prefer cells far from any wall: sample a ring of neighbours
          let ok = true; for (const [di, dj] of [[5, 0], [-5, 0], [0, 4], [0, -4]]) { const kk = ((j + dj + HY) % HY) * HX + (i + di + HX) % HX; if (lab[kk] !== id) { ok = false; break; } }
          if (ok) { bv = Math.abs(phi[k]); best = k; }
        }
        if (bv > 0) out.labels.push({ i: best % HX, j: (best / HX) | 0, sign });
      }
      id++;
    }
    return out;
  }
  quench();

  function step(dt) {
    tNow += dt * RATE * 10;
    if (mode === 'higgs') {
      for (let s = 0; s < 2; s++) higgsStep();
      if (++compAge > 12) { comps = components(); compAge = 0; }
      if (since > 110) { quench(); compAge = 99; }
    }
  }
  const sk = makeSketch(canvas, { layout() { patterns = null; }, step, draw });
  const setMode = m => { mode = m; for (const k in btn) btn[k].setAttribute('aria-pressed', String(k === m)); if (m === 'higgs') { comps = components(); compAge = 0; } sk.draw(); };
  for (const k in btn) btn[k].addEventListener('click', () => setMode(k));
  setMode('grav');

  function hatch(col, dir) {
    const n = 8, cv = document.createElement('canvas'), d = sk.dpr; cv.width = cv.height = n * d;
    const x = cv.getContext('2d'); x.scale(d, d); x.strokeStyle = rgba(col, tok.dark ? 0.75 : 0.62); x.lineWidth = 1;
    x.beginPath();
    for (const o of [-n, 0, n]) { if (dir > 0) { x.moveTo(o, n); x.lineTo(o + n, 0); } else { x.moveTo(o, 0); x.lineTo(o + n, n); } }
    x.stroke();
    const p = sk.ctx.createPattern(cv, 'repeat'); p.setTransform(new DOMMatrix().scale(1 / d, 1 / d)); return p;
  }
  const higgsInk = s => s ? tok['ink-sap'] : tok['ink-violet'];

  function draw() {
    if (!sk.ready) return;
    const c = sk.ctx, W = sk.w, H = sk.h;
    c.fillStyle = tok.canvas; c.fillRect(0, 0, W, H);
    const S = Math.min(W / (2 * DW + 4), H / (2 * DH + 4)), cx = W / 2, cy = H / 2;
    const P = (x, y) => [cx + S * x, cy + S * y];
    const G = (i, j) => P(gx(i), gy(j));
    const box = [cx - S * DW, cy - S * DH, cx + S * DW, cy + S * DH];
    // the paper outside and the domain's edge
    c.strokeStyle = rgba(tok.text, 0.045); c.lineWidth = 1; c.beginPath();
    for (let x = Math.ceil(-W / 2 / S / 4) * 4; x * S < W / 2; x += 4) { const X = Math.round(cx + x * S) + 0.5; c.moveTo(X, 0); c.lineTo(X, H); }
    for (let y = Math.ceil(-H / 2 / S / 4) * 4; y * S < H / 2; y += 4) { const Y = Math.round(cy + y * S) + 0.5; c.moveTo(0, Y); c.lineTo(W, Y); }
    c.stroke();
    c.save(); c.beginPath(); c.rect(box[0], box[1], box[2] - box[0], box[3] - box[1]); c.clip();
    c.fillStyle = tok.canvas; c.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    const taken = [];

    if (mode === 'grav') {
      const bs = gravBodies(tNow), eps2 = 1.6 ** 2;
      const pot = (x, y) => { let v = 0; for (const b of bs) v -= b.m / Math.sqrt((x - b.x) ** 2 + (y - b.y) ** 2 + eps2); return v; };
      const grad = (x, y) => { let gxv = 0, gyv = 0; for (const b of bs) { const r2 = (x - b.x) ** 2 + (y - b.y) ** 2 + eps2, k = b.m / (r2 * Math.sqrt(r2)); gxv += k * (x - b.x); gyv += k * (y - b.y); } return [gxv, gyv]; };
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) grid[j * NX + i] = pot(gx(i), gy(j));
      for (const b of bs) { const p = P(b.x, b.y); taken.push([p[0], p[1], 0.84 * S * Math.cbrt(b.m) + 26]); }
      for (let n = 0; n <= 10; n++) {
        const L = -0.55 * 1.32 ** n, index = n % 4 === 0;
        const lines = contourLines(grid, NX, NY, L).map(l => l.map(p => G(p[0], p[1])));
        c.strokeStyle = rgba(tok.text, index ? 0.62 : 0.36); c.lineWidth = index ? 1.35 : 1;
        c.beginPath(); for (const l of lines) l.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        // ticks downhill, every 15 px along the contour, as on a depression contour
        c.beginPath();
        for (const l of lines) {
          let acc = 7;
          for (let k = 1; k < l.length; k++) {
            const a = l[k - 1], b = l[k], dl = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += dl;
            if (acc < 15 || dl < 1e-3) continue; acc = 0;
            let nx = -(b[1] - a[1]) / dl, ny = (b[0] - a[0]) / dl;
            const wx = (b[0] - cx) / S, wy = (b[1] - cy) / S, g = grad(wx, wy);
            if (nx * -g[0] + ny * -g[1] < 0) { nx = -nx; ny = -ny; }
            const h = clamp(2 + 3.5 * Math.hypot(g[0], g[1]) / 0.25, 2, 6);
            c.moveTo(b[0], b[1]); c.lineTo(b[0] + nx * h, b[1] + ny * h);
          }
        }
        c.stroke();
        if (index || n === 2 || n === 6) for (const l of lines.sort((a, b) => b.length - a.length).slice(0, 2)) labelAlong(c, l, (L.toFixed(2)).replace('-', '−'), taken, { box });
      }
      for (const b of bs) { const p = P(b.x, b.y); drawGlyph(c, p[0], p[1], 0.42 * S * Math.cbrt(b.m), { q: 0 }); }
      cap('Proposed: gravity. The potential as a survey sheet: a contour at every step of 1.32× in Φ, ticked downhill like the depression contours on a map, every fourth one heavier and labelled. Where contours crowd the pull is strong; the binary sits in one deep basin, and the planet and the lone mass in shallow ones.');
    } else if (mode === 'elec') {
      const qs = elecCharges(tNow), e2 = 1;
      const V = (x, y) => { let v = 0; for (const q of qs) v += q.q / Math.sqrt((x - q.x) ** 2 + (y - q.y) ** 2 + e2); return v; };
      const E = (x, y) => { let ex = 0, ey = 0; for (const q of qs) { const r2 = (x - q.x) ** 2 + (y - q.y) ** 2 + e2 * 0.2, k = q.q / (r2 * Math.sqrt(r2)); ex += k * (x - q.x); ey += k * (y - q.y); } return [ex, ey]; };
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) grid[j * NX + i] = V(gx(i), gy(j));
      for (const q of qs) { const p = P(q.x, q.y); taken.push([p[0], p[1], 40]); }
      for (const L of [0.12, 0.25, 0.5, 1, -0.12, -0.25, -0.5, -1]) {
        const lines = contourLines(grid, NX, NY, L).map(l => l.map(p => G(p[0], p[1])));
        c.strokeStyle = rgba(L > 0 ? tok['ink-sienna'] : tok['ink-prussian'], 0.62); c.lineWidth = 1; c.setLineDash(L > 0 ? [] : [4, 3]);
        c.beginPath(); for (const l of lines) l.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        c.setLineDash([]);
        if (Math.abs(L) === 0.5) for (const l of lines.slice(0, 1)) labelAlong(c, l, (L > 0 ? '+' : '−') + '0.5', taken, { box, color: L > 0 ? tok['ink-sienna'] : tok['ink-prussian'] });
      }
      // field lines from the positive charge, as many as its charge allows, ending on the negatives
      const src = qs[0], N = 14 * src.q;
      c.strokeStyle = rgba(tok.text, tok.dark ? 0.66 : 0.58); c.lineWidth = 1;
      const unit = (x, y) => { const e = E(x, y), m = Math.hypot(e[0], e[1]) || 1; return [e[0] / m, e[1] / m]; };
      const mids = [];
      for (let k = 0; k < N; k++) {
        const th = TAU * k / N + 0.05;
        let x = src.x + 1.1 * Math.cos(th), y = src.y + 1.1 * Math.sin(th);
        const pts = [P(x, y)], h = 0.25;
        for (let s = 0; s < 520; s++) {
          const k1 = unit(x, y), k2 = unit(x + k1[0] * h / 2, y + k1[1] * h / 2), k3 = unit(x + k2[0] * h / 2, y + k2[1] * h / 2), k4 = unit(x + k3[0] * h, y + k3[1] * h);
          x += h * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6; y += h * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
          pts.push(P(x, y));
          if (Math.abs(x) > DW + 1 || Math.abs(y) > DH + 1) break;
          if (qs.some(q => q.q < 0 && Math.hypot(x - q.x, y - q.y) < 0.9)) break;
        }
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        if (pts.length > 12) { const m = (pts.length * 0.45) | 0; mids.push([pts[m], pts[m + 2]]); }
      }
      c.beginPath();
      for (const [a, b] of mids) { const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); for (const s of [-1, 1]) { c.moveTo(a[0] + 4 * Math.cos(ang), a[1] + 4 * Math.sin(ang)); c.lineTo(a[0] + 4 * Math.cos(ang) - 5 * Math.cos(ang + s * 0.5), a[1] + 4 * Math.sin(ang) - 5 * Math.sin(ang + s * 0.5)); } }
      c.stroke();
      for (const q of qs) { const p = P(q.x, q.y); drawGlyph(c, p[0], p[1], q.q > 1 ? 13 : 9, { q: q.q }); }
      cap('Proposed: electric. Twenty-eight field lines leave the +2 charge and end on the two −1 charges, fourteen each, so their density reads the field’s strength. Equipotentials are solid sienna where the potential is positive and dashed prussian where it is negative, so the sign survives in grey.');
    } else if (mode === 'mag') {
      const ds = dipoles(tNow);
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) grid[j * NX + i] = Bz(gx(i), gy(j), ds);
      const zl = contourLines(grid, NX, NY, 0).map(l => l.map(p => G(p[0], p[1])));
      c.strokeStyle = rgba(tok['ink-verdigris'], 0.65); c.lineWidth = 1; c.setLineDash([4, 3]);
      c.beginPath(); for (const l of zl) l.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke(); c.setLineDash([]);
      for (const l of zl.sort((a, b) => b.length - a.length).slice(0, 1)) labelAlong(c, l, 'Bz = 0', taken, { box, color: tok['ink-verdigris'] });
      // an octave lattice fixed to the plane: a site of level L shows once |Bz| passes 0.01·5^L
      const col = tok['ink-verdigris'], r = 4;
      c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1;
      for (let L = 0; L < 3; L++) {
        const sp = 4 / 2 ** L, thr = 0.01 * 5 ** L;
        for (let y = -DH + sp / 2; y < DH; y += sp) for (let x = -DW + sp / 2; x < DW; x += sp) {
          if (L > 0) { const cs = sp * 2, fx = (x + DW - sp / 2) / cs, fy = (y + DH - sp / 2) / cs; if (Math.abs(fx - Math.round(fx)) < 1e-6 && Math.abs(fy - Math.round(fy)) < 1e-6) continue; }
          const b = Bz(x, y, ds); if (Math.abs(b) < thr) continue;
          if (ds.some(d => Math.hypot(x - d.x, y - d.y) < 1.4)) continue;
          const p = P(x, y);
          c.beginPath(); c.arc(p[0], p[1], r, 0, TAU); c.stroke();
          if (b > 0) { c.beginPath(); c.moveTo(p[0] - r * 0.7, p[1] - r * 0.7); c.lineTo(p[0] + r * 0.7, p[1] + r * 0.7); c.moveTo(p[0] + r * 0.7, p[1] - r * 0.7); c.lineTo(p[0] - r * 0.7, p[1] + r * 0.7); c.stroke(); }
          else { c.beginPath(); c.arc(p[0], p[1], 1.2, 0, TAU); c.fill(); }
        }
      }
      for (const d of ds) { const p = P(d.x, d.y); drawGlyph(c, p[0], p[1], 10, { q: d.q, tick: tNow * 0.08 * Math.sign(d.mu) }); }
      cap('Proposed: magnetic. Bz, which points out of the plane, as ⊙ and ⊗ on a lattice fixed to the plane: one symbol every 4 where the field is weak, every 2 and then every 1 as it strengthens. The uniform field reads as an open lattice instead of a wallpaper, and the dashed line marks where the spinning charges’ dipole fields cancel it.');
    } else {
      // hatching through a mask upscaled from the grid, so its ends follow the walls smoothly
      if (!patterns) patterns = { pos: hatch(higgsInk(true), 1), neg: hatch(higgsInk(false), -1) };
      if (!maskC) { maskC = document.createElement('canvas'); maskC.width = HX; maskC.height = HY; }
      if (!layer || layer.width !== c.canvas.width || layer.height !== c.canvas.height) { layer = document.createElement('canvas'); layer.width = c.canvas.width; layer.height = c.canvas.height; }
      const lc = layer.getContext('2d'), mc = maskC.getContext('2d'), img = mc.createImageData(HX, HY);
      for (const sign of [true, false]) {
        for (let k = 0; k < HX * HY; k++) { const a = clamp(0.5 + (sign ? 1 : -1) * phi[k] * 3, 0, 1); img.data[4 * k + 3] = a * 255; }
        mc.putImageData(img, 0, 0);
        lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, layer.width, layer.height);
        lc.setTransform(sk.dpr, 0, 0, sk.dpr, 0, 0);
        lc.globalCompositeOperation = 'source-over'; lc.fillStyle = sign ? patterns.pos : patterns.neg; lc.fillRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
        lc.globalCompositeOperation = 'destination-in'; lc.imageSmoothingEnabled = true; lc.drawImage(maskC, box[0], box[1], box[2] - box[0], box[3] - box[1]);
        lc.globalCompositeOperation = 'source-over';
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(layer, 0, 0); c.restore();
      }
      const HXm = (i, j) => [box[0] + (box[2] - box[0]) * (i + 0.5) / HX, box[1] + (box[3] - box[1]) * (j + 0.5) / HY];
      const walls = contourLines(phi, HX, HY, 0).map(l => l.map(p => HXm(p[0], p[1])));
      c.strokeStyle = rgba(tok.text, 0.8); c.lineWidth = 1.4; c.lineJoin = 'round';
      c.beginPath(); for (const l of walls) l.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
      for (const lb of comps.labels) { const p = HXm(lb.i, lb.j); haloText(c, lb.sign ? '+v' : '−v', p[0], p[1], { align: 'center', color: higgsInk(lb.sign), font: `italic 15px ${FONT}` }); }
      const dn = n => n === 1 ? '1 domain has' : `${n} domains have`;
      cap(`Proposed: Higgs, ${since.toFixed(0)} after a quench. ${dn(comps.pos)} fallen to +v (hatched one way, in sap) and ${dn(comps.neg).replace(' have', '').replace(' has', '')} to −v (hatched the other, in violet); the walls between them are the φ = 0 contour. As the walls straighten and annihilate, the domains grow, and a slower quench would leave fewer.`);
    }
    c.restore();
    c.strokeStyle = rgba(tok.text, 0.4); c.lineWidth = 1; c.strokeRect(box[0] + 0.5, box[1] + 0.5, box[2] - box[0] - 1, box[3] - box[1] - 1);
  }
  wirePause(sk, $('#pp-fields'));
}
INITS.push(r2_Fields);
