/**
 * GPU pass scheduling predicates.
 *
 * This is intentionally small and data-oriented: GPUPhysics owns the actual
 * dispatches, while this module decides which feature passes are meaningful for
 * the current physics contract. Keep conditions aligned with shader guards so
 * the JS side can skip whole compute passes instead of paying dispatch overhead
 * for shaders that immediately return.
 */

export function createGPUDispatchPlan() {
    return {
        spinOrbit: false,
        applyTorques: false,
        radiation: false,
        larmorRadiation: false,
        hawkingRadiation: false,
        pionEmission: false,
        schwingerDischarge: false,
        bosonUpdate: false,
        photonUpdate: false,
        pionUpdate: false,
        bosonInteraction: false,
        kugelblitzReadback: false,
    };
}

export function updateGPUDispatchPlan(gpu, plan = createGPUDispatchPlan()) {
    const canHavePions = gpu._yukawaEnabled ||
        (gpu._blackHoleEnabled && gpu._coulombEnabled);
    const canHavePhotons = gpu._radiationEnabled;

    plan.spinOrbit = gpu._spinOrbitEnabled &&
        (gpu._magneticEnabled || gpu._gravitomagEnabled);
    plan.applyTorques = (gpu._gravitomagEnabled && gpu._relativityEnabled) ||
        gpu._gravityEnabled;

    plan.radiation = gpu._radiationEnabled;
    plan.larmorRadiation = gpu._radiationEnabled && gpu._coulombEnabled;
    plan.hawkingRadiation = gpu._radiationEnabled && gpu._blackHoleEnabled;
    plan.pionEmission = gpu._radiationEnabled && gpu._yukawaEnabled;
    plan.schwingerDischarge = gpu._radiationEnabled &&
        gpu._blackHoleEnabled && gpu._coulombEnabled;

    plan.bosonUpdate = canHavePhotons || canHavePions;
    plan.photonUpdate = canHavePhotons;
    plan.pionUpdate = canHavePions;
    // Existing bosons can remain after their source toggles are turned off, so
    // interaction follows the explicit interaction toggle until active pool
    // counters are available to the scheduler.
    plan.bosonInteraction = gpu._bosonInterEnabled;
    plan.kugelblitzReadback = gpu._bosonInterEnabled && gpu._gravityEnabled && !!gpu._kbBuffers;

    return plan;
}
