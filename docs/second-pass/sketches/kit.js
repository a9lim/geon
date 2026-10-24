
/* ---------- shared drawing kit for the second pass ---------- */

// The ink a body's charge takes: sienna for positive, prussian for negative, graphite when neutral.
function chargeInk(q) { return q > 0 ? tok['ink-sienna'] : q < 0 ? tok['ink-prussian'] : tok.muted; }
// A horizon is the darkest thing on the page in both themes.
function voidInk() { return tok.dark ? '#040404' : tok.text; }

/**
 * A body as proposed: its rest-frame disk contracted by 1/γ along its motion, a lighter body
 * inside a darker outline, the sign of its charge as a mark, and a rim tick that turns on its
 * proper time. Antimatter is hollow. A black hole is a void with its ergosphere dashed.
 * o: { q, anti, bh, ergo (px), ang (direction of motion), g (γ), tick (rad), sel, plane(c) }
 */
function drawGlyph(c, x, y, R, o) {
  const frame = (rest) => {
    c.translate(x, y);
    if (o.plane) o.plane(c);
    c.rotate(o.ang || 0);
    c.scale(1 / (o.g || 1), 1);
    if (rest) c.rotate(-(o.ang || 0));
  };
  const disk = (rr) => { c.save(); frame(false); c.beginPath(); c.arc(0, 0, rr, 0, TAU); c.restore(); };
  if (o.bh) {
    disk(R); c.fillStyle = voidInk(); c.fill();
    if (o.ergo) { disk(o.ergo); c.setLineDash([3, 3]); c.strokeStyle = rgba(tok.text, 0.55); c.lineWidth = 1; c.stroke(); c.setLineDash([]); }
  } else {
    const ink = chargeInk(o.q);
    disk(R);
    c.fillStyle = o.anti ? tok.canvas : mix(ink, tok.canvas, tok.dark ? 0.38 : 0.52); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.25; c.stroke();
    c.save(); frame(true); c.beginPath();
    if (R >= 5 && o.q) {
      const k = R * 0.42;
      c.moveTo(-k, 0); c.lineTo(k, 0);
      if (o.q > 0) { c.moveTo(0, -k); c.lineTo(0, k); }
    }
    if (o.tick !== undefined && R >= 4) {
      const a = o.tick, ca = Math.cos(a), sa = Math.sin(a);
      c.moveTo(R * 0.62 * ca, R * 0.62 * sa); c.lineTo(R * ca, R * sa);
    }
    c.restore();
    c.strokeStyle = ink; c.lineWidth = 1; c.stroke();
  }
  if (o.sel) { disk(R + 4.5); c.strokeStyle = tok.accent; c.lineWidth = 1.25; c.stroke(); }
}

// Photon colour by its Doppler factor: sienna when redshifted, graphite at 1, indigo when blueshifted.
function dopplerInk(D) {
  if (D < 1) return mix(tok.muted, tok['ink-sienna'], clamp((1 - D) / 0.5, 0, 1));
  return mix(tok.muted, tok['ink-indigo'], clamp((D - 1) / 1, 0, 1));
}

/** A photon as a wave packet along (nx, ny): wavelength in px reads its energy. */
function drawWiggle(c, x, y, nx, ny, lam, col, alpha = 1) {
  const L = Math.max(16, lam * 3.2), A = 2.6, px = -ny, py = nx;
  c.beginPath();
  for (let k = 0; k <= 40; k++) {
    const s = -L / 2 + L * k / 40, env = Math.exp(-((2 * s / L) ** 2) * 2.2);
    const w = A * env * Math.sin(TAU * s / lam);
    const X = x + nx * s + px * w, Y = y + ny * s + py * w;
    k ? c.lineTo(X, Y) : c.moveTo(X, Y);
  }
  c.strokeStyle = rgba(col, alpha); c.lineWidth = 1.3; c.stroke();
}

