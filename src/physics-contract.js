/**
 * Shared physics contract for CPU/GPU parity.
 *
 * Keep data that defines cross-backend behavior here instead of duplicating it
 * in the CPU save path, GPU save path, and UI glue. This file is deliberately
 * declarative so future generated CPU/WGSL parity targets can use the same
 * source of truth.
 */

export const TOGGLE_KEYS = Object.freeze([
    'gravityEnabled',
    'bosonInterEnabled',
    'coulombEnabled',
    'magneticEnabled',
    'gravitomagEnabled',
    'relativityEnabled',
    'barnesHutEnabled',
    'radiationEnabled',
    'blackHoleEnabled',
    'disintegrationEnabled',
    'spinOrbitEnabled',
    'onePNEnabled',
    'yukawaEnabled',
    'axionEnabled',
    'expansionEnabled',
    'higgsEnabled',
]);

export const PARAMETER_KEYS = Object.freeze([
    'yukawaMu',
    'axionMass',
    'hubbleParam',
    'higgsMass',
    'extGravity',
    'extGravityAngle',
    'extElectric',
    'extElectricAngle',
    'extBz',
]);

export const GPU_PARAMETER_SLOTS = Object.freeze({
    yukawaMu: '_yukawaMu',
    axionMass: '_axionMass',
    hubbleParam: '_hubbleParam',
    higgsMass: '_higgsMass',
    extGravity: '_extGravity',
    extGravityAngle: '_extGravityAngle',
    extElectric: '_extElectric',
    extElectricAngle: '_extElectricAngle',
    extBz: '_extBz',
});

export const CONSERVATION_CONTRACTS = Object.freeze({
    rocheTransfer: Object.freeze({
        conserved: Object.freeze(['mass', 'charge']),
        cpu: 'integrator.checkDisintegration -> main CPU transfer handler',
        gpu: 'disintegration.wgsl -> GPUBackend._processDisintegrationEvents',
    }),
    saveState: Object.freeze({
        conserved: Object.freeze(['toggles', 'parameters', 'modes', 'camera']),
        cpu: 'save-load._cpuSaveState',
        gpu: 'GPUPhysics.serialize',
    }),
});
