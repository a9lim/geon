// ─── Heatmap Overlay Rendering ───
// Fullscreen triangle, blends gravity (slate), electric (blue/red), and Yukawa (green)
// channels using fastTanh color mapping. Same approach as field-render.wgsl.

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

// Fullscreen triangle (3 vertices, no vertex buffer)
@vertex
fn vsFullscreen(@builtin(vertex_index) vid: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

struct HeatmapRenderUniforms {
    cameraX: f32,
    cameraY: f32,
    cameraZoom: f32,
    canvasW: f32,
    canvasH: f32,
    viewLeft: f32,
    viewTop: f32,
    cellW: f32,
    cellH: f32,
    sensitivity: f32,    // HEATMAP_SENSITIVITY = 2
    maxAlpha: f32,       // 100/255
    isLight: u32,
    doGravity: u32,
    doCoulomb: u32,
    doYukawa: u32,
    tilt: f32,           // the spacetime view's tilt: tilted, the overlay keeps to the domain
    domainW: f32,
    domainH: f32,
    doMagnetic: u32,     // draw Bz as ⊙/⊗
    glyphPx: f32,        // screen px per world unit on the plane (zoom, times the tilt's fit)
};

// HGRID provided by generated wgslConstants block.

struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    invViewMatrix: mat4x4<f32>,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    isDarkMode: f32,
    relativityOn: f32,
    blackHoleOn: f32,
    showClocks: f32,
    frameOn: f32,
    frameImages: f32,
    dpr: f32,           // device px per CSS px (the uniform sizes are CSS px)
};

@group(0) @binding(0) var<storage, read> gravPotential: array<f32>;
@group(0) @binding(1) var<storage, read> elecPotential: array<f32>;
@group(0) @binding(2) var<storage, read> yukawaPotential: array<f32>;
@group(0) @binding(3) var<uniform> ru: HeatmapRenderUniforms;
@group(0) @binding(4) var<uniform> camera: CameraUniforms;
@group(0) @binding(5) var<storage, read> magField: array<f32>;

// Fast tanh approximation: x/(1+|x|)
fn fastTanh(x: f32) -> f32 {
    return x / (1.0 + abs(x));
}

fn gridOf(world: vec2<f32>) -> vec2<f32> {
    return vec2((world.x - ru.viewLeft) / ru.cellW, (world.y - ru.viewTop) / ru.cellH);
}

/** Bilinear sample of a potential grid at grid coordinates g (clamped to the grid). */
fn sampleAt(which: u32, g: vec2<f32>) -> f32 {
    let gc = clamp(g, vec2(0.0), vec2(f32(HGRID) - 1.001));
    let i0 = vec2<u32>(floor(gc));
    let i1 = min(i0 + 1u, vec2(HGRID - 1u));
    let f = gc - floor(gc);
    var a: f32; var b: f32; var c: f32; var d: f32;
    if (which == 0u) {
        a = gravPotential[i0.y * HGRID + i0.x]; b = gravPotential[i0.y * HGRID + i1.x];
        c = gravPotential[i1.y * HGRID + i0.x]; d = gravPotential[i1.y * HGRID + i1.x];
    } else if (which == 1u) {
        a = elecPotential[i0.y * HGRID + i0.x]; b = elecPotential[i0.y * HGRID + i1.x];
        c = elecPotential[i1.y * HGRID + i0.x]; d = elecPotential[i1.y * HGRID + i1.x];
    } else if (which == 2u) {
        a = yukawaPotential[i0.y * HGRID + i0.x]; b = yukawaPotential[i0.y * HGRID + i1.x];
        c = yukawaPotential[i1.y * HGRID + i0.x]; d = yukawaPotential[i1.y * HGRID + i1.x];
    } else {
        a = magField[i0.y * HGRID + i0.x]; b = magField[i0.y * HGRID + i1.x];
        c = magField[i1.y * HGRID + i0.x]; d = magField[i1.y * HGRID + i1.x];
    }
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** The field −∇φ in grid units at grid coordinates g, by central differences. */
fn fieldAt(which: u32, g: vec2<f32>) -> vec2<f32> {
    let dx = sampleAt(which, g + vec2(1.0, 0.0)) - sampleAt(which, g - vec2(1.0, 0.0));
    let dy = sampleAt(which, g + vec2(0.0, 1.0)) - sampleAt(which, g - vec2(0.0, 1.0));
    return -0.5 * vec2(dx / ru.cellW, dy / ru.cellH);
}

fn hash2(p: vec2<f32>) -> f32 {
    let q = vec2<u32>(vec2<i32>(floor(p)) + vec2(65536));
    var h = (q.x * 0x27d4eb2du) ^ (q.y * 0x165667b1u);
    h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
    h = h ^ (h >> 12u);
    return f32(h & 0xFFFFu) / 65535.0;
}

// Line integral convolution: white noise on a lattice fixed to the plane (so the texture
// moves with the bodies, not the screen), averaged along the field's streamline through
// the pixel. The streaks are the field lines; their contrast reads the field's strength.
const LIC_STEPS: i32 = 10;
fn lic(which: u32, world: vec2<f32>, pxWorld: f32) -> vec2<f32> {
    let grain = 1.7 * pxWorld;        // noise cell, in world units: a streak about 2 px wide
    let h = 1.4 * pxWorld;            // integration step
    var sum = hash2(world / grain);
    var wsum = 1.0;
    var strength = 0.0;
    for (var dirSign = -1.0; dirSign <= 1.0; dirSign += 2.0) {
        var p = world;
        for (var k = 1; k <= LIC_STEPS; k++) {
            let e = fieldAt(which, gridOf(p));
            let m = length(e);
            if (k == 1 && dirSign > 0.0) { strength = m; }
            if (m < 1e-9) { break; }
            p += dirSign * h * e / m;
            let w = 1.0 - f32(k) / f32(LIC_STEPS + 1);
            sum += hash2(p / grain) * w;
            wsum += w;
        }
    }
    return vec2(sum / wsum, strength);
}

// The magnetic field is out of the plane, so it has no direction to comb: it is drawn in
// the textbook way, ⊙ out of the page and ⊗ into it, on a lattice fixed to the plane. Each
// site shows with probability 1 − exp(−|Bz|/B0), so the symbols per unit area are
// proportional to the field where it is weak (field lines per unit area) and fill the
// lattice where it is strong. World y runs down the screen, so the right-handed z axis
// points into it: Bz > 0 is ⊗.
const B0: f32 = 0.04;
const GLYPH_PX: f32 = 16.0;   // lattice spacing, about this many CSS px (an octave of world units)

fn magGlyph(world: vec2<f32>, pxWorld: f32) -> vec2<f32> {
    let spacing = exp2(round(log2(GLYPH_PX / max(ru.glyphPx, 1e-6))));
    let cell = floor(world / spacing);
    let centre = (cell + 0.5) * spacing;
    // The site's own field decides it, so a symbol is always whole
    let B = sampleAt(3u, gridOf(centre));
    if (hash2(cell + vec2(0.37, 0.71)) >= 1.0 - exp(-abs(B) / B0)) { return vec2(0.0); }
    let q = (world - centre) / spacing;               // in [−0.5, 0.5]
    let w = max(pxWorld / spacing, 1e-4);              // one CSS px, in lattice units
    let aa = w * 0.75;
    let r = length(q);
    let R = 0.3;
    var cover = 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(r - R));
    if (B < 0.0) {
        cover = max(cover, 1.0 - smoothstep(0.075 - aa, 0.075 + aa, r));
    } else {
        let diag = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.70710678;
        cover = max(cover, (1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, diag)) * step(r, R * 0.72));
    }
    return vec2(cover, B);
}

