// clock-render.wgsl — Proper-time clock rings around particles (the Clocks overlay).
//
// Each body's ring fills clockwise from the top once per CLOCK_PERIOD of its own proper
// time, so moving bodies and bodies deep in a well visibly lag. The ring sits on the
// body and contracts with it along v (Relativity on).
//
// Entry points, both triangle-strip ribbons of RING_SEGMENTS * 2 vertices per instance:
//   vs_track — the faint full circle
//   vs_main  — the elapsed arc

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
    _pad: f32,
};

// Struct definitions (ParticleState, ParticleAux, ParticleDerived) provided by shared-structs.wgsl.

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read> particleAux: array<ParticleAux>;
@group(0) @binding(3) var<storage, read> derived: array<ParticleDerived>;
@group(0) @binding(4) var<storage, read> clocks: array<vec4<f32>>;   // y = phase in [0, CLOCK_PERIOD)

const RING_SEGMENTS: u32 = 48u;
const RING_GAP: f32 = 0.5;          // ring radius = body radius + RING_GAP
const RING_HALF_WIDTH: f32 = 0.12;

struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) color: vec4f,
};

fn offscreen() -> VertexOutput {
    var out: VertexOutput;
    out.pos = vec4f(0.0, 0.0, -2.0, 1.0);
    out.color = vec4f(0.0);
    return out;
}

// One ribbon vertex at fraction t ∈ [0, 1] of the arc [start, start + sweep].
fn ringVertex(instIdx: u32, vertIdx: u32, sweep: f32, color: vec4f) -> VertexOutput {
    let p = particles[instIdx];
    let d = derived[instIdx];
    let r = particleAux[instIdx].radius;

    let t = f32(vertIdx >> 1u) / f32(RING_SEGMENTS - 1u);
    let angle = -HALF_PI + t * sweep;
    let ringR = r + select(RING_GAP - RING_HALF_WIDTH, RING_GAP + RING_HALF_WIDTH, (vertIdx & 1u) == 1u);
    var off = vec2f(cos(angle), sin(angle)) * ringR;

    // Lorentz contraction along v, as for the body
    if (camera.relativityOn > 0.5) {
        let v = vec2f(d.velX, d.velY);
        let speed = min(length(v), MAX_SPEED_RATIO);
        if (speed > 1e-4) {
            let n = v / length(v);
            off -= (1.0 - sqrt(1.0 - speed * speed)) * dot(off, n) * n;
        }
    }

    var out: VertexOutput;
    out.pos = camera.viewMatrix * vec4f(p.posX + off.x, p.posY + off.y, 0.0, 1.0);
    out.color = color;
    return out;
}

fn inkColor(alpha: f32) -> vec4f {
    return vec4f(select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, camera.isDarkMode > 0.5), alpha);
}

@vertex
fn vs_track(@builtin(vertex_index) vertIdx: u32, @builtin(instance_index) instIdx: u32) -> VertexOutput {
    if ((particles[instIdx].flags & FLAG_ALIVE) == 0u || vertIdx >= RING_SEGMENTS * 2u) { return offscreen(); }
    return ringVertex(instIdx, vertIdx, TWO_PI, inkColor(0.14));
}

@vertex
fn vs_main(@builtin(vertex_index) vertIdx: u32, @builtin(instance_index) instIdx: u32) -> VertexOutput {
    if ((particles[instIdx].flags & FLAG_ALIVE) == 0u || vertIdx >= RING_SEGMENTS * 2u) { return offscreen(); }
    let elapsed = clocks[instIdx].y / CLOCK_PERIOD;
    let accent = select(COLOR_ACCENT_LIGHT, COLOR_ACCENT_DARK, camera.isDarkMode > 0.5);
    return ringVertex(instIdx, vertIdx, elapsed * TWO_PI, vec4f(accent, 0.85));
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Premultiplied alpha output
    return vec4f(in.color.rgb * in.color.a, in.color.a);
}
