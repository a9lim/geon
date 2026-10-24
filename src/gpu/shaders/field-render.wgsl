// ─── Scalar Field Overlay Rendering ───
// Fullscreen triangle, fragment shader samples field grid, bilinear upscale,
// color-maps deviation from vacuum. Rendered with alpha blending, depth off.

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

// Fullscreen triangle (3 vertices, no vertex buffer)
@vertex
fn vsFullscreen(@builtin(vertex_index) vid: u32) -> VertexOutput {
    var out: VertexOutput;
    // Fullscreen triangle: vertices at (-1,-1), (3,-1), (-1,3)
    let x = f32(i32(vid & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vid >> 1u)) * 4.0 - 1.0;
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
    return out;
}

struct FieldRenderUniforms {
    cameraX: f32,       // (the flat camera; the plane's inverse matrix maps pixels now)
    cameraY: f32,
    cameraZoom: f32,
    canvasW: f32,
    canvasH: f32,
    domainW: f32,
    domainH: f32,
    isLight: u32,
    fieldType: u32,  // 0=higgs, 1=axion
    vev: f32,        // the Higgs vacuum, √ε during a quench (1 otherwise)
    _pad1: f32,
    _pad2: f32,
    // Colors (packed as vec4 RGBA floats)
    color0: vec4<f32>,  // the negative side: Higgs −v (violet), axion (indigo)
    color1: vec4<f32>,  // the positive side: Higgs +v (sap), axion (ochre)
};

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

@group(0) @binding(0) var<storage, read> field: array<f32>;
@group(0) @binding(1) var<uniform> renderUniforms: FieldRenderUniforms;
@group(0) @binding(2) var<uniform> camera: CameraUniforms;

fn fieldAt(gx: f32, gy: f32) -> f32 {
    let ix0 = u32(clamp(floor(gx), 0.0, f32(GRID - 1u)));
    let iy0 = u32(clamp(floor(gy), 0.0, f32(GRID - 1u)));
    let ix1 = min(ix0 + 1u, GRID - 1u);
    let iy1 = min(iy0 + 1u, GRID - 1u);
    let fx = clamp(gx - f32(ix0), 0.0, 1.0);
    let fy = clamp(gy - f32(iy0), 0.0, 1.0);
    let f00 = field[iy0 * GRID + ix0];
    let f10 = field[iy0 * GRID + ix1];
    let f01 = field[iy1 * GRID + ix0];
    let f11 = field[iy1 * GRID + ix1];
    return mix(mix(f00, f10, fx), mix(f01, f11, fx), fy);
}

/** Coverage of the contour lines of s (one per unit), `px` wide on screen. */
fn contour(s: f32, px: f32) -> f32 {
    let w = max(fwidth(s), 1e-6);
    let f = abs(fract(s + 0.5) - 0.5) / w;
    return 1.0 - smoothstep(px * 0.5 - 0.5, px * 0.5 + 0.5, f);
}

/** The field averaged over a tent ±1 cell wide: grid-scale noise stays out of its sign. */
fn fieldSmooth(gx: f32, gy: f32) -> f32 {
    var sum = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let w = f32((2 - abs(dx)) * (2 - abs(dy))) / 16.0;
            sum += w * fieldAt(gx + f32(dx), gy + f32(dy));
        }
    }
    return sum;
}

// The field as a relief, by pattern before hue: each side of zero hatched its own way in its
// own ink (the Higgs: +v one way in sap, −v the other in violet; the axion: indigo and ochre),
// once the field has left the noise about zero, and the zero contour drawn heavier: for the Higgs, the
// walls between the domains a quench leaves; for the axion, its nodes. The Higgs also takes
// thin contours every v/4 from its vacuum, faded where the field sits at the vacuum, so a
// calm field draws only its hatch. The axion's sign is read from the smoothed field.
@fragment
fn fsFieldOverlay(in: VertexOutput) -> @location(0) vec4<f32> {
    let css = in.pos.xy / max(camera.dpr, 1.0);
    let ndc = vec2(css.x / camera.canvasWidth * 2.0 - 1.0, 1.0 - css.y / camera.canvasHeight * 2.0);
    let world = (camera.invViewMatrix * vec4(ndc, 0.0, 1.0)).xy;
    let gx = world.x / renderUniforms.domainW * f32(GRID);
    let gy = world.y / renderUniforms.domainH * f32(GRID);
    // No early return: the contours take derivatives, which need uniform control flow
    let inside = select(0.0, 1.0, gx >= 0.0 && gx < f32(GRID) && gy >= 0.0 && gy < f32(GRID));
    let higgs = renderUniforms.fieldType == 0u;
    let val = select(fieldSmooth(gx, gy), fieldAt(gx, gy), higgs);

    let v = max(renderUniforms.vev, 0.05);
    let pos = val >= 0.0;
    // Whether it has left zero: past the symmetric phase's noise it has picked a side
    let depth = smoothstep(0.01, 0.06, abs(val));
    let dark = renderUniforms.isLight == 0u;

    // Hatching: lines of constant x ± y, 6 px apart, one CSS px wide
    let u = select(css.x - css.y, css.x + css.y, pos) * 0.70710678;
    let d = abs(fract(u / 6.0 + 0.5) - 0.5) * 6.0;
    let hatch = (1.0 - smoothstep(0.25, 0.85, d)) * depth * select(0.42, 0.5, dark);

    // The zero contour, and for the Higgs thin contours every v/4 away from its vacuum
    let c = select(val * 4.0, val / v * 4.0, higgs);
    let wall = contour(c * 0.25, 1.6 * camera.dpr) * (1.0 - step(0.5, abs(c))) * select(0.65, 0.75, dark);
    let calm = select(0.0, smoothstep(0.08, 0.3, abs(abs(val) - v) / v), higgs);
    let lines = contour(c, camera.dpr) * calm * select(0.28, 0.34, dark);

    let tintCol = select(renderUniforms.color0.rgb, renderUniforms.color1.rgb, pos);
    let ink = select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, dark);
    var rgb = tintCol * (hatch + lines);
    var a = hatch + lines;
    rgb = rgb * (1.0 - wall) + ink * wall;
    a = a * (1.0 - wall) + wall;
    a = clamp(a, 0.0, 0.95) * inside;
    return vec4<f32>(rgb * inside, a);  // premultiplied: each term above is colour × its alpha
}
