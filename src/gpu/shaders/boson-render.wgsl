// ─── Boson Rendering ───
// Photons are wave packets: a hairline sinusoid under a Gaussian envelope, drawn along the
// photon's direction, its wavelength on screen falling as its energy rises (λ ∝ E′^−½, so a
// blueshifted photon has more wiggles in the same span: pattern before hue). Ochre for light, madder for
// gravitons, alpha fading over their pool age. Pions mulberry, leptons verdigris, as dots.
// In a non-lab frame each boson is drawn where its straight path crosses the observer's
// slice (frame-slice.wgsl), back no further than its emission; photons take the Doppler
// factor E′/E = γ(1 − u·v̂) in their size. Lensing inside the lag window is ignored.

struct CameraUniforms {
    viewMatrix: mat4x4f,
    invViewMatrix: mat4x4f,
    zoom: f32,
    canvasWidth: f32,
    canvasHeight: f32,
    isDarkMode: f32,
    relativityOn: f32,
    blackHoleOn: f32,
    showClocks: f32,
    frameOn: f32,
};

// FrameState as frame-slice.wgsl writes it
struct FrameState {
    u: vec2<f32>,
    gamma: f32,
    tA: f32,
    xA: vec2<f32>,
    aNow: vec2<f32>,
    phi: f32,
    lag: f32,
    lorentz: f32,
    valid: f32,
    omega: f32,
    images: f32,
    domainW: f32,
    domainH: f32,
    topology: f32,
    kind: f32,
    _pad0: f32,
    _pad1: f32,
};

// Photon and Pion structs from shared-structs.wgsl (prepended)

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
    @location(1) uv: vec2f,                         // pions: [-1,1]²; photons: px along, across
    @location(2) isDark: f32,
    @location(3) @interpolate(flat) wave: vec2f,    // photons: wavelength, half-length (px)
};

const WAVE_AMP: f32 = 2.6;        // px
const WAVE_E_REF: f32 = 0.05;     // the energy drawn at 6 px a wavelength

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> frame: FrameState;

// Photon pool (packed, read-only for rendering)
@group(1) @binding(0) var<storage, read> photonPool: array<Photon>;
@group(1) @binding(1) var<storage, read> phCount: array<u32>;

// Pion pool (packed, read-only for rendering)
@group(2) @binding(0) var<storage, read> pionPool: array<Pion>;
@group(2) @binding(1) var<storage, read> piCount: array<u32>;

// The quad is the dot itself in both themes (no glow halo)
const DARK_QUAD_SCALE: f32 = 1.0;

/**
 * A boson at lab position pos with coordinate velocity v, emitted age ago, seen in the
 * current frame: (x′, y′) in the observer's coordinates, whether it is on the slice, and
 * γ(1 − u·v̂) for photons. In the lab frame it is just (pos, 1, 1).
 */
fn bosonInFrame(pos: vec2f, v: vec2f, age: f32) -> vec4f {
    if (camera.frameOn < 0.5) { return vec4f(pos, 1.0, 1.0); }
    if (frame.valid < 0.5) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    var d = pos - frame.aNow;
    if (frame.topology >= 0.0) {
        d = fullMinImageP(frame.aNow.x, frame.aNow.y, pos.x, pos.y, frame.domainW, frame.domainH, u32(frame.topology));
    }
    let pNow = frame.aNow + d;
    let now = frame.tA + frame.lag;
    let corot = frame.kind > 3.5;
    let lorentz = frame.lorentz > 0.5 && !corot;
    // The slice t − u·x = t_A − u·X_A (t = t_A without Lorentz), met along x = pNow + v(t − now)
    var tHit = frame.tA;
    if (lorentz) {
        let c0 = frame.tA - dot(frame.u, frame.xA);
        tHit = (c0 + dot(frame.u, pNow) - dot(frame.u, v) * now) / max(1.0 - dot(frame.u, v), 1e-4);
    }
    if (tHit > now + 1e-3 || tHit < now - age) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let delta = pNow + v * (tHit - now) - frame.xA;
    var xo = delta;
    var doppler = 1.0;
    let su = length(frame.u);
    if (corot) {
        let c = cos(-frame.phi);
        let s = sin(-frame.phi);
        xo = vec2f(c * delta.x - s * delta.y, s * delta.x + c * delta.y);
    } else if (lorentz && su > 1e-6) {
        let n = frame.u / su;
        xo = delta + (1.0 / frame.gamma - 1.0) * dot(delta, n) * n;
        doppler = frame.gamma * (1.0 - dot(frame.u, normalize(v)));
    } else if (!lorentz) {
        xo = delta;
    }
    return vec4f(xo, 1.0, doppler);
}

