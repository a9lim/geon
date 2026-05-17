// Build indirect dispatch records from active boson counters.
// Four records, each 3 × u32: photons, pions/leptons, total bosons, boson-tree nodes.

@group(0) @binding(0) var<storage, read> phCount: array<u32>;
@group(0) @binding(1) var<storage, read> piCount: array<u32>;
@group(0) @binding(2) var<storage, read_write> dispatchArgs: array<u32>;

fn wg64(n: u32) -> u32 {
    return max(1u, (n + 63u) / 64u);
}

@compute @workgroup_size(1)
fn buildBosonDispatchArgs() {
    let phN = min(phCount[0], MAX_PHOTONS);
    let piN = min(piCount[0], PION_POOL_CAP);
    let total = min(phN + piN, MAX_PHOTONS + PION_POOL_CAP);

    dispatchArgs[0] = wg64(phN);
    dispatchArgs[1] = 1u;
    dispatchArgs[2] = 1u;

    dispatchArgs[3] = wg64(piN);
    dispatchArgs[4] = 1u;
    dispatchArgs[5] = 1u;

    dispatchArgs[6] = wg64(total);
    dispatchArgs[7] = 1u;
    dispatchArgs[8] = 1u;

    dispatchArgs[9] = wg64(total * 6u);
    dispatchArgs[10] = 1u;
    dispatchArgs[11] = 1u;
}
