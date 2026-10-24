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
    color0: vec4<f32>,  // Higgs depleted / Axion positive
    color1: vec4<f32>,  // Higgs enhanced, or the other vacuum / Axion negative
};

struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    invViewMatrix: mat4x4<f32>,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    isDarkMode: f32,
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

// The field as a relief: contours at even steps of its value, a heavier contour at zero (for
// the Higgs, the walls between the ±v domains a quench leaves; for the axion, the nodes), a
// faint tint by the sign of the deviation from vacuum, and hatching over the far side of
// zero, so the two vacua differ by pattern as well as ink.
@fragment
fn fsFieldOverlay(in: VertexOutput) -> @location(0) vec4<f32> {
    let ndc = vec2(in.pos.x / camera.canvasWidth * 2.0 - 1.0, 1.0 - in.pos.y / camera.canvasHeight * 2.0);
    let world = (camera.invViewMatrix * vec4(ndc, 0.0, 1.0)).xy;
    let gx = world.x / renderUniforms.domainW * f32(GRID);
    let gy = world.y / renderUniforms.domainH * f32(GRID);
    // No early return: the contours take derivatives, which need uniform control flow
    let inside = select(0.0, 1.0, gx >= 0.0 && gx < f32(GRID) && gy >= 0.0 && gy < f32(GRID));
    let val = fieldAt(gx, gy);

    var c: f32;          // the field in contour units
    var dev: f32;        // deviation from the nearest vacuum, for the tint
    var other: bool;     // past zero: the other vacuum, or the axion's negative side
    if (renderUniforms.fieldType == 0u) {
        let v = max(renderUniforms.vev, 0.05);
        c = val / v * 4.0;               // a contour every v/4
        dev = abs(val) - v;
        other = val < 0.0;
    } else {
        c = val * 20.0;                  // a contour every 0.05
        dev = val;
        other = val < 0.0;
    }
    let tintCol = select(renderUniforms.color0.rgb, renderUniforms.color1.rgb, other || (dev > 0.0 && renderUniforms.fieldType == 0u));
    let strength = clamp(abs(dev) * select(4.0, 8.0, renderUniforms.fieldType == 0u), 0.0, 1.0);
    let dark = renderUniforms.isLight == 0u;

    // Contours fade where the field sits at its vacuum, so a calm field draws nothing
    let lines = contour(c, 1.0) * smoothstep(0.02, 0.12, strength) * select(0.32, 0.4, dark);
    let wall = contour(c * 0.25, 1.6) * (1.0 - step(0.5, abs(c))) * select(0.55, 0.7, dark);
    let hatch = select(0.0, 1.0 - smoothstep(0.6, 1.6, abs(fract((in.pos.x + in.pos.y) / 7.0) - 0.5) * 7.0), other)
              * select(0.14, 0.18, dark);
    let tint = strength * select(0.10, 0.13, dark);

    let ink = select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, dark);
    var rgb = tintCol * tint + tintCol * lines + tintCol * hatch;
    var a = tint + lines + hatch;
    rgb = rgb * (1.0 - wall) + ink * wall;
    a = a * (1.0 - wall) + wall;
    a = clamp(a, 0.0, 0.95) * inside;
    return vec4<f32>(rgb * inside, a);  // premultiplied: each term above is colour × its alpha
}
