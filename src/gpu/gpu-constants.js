/**
 * @fileoverview GPU constants generator — single source of truth for WGSL constants.
 *
 * buildWGSLConstants() generates a WGSL const declaration block from config.js
 * exports + _PALETTE hex→RGB conversions. Prepended to all shaders at compile time.
 *
 * paletteRGB() delegates to _parseHex() from shared-tokens.js for hex→RGB conversion.
 */

import {
    SOFTENING, SOFTENING_SQ, BH_SOFTENING, BH_SOFTENING_SQ, BH_PW_MIN_GAP,
    INERTIA_K, MAG_MOMENT_K, TIDAL_STRENGTH,
    YUKAWA_COUPLING, AXION_COUPLING, HIGGS_AXION_COUPLING, HIGGS_MASS_FLOOR, GPU_EPSILON,
    PI, TWO_PI,
    BOSON_SOFTENING_SQ, BOSON_MIN_AGE, PHYSICS_DT,
    MIN_MASS, PHOTON_QUANTUM, ELECTRON_MASS,
    PION_HALF_LIFE, CHARGED_PION_HALF_LIFE, BOSON_CHARGE, MIN_KUGELBLITZ_ENERGY, MIN_KUGELBLITZ_COUNT,
    BH_THETA, BH_THETA_SQ,
    VELOCITY_VECTOR_SCALE,
    GPU_MAX_PHOTONS, GPU_MAX_PIONS, PHOTON_CULL_AGE, MAX_REJECTION_SAMPLES, GPU_MAX_LEPTONS, LEPTON_CULL_AGE,
    SPAWN_OFFSET_MULTIPLIER, SPAWN_OFFSET_FLOOR, ABERRATION_THRESHOLD,
    WORLDLINE_LEN, CLOCK_PERIOD,
    SCALAR_FIELD_MAX, FIELD_EXCITATION_SIGMA, METRIC_PHI_CLAMP, SHEET_THICKNESS_SQ,
    COL_PASS, COL_MERGE, COL_BOUNCE,
    BOUND_DESPAWN, BOUND_BOUNCE, BOUND_LOOP,
    TORUS, KLEIN, RP2,
    GPU_SCALAR_GRID,
    GPU_HEATMAP_GRID, GPU_MAX_PARTICLES, MAX_SPEED_RATIO,
    DESPAWN_MARGIN,
} from '../config.js';

const _PAL = window._PALETTE;

/**
 * Convert a hex color string (#RRGGBB) to normalized [r, g, b] floats (0–1).
 * Delegates to _parseHex() from shared-tokens.js.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export const paletteRGB = window._parseHex;

/** Format a float for WGSL (always includes decimal point). */
function wf(v) {
    const s = String(v);
    return s.includes('.') || s.includes('e') ? s : s + '.0';
}

/** Format a vec3f from [r,g,b] array. */
function wv3(rgb) {
    return `vec3f(${wf(rgb[0])}, ${wf(rgb[1])}, ${wf(rgb[2])})`;
}

let _cached = null;

/**
 * Build WGSL constants block from config.js + _PALETTE.
 * Called once at GPU init, result is cached.
 * @returns {string} WGSL const declarations
 */