/** Light's ink by its Doppler factor D: sienna by D = 0.7, indigo by D = 1.45, `base` at 1. */
fn dopplerInk(base: vec3f, D: f32, dk: bool) -> vec3f {
    if (D < 1.0) { return mix(base, select(INK_SIENNA_L, INK_SIENNA_D, dk), clamp((1.0 - D) / 0.3, 0.0, 1.0)); }
    return mix(base, select(INK_INDIGO_L, INK_INDIGO_D, dk), clamp((D - 1.0) / 0.45, 0.0, 1.0));
}

// Quad vertex positions (triangle strip: 4 verts -> 2 triangles)
fn quadOffset(vertexIdx: u32) -> vec2f {
    // 0: (-1,-1), 1: (1,-1), 2: (-1,1), 3: (1,1)
    let x = select(-1.0, 1.0, (vertexIdx & 1u) != 0u);
    let y = select(-1.0, 1.0, (vertexIdx & 2u) != 0u);
    return vec2f(x, y);
}

@vertex
fn vertexPhoton(
    @builtin(instance_index) instanceIdx: u32,
    @builtin(vertex_index) vertexIdx: u32,
) -> VertexOutput {
    var out: VertexOutput;

    if (instanceIdx >= phCount[0]) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0); // cull
        return out;
    }

    let ph = photonPool[instanceIdx];
    if ((ph.flags & 1u) == 0u) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0);
        return out;
    }

    let rawAlpha = max(0.0, 1.0 - ph.lifetime / PHOTON_CULL_AGE);
    let isDark = camera.isDarkMode;
    let alpha = rawAlpha * select(0.85, 0.95, isDark > 0.5);

    let seen = bosonInFrame(vec2f(ph.posX, ph.posY), vec2f(ph.velX, ph.velY), ph.lifetime);
    if (seen.z < 0.5) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0);
        return out;
    }

    // A wave packet along the photon's direction on screen
    let qOff = quadOffset(vertexIdx);
    let E = max(ph.energy * seen.w, 1e-5);
    // One packet length for all, so more energy reads as more wiggles in the same span
    let lam = clamp(6.0 * sqrt(WAVE_E_REF / E), 3.5, 12.0);
    let halfL = 11.0;
    let clipPos = camera.viewMatrix * vec4f(seen.x, seen.y, 0.0, 1.0);
    let ahead = camera.viewMatrix * vec4f(seen.x + ph.velX, seen.y + ph.velY, 0.0, 1.0);
    var dir = (ahead.xy - clipPos.xy) * vec2f(camera.canvasWidth, camera.canvasHeight) * 0.5;
    dir = select(vec2f(1.0, 0.0), normalize(dir), dot(dir, dir) > 1e-8);
    let perp = vec2f(-dir.y, dir.x);
    let local = vec2f(qOff.x * (halfL + 1.0), qOff.y * (WAVE_AMP + 1.5));
    let px = dir * local.x + perp * local.y;
    out.position = clipPos + vec4f(px * 2.0 / vec2f(camera.canvasWidth, camera.canvasHeight), 0.0, 0.0);

    // Color: ochre for EM, madder for gravitons (theme-paired inks). In a frame, light takes
    // its Doppler factor E′/E = γ(1 − u·v̂): sienna as it reddens, indigo as it blues
    let isGrav = (ph.flags & 2u) != 0u;
    let dk = isDark > 0.5;
    out.color = vec4f(select(dopplerInk(select(INK_OCHRE_L, INK_OCHRE_D, dk), seen.w, dk), select(INK_MADDER_L, INK_MADDER_D, dk), isGrav), alpha);
    out.uv = local;
    out.wave = vec2f(lam, halfL);
    out.isDark = isDark;
    return out;
}

