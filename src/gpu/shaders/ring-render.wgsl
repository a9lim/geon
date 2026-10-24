// ring-render.wgsl — Instanced ring overlays, Lorentz-contracted with their body:
//   ringType 0, the ergosphere: a dashed hairline at the equatorial ergosphere of a black
//     hole, r_E = M + √(M² − Q²) (2M uncharged), outside the horizon r₊ = M + √(M² − a² − Q²).
//     The two coincide when the hole doesn't spin, and the gap between them reads its spin.
//   ringType 1, the selection: a solid accent hairline 4.5 px outside the selected body.
// Widths and dashes are in CSS px, so the rings stay hairlines at every zoom; the dash
// phase runs on the uncontracted angle. Triangle-strip full-circle ribbon.
//
// Constants from generated wgslConstants block:
//   FLAG_ALIVE, INERTIA_K, TWO_PI, MAX_SPEED_RATIO

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
};

// Struct definitions (ParticleState, ParticleAux, ParticleDerived) provided by shared-structs.wgsl.

struct RingParams {
    color: vec4f,       // ring color (non-premultiplied — premultiply in fragment)
    dashPx: f32,        // dash length, CSS px (0: solid)
    gapPx: f32,         // gap length, CSS px
    halfWidthPx: f32,   // half-width, CSS px
    ringType: u32,      // 0 = ergosphere, 1 = selection
    selected: u32,      // the selected slot, or 0xFFFFFFFF
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read> particleAux: array<ParticleAux>;
@group(0) @binding(3) var<storage, read> derived: array<ParticleDerived>;
@group(0) @binding(4) var<uniform> ring: RingParams;

const RING_SEGMENTS: u32 = 64u;

struct VertexOut {
    @builtin(position) position: vec4f,
    @location(0) ringColor: vec4f,
    @location(1) arcAngle: f32,
    @location(2) @interpolate(flat) ringPx: f32,   // the ring's radius in px
    @location(3) across: f32,                       // px from the ring's centre line
};

@vertex
fn vs_main(
    @builtin(vertex_index) vertIdx: u32,
    @builtin(instance_index) instIdx: u32,
) -> VertexOut {
    var out: VertexOut;
    let offScreen = vec4f(0.0, 0.0, -2.0, 1.0);
    out.position = offScreen;

    let p = particles[instIdx];
    if ((p.flags & FLAG_ALIVE) == 0u) { return out; }

    let aux = particleAux[instIdx];
    let der = derived[instIdx];
    let px = 1.0 / camera.zoom;

    var ringR: f32;
    if (ring.ringType == 0u) {
        if (p.mass <= 0.0) { return out; }
        let M = p.mass;
        ringR = M + sqrt(max(0.0, M * M - p.charge * p.charge));
        // A ring on the horizon says nothing: only one at least a pixel and a half out
        if (ringR <= aux.radius + 1.5 * px) { return out; }
    } else {
        let slot = select(instIdx, instIdx / u32(max(camera.frameImages, 1.0)), camera.frameOn > 0.5);
        if (slot != ring.selected) { return out; }
        ringR = max(aux.radius, 2.0 * px) + 4.5 * px;
    }

    // Full-circle triangle strip (RING_SEGMENTS + 1 pairs to close)
    let pointIdx = vertIdx >> 1u;
    let side = select(-1.0, 1.0, (vertIdx & 1u) == 1u);
    if (pointIdx > RING_SEGMENTS) { return out; }

    let angle = f32(pointIdx) / f32(RING_SEGMENTS) * TWO_PI;
    // One extra px each side for the antialiased edge
    let edgePx = ring.halfWidthPx + 1.0;
    var off = vec2f(cos(angle), sin(angle)) * (ringR + side * edgePx * px);

    // The ring belongs to the body, so it contracts with it along v (Relativity on)
    if (camera.relativityOn > 0.5) {
        let v = vec2f(der.velX, der.velY);
        let speed = min(length(v), MAX_SPEED_RATIO);
        if (speed > 1e-4) {
            let n = v / length(v);
            off -= (1.0 - sqrt(1.0 - speed * speed)) * dot(off, n) * n;
        }
    }

    out.position = camera.viewMatrix * vec4f(p.posX + off.x, p.posY + off.y, 0.0, 1.0);
    out.ringColor = ring.color;
    out.arcAngle = angle;
    out.ringPx = ringR * camera.zoom;
    out.across = side * edgePx;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    let aa = 0.5;
    var a = 1.0 - smoothstep(ring.halfWidthPx - aa, ring.halfWidthPx + aa, abs(in.across));
    if (ring.dashPx > 0.0) {
        // Snap the period to the circumference so dashes tile seamlessly at the seam
        let circumference = TWO_PI * in.ringPx;
        let nominal = ring.dashPx + ring.gapPx;
        let period = circumference / max(round(circumference / nominal), 1.0);
        let arc = in.arcAngle * in.ringPx;
        let phase = arc - floor(arc / period) * period;
        a *= 1.0 - smoothstep(period * ring.dashPx / nominal - aa, period * ring.dashPx / nominal + aa, phase);
    }
    a *= in.ringColor.a;
    if (a < 0.003) { discard; }
    return vec4f(in.ringColor.rgb * a, a);
}
