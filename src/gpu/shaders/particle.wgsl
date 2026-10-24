// Instanced particle rendering — vertex + fragment.
// Each body is its rest-frame disk, carrying one spoke at body angle θ, pushed through
// the Lorentz map of its centre's velocity (with Relativity on):
//   - a lab offset Δ maps to the rest-frame offset Δ + (γ − 1)(Δ·n̂)n̂, so the disk
//     contracts by 1/γ along v;
//   - the same lab instant is rest-frame time t′ − t′_c = −γvΔ∥ (relativity of
//     simultaneity), when the spoke stood at θ + ω·(t′ − t′_c). The spoke bends, by
//     2·v·v_rim across the diameter; a spoke perpendicular to v stays straight.
// ω is the body's rest-frame rotation rate, or the horizon's Ω_H for a black hole.
//
// The glyph, drawn in the rest frame so all of it contracts with the disk:
//   - a lighter body inside a darker 1.25 px outline, both in the charge's ink
//     (update-colors.wgsl): sienna positive, prussian negative, graphite neutral;
//   - the sign of the charge as a + or − at the centre, so it survives in grey;
//   - the spoke from the centre, or, where the centre carries a sign, a tick at the rim;
//   - antimatter hollow: the ground inside the outline;
//   - in black-hole mode, the horizon as a void, its tick in the ground's colour.
// Marks show only on bodies at least 5 px across their radius; the edge is antialiased.

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
    frameOn: f32,      // drawing a frame's view buffers (frame-slice.wgsl)
    frameImages: f32,  // view entries per slot
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
    @location(4) @interpolate(flat) kind: vec2<f32>,    // sign of the charge, antimatter (1/0)
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

    // At least 2 px across, as before the contraction; the quad leaves a pixel for the edge
    let drawR = max(r, 2.0 / camera.zoom);
    let quadR = drawR + 1.0 / camera.zoom;
    let corner = QUAD_POS[vertexIndex];
    let perp = vec2(-n.y, n.x);
    let offset = n * corner.x * max(quadR / gamma, 2.0 / camera.zoom) + perp * corner.y * quadR;

    out.position = camera.viewMatrix * vec4(p.posX + offset.x, p.posY + offset.y, 0.0, 1.0);
    out.offset = offset;
    out.boost = vec4(n, gamma, speed);
    out.body = vec4(r, clocks[instanceIndex].z, omega, drawR);
    let q = select(0.0, sign(p.charge), abs(p.charge) > 0.5 * BOSON_CHARGE);
    out.kind = vec2(q, select(0.0, 1.0, (p.flags & FLAG_ANTIMATTER) != 0u));

    // Unpack RGBA from u32 (ABGR packed); colors stay per slot in a frame's view
    let slot = select(instanceIndex, instanceIndex / u32(max(camera.frameImages, 1.0)), camera.frameOn > 0.5);
    let packed = color[slot];
    out.particleColor = vec4(
        f32(packed & 0xFFu) / 255.0,
        f32((packed >> 8u) & 0xFFu) / 255.0,
        f32((packed >> 16u) & 0xFFu) / 255.0,
        f32((packed >> 24u) & 0xFFu) / 255.0,
    );

    return out;
}

/** Coverage of a band |x| < w with an antialiased edge aa wide. */
fn band(x: f32, w: f32, aa: f32) -> f32 {
    return 1.0 - smoothstep(w - aa, w + aa, abs(x));
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
    let aa = max(fwidth(dist), 1e-6);
    let cover = 1.0 - smoothstep(drawR - aa, drawR + aa, dist);
    if (cover <= 0.001) { discard; }

    let px = 1.0 / camera.zoom;                  // one CSS px in world units
    let dk = camera.isDarkMode > 0.5;
    let ground = select(COLOR_CANVAS_LIGHT, COLOR_CANVAS_DARK, dk);
    let ink = in.particleColor.rgb;
    let q = in.kind.x;
    let hole = camera.blackHoleOn > 0.5;
    let rPx = drawR * camera.zoom;

    var rgb: vec3<f32>;
    // Marks a step darker than the outline, so a spoke reads on a graphite body too
    var markInk = mix(ink, select(COLOR_TEXT_LIGHT, COLOR_TEXT_DARK, dk), 0.45);
    if (hole) {
        rgb = select(COLOR_TEXT_LIGHT, COLOR_VOID_DARK, dk);
        // On the dark ground the void needs its edge drawn: a faint hairline at the horizon
        let edge = smoothstep(drawR - 1.0 * px - aa, drawR - 1.0 * px + aa, dist);
        rgb = mix(rgb, mix(COLOR_VOID_DARK, COLOR_TEXT_DARK, 0.3), select(0.0, edge, dk));
        markInk = ground;
    } else {
        // Lighter body, darker outline; antimatter keeps only the outline
        let body = select(mix(ink, ground, select(0.52, 0.38, dk)), ground, in.kind.y > 0.5);
        let outline = smoothstep(drawR - 1.25 * px - aa, drawR - 1.25 * px + aa, dist);
        rgb = mix(body, ink, select(outline, 1.0, rPx < 2.5));
    }

    // The sign at the centre, upright in the rest frame
    var mark = 0.0;
    let hw = 0.55 * px;
    if (!hole && q != 0.0 && rPx >= 5.0) {
        let k = 0.42 * drawR;
        mark = band(rest.y, hw, aa) * band(rest.x, k, aa);
        if (q > 0.0) { mark = max(mark, band(rest.x, hw, aa) * band(rest.y, k, aa)); }
    }

    // The spoke, a radius at the angle it held at this point's rest-frame time: from the
    // centre on a neutral body, a tick at the rim where the centre carries a mark
    if (rPx >= 4.0) {
        let spokeAngle = in.body.y + in.body.z * (-gamma * speed * par);
        let dir = vec2(cos(spokeAngle), sin(spokeAngle));
        let along = dot(rest, dir);
        let across = rest.x * dir.y - rest.y * dir.x;
        let startR = select(0.0, 0.6 * drawR, hole || q != 0.0);
        let spoke = band(across, clamp(0.02 * r, hw, 1.5 * px), aa) * smoothstep(startR - aa, startR + aa, along);
        mark = max(mark, spoke * select(1.0, 0.6, hole));
    }
    rgb = mix(rgb, markInk, mark);

    let alpha = in.particleColor.a * cover;
    // Premultiplied alpha output (required by alphaMode: 'premultiplied').
    return vec4(rgb * alpha, alpha);
}
