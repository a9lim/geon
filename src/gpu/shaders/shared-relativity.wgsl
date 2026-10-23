// ── Shared special-relativity helpers ──
// Prepended to every shader through getSharedPrefix(). Functions only.

// Lorentz factor from proper velocity w = γv.
fn gammaFromW(w: vec2<f32>) -> f32 {
    return sqrt(1.0 + dot(w, w));
}

// Rest-frame interval of a body's internal clock over lab interval dt.
// Massive particles carry w = v when relativity is off, so they only dilate
// with it on; bosons always carry true proper velocity (relOn = true).
fn restFrameDt(dt: f32, w: vec2<f32>, relOn: bool) -> f32 {
    if (!relOn) { return dt; }
    return dt / gammaFromW(w);
}

// Boost a four-momentum (E, p) from the rest frame of a body with proper
// velocity w into the lab. Returns (E, px, py).
fn boostToLab(E: f32, p: vec2<f32>, w: vec2<f32>) -> vec3<f32> {
    let wSq = dot(w, w);
    if (wSq < 1e-12) { return vec3<f32>(E, p); }
    let gamma = sqrt(1.0 + wSq);
    let n = w * inverseSqrt(wSq);
    let beta = sqrt(wSq) / gamma;
    let pPar = dot(p, n);
    let pParLab = gamma * (pPar + beta * E);
    let eLab = gamma * (E + beta * pPar);
    return vec3<f32>(eLab, p + (pParLab - pPar) * n);
}