/* ---- contours: marching squares on a grid, stitched into polylines (grid coordinates) ---- */
function contourLines(f, nx, ny, L) {
  const segs = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = f[j * nx + i] - L, b = f[j * nx + i + 1] - L, cc = f[(j + 1) * nx + i + 1] - L, d = f[(j + 1) * nx + i] - L;
    const pts = [];
    if ((a > 0) !== (b > 0)) pts.push([i + a / (a - b), j]);            // top
    if ((b > 0) !== (cc > 0)) pts.push([i + 1, j + b / (b - cc)]);      // right
    if ((d > 0) !== (cc > 0)) pts.push([i + d / (d - cc), j + 1]);      // bottom
    if ((a > 0) !== (d > 0)) pts.push([i, j + a / (a - d)]);            // left
    if (pts.length === 2) segs.push(pts);
    else if (pts.length === 4) {
      const cutBD = (a > 0) === ((a + b + cc + d) / 4 > 0);
      if (cutBD) { segs.push([pts[0], pts[1]]); segs.push([pts[2], pts[3]]); }
      else { segs.push([pts[3], pts[0]]); segs.push([pts[1], pts[2]]); }
    }
  }
  const key = p => Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4);
  const ends = new Map();
  segs.forEach((s, k) => { for (const e of s) { const kk = key(e); let l = ends.get(kk); if (!l) ends.set(kk, l = []); l.push(k); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const fwd = [segs[k][1]], back = [segs[k][0]];
    for (const arr of [fwd, back]) {
      for (;;) {
        const tip = arr[arr.length - 1], tk = key(tip);
        const m = (ends.get(tk) || []).find(n => !used[n]);
        if (m === undefined) break;
        used[m] = 1;
        arr.push(key(segs[m][0]) === tk ? segs[m][1] : segs[m][0]);
      }
    }
    lines.push(back.reverse().concat(fwd));
  }
  return lines;
}

/** Stroke polylines given in grid coordinates through map(i, j) -> [x, y]. */
function strokeLines(c, lines, map) {
  c.beginPath();
  for (const l of lines) l.forEach((p, k) => { const q = map(p[0], p[1]); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
  c.stroke();
}

/**
 * Map labels set along a line, as on a survey sheet: upright, knocked out of the line with a
 * halo of the ground, and skipped where they would collide with one already placed.
 */
function labelAlong(c, pts, text, taken, opts = {}) {
  if (pts.length < 8) return false;
  c.font = opts.font || `italic 12.5px ${FONT}`;
  const w = c.measureText(text).width, need = w + 10;
  let len = 0; const acc = [0];
  for (let k = 1; k < pts.length; k++) { len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); acc.push(len); }
  if (len < need * 1.6) return false;
  for (const frac of opts.at || [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const target = len * frac;
    let k = acc.findIndex(v => v >= target); if (k < 2) k = 2; if (k > pts.length - 3) k = pts.length - 3;
    const p = pts[k];
    let a0 = Math.atan2(pts[k + 2][1] - pts[k - 2][1], pts[k + 2][0] - pts[k - 2][0]);
    const a1 = Math.atan2(pts[Math.min(pts.length - 1, k + 6)][1] - p[1], pts[Math.min(pts.length - 1, k + 6)][0] - p[0]);
    let bend = Math.abs(((a1 - a0 + 3 * Math.PI) % TAU) - Math.PI);
    if (bend > 0.5) continue;
    if (opts.box && (p[0] < opts.box[0] + need / 2 || p[0] > opts.box[2] - need / 2 || p[1] < opts.box[1] + 10 || p[1] > opts.box[3] - 10)) continue;
    if (taken.some(t => Math.hypot(t[0] - p[0], t[1] - p[1]) < (t[2] + need) / 2 + 4)) continue;
    if (a0 > Math.PI / 2) a0 -= Math.PI; else if (a0 < -Math.PI / 2) a0 += Math.PI;
    c.save(); c.translate(p[0], p[1]); c.rotate(a0);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 5; c.strokeStyle = tok.canvas; c.lineJoin = 'round'; c.strokeText(text, 0, 0);
    c.fillStyle = opts.color || tok.muted; c.fillText(text, 0, 0);
    c.restore();
    taken.push([p[0], p[1], need]);
    return true;
  }
  return false;
}

/** A label at a point with the ground's halo, for annotations. */
function haloText(c, text, x, y, opts = {}) {
  c.font = opts.font || `italic 13px ${FONT}`;
  c.textAlign = opts.align || 'left'; c.textBaseline = opts.base || 'middle';
  c.lineWidth = 5; c.strokeStyle = tok.canvas; c.lineJoin = 'round'; c.strokeText(text, x, y);
  c.fillStyle = opts.color || tok.muted; c.fillText(text, x, y);
}

/** A scale bar with 1-2-5 ticks: px per unit S, at most maxPx long, its right end at (x, y). */
function scaleBar(c, S, x, y, maxPx, unit) {
  const raw = maxPx / S, p10 = 10 ** Math.floor(Math.log10(raw));
  const step = [5, 2, 1].map(m => m * p10).find(v => v <= raw) || p10;
  const L = step * S, n = step / p10 === 5 ? 5 : step / p10 === 2 ? 4 : 5;
  c.strokeStyle = rgba(tok.text, 0.7); c.lineWidth = 1; c.beginPath();
  c.moveTo(x - L, y); c.lineTo(x, y);
  for (let k = 0; k <= n; k++) { const X = x - L + L * k / n, h = k === 0 || k === n ? 5 : 3; c.moveTo(X, y); c.lineTo(X, y - h); }
  c.stroke();
  c.font = `12.5px ${FONT}`; c.fillStyle = tok.muted; c.textBaseline = 'top'; c.textAlign = 'center';
  c.fillText('0', x - L, y + 4); c.fillText(String(+step.toPrecision(3)), x, y + 4);
  c.font = `italic 12.5px ${FONT}`; c.textAlign = 'right'; c.textBaseline = 'bottom';
  c.fillText(unit, x, y - 8);
}

/** The plate's key: a hairline box of rows, each a little drawing and its label. rows: [{draw(c, x, y), text}] */
function cartouche(c, x, y, rows, title = 'Reference') {
  c.font = `13px ${FONT}`;
  const w = 34 + Math.max(...rows.map(r => c.measureText(r.text).width)) + 16, rowH = 19, h = 30 + rows.length * rowH + 4;
  const top = y - h;
  c.fillStyle = rgba(tok.canvas, 0.92); c.fillRect(x, top, w, h);
  c.strokeStyle = tok.rule || rgba(tok.text, 0.14); c.strokeStyle = rgba(tok.text, 0.16); c.lineWidth = 1; c.strokeRect(x + 0.5, top + 0.5, w - 1, h - 1);
  c.font = `italic 13px ${FONT}`; c.fillStyle = tok.muted; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(title, x + w / 2, top + 15);
  rows.forEach((r, k) => {
    const ry = top + 34 + k * rowH;
    c.save(); r.draw(c, x + 19, ry); c.restore();
    c.font = `13px ${FONT}`; c.fillStyle = tok.text2; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(r.text, x + 36, ry + 0.5);
  });
  return [x, top, x + w, y];
}
