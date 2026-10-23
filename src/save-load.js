import { DEFAULT_SPEED_SCALE, SPEED_OPTIONS, DEFAULT_SPEED_INDEX, colFromString, boundFromString, topoFromString } from './config.js';
import { PARAMETER_KEYS } from './physics-contract.js';

// Maps physics flag names to UI toggle element IDs (same order as presets.js TOGGLE_ORDER)
const TOGGLE_SYNC = [
    ['gravityEnabled', 'gravity-toggle'],
    ['bosonInterEnabled', 'bosoninter-toggle'],
    ['coulombEnabled', 'coulomb-toggle'],
    ['relativityEnabled', 'relativity-toggle'],
    ['gravitomagEnabled', 'gravitomag-toggle'],
    ['magneticEnabled', 'magnetic-toggle'],
    ['onePNEnabled', 'onepn-toggle'],
    ['blackHoleEnabled', 'blackhole-toggle'],
    ['spinOrbitEnabled', 'spinorbit-toggle'],
    ['radiationEnabled', 'radiation-toggle'],
    ['disintegrationEnabled', 'disintegration-toggle'],
    ['barnesHutEnabled', 'barneshut-toggle'],
    ['yukawaEnabled', 'yukawa-toggle'],
    ['axionEnabled', 'axion-toggle'],
    ['expansionEnabled', 'expansion-toggle'],
    ['higgsEnabled', 'higgs-toggle'],
];

const MODE_SYNC = [
    ['collisionMode', 'collision-toggles', 'collision'],
    ['boundaryMode', 'boundary-toggles', 'boundary'],
    ['topology', 'topology-toggles', 'topology'],
];

function syncUI(sim) {
    const ph = sim.settings;
    // Sync toggle checkboxes (parent-first order triggers dependency cascades)
    for (const [prop, elId] of TOGGLE_SYNC) {
        const el = document.getElementById(elId);
        if (!el) continue;
        const want = ph[prop];
        if (el.checked !== want) {
            el.checked = want;
            el.setAttribute('aria-checked', String(want));
            el.dispatchEvent(new Event('change'));
        }
    }
    // Sync mode button groups
    for (const [prop, groupId, attr] of MODE_SYNC) {
        const group = document.getElementById(groupId);
        if (!group) continue;
        const target = group.querySelector(`[data-${attr}="${sim[prop]}"]`);
        if (target) target.click();
    }
    // Sync speed button
    const speedBtn = document.getElementById('speedBtn');
    if (speedBtn && typeof _toolbar !== 'undefined') _toolbar.updateSpeedBtn(speedBtn, sim.speedScale / 16);
    const frictionEl = document.getElementById('frictionInput');
    if (frictionEl) { frictionEl.value = ph.bounceFriction; frictionEl.dispatchEvent(new Event('input')); }
    const hubbleEl = document.getElementById('hubbleInput');
    if (hubbleEl) { hubbleEl.value = ph.hubbleParam; hubbleEl.dispatchEvent(new Event('input')); }
    const yukawaMuEl = document.getElementById('yukawaMuInput');
    if (yukawaMuEl) { yukawaMuEl.value = ph.yukawaMu; yukawaMuEl.dispatchEvent(new Event('input')); }
    const axionMassEl = document.getElementById('axionMassInput');
    if (axionMassEl) { axionMassEl.value = ph.axionMass; axionMassEl.dispatchEvent(new Event('input')); }
    const higgsMassEl = document.getElementById('higgsMassInput');
    if (higgsMassEl) { higgsMassEl.value = ph.higgsMass; higgsMassEl.dispatchEvent(new Event('input')); }
    const extGravEl = document.getElementById('extGravityInput');
    if (extGravEl) { extGravEl.value = ph.extGravity; extGravEl.dispatchEvent(new Event('input')); }
    const extGravAngleEl = document.getElementById('extGravityAngleInput');
    if (extGravAngleEl) { extGravAngleEl.value = (ph.extGravityAngle || 0) * 180 / Math.PI; extGravAngleEl.dispatchEvent(new Event('input')); }
    const extElecEl = document.getElementById('extElectricInput');
    if (extElecEl) { extElecEl.value = ph.extElectric; extElecEl.dispatchEvent(new Event('input')); }
    const extElecAngleEl = document.getElementById('extElectricAngleInput');
    if (extElecAngleEl) { extElecAngleEl.value = (ph.extElectricAngle || 0) * 180 / Math.PI; extElecAngleEl.dispatchEvent(new Event('input')); }
    const extBzEl = document.getElementById('extBzInput');
    if (extBzEl) { extBzEl.value = ph.extBz; extBzEl.dispatchEvent(new Event('input')); }
}