export function buildWGSLConstants() {
    if (_cached) return _cached;

    // Grid derived constants
    const GRID = GPU_SCALAR_GRID;
    const GRID_SQ = GRID * GRID;
    const GRID_LAST = GRID - 1;
    const HGRID = GPU_HEATMAP_GRID;
    const HGRID_SQ = HGRID * HGRID;

    // The shared inks, one light/dark pair each (INK_<NAME>_L / _D), and
    // graphite, the neutral data hue (the theme's textMuted)
    const inkConsts = Object.keys(_PAL.light.inks).map(k => {
        const n = k.toUpperCase();
        return `const INK_${n}_L: vec3f = ${wv3(paletteRGB(_PAL.light.inks[k]))};\n` +
               `const INK_${n}_D: vec3f = ${wv3(paletteRGB(_PAL.dark.inks[k]))};`;
    }).join('\n') + `\nconst INK_GRAPHITE_L: vec3f = ${wv3(paletteRGB(_PAL.light.textMuted))};` +
        `\nconst INK_GRAPHITE_D: vec3f = ${wv3(paletteRGB(_PAL.dark.textMuted))};`;

    // Theme colors
    const textLight = paletteRGB(_PAL.light.text);
    const textDark = paletteRGB(_PAL.dark.text);
    const lightAccent = paletteRGB(_PAL.light.accent);
    const canvasLight = paletteRGB(_PAL.light.canvas);
    const canvasDark = paletteRGB(_PAL.dark.canvas);
    const darkAccent = paletteRGB(_PAL.dark.accent);

    _cached = `// ── Auto-generated from config.js + _PALETTE ──

// Physics constants
const SOFTENING: f32 = ${wf(SOFTENING)};
const SOFTENING_SQ: f32 = ${wf(SOFTENING_SQ)};
const BH_SOFTENING: f32 = ${wf(BH_SOFTENING)};
const BH_SOFTENING_SQ: f32 = ${wf(BH_SOFTENING_SQ)};
const BH_PW_MIN_GAP: f32 = ${wf(BH_PW_MIN_GAP)};
const INERTIA_K: f32 = ${wf(INERTIA_K)};
const MAG_MOMENT_K: f32 = ${wf(MAG_MOMENT_K)};
const TIDAL_STRENGTH: f32 = ${wf(TIDAL_STRENGTH)};
const YUKAWA_COUPLING: f32 = ${wf(YUKAWA_COUPLING)};
const AXION_COUPLING: f32 = ${wf(AXION_COUPLING)};
const HIGGS_AXION_COUPLING: f32 = ${wf(HIGGS_AXION_COUPLING)};
const HIGGS_MASS_FLOOR: f32 = ${wf(HIGGS_MASS_FLOOR)};
const EPSILON: f32 = ${wf(GPU_EPSILON)};
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;
const HALF_PI: f32 = 1.5707963268;
const LN2: f32 = 0.693147180559945;
const BOSON_SOFTENING_SQ: f32 = ${wf(BOSON_SOFTENING_SQ)};
const BOSON_MIN_AGE: u32 = ${BOSON_MIN_AGE}u;
const BOSON_MIN_AGE_TIME: f32 = ${wf(BOSON_MIN_AGE * PHYSICS_DT)};
const MAX_QUAD_WG: u32 = ${Math.ceil(GPU_MAX_PARTICLES / 64)}u;
const PHYSICS_DT: f32 = ${wf(PHYSICS_DT)};
const MIN_MASS: f32 = ${wf(MIN_MASS)};
const PHOTON_QUANTUM: f32 = ${wf(PHOTON_QUANTUM)};
const SCHWINGER_E_CR: f32 = ELECTRON_MASS * ELECTRON_MASS / BOSON_CHARGE;  // m_e²/e
const SCHWINGER_COEFF: f32 = BOSON_CHARGE * BOSON_CHARGE / (PI * PI);     // e²/π² (rate×area baked in)
const ELECTRON_MASS: f32 = ${wf(ELECTRON_MASS)};
const BOSON_CHARGE: f32 = ${wf(BOSON_CHARGE)};
const MAX_SPEED_RATIO: f32 = ${wf(MAX_SPEED_RATIO)};
const PION_HALF_LIFE: f32 = ${wf(PION_HALF_LIFE)};
const CHARGED_PION_HALF_LIFE: f32 = ${wf(CHARGED_PION_HALF_LIFE)};
const BH_THETA: f32 = ${wf(BH_THETA)};
const BH_THETA_SQ: f32 = ${wf(BH_THETA_SQ)};
const VELOCITY_VECTOR_SCALE: f32 = ${wf(VELOCITY_VECTOR_SCALE)};

// Capacity constants
const MAX_PARTICLES: u32 = ${GPU_MAX_PARTICLES}u;
const MAX_PHOTONS: u32 = ${GPU_MAX_PHOTONS}u;
const MAX_PIONS: u32 = ${GPU_MAX_PIONS}u;
const MAX_LEPTONS: u32 = ${GPU_MAX_LEPTONS}u;
const LEPTON_CULL_AGE: f32 = ${wf(LEPTON_CULL_AGE)};
const PION_POOL_CAP: u32 = ${GPU_MAX_PIONS + GPU_MAX_LEPTONS}u;
const MAX_GHOSTS: u32 = ${GPU_MAX_PARTICLES}u;
const PHOTON_CULL_AGE: f32 = ${wf(PHOTON_CULL_AGE)};
const MAX_REJECTION_SAMPLES: u32 = ${MAX_REJECTION_SAMPLES}u;
const SPAWN_OFFSET_MUL: f32 = ${wf(SPAWN_OFFSET_MULTIPLIER)};
const SPAWN_OFFSET_FLOOR: f32 = ${wf(SPAWN_OFFSET_FLOOR)};
const ABERRATION_THRESHOLD: f32 = ${wf(ABERRATION_THRESHOLD)};
const ABERRATION_CLAMP_MIN: f32 = 0.01;
const ABERRATION_CLAMP_MAX: f32 = 100.0;
// Liénard–Wiechert beaming floor: κ = 1 − n̂·β ≥ 0.01^(1/3), so 1/κ³ ≤ 100 like the aberration clamp
const LW_KAPPA_MIN: f32 = 0.21544347;

// Grid constants
const GRID: u32 = ${GRID}u;
const GRID_SQ: u32 = ${GRID_SQ}u;
const GRID_LAST: u32 = ${GRID_LAST}u;
const SCALAR_FIELD_MAX: f32 = ${wf(SCALAR_FIELD_MAX)};
const FIELD_EXCITATION_SIGMA: f32 = ${wf(FIELD_EXCITATION_SIGMA)};
const METRIC_PHI_CLAMP: f32 = ${wf(METRIC_PHI_CLAMP)};
const SHEET_THICKNESS_SQ: f32 = ${wf(SHEET_THICKNESS_SQ)};
const HGRID: u32 = ${HGRID}u;
const HGRID_SQ: u32 = ${HGRID_SQ}u;

// World lines (worldline.wgsl documents the sample layout), clocks, trails
const WL_LEN: u32 = ${WORLDLINE_LEN}u;
const WL_MASK: u32 = ${WORLDLINE_LEN - 1}u;
const WL_STRIDE: u32 = 12u;
// Meta: writeIdx, count, creationTime (f32 bits), generation, deck flips (bit 0 x, bit 1 y),
// deck offset x, y (f32 bits), _pad. The deck maps the wrapped position onto the covering plane.
const WL_META_STRIDE: u32 = 8u;
const CLOCK_PERIOD: f32 = ${wf(CLOCK_PERIOD)};

// Boundary mode enums
const BOUND_DESPAWN: u32 = ${BOUND_DESPAWN}u;
const BOUND_BOUNCE: u32 = ${BOUND_BOUNCE}u;
const BOUND_LOOP: u32 = ${BOUND_LOOP}u;

// Topology enums (both naming conventions)
const TOPO_TORUS: u32 = ${TORUS}u;
const TOPO_KLEIN: u32 = ${KLEIN}u;
const TOPO_RP2: u32 = ${RP2}u;
const TORUS: u32 = ${TORUS}u;
const KLEIN: u32 = ${KLEIN}u;
const RP2: u32 = ${RP2}u;

// Collision mode enums
const COL_PASS: u32 = ${COL_PASS}u;
const COL_MERGE: u32 = ${COL_MERGE}u;
const COL_BOUNCE: u32 = ${COL_BOUNCE}u;

// Particle flag bits (standardized FLAG_* prefix)
const FLAG_ALIVE: u32 = 1u;
const FLAG_RETIRED: u32 = 2u;
const FLAG_ANTIMATTER: u32 = 4u;
const FLAG_BH: u32 = 8u;
const FLAG_GHOST: u32 = 16u;
const FLAG_WL_BREAK: u32 = 32u;   // a merge jumped this body: its world line records a break
const FLAG_DEATH_HIST: u32 = 64u;

// Toggle bit constants (toggles0)
const GRAVITY_BIT: u32 = 1u;
const COULOMB_BIT: u32 = 2u;
const MAGNETIC_BIT: u32 = 4u;
const GRAVITOMAG_BIT: u32 = 8u;
const ONE_PN_BIT: u32 = 16u;
const RELATIVITY_BIT: u32 = 32u;
const SPIN_ORBIT_BIT: u32 = 64u;
const RADIATION_BIT: u32 = 128u;
const BLACK_HOLE_BIT: u32 = 256u;
const DISINTEGRATION_BIT: u32 = 512u;
const EXPANSION_BIT: u32 = 1024u;
const YUKAWA_BIT: u32 = 2048u;
const HIGGS_BIT: u32 = 4096u;
const AXION_BIT: u32 = 8192u;
const BARNES_HUT_BIT: u32 = 16384u;
const BOSON_INTER_BIT: u32 = 32768u;

// Toggle bit constants (toggles1)
const FIELD_GRAV_BIT: u32 = 1u;
const HERTZ_BOUNCE_BIT: u32 = 2u;
// Barnes–Hut with Relativity: EM runs pairwise (Liénard–Wiechert needs each source's
// world line, which tree aggregates lack), the tree walk carries everything else
const EM_PAIRWISE_BIT: u32 = 4u;

// Barnes-Hut tree constants
// NOTE: QT_CAPACITY intentionally NOT included — GPU uses 1 (lock-free), CPU uses 4.
const MAX_DEPTH: u32 = 48u;
const QT_MAX_NODES: u32 = ${GPU_MAX_PARTICLES * 6}u;

// Boundary
const DESPAWN_MARGIN: f32 = ${wf(DESPAWN_MARGIN)};

// Disintegration
const MAX_DISINT_EVENTS: u32 = 64u;

// Kugelblitz collapse
const MIN_KUGELBLITZ_ENERGY: f32 = ${wf(MIN_KUGELBLITZ_ENERGY)};
const MIN_KUGELBLITZ_COUNT: u32 = ${MIN_KUGELBLITZ_COUNT}u;

// Palette colors
${inkConsts}

// Theme colors
const COLOR_TEXT_LIGHT: vec3f = ${wv3(textLight)};
const COLOR_TEXT_DARK: vec3f = ${wv3(textDark)};
const COLOR_ACCENT_LIGHT: vec3f = ${wv3(lightAccent)};
const COLOR_ACCENT_DARK: vec3f = ${wv3(darkAccent)};
const COLOR_CANVAS_LIGHT: vec3f = ${wv3(canvasLight)};
const COLOR_CANVAS_DARK: vec3f = ${wv3(canvasDark)};
// A horizon is the darkest thing on the page in both themes: the text ink on the light
// ground, and below the dark ground's own value on the dark one
const COLOR_VOID_DARK: vec3f = vec3f(0.016, 0.016, 0.016);

`;
    return _cached;
}

// ── JS-side toggle bit constants (must match WGSL block above) ──

// toggles0
export const GRAVITY_BIT     = 1;
export const COULOMB_BIT     = 2;
export const MAGNETIC_BIT    = 4;
export const GRAVITOMAG_BIT  = 8;
export const ONE_PN_BIT      = 16;
export const RELATIVITY_BIT  = 32;
export const SPIN_ORBIT_BIT  = 64;
export const RADIATION_BIT   = 128;
export const BLACK_HOLE_BIT  = 256;
export const DISINTEGRATION_BIT = 512;
export const EXPANSION_BIT   = 1024;
export const YUKAWA_BIT      = 2048;
export const HIGGS_BIT       = 4096;
export const AXION_BIT       = 8192;
export const BARNES_HUT_BIT  = 16384;
export const BOSON_INTER_BIT = 32768;

// toggles1
export const FIELD_GRAV_BIT_T1 = 1;
export const HERTZ_BOUNCE_BIT_T1 = 2;
export const EM_PAIRWISE_BIT_T1 = 4;

// World-line buffer layout (must match the WGSL block above)
export const WL_STRIDE = 12;
export const WL_META_STRIDE = 8;
