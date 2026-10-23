// ─── Gravitational lensing of the backdrop ───
// The background grid is a sheet behind the slab, seen along z through the slab's masses as
// a thin lens. Each image-plane point θ (lab coordinates) sees the backdrop at
//   β = θ − α(θ),  α(θ) = Σᵢ 4Mᵢ·D·(θ − θᵢ)/|θ − θᵢ|²,
// the gradient of the 2D log potential, with D = D_LS/(D_L·D_S) the backdrop-distance knob
// (a lone mass's Einstein radius is θ_E = √(4MD)). One thread per cell of a LENS_RES² map
// over the visible rectangle writes (αx, αy, shadow, 0); grid-render.wgsl samples it.
//
// Black holes: the weak thin-lens formula has no shadow, so cells within the photon-capture
// radius 3√3·M of a hole are flagged, an imposed and labelled disk (3.0's ray tracing would
// find it). Periodic domains use each lens's nearest image.
//
// The microlensing probe is a backdrop star of radius r_s at β_s: a cell whose ray lands
// inside it adds to `hits`, so the magnification is hits·cellArea/(π r_s²) (inverse ray
// shooting: Σ over images of |det A|⁻¹, for any number of lenses).

struct LensParams {
    viewLeft: f32,
    viewTop: f32,
    cellW: f32,
    cellH: f32,
    res: u32,
    aliveCount: u32,
    deflect: f32,       // 4·D
    softSq: f32,        // a small core, so a pixel on a body stays finite
    starX: f32,
    starY: f32,
    starRSq: f32,
    probeOn: u32,
    periodic: u32,
    topology: u32,
    domainW: f32,
    domainH: f32,
    blackHole: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> lp: LensParams;
@group(0) @binding(1) var<storage, read> particles: array<ParticleState>;
@group(0) @binding(2) var<storage, read_write> lensMap: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> hits: atomic<u32>;

@compute @workgroup_size(8, 8)
fn lensDeflection(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= lp.res || gid.y >= lp.res) { return; }
    let theta = vec2(lp.viewLeft + (f32(gid.x) + 0.5) * lp.cellW, lp.viewTop + (f32(gid.y) + 0.5) * lp.cellH);
    var alpha = vec2(0.0);
    var shadow = 0.0;
    for (var i = 0u; i < lp.aliveCount; i++) {
        let p = particles[i];
        if ((p.flags & FLAG_ALIVE) == 0u || p.mass <= 0.0) { continue; }
        var d = theta - vec2(p.posX, p.posY);
        if (lp.periodic != 0u) {
            d = -fullMinImageP(theta.x, theta.y, p.posX, p.posY, lp.domainW, lp.domainH, lp.topology);
        }
        let rSq = dot(d, d);
        alpha += (lp.deflect * p.mass / (rSq + lp.softSq)) * d;
        if (lp.blackHole != 0u && rSq < 27.0 * p.mass * p.mass) { shadow = 1.0; }
    }
    lensMap[gid.y * lp.res + gid.x] = vec4(alpha, shadow, 0.0);

    if (lp.probeOn != 0u && shadow == 0.0) {
        let beta = theta - alpha - vec2(lp.starX, lp.starY);
        if (dot(beta, beta) < lp.starRSq) { atomicAdd(&hits, 1u); }
    }
}