@vertex
fn vertexPion(
    @builtin(instance_index) instanceIdx: u32,
    @builtin(vertex_index) vertexIdx: u32,
) -> VertexOutput {
    var out: VertexOutput;

    if (instanceIdx >= piCount[0]) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0);
        return out;
    }

    let pi = pionPool[instanceIdx];
    if ((pi.flags & 1u) == 0u) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0);
        return out;
    }

    let isDark = camera.isDarkMode;
    let quadScale = 1.0 + isDark * (DARK_QUAD_SCALE - 1.0);

    // Energy-proportional size in world space (matches CPU renderer)
    // Leptons repurpose energy as lifetime tracker, so use fixed size
    let qOff = quadOffset(vertexIdx);
    let worldRadius = select(clamp(0.25 + 2.0 * pi.energy, 0.25, 5.0), clamp(0.25 + 2.0 * pi.mass, 0.25, 5.0), pi.kind == 1u);
    let pixelRadius = max(worldRadius * camera.zoom, 2.0);
    let wp = vec2f(pi.wX, pi.wY);
    let seen = bosonInFrame(vec2f(pi.posX, pi.posY), wp * inverseSqrt(1.0 + dot(wp, wp)), 1e30);
    if (seen.z < 0.5) {
        out.position = vec4f(0.0, 0.0, -2.0, 1.0);
        return out;
    }
    let clipPos = camera.viewMatrix * vec4f(seen.x, seen.y, 0.0, 1.0);

    out.position = clipPos + vec4f(qOff * pixelRadius * quadScale * 2.0 / vec2f(camera.canvasWidth, camera.canvasHeight), 0.0, 0.0);

    // Pion: mulberry, lepton: verdigris (theme-paired inks), alpha 0.7 light / 0.9 dark
    let dk = isDark > 0.5;
    let bosonAlpha = select(0.7, 0.9, dk);
    let isLepton = pi.kind == 1u;
    out.color = vec4f(select(select(INK_MULBERRY_L, INK_MULBERRY_D, dk), select(INK_VERDIGRIS_L, INK_VERDIGRIS_D, dk), isLepton), bosonAlpha);
    out.uv = qOff * quadScale;
    out.isDark = isDark;
    out.wave = vec2f(0.0);
    return out;
}

/** A photon: the hairline y = A·env(s)·sin(2πs/λ), its distance taken along the normal. */
@fragment
fn fragmentPhoton(
    @location(0) color: vec4f,
    @location(1) uv: vec2f,
    @location(2) isDark: f32,
    @location(3) @interpolate(flat) wave: vec2f,
) -> @location(0) vec4f {
    let lam = wave.x;
    let halfL = wave.y;
    let s = uv.x;
    let u = s / halfL;
    let env = exp(-2.2 * u * u);
    let k = 6.2831853 / lam;
    let y = WAVE_AMP * env * sin(k * s);
    let dy = WAVE_AMP * env * (k * cos(k * s) - 4.4 * s / (halfL * halfL) * sin(k * s));
    let d = abs(uv.y - y) / sqrt(1.0 + dy * dy);
    let cover = (1.0 - smoothstep(0.1, 1.2, d)) * (1.0 - smoothstep(0.75, 1.0, abs(u)));
    let a = cover * color.a;
    if (a < 0.003) { discard; }
    return vec4f(color.rgb * a, a);
}

@fragment
fn fragmentBoson(
    @location(0) color: vec4f,
    @location(1) uv: vec2f,
    @location(2) isDark: f32,
) -> @location(0) vec4f {
    let dist = length(uv);

    if (dist > DARK_QUAD_SCALE + 0.05) { discard; }

    // Sharp circle edge (matches CPU ctx.arc fill)
    let circleAlpha = select(0.0, 1.0, dist <= 1.0) * color.a;

    let totalAlpha = clamp(circleAlpha, 0.0, 1.0);

    // Premultiplied alpha output (matches particle.wgsl and canvas alphaMode: 'premultiplied')
    return vec4f(color.rgb * totalAlpha, totalAlpha);
}
