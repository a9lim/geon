// ── Shared read-only node accessors for BH tree walk ──
// Non-atomic reads — use only AFTER tree is fully built (forces, collision).
// tree-build.wgsl has its own atomic versions for concurrent insertion.
// Requires: nodes declared as var<storage, read_write> nodes: array<u32>

const NODE_STRIDE: u32 = 20u;
fn nodeOffset(idx: u32) -> u32 { return idx * NODE_STRIDE; }

fn getMinX(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx)]); }
fn getMinY(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 1u]); }
fn getMaxX(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 2u]); }
fn getMaxY(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 3u]); }
fn getComX(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 4u]); }
fn getComY(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 5u]); }
fn getTotalMass(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 6u]); }
fn getTotalCharge(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 7u]); }
fn getTotalMagMoment(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 8u]); }
fn getTotalAngMomentum(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 9u]); }
fn getTotalMomX(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 10u]); }
fn getTotalMomY(idx: u32) -> f32 { return bitcast<f32>(nodes[nodeOffset(idx) + 11u]); }
fn getNW(idx: u32) -> i32 { return bitcast<i32>(nodes[nodeOffset(idx) + 12u]); }
fn getNE(idx: u32) -> i32 { return bitcast<i32>(nodes[nodeOffset(idx) + 13u]); }
fn getSW(idx: u32) -> i32 { return bitcast<i32>(nodes[nodeOffset(idx) + 14u]); }
fn getSE(idx: u32) -> i32 { return bitcast<i32>(nodes[nodeOffset(idx) + 15u]); }
fn getParticleIndex(idx: u32) -> i32 { return bitcast<i32>(nodes[nodeOffset(idx) + 16u]); }
fn getParticleCount(idx: u32) -> u32 { return nodes[nodeOffset(idx) + 17u]; }
