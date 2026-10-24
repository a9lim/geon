
const $ = s => document.querySelector(s);
const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FONT = '"Newsreader", "STIX Two Text", Georgia, serif';
const TAU = Math.PI * 2;
const tok = {};
const INKS = ['indigo', 'prussian', 'verdigris', 'viridian', 'sap', 'ochre', 'sienna', 'umber', 'madder', 'mulberry', 'violet'];
const TOKS = ['canvas', 'panel', 'elevated', 'text', 'text2', 'muted', 'accent', 'scheme', ...INKS.map(n => 'ink-' + n)];
const INITS = [];
function readTokens() {
  const cs = getComputedStyle(root);
  for (const k of TOKS) tok[k] = cs.getPropertyValue('--' + k).trim();
  tok.dark = tok.scheme === 'dark';
}
readTokens();

const hexRgb = h => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
const mix = (h1, h2, t) => { const a = hexRgb(h1), b = hexRgb(h2); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt = n => Math.round(n).toLocaleString('en-US');
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeNoise(seed) {
  const rnd = mulberry32(seed), N = 64, g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (i, j) => g[(((j % N) + N) % N) * N + (((i % N) + N) % N)];
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), v = sm(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function captioner(el) {
  let last = 0, text = '';
  return (t, force) => {
    const now = performance.now();
    if (!force && now - last < 220) return;
    last = now;
    if (t !== text) { text = t; el.textContent = t; }
  };
}

/* ---------- sketch manager ---------- */
const sketches = [];
function makeSketch(canvas, impl) {
  const s = Object.assign({ canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, dpr: 1, visible: false, running: !reduceMotion, ready: false }, impl);
  sketches.push(s);
  new ResizeObserver(() => sizeSketch(s)).observe(canvas);
  new IntersectionObserver(es => { for (const e of es) s.visible = e.isIntersecting; }, { rootMargin: '160px' }).observe(canvas);
  return s;
}
function sizeSketch(s) {
  const r = s.canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
  if (s.ready && w === s.w && h === s.h && dpr === s.dpr) return;
  s.w = w; s.h = h; s.dpr = dpr;
  s.canvas.width = Math.round(w * dpr); s.canvas.height = Math.round(h * dpr);
  s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (s.layout) s.layout();
  s.ready = true;
  s.draw();
}
function wirePause(s, btn) {
  const sync = () => { btn.textContent = s.running ? 'Pause' : 'Play'; };
  btn.addEventListener('click', () => { s.running = !s.running; sync(); });
  sync();
}
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  for (const s of sketches) if (s.ready && s.visible && s.running) { s.step(dt); s.draw(); }
  requestAnimationFrame(loop);
}
function onTheme() {
  readTokens();
  for (const s of sketches) if (s.ready) { if (s.theme) s.theme(); s.draw(); }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });


