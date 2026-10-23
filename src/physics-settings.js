// ─── Physics Settings ───
// The toggle and parameter store the UI writes and GPUPhysics.setToggles() reads.
// Defaults match the checked state of the toggles in index.html.
import { PI, DEFAULT_PION_MASS, DEFAULT_AXION_MASS, DEFAULT_HIGGS_MASS, DEFAULT_HUBBLE } from './config.js';

export function createPhysicsSettings() {
    return {
        gravityEnabled: true,
        bosonInterEnabled: false,
        coulombEnabled: true,
        magneticEnabled: true,
        gravitomagEnabled: true,
        relativityEnabled: true,
        barnesHutEnabled: false,
        radiationEnabled: true,
        blackHoleEnabled: false,
        disintegrationEnabled: false,
        spinOrbitEnabled: true,
        onePNEnabled: true,
        yukawaEnabled: false,
        axionEnabled: false,
        expansionEnabled: false,
        higgsEnabled: false,

        bounceFriction: 0.4,
        yukawaMu: DEFAULT_PION_MASS,
        axionMass: DEFAULT_AXION_MASS,
        hubbleParam: DEFAULT_HUBBLE,
        cosmoSchedule: 0,          // cosmology.js SCHEDULE_KEYS: the Friedmann closure
        fieldDamping: 1,           // 0 turns off the fields' ether damping (Higgs 2m_H, axion g·m_a)
        higgsMass: DEFAULT_HIGGS_MASS,

        // Uniform background fields, independent of the force toggles
        extGravity: 0,
        extGravityAngle: PI * 0.5,   // radians; default points down
        extElectric: 0,
        extElectricAngle: 0,
        extBz: 0,
    };
}
