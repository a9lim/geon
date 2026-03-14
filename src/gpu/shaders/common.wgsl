// Common structs and constants shared across all compute/render shaders.
// This file is prepended to other shaders before compilation.

struct SimUniforms {
    dt: f32,
    simTime: f32,
    domainW: f32,
    domainH: f32,
    speedScale: f32,
    softening: f32,
    softeningSq: f32,
    toggles0: u32,
    toggles1: u32,
    yukawaCoupling: f32,
    yukawaMu: f32,
    higgsMass: f32,
    axionMass: f32,
    boundaryMode: u32,
    topologyMode: u32,
    collisionMode: u32,
    maxParticles: u32,
    aliveCount: u32,
    // Phase 2 additions
    extGravity: f32,
    extGravityAngle: f32,
    extElectric: f32,
    extElectricAngle: f32,
    extBz: f32,
    bounceFriction: f32,
    extGx: f32,
    extGy: f32,
    extEx: f32,
    extEy: f32,
    axionCoupling: f32,
    higgsCoupling: f32,
    particleCount: u32,
    bhTheta: f32,
    _pad3: u32,
    _pad4: u32,
};

// Toggle bit constants (toggles0)
const GRAVITY_BIT: u32       = 1u;
const COULOMB_BIT: u32       = 2u;
const MAGNETIC_BIT: u32      = 4u;
const GRAVITOMAG_BIT: u32    = 8u;
const ONE_PN_BIT: u32        = 16u;
const RELATIVITY_BIT: u32    = 32u;
const SPIN_ORBIT_BIT: u32    = 64u;
const RADIATION_BIT: u32     = 128u;
const BLACK_HOLE_BIT: u32    = 256u;
const DISINTEGRATION_BIT: u32 = 512u;
const EXPANSION_BIT: u32     = 1024u;
const YUKAWA_BIT: u32        = 2048u;
const HIGGS_BIT: u32         = 4096u;
const AXION_BIT: u32         = 8192u;
const BARNES_HUT_BIT: u32    = 16384u;
const BOSON_GRAV_BIT: u32    = 32768u;

// Toggle bit constants (toggles1)
const FIELD_GRAV_BIT: u32    = 1u;
const HERTZ_BOUNCE_BIT: u32  = 2u;

// Particle flag bits
const FLAG_ALIVE: u32    = 1u;
const FLAG_RETIRED: u32  = 2u;
const FLAG_ANTIMATTER: u32 = 4u;
const FLAG_BH: u32       = 8u;
const FLAG_GHOST: u32    = 16u;

// Boundary modes
const BOUND_DESPAWN: u32 = 0u;
const BOUND_BOUNCE: u32  = 1u;
const BOUND_LOOP: u32    = 2u;

// Topology modes
const TOPO_TORUS: u32 = 0u;
const TOPO_KLEIN: u32 = 1u;
const TOPO_RP2: u32   = 2u;

// Physics constants (from config.js)
const SOFTENING: f32 = 8.0;
const SOFTENING_SQ: f32 = 64.0;
const BH_SOFTENING: f32 = 4.0;
const BH_SOFTENING_SQ: f32 = 16.0;
const INERTIA_K: f32 = 0.4;
const MAG_MOMENT_K: f32 = 0.2;
const TIDAL_STRENGTH: f32 = 0.3;
const YUKAWA_COUPLING_DEFAULT: f32 = 14.0;
const EPSILON: f32 = 1e-9;
const EPSILON_SQ: f32 = 1e-18;
const PI: f32 = 3.14159265358979;
const TWO_PI: f32 = 6.28318530717959;

// Toggle query helpers
fn hasToggle0(bit: u32) -> bool {
    return (uniforms.toggles0 & bit) != 0u;
}

fn hasToggle1(bit: u32) -> bool {
    return (uniforms.toggles1 & bit) != 0u;
}

// Minimum image displacement for torus topology (most common case).
// Returns displacement vector from observer at (ox, oy) to source at (sx, sy).
fn torusMinImage(ox: f32, oy: f32, sx: f32, sy: f32) -> vec2<f32> {
    let w = uniforms.domainW;
    let h = uniforms.domainH;
    let halfW = w * 0.5;
    let halfH = h * 0.5;
    var rx = sx - ox;
    if (rx > halfW) { rx -= w; } else if (rx < -halfW) { rx += w; }
    var ry = sy - oy;
    if (ry > halfH) { ry -= h; } else if (ry < -halfH) { ry += h; }
    return vec2(rx, ry);
}
