// Instanced particle rendering — vertex + fragment.
// Each body is its rest-frame disk, carrying one spoke at body angle θ, pushed through
// the Lorentz map of its centre's velocity (with Relativity on):
//   - a lab offset Δ maps to the rest-frame offset Δ + (γ − 1)(Δ·n̂)n̂, so the disk
//     contracts by 1/γ along v;
//   - the same lab instant is rest-frame time t′ − t′_c = −γvΔ∥ (relativity of
//     simultaneity), when the spoke stood at θ + ω·(t′ − t′_c). The spoke bends, by
//     2·v·v_rim across the diameter; a spoke perpendicular to v stays straight.
// ω is the body's rest-frame rotation rate, or the horizon's Ω_H for a black hole.

struct CameraUniforms {
    viewMatrix: mat4x4<f32>,
    invViewMatrix: mat4x4<f32>,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    isDarkMode: f32,   // 0.0 = light, 1.0 = dark
    relativityOn: f32,
    blackHoleOn: f32,
    showClocks: f32,
    _pad: f32,
};

// Struct definitions (ParticleState, ParticleAux, ParticleDerived) provided by shared-structs.wgsl.

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read> particleAux: array<ParticleAux>;
@group(0) @binding(3) var<storage, read> color: array<u32>;
@group(0) @binding(4) var<storage, read> derived: array<ParticleDerived>;
@group(0) @binding(5) var<storage, read> clocks: array<vec4<f32>>;   // z = θ

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) offset: vec2<f32>,                     // lab offset from the centre, world units
    @location(1) particleColor: vec4<f32>,
    @location(2) @interpolate(flat) boost: vec4<f32>,   // n̂.xy, γ, v
    @location(3) @interpolate(flat) body: vec4<f32>,    // radius, θ, ω, drawn radius
};

// Quad vertices: 2 triangles forming a [-1,1] square
const QUAD_POS = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0),  vec2(1.0, -1.0), vec2(1.0, 1.0),
);

@vertex
fn vs_main(
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
    var out: VertexOut;

    let p = particles[instanceIndex];
    // Skip non-alive particles by pushing off-screen
    if ((p.flags & 1u) == 0u) {
        out.position = vec4(0.0, 0.0, -2.0, 1.0);
        return out;
    }

    let r = particleAux[instanceIndex].radius;
    let d = derived[instanceIndex];

    var n = vec2<f32>(1.0, 0.0);
    var gamma = 1.0;
    var speed = 0.0;
    if (camera.relativityOn > 0.5) {
        speed = min(length(vec2(d.velX, d.velY)), MAX_SPEED_RATIO);
        if (speed > 1e-4) {
            n = vec2(d.velX, d.velY) / length(vec2(d.velX, d.velY));
            gamma = 1.0 / sqrt(1.0 - speed * speed);
        }
    }

    var omega = d.angVel;
    if (camera.blackHoleOn > 0.5) {
        let a = INERTIA_K * d.bodyRSq * abs(d.angVel);
        omega = sign(d.angVel) * a / max(r * r + a * a, EPSILON);
    }

    // At least 2 px across, as before the contraction
    let drawR = max(r, 2.0 / camera.zoom);
    let corner = QUAD_POS[vertexIndex];
    let perp = vec2(-n.y, n.x);
    let offset = n * corner.x * max(drawR / gamma, 2.0 / camera.zoom) + perp * corner.y * drawR;

    out.position = camera.viewMatrix * vec4(p.posX + offset.x, p.posY + offset.y, 0.0, 1.0);
    out.offset = offset;
    out.boost = vec4(n, gamma, speed);
    out.body = vec4(r, clocks[instanceIndex].z, omega, drawR);

    // Unpack RGBA from u32 (ABGR packed)
    let packed = color[instanceIndex];
    out.particleColor = vec4(
        f32(packed & 0xFFu) / 255.0,
        f32((packed >> 8u) & 0xFFu) / 255.0,
        f32((packed >> 16u) & 0xFFu) / 255.0,
        f32((packed >> 24u) & 0xFFu) / 255.0,
    );

    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let n = in.boost.xy;
    let gamma = in.boost.z;
    let speed = in.boost.w;
    let r = in.body.x;
    let drawR = in.body.w;

    // Rest-frame offset of this lab point (pure boost along n̂)
    let par = dot(in.offset, n);
    let rest = in.offset + (gamma - 1.0) * par * n;
    let dist = length(rest);
    if (dist > drawR) { discard; }

    var rgb = in.particleColor.rgb;
    let alpha = in.particleColor.a;

    // The spoke, a radius at the angle it held at this point's rest-frame time
    let spokeAngle = in.body.y + in.body.z * (-gamma * speed * par);
    let dir = vec2(cos(spokeAngle), sin(spokeAngle));
    let along = dot(rest, dir);
    let across = abs(rest.x * dir.y - rest.y * dir.x);
    let halfWidth = max(0.09 * r, 0.6 / camera.zoom);
    let edge = fwidth(across);
    let onSpoke = (1.0 - smoothstep(halfWidth - edge, halfWidth + edge, across)) * step(0.0, along);
    let ink = select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, camera.isDarkMode > 0.5);
    rgb = mix(rgb, ink, 0.65 * onSpoke * step(4.0 / camera.zoom, r));

    // Premultiplied alpha output (required by alphaMode: 'premultiplied').
    return vec4(rgb * alpha, alpha);
}
