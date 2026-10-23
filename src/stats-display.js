import { DISPLAY_SCALE, EPSILON } from './config.js';
const fmt = (v) => { v *= DISPLAY_SCALE; return Math.abs(v) > 999 ? v.toExponential(2) : v.toFixed(2); };
const fmtRaw = (v) => Math.abs(v) > 999 ? v.toExponential(2) : v.toFixed(2);
const fmtDrift = (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
// R15: Set textContent only when value changed (avoids DOM text node rebuild)
function _set(el, val) { if (el.textContent !== val) el.textContent = val; }

export default class StatsDisplay {
    constructor(dom, selDom) {
        this.dom = dom;
        this.selDom = selDom;
        this.initialEnergy = null;
        this.initialMomentum = null;
        this.initialAngMom = null;
        // R14: Pre-allocate force descriptor array (avoids 11 object allocations per updateSelected)
        this._forceDescs = selDom ? [
            { row: selDom.fbGravity, val: selDom.fbGravityVal, vec: null },
            { row: selDom.fbCoulomb, val: selDom.fbCoulombVal, vec: null },
            { row: selDom.fbMagnetic, val: selDom.fbMagneticVal, vec: null },
            { row: selDom.fbGravitomag, val: selDom.fbGravitomagVal, vec: null },
            { row: selDom.fb1pn, val: selDom.fb1pnVal, vec: null },
            { row: selDom.fbSpincurv, val: selDom.fbSpincurvVal, vec: null },
            { row: selDom.fbRadiation, val: selDom.fbRadiationVal, vec: null },
            { row: selDom.fbYukawa, val: selDom.fbYukawaVal, vec: null },
            { row: selDom.fbExternal, val: selDom.fbExternalVal, vec: null },
            { row: selDom.fbHiggs, val: selDom.fbHiggsVal, vec: null },
            { row: selDom.fbAxion, val: selDom.fbAxionVal, vec: null },
        ] : [];
    }

    resetBaseline() {
        this.initialEnergy = null;
        this.initialMomentum = null;
        this.initialAngMom = null;
    }

    /**
     * Update energy/momentum display from GPU readback data.
     * All quantities computed on GPU: KE, PE (O(N²)), Darwin field energy/momentum,
     * scalar field energy/momentum, particle-field interaction energy, the boson pools.
     * Radiated is the pools plus the escaped radiation the pool culls removed; under
     * expansion the ledger adds the energy the expansion took (redshift and the stretched
     * potentials), and the momentum drift compares a·P, which expansion conserves.
     */
    updateEnergyGPU(gpuStats, sim) {
        const e = gpuStats;
        const L = e.ledger;
        const angMom = e.orbitalAngMom + e.spinAngMom;
        const pe = e.pe + e.pfiEnergy;
        // A scalar field's energy is the slab's, a·ℓ thick under expansion (cosmology.js)
        const allFieldE = e.fieldEnergy + (e.higgsFieldEnergy + e.axionFieldEnergy) * e.scaleA;
        const radiated = e.photonE + e.pionE + e.pendingRadiation + L.escapedE;
        const total = e.totalMass + e.linearKE + e.spinKE + pe + allFieldE + radiated;
        const ledgerTotal = total + L.expansionWork;

        const totalFieldPx = e.fieldPx + e.scalarFieldMomX;
        const totalFieldPy = e.fieldPy + e.scalarFieldMomY;
        const radPx = e.photonPx + e.pionPx + L.escapedPx;
        const radPy = e.photonPy + e.pionPy + L.escapedPy;
        const totalPx = e.px + totalFieldPx + radPx;
        const totalPy = e.py + totalFieldPy + radPy;
        const pMag = Math.sqrt(totalPx * totalPx + totalPy * totalPy);
        const pComoving = pMag * e.scaleA;

        // The baseline comes from a readback of the current state, not one in flight before it
        if (this.initialEnergy === null && e.aliveCount > 0 && e.current) {
            this.initialEnergy = ledgerTotal;
            this.initialMomentum = pComoving;
            this.initialAngMom = angMom;
        }

        // Relative to the run's energy scale: under expansion the energy that has flowed through
        // the ledger can dwarf the starting total (a frozen field's slab energy grows as a³)
        const eScale = Math.max(Math.abs(this.initialEnergy ?? 0), Math.abs(total), Math.abs(L.expansionWork), 1e-6);
        const eDrift = this.initialEnergy !== null ? ((ledgerTotal - this.initialEnergy) / eScale * 100) : 0;
        const pDrift = this.initialMomentum !== null
            ? ((pComoving - this.initialMomentum) / Math.max(Math.abs(this.initialMomentum), 1e-6) * 100) : 0;
        const aDrift = this.initialAngMom !== null
            ? ((angMom - this.initialAngMom) / Math.max(Math.abs(this.initialAngMom), 1e-6) * 100) : 0;

        _set(this.dom.linearKE, fmt(e.linearKE));
        _set(this.dom.spinKE, fmt(e.spinKE));
        _set(this.dom.massE, fmt(e.totalMass));
        _set(this.dom.potentialE, fmt(pe));
        _set(this.dom.totalE, fmt(total));
        _set(this.dom.energyDrift, fmtDrift(eDrift));
        _set(this.dom.fieldE, fmt(allFieldE));
        _set(this.dom.radiatedE, fmt(radiated));
        const showWork = L.expansionWork !== 0;
        // .stat-row's display beats the hidden attribute
        const workDisplay = showWork ? '' : 'none';
        if (this.dom.expansionWorkRow.style.display !== workDisplay) this.dom.expansionWorkRow.style.display = workDisplay;
        if (showWork) _set(this.dom.expansionWork, fmt(L.expansionWork));
        _set(this.dom.momentum, fmt(pMag));
        _set(this.dom.particleMom, fmt(Math.sqrt(e.px * e.px + e.py * e.py)));
        _set(this.dom.fieldMom, fmt(Math.sqrt(totalFieldPx * totalFieldPx + totalFieldPy * totalFieldPy)));
        _set(this.dom.radiatedMom, fmt(Math.sqrt(radPx * radPx + radPy * radPy)));
        _set(this.dom.momentumDrift, fmtDrift(pDrift));
        _set(this.dom.angularMomentum, fmt(angMom));
        _set(this.dom.orbitalAngMom, fmt(e.orbitalAngMom));
        _set(this.dom.spinAngMom, fmt(e.spinAngMom));
        _set(this.dom.angMomDrift, fmtDrift(aDrift));
    }

    /**
     * Update selected particle display from GPU readback data.
     * @param {Object} sel - GPU readback selected particle object, or null.
     * @param {Object} settings - for the relativityEnabled check.
     * @returns {Object|null}
     */
    updateSelectedGPU(sel, settings) {
        const dom = this.selDom;
        if (!sel || sel.mass <= 0) {
            dom.details.hidden = true;
            dom.hint.hidden = false;
            dom.phaseSection.hidden = true;
            if (dom.effPotSection) dom.effPotSection.hidden = true;
            return null;
        }

        dom.details.hidden = false;
        dom.hint.hidden = true;
        dom.phaseSection.hidden = false;
        if (dom.effPotSection) dom.effPotSection.hidden = false;
        const speed = Math.sqrt(sel.velX * sel.velX + sel.velY * sel.velY);
        const wSq = sel.velWX * sel.velWX + sel.velWY * sel.velWY;
        const gamma = settings.relativityEnabled ? Math.sqrt(1 + wSq) : 1;
        const totalFx = sel.forceGravity.x + sel.forceCoulomb.x + sel.forceMagnetic.x + sel.forceGravitomag.x + sel.force1PN.x + sel.forceSpinCurv.x + sel.forceRadiation.x + sel.forceYukawa.x + sel.forceExternal.x + sel.forceHiggs.x + sel.forceAxion.x;
        const totalFy = sel.forceGravity.y + sel.forceCoulomb.y + sel.forceMagnetic.y + sel.forceGravitomag.y + sel.force1PN.y + sel.forceSpinCurv.y + sel.forceRadiation.y + sel.forceYukawa.y + sel.forceExternal.y + sel.forceHiggs.y + sel.forceAxion.y;
        const forceMag = Math.sqrt(totalFx * totalFx + totalFy * totalFy);

        _set(dom.mass, fmtRaw(sel.mass) + (sel.antimatter ? ' (anti)' : ''));
        _set(dom.charge, fmtRaw(sel.charge));
        const surfaceV = sel.angVel * sel.radius;
        _set(dom.spin, surfaceV.toFixed(4) + 'c');
        _set(dom.speed, speed.toFixed(4) + 'c');
        _set(dom.gamma, gamma.toFixed(3));
        if (dom.tau) _set(dom.tau, fmtRaw(sel.tau));
        if (dom.lapse) _set(dom.lapse, sel.lapse.toFixed(4));
        _set(dom.force, fmt(forceMag));

        const forces = this._forceDescs;
        forces[0].vec = sel.forceGravity;
        forces[1].vec = sel.forceCoulomb;
        forces[2].vec = sel.forceMagnetic;
        forces[3].vec = sel.forceGravitomag;
        forces[4].vec = sel.force1PN;
        forces[5].vec = sel.forceSpinCurv;
        forces[6].vec = sel.forceRadiation;
        forces[7].vec = sel.forceYukawa;
        forces[8].vec = sel.forceExternal;
        forces[9].vec = sel.forceHiggs;
        forces[10].vec = sel.forceAxion;
        for (const f of forces) {
            if (!f.row) continue;
            const mag = Math.sqrt(f.vec.x * f.vec.x + f.vec.y * f.vec.y);
            if (mag > EPSILON) {
                f.row.hidden = false;
                _set(f.val, fmt(mag));
            } else {
                f.row.hidden = true;
            }
        }

        return sel;
    }
}