/**
 * Save simulation state (async: reads particle buffers back from the GPU).
 * @param {Object} sim
 * @returns {Promise<Object|null>} State object, or null before WebGPU is up
 */
export async function saveState(sim) {
    if (!sim._gpuPhysics) return null;
    return await sim._gpuPhysics.serialize(sim);
}

export function loadState(state, sim) {
    if (!state || state.version !== 1 || !sim._gpuPhysics) return false;

    // deserialize() calls reset() internally, then uploads particles to GPU
    const ok = sim._gpuPhysics.deserialize(state, sim);
    if (!ok) return false;
    sim.select(-1);
    sim.totalRadiated = 0;
    sim.totalRadiatedPx = 0;
    sim.totalRadiatedPy = 0;

    // Restore toggles and parameters to the settings store (UI sync reads it)
    const ph = sim.settings;
    if (state.toggles) {
        for (const [key, val] of Object.entries(state.toggles)) {
            if (key in ph) ph[key] = val;
        }
    }
    for (const key of PARAMETER_KEYS) {
        if (state[key] !== undefined && state[key] !== null) ph[key] = state[key];
    }
    if (state.settings && state.settings.friction != null) ph.bounceFriction = state.settings.friction;

    _restoreSettings(state, sim);
    sim.gpu.applySettings(sim);
    sim.stats.resetBaseline();
    syncUI(sim);
    return true;
}

function _restoreSettings(state, sim) {
    if (state.settings) {
        // Legacy compat: 'repel' was renamed to 'bounce' in an earlier version
        const col = state.settings.collision === 'repel' ? 'bounce' : (state.settings.collision || 'pass');
        sim.collisionMode = colFromString(col);
        sim.boundaryMode = boundFromString(state.settings.boundary);
        sim.topology = topoFromString(state.settings.topology);
        const loadedSpeed = state.settings.speed ?? DEFAULT_SPEED_SCALE;
        let bestIdx = DEFAULT_SPEED_INDEX;
        let bestDist = Infinity;
        for (let i = 0; i < SPEED_OPTIONS.length; i++) {
            const d = Math.abs(SPEED_OPTIONS[i] - loadedSpeed);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        sim.speedIndex = bestIdx;
        sim.speedScale = SPEED_OPTIONS[bestIdx];
    }
    if (state.camera) {
        sim.camera.x = state.camera.x;
        sim.camera.y = state.camera.y;
        sim.camera.zoom = state.camera.zoom;
    }
}

export async function downloadState(sim) {
    const state = await saveState(sim);
    if (!state) return;
    const json = JSON.stringify(state);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nohair-state.json';
    a.click();
    // A12: Defer revoke to next frame — immediate revoke may fire before download starts
    requestAnimationFrame(() => URL.revokeObjectURL(a.href));
}

export function uploadState(sim, onComplete) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const state = JSON.parse(reader.result);
                if (loadState(state, sim)) {
                    showToast((window._i18n && window._i18n.t('toast.stateLoaded')) || 'State loaded');
                    if (onComplete) onComplete();
                } else {
                    showToast((window._i18n && window._i18n.t('toast.invalidState')) || 'Invalid state file');
                }
            } catch { showToast((window._i18n && window._i18n.t('toast.parseFailed')) || 'Failed to parse state file'); }
        };
        reader.readAsText(file);
    });
    input.click();
}

export async function quickSave(sim) {
    const state = await saveState(sim);
    if (!state) return;
    localStorage.setItem('nohair-quicksave', JSON.stringify(state));
    showToast((window._i18n && window._i18n.t('toast.quickSaved')) || 'Quick saved');
}

export function quickLoad(sim, onComplete) {
    const json = localStorage.getItem('nohair-quicksave');
    if (!json) { showToast((window._i18n && window._i18n.t('toast.noQuickSave')) || 'No quick save found'); return; }
    try {
        const state = JSON.parse(json);
        if (loadState(state, sim)) {
            showToast((window._i18n && window._i18n.t('toast.quickLoaded')) || 'Quick loaded');
            if (onComplete) onComplete();
        }
    } catch { showToast((window._i18n && window._i18n.t('toast.quickLoadFailed')) || 'Failed to load quick save'); }
}
