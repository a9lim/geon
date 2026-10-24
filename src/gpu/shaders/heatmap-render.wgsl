// ─── Heatmap Overlay Rendering: the magnetic field ───
// Fullscreen triangle. The potentials and the electric field are drawn as contours and field
// lines on the overlay canvas (src/field-atlas.js, from a readback of these grids); this pass
// draws Bz, which points out of the plane and so has no direction to draw a line along.
//
// Bz is drawn the textbook way, ⊙ out of the page and ⊗ into it, on lattices fixed to the
// plane, one octave of density per decade of |Bz|: every site of the coarsest lattice (about
// 64 px apart) shows once |Bz| passes B0, the sites halfway between them once it passes 10·B0,
// and halfway again past 100·B0. A uniform field is an even lattice whose spacing reads its
// strength; a dipole's field crowds toward the dipole. World y runs down the screen, so the
// right-handed z axis points into it: Bz > 0 is ⊗. Drawn inside the domain only.

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
    sensitivity: f32,
    maxAlpha: f32,
    isLight: u32,
    doGravity: u32,
    doCoulomb: u32,
    doYukawa: u32,
    tilt: f32,           // the spacetime view's tilt
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

@group(0) @binding(3) var<uniform> ru: HeatmapRenderUniforms;
@group(0) @binding(4) var<uniform> camera: CameraUniforms;
@group(0) @binding(5) var<storage, read> magField: array<f32>;

const B0: f32 = 0.1;
const COARSE_PX: f32 = 64.0;
const SYMBOL_PX: f32 = 3.6;   // the symbol's radius

fn gridOf(world: vec2<f32>) -> vec2<f32> {
    return vec2((world.x - ru.viewLeft) / ru.cellW, (world.y - ru.viewTop) / ru.cellH);
}

/** Bilinear sample of Bz at grid coordinates g (clamped to the grid). */
fn bzAt(g: vec2<f32>) -> f32 {
    let gc = clamp(g, vec2(0.0), vec2(f32(HGRID) - 1.001));
    let i0 = vec2<u32>(floor(gc));
    let i1 = min(i0 + 1u, vec2(HGRID - 1u));
    let f = gc - floor(gc);
    let a = magField[i0.y * HGRID + i0.x];
    let b = magField[i0.y * HGRID + i1.x];
    let c = magField[i1.y * HGRID + i0.x];
    let d = magField[i1.y * HGRID + i1.x];
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Coverage of a ⊙ or ⊗ at q, px from its site, for a field Bz. */
fn symbol(q: vec2<f32>, B: f32) -> f32 {
    let aa = 0.6 / max(camera.dpr, 1.0);
    let r = length(q);
    var cover = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, abs(r - SYMBOL_PX));
    if (B < 0.0) {
        cover = max(cover, 1.0 - smoothstep(1.1 - aa, 1.1 + aa, r));
    } else {
        let diag = min(abs(q.x - q.y), abs(q.x + q.y)) * 0.70710678;
        cover = max(cover, (1.0 - smoothstep(0.5 - aa, 0.5 + aa, diag)) * step(r, SYMBOL_PX * 0.72));
    }
    return cover;
}

@fragment
fn fsHeatmapOverlay(in: VertexOutput) -> @location(0) vec4<f32> {
    if (ru.doMagnetic == 0u) { return vec4<f32>(0.0); }
    let css = in.pos.xy / max(camera.dpr, 1.0);
    let ndc = vec2(css.x / camera.canvasWidth * 2.0 - 1.0, 1.0 - css.y / camera.canvasHeight * 2.0);
    let world = (camera.invViewMatrix * vec4(ndc, 0.0, 1.0)).xy;
    let g = gridOf(world);
    if (g.x < 0.0 || g.x >= f32(HGRID) || g.y < 0.0 || g.y >= f32(HGRID)) { return vec4<f32>(0.0); }
    // World units per screen px here (foreshortened on a tilted plane)
    let pxWorld = length((camera.invViewMatrix * vec4(ndc + vec2(2.0 / camera.canvasWidth, 0.0), 0.0, 1.0)).xy - world);

    // The coarsest spacing: a power of two in world units near COARSE_PX on screen
    let s0 = exp2(round(log2(COARSE_PX / max(ru.glyphPx, 1e-6))));
    var cover = 0.0;
    for (var L = 0; L < 3; L++) {
        let sp = s0 / exp2(f32(L));
        let k = round(world / sp);
        // A site both of whose indices are even belongs to the coarser lattice
        let even = abs(fract(k * 0.5)) < vec2(0.25);
        if (L > 0 && even.x && even.y) { continue; }
        let centre = k * sp;
        if (centre.x < 0.0 || centre.x > ru.domainW || centre.y < 0.0 || centre.y > ru.domainH) { continue; }
        let B = bzAt(gridOf(centre));
        if (abs(B) < B0 * pow(10.0, f32(L))) { continue; }
        cover = max(cover, symbol((world - centre) / max(pxWorld, 1e-6), B));
    }
    let a = cover * select(0.8, 0.72, ru.isLight != 0u);
    let ink = select(INK_VERDIGRIS_D, INK_VERDIGRIS_L, ru.isLight != 0u);
    return vec4<f32>(ink * a, a);   // premultiplied
}
