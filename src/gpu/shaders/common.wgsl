// Common utilities shared across Phase 2 compute shaders.
// Prepended (after shared-structs.wgsl + shared-topology.wgsl) to other shaders before compilation.
// Struct definitions and fullMinImageP are in shared-structs.wgsl / shared-topology.wgsl.

// Toggle query helpers
fn hasToggle0(bit: u32) -> bool {
    return (uniforms.toggles0 & bit) != 0u;
}

fn hasToggle1(bit: u32) -> bool {
    return (uniforms.toggles1 & bit) != 0u;
}

// Convenience wrappers that read domain/topology from uniforms
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

fn fullMinImage(ox: f32, oy: f32, sx: f32, sy: f32) -> vec2<f32> {
    return fullMinImageP(ox, oy, sx, sy, uniforms.domainW, uniforms.domainH, uniforms.topologyMode);
}
