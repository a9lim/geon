// ─── Gravitational lensing of the backdrop ───
// The background grid is a sheet behind the slab, seen along z through the slab's masses as
// a thin lens. Positions are physical lab coordinates in the lens plane (x = D_L·θ), so a
// point x sees the backdrop at
//   y = x − α(x),  α(x) = Σᵢ 4Mᵢ·𝒟·(x − xᵢ)/(|x − xᵢ|² + s²ᵢ),
// the gradient of the 2D log potential, with 𝒟 = D_L·D_LS/D_S the projected-distance knob
// (a lone mass's Einstein radius is R_E = √(4M𝒟)). The core s²ᵢ = 10⁻⁴·4Mᵢ𝒟 keeps a ray
// through a body finite; it makes each lens a tiny extended mass (ring radius² R_E² − s²). One thread per cell of a LENS_RES² map
// over the visible rectangle writes (αx, αy, shadow, 0); grid-render.wgsl samples it.
//
// Black holes: the weak thin-lens formula has no shadow, so cells within the photon-capture
// radius 3√3·M of a hole are flagged, an imposed and labelled disk (3.0's ray tracing would
// find it); 3√3·M is the Schwarzschild capture impact parameter, without Kerr–Newman spin or
// charge. On a periodic domain each lens sits at its image nearest one reference point (the
// view's centre, for both the map and the probe), not the nearest image per pixel: the 1/x
// deflection decays too slowly for a minimum-image seam, which would tear the backdrop.
// One image per lens is a finite-patch approximation, not periodic lensing.
//
// The microlensing probe is a backdrop star of radius r_s at β_s: a cell whose ray lands
// inside it adds to `hits`, so the magnification is hits·cellArea/(π r_s²) (inverse ray
// shooting: Σ over images of |det A|⁻¹, for any number of lenses). The probe runs as a
// second pass on its own window around the star (countOnly: no map write), so its
// resolution doesn't depend on the zoom.

struct LensParams {
    viewLeft: f32,
    viewTop: f32,
    cellW: f32,
    cellH: f32,
    res: u32,
    aliveCount: u32,
    deflect: f32,       // 4·𝒟
    coreFrac: f32,      // s² = coreFrac·4M𝒟 per lens
    starX: f32,
    starY: f32,
    starRSq: f32,
    probeOn: u32,
    periodic: u32,
    topology: u32,
    domainW: f32,
    domainH: f32,
    blackHole: u32,
    countOnly: u32,     // the probe's pass: count, don't write the map
    refX: f32,          // periodic: each lens's image nearest this point
    refY: f32,
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
        var lens = vec2(p.posX, p.posY);
        if (lp.periodic != 0u) {
            lens = vec2(lp.refX, lp.refY) + fullMinImageP(lp.refX, lp.refY, p.posX, p.posY, lp.domainW, lp.domainH, lp.topology);
        }
        let d = theta - lens;
        let rSq = dot(d, d);
        let k = lp.deflect * p.mass;
        alpha += (k / (rSq + lp.coreFrac * k)) * d;
        if (lp.blackHole != 0u && rSq < 27.0 * p.mass * p.mass) { shadow = 1.0; }
    }
    if (lp.countOnly == 0u) { lensMap[gid.y * lp.res + gid.x] = vec4(alpha, shadow, 0.0); }

    if (lp.probeOn != 0u && shadow == 0.0) {
        let beta = theta - alpha - vec2(lp.starX, lp.starY);
        if (dot(beta, beta) < lp.starRSq) { atomicAdd(&hits, 1u); }
    }
}