@fragment
fn fsHeatmapOverlay(in: VertexOutput) -> @location(0) vec4<f32> {
    let css = in.pos.xy / max(camera.dpr, 1.0);
    let ndc = vec2(css.x / camera.canvasWidth * 2.0 - 1.0, 1.0 - css.y / camera.canvasHeight * 2.0);
    let world = (camera.invViewMatrix * vec4(ndc, 0.0, 1.0)).xy;
    let g = gridOf(world);
    if (g.x < 0.0 || g.x >= f32(HGRID) || g.y < 0.0 || g.y >= f32(HGRID)) {
        return vec4<f32>(0.0);
    }
    // World units per screen px here (foreshortened on a tilted plane)
    let pxWorld = length((camera.invViewMatrix * vec4(ndc + vec2(2.0 / camera.canvasWidth, 0.0), 0.0, 1.0)).xy - world);

    let lt = ru.isLight != 0u;
    var inside = 1.0;
    if (ru.tilt > 0.0) {
        inside = mix(1.0, step(0.0, world.x) * step(world.x, ru.domainW) * step(0.0, world.y) * step(world.y, ru.domainH), ru.tilt);
    }

    // Bz, in verdigris (the magnetic ink)
    var glyph = 0.0;
    // Lighter when the potentials and combed field share the overlay
    let alone = ru.doGravity == 0u && ru.doCoulomb == 0u && ru.doYukawa == 0u;
    if (ru.doMagnetic != 0u) { glyph = magGlyph(world, pxWorld).x * select(0.45, 0.8, alone) * inside; }
    let mag = select(INK_VERDIGRIS_D, INK_VERDIGRIS_L, lt);

    var gI = 0.0;
    var eI = 0.0;
    var yI = 0.0;
    var eSign = 0.0;
    if (ru.doGravity != 0u) { gI = abs(fastTanh(sampleAt(0u, g) * ru.sensitivity)); }
    if (ru.doCoulomb != 0u) {
        let eVal = sampleAt(1u, g);
        eSign = eVal;
        eI = abs(fastTanh(eVal * ru.sensitivity));
    }
    if (ru.doYukawa != 0u) { yI = abs(fastTanh(sampleAt(2u, g) * ru.sensitivity)); }
    let totalI = gI + eI + yI;
    if (totalI < 0.001) { return vec4<f32>(mag * glyph, glyph); }

    // Gravity graphite, electric sienna (+) or prussian (−), Yukawa viridian
    let eColor = select(select(INK_PRUSSIAN_D, INK_PRUSSIAN_L, lt), select(INK_SIENNA_D, INK_SIENNA_L, lt), eSign >= 0.0);
    let rgb = (select(INK_GRAPHITE_D, INK_GRAPHITE_L, lt) * gI + eColor * eI + select(INK_VIRIDIAN_D, INK_VIRIDIAN_L, lt) * yI) / totalI;
    let wash = min(totalI * ru.maxAlpha, 120.0 / 255.0) * 0.55;

    // Comb the electric field where it is on, else gravity's: streaks along −∇φ
    var combed = 0.0;
    let which = select(0u, 1u, ru.doCoulomb != 0u);
    if (ru.doCoulomb != 0u || ru.doGravity != 0u) {
        let l = lic(which, world, pxWorld);
        let reach = fastTanh(sqrt(l.y) * 4.0);
        combed = clamp((l.x - 0.5) * 6.0 + 0.5, 0.0, 1.0) * reach * select(0.55, 0.65, !lt);
    }
    let alpha = clamp(wash + combed * (1.0 - wash), 0.0, 0.85) * inside;
    // The symbols lie over the wash and the combing
    return vec4<f32>(rgb * alpha * (1.0 - glyph) + mag * glyph, alpha * (1.0 - glyph) + glyph);  // premultiplied
}
