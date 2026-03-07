# Physics Accuracy Audit

Comprehensive audit of the physsim N-body simulation for physical accuracy, realism, and factual correctness. Covers all force laws, field theories, numerical methods, presets, and reference documentation.

**Audit date**: 2026-03-07
**Scope**: All source files in `src/`, `main.js`, `colors.js`
**Unit system**: Natural units with c = G = hbar = 1, 3D force laws with motion constrained to a 2D plane
**Status**: All bugs, inaccuracies, and reference errors **fixed** (2026-03-07)

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Bug | 3 | **All fixed** |
| Inaccuracy | 2 | **All fixed** |
| Reference error | 4 | **All fixed** |
| Approximation | 12 | Documented (by design) |
| Simplification | 12 | Documented (by design) |
| Ambiguity | 4 | Documented |
| Correct | 60+ | Verified |

The physics implementation is remarkably thorough and mostly correct. Three genuine bugs were found and fixed (Yukawa jerk coefficient, pi0 decay kinematics, Kerr-Newman surface gravity for charged BHs). Two physics inaccuracies were corrected (Landau-Lifshitz radiation terms, Higgs gradient force). Four reference documentation errors were fixed. All other formulas, sign conventions, and dimensional analyses check out.

---

## Bugs

### B1. Yukawa jerk radial coefficient -- FIXED
**File**: `forces.js:288`
**Severity**: Bug (affects radiation reaction when Yukawa dominates)

The analytical jerk for the Yukawa force has an incorrect coefficient. The radial jerk term uses `2*mu*invR` where it should be `3*mu*invR`.

**Code**:
```js
const jRadial = -(3 * invRSq + 2 * mu * invR + mu * mu) * rDotVr * ...
//                               ^ should be 3
```

**Derivation**: For `f(r) = exp(-mu*r) * (r^-3 + mu*r^-2)`, the derivative is:
```
f'(r) = exp(-mu*r) * (-3/r^4 - 3*mu/r^3 - mu^2/r^2)
```
The code has `(-3/r^4 - 2*mu/r^3 - mu^2/r^2)` -- the middle coefficient is wrong.

**Impact**: Affects the Landau-Lifshitz radiation reaction force and quadrupole radiation power when Yukawa forces are the dominant acceleration. The error is in the jerk (time derivative of force), which feeds into radiation calculations. Gravity and Coulomb jerks are correct.

---

### B2. Pi0 decay kinematics violate momentum conservation -- FIXED
**File**: `pion.js:56-82`
**Severity**: Bug (momentum non-conservation)

Neutral pion decay emits two photons perpendicular to the pion's flight direction (`+/- PI/2`). This violates conservation of momentum: the pion carries forward momentum `p = E*v`, but the two perpendicular photons carry zero net forward momentum.

**Correct kinematics**: In the rest frame, emit two back-to-back photons along a random axis (each with energy `m_pi/2`), then Lorentz-boost to the lab frame. The result would be two forward-beamed photons, not perpendicular ones.

**Impact**: Also breaks the radiated momentum bookkeeping (`totalRadiatedPx/Py`) -- when a pi0 decays, the pion's forward momentum is subtracted but the photons contribute only transverse momentum, creating a systematic drift.

---

### B3. Kerr-Newman surface gravity formula incorrect for Q != 0 -- FIXED
**Files**: `integrator.js:772`, `reference.js:251`
**Severity**: Bug (overestimates Hawking temperature for charged BHs)

The surface gravity formula uses:
```
kappa = sqrt(M^2 - a^2 - Q^2) / (r+^2 + a^2)
```

This is correct for Kerr (Q=0) but incorrect for Kerr-Newman. The correct denominator is `2*M*r+`, which equals `r+^2 + a^2 + Q^2`. Since `r+^2 + a^2 < r+^2 + a^2 + Q^2`, the code gives a **larger** kappa (hotter BH) than the correct formula for charged black holes.

**Verification**: For Schwarzschild (Q=0, a=0): `kappa = M / (4M^2) = 1/(4M)`. Correct. For Kerr (Q=0): `kappa = sqrt(M^2-a^2) / (2M*r+)`. Also correct since `r+^2 + a^2 = 2M*r+` when Q=0. The error only manifests when Q != 0.

**Impact**: Charged black holes evaporate faster than they should. The reference documentation has the same error.

---

## Inaccuracies

### I1. Landau-Lifshitz power-dissipation terms -- FIXED
**File**: `integrator.js:680-688`
**Severity**: Inaccuracy (wrong force direction at relativistic speeds)

The Landau-Lifshitz radiation reaction has three terms. Term 3 (the Schott-like term) is applied along the external force `F` direction, but the standard LL formula has both power-dissipation terms purely along the velocity `v`. The standard form is:

```
F_rad = tau * [dF/dt / gamma^3 - (gamma/m) * (F^2 - (v.F)^2) * v]
```

The code splits this into `F^2 * v` and `(v.F) * F`, which produces a component perpendicular to v that should not exist. At non-relativistic speeds the two power terms are negligible (only Term 1, the jerk, matters). The LL_FORCE_CLAMP = 0.5 further limits the impact.

**Impact**: Affects radiation reaction direction at relativistic speeds. Mitigated by the clamp and by Term 1 (jerk) dominating in most scenarios.

---

### I2. Higgs gradient force sign vs |phi| mass generation -- FIXED
**File**: `higgs-field.js:137 vs 169-175`
**Severity**: Inaccuracy (force-energy inconsistency)

Mass generation uses `m_eff = baseMass * |phi(x)|` (absolute value), but the gradient force uses `F = +g * baseMass * grad(phi)` (without `sign(phi)`). If the particle energy is `E = baseMass * |phi|`, then the consistent force should be `F = -grad(E) = -baseMass * sign(phi) * grad(phi)`.

The code always pushes particles toward increasing phi regardless of sign, while the energy function treats both signs equally via `|phi|`. The source term `+g*baseMass` also always pushes phi positive, breaking the Z2 symmetry. This creates a self-consistent attractive coupling where particles cluster around high-phi regions, but the force and energy are not derivable from a single Hamiltonian.

**Impact**: The Higgs field starts at VEV=1 and particles preferentially inhabit the phi > 0 vacuum, so in practice this rarely causes observable issues. The phi < 0 vacuum is physically inaccessible due to the positive-definite source.

---

## Reference Documentation Errors

### R1. Magnetic dipole force sign -- FIXED
**File**: `reference.js` (magnetic section)

The reference shows `F = +3*mu_1*mu_2/r^4 * hat{r}` but the accompanying text says "aligned perpendicular-to-plane dipoles repel." With the code's convention (positive = toward source = attractive), the positive sign implies attraction, contradicting the text. The code correctly uses `F = -3*mu1*mu2/r^4` (negative = repulsive for aligned dipoles). The reference formula sign should be negative.

### R2. Axion alpha_eff missing coupling constant -- FIXED
**File**: `reference.js` (axion section, ~line 334)

Shows `alpha_eff(x) = alpha * (1 + a(x))` but should be `alpha_eff(x) = alpha * (1 + g*a(x))` to match the Lagrangian `-(1+g*a)F^2/4` shown two lines above and the code (`axMod = 1 + g*a`).

### R3. Axion field visualization colors -- FIXED
**File**: `reference.js` (axion section, ~line 358)

Describes the field as "blue" (a > 0) and "red" (a < 0). The actual rendering uses indigo (a > 0) and yellow (a < 0), as implemented in `axion-field.js` and confirmed in CLAUDE.md.

### R4. RP2 topology claim -- FIXED
**File**: `reference.js` (topology section, ~line 533)

Claims RP2 is "the only closed 2D surface where *every* closed loop is orientation-reversing." This is false -- contractible loops preserve orientation on any surface. The correct statement is that every *non-contractible* loop is orientation-reversing (equivalently, pi_1(RP2) = Z/2Z with the orientation character mapping the generator to -1).

---

## Approximations

These are deliberate or well-motivated modeling choices that differ from exact physics.

### A1. Plummer softening
**Files**: `config.js:25-28`, `forces.js`

SOFTENING = 8 (SOFTENING_SQ = 64) is very large relative to particle sizes (r = cbrt(m)), substantially smoothing close encounters. BH mode reduces to SOFTENING = 4. Standard N-body technique, well-motivated for numerical stability.

### A2. Tidal torque r^3 scaling
**File**: `forces.js:313-325`

Uses `r_body^3` instead of the textbook `R^5` scaling. Since `r = cbrt(m)`, `r^3 = m` instead of `r^5 = m^{5/3}`, changing the mass-dependence. With `TIDAL_STRENGTH = 2.0` as a tunable parameter, the qualitative behavior (spin -> synchronous rotation) is correct.

### A3. Boris integrator for gravity
**File**: `integrator.js:530-570`

Boris integrators are designed for charged-particle-in-field problems. Using them for gravitomagnetic forces is motivated by the GEM analogy but is an approximation since the analogy breaks down at higher orders. At 1PN in the weak-field limit, this is appropriate and elegant.

### A4. Signal delay: position-only retardation
**File**: `signal-delay.js`

Uses retarded position and velocity of the source, not the full Lienard-Wiechert potential formalism. The actual retarded force from GR would include additional velocity-dependent corrections (aberration). Provides the key physical effect (finite propagation speed) without full complexity.

### A5. Symplectic Euler is first-order
**Files**: `higgs-field.js:80-81`, `axion-field.js:81-82`

Symplectic Euler for the Klein-Gordon wave equation is only O(dt) accurate. Stormer-Verlet (leapfrog) would give O(dt^2) for negligible extra cost. For an interactive visualization, first-order is adequate. The CFL stability limit is well-satisfied.

### A6. Quadrupole radiation uses absolute coordinates
**File**: `integrator.js:1069-1115`

Quadrupole moments are computed relative to the simulation origin, not the center of mass. This introduces a spurious dipole contribution for systems with nonzero total momentum. For bound systems this is a small effect.

### A7. Quadrupole energy extraction is heuristic
**File**: `integrator.js:1142-1161`

Radiated energy is removed by uniformly scaling all particles' proper velocities proportional to KE. In reality, each particle should lose energy according to its contribution to the quadrupole moment. The approach conserves momentum and is reasonable for bound systems.

### A8. Hawking radiation uses single scalar DOF
**File**: `integrator.js:775`

Stefan-Boltzmann constant `sigma = pi^2/60` corresponds to a single massless scalar field. Photons have 2 DOFs (sigma = pi^2/30); the full Standard Model has many more. For a 2D toy model, the single-DOF choice is a reasonable simplification.

### A9. Thermal phase transition heuristic
**File**: `higgs-field.js:71, 114-115`

The thermal correction `mu^2_eff = mu^2 - KE_local` uses local KE density as a proxy for T^2. This is a simplified model of finite-temperature effective potential. The qualitative behavior (symmetry restoration at high temperature) is correct. The thermal KE uses the Newtonian formula `0.5*m*v^2` even when relativity is on.

### A10. BH aggregate nodes lose dipole information
**File**: `forces.js:465-468`

Barnes-Hut aggregate nodes use mass-weighted average velocity and zero angular velocity for distant clusters. This means frame-dragging torque from distant clusters is zero. Since tidal/frame-drag torques fall off as 1/r^3 or faster, this is physically reasonable for distant nodes.

### A11. Roche lobe uses small-q limit of Eggleton
**File**: `integrator.js:1361`

Uses `r_L = 0.462 * d * (m/(m+M))^{1/3}`, which is the small mass-ratio limit of the full Eggleton (1983) formula. Less accurate for comparable masses.

### A12. Pion emission radiation reaction scaling
**File**: `integrator.js:849-860`

The proper velocity scaling `scale = sqrt(1 - dE/KE)` is exact non-relativistically but first-order approximate in the relativistic case. Error is O(dE^2/KE^2), negligible under the LL force clamp.

---

## Simplifications

These are deliberate modeling choices that differ from real physics for practical or pedagogical reasons.

### S1. 2D magnetic dipole field sign
**File**: `forces.js:244-245`

Uses `Bz = +mu/r^3` for the dipole B-field, while the 3D equatorial field is `Bz = -mu/(4*pi*r^3)`. The positive sign is chosen so that the dipole-dipole force `F = -3*mu1*mu2/r^4` gives the correct physics: aligned dipoles repel in the equatorial plane. The individual field sign differs from the 3D textbook but the combined force behavior is correct.

### S2. Simplified pion decay channels
**File**: `pion.js:56-82`

`pi+/- -> 1 photon` is kinematically forbidden in real physics (a massive particle cannot decay to a single massless particle while conserving both energy and momentum). The physical decay is `pi+ -> mu+ + nu_mu`. Since the simulation doesn't model muons or neutrinos, this is a deliberate simplification.

### S3. No relativistic aberration for pion emission
**File**: `integrator.js:831-836`

Pion emission uses the `cos^2(phi)` scalar dipole pattern in the lab frame without a full Lorentz boost of the emission pattern. At low velocities this is fine; at high velocities, relativistic beaming is not applied.

### S4. Axion modulation uses observer-only field value
**File**: `forces.js:162`

The fine structure constant modulation `p.axMod` uses only the observer particle's local axion field value, not an averaged or midpoint value. Strictly, the coupling should depend on the field along the propagation path.

### S5. Particle-field interaction energy missing from PE
**Files**: `potential.js`, `energy.js:131-139`

The `computePE()` function and effective potential do not include the particle-Higgs or particle-axion interaction energy. Field energy is computed separately but the particle-field coupling energy is untracked. This means total energy accounting is not perfectly conserving across field interactions.

### S6. 50/50 energy split for field excitations
**File**: `integrator.js:946-951`

When both Higgs and axion fields are active, merge collision energy is split 50/50 between them. With `HIGGS_COUPLING = 1` and `AXION_COUPLING = 0.05`, the Higgs should receive a much larger share based on coupling strengths.

### S7. Mass modulation breaks particle momentum conservation
**File**: `higgs-field.js:124-148`

When `modulateMasses()` changes particle mass, proper velocity `w` is unchanged, so momentum `p = m*w` changes implicitly. The field should carry the missing momentum, but no mechanism ensures exact conservation each substep.

### S8. Kerr-Newman in 2D
**Files**: `config.js:127-131`, `integrator.js:760-806`

The Kerr-Newman metric is a 4D solution. Concepts like "event horizon" and "ergosphere" don't directly apply in 2D. The simulation uses 4D formulas as effective radii for collision and rendering, which is a reasonable pedagogical choice.

### S9. Angular velocity not retarded in signal delay
**File**: `forces.js:82`

When signal delay is active, the source's `angVel` is taken from the current time, not the retarded time. Retarded angular velocity would require storing angVel in the history buffer. This is a minor inconsistency since angular velocity affects dipole forces which are already small corrections.

### S10. Magnetic moment model
**File**: `config.js:35`

`mu = 0.2 * q * omega * r^2` corresponds to a uniformly charged sphere. This is a specific geometric model choice.

### S11. Field interpolation uses boundary clamping
**File**: `scalar-field.js:95-100, 258-261`

`interpolate()` and `gradient()` use boundary clamping rather than topology-aware wrapping (`_nb`). For particles near domain boundaries with periodic topology, PQS stencil nodes are clamped to edge values instead of wrapped. Inconsistent with `_depositPQS()` which properly wraps. Effects are small (outermost ring of cells only).

### S12. Annihilation KE not tracked
**File**: `collisions.js:55`

Annihilation energy is `2*m*c^2` (rest mass only). The kinetic energy of the annihilated mass fraction is not deposited as radiation or tracked.

---

## Ambiguities

### U1. Quadrupole radiation missing trace subtraction
**File**: `integrator.js:1119-1121`

Both GW and EM quadrupole power use the full (non-traceless) tensor `I_xx^2 + 2*I_xy^2 + I_yy^2`. The 3+1D formulas (factors 1/5 and 1/180) assume the trace-free reduced quadrupole moment. The missing trace subtraction causes a systematic overestimate of radiation power. For 2D motion embedded in 3D, this is a modeling choice, not strictly wrong.

### U2. EIH 1PN coefficient decomposition
**File**: `forces.js:186-188`

The `5*m_test/r + 4*m_source/r` split is specific to the decomposition where the GM Lorentz piece is subtracted for Boris rotation. Different but equally valid decompositions give different coefficients. The velocity-Verlet correction step ensures the total 1PN force (Boris + explicit) sums correctly regardless of the split.

### U3. Bazanski term relative scaling
**File**: `forces.js:217-223`

The Bazanski term mixes charge and mass dimensions. Since the simulation's charge unit is arbitrary (not tied to the real electromagnetic coupling constant), the relative magnitude of Bazanski vs Newtonian gravity is not constrained by real physics.

### U4. Darwin EM remainder decomposition
**File**: `forces.js:200-211`

The Darwin Lagrangian force minus the Boris-handled Lorentz piece leaves a specific remainder. The exact form depends on the decomposition. The code's form appears consistent but verifying requires the full decomposition.

---

## Verified Correct

The following areas were verified as physically correct (or correct within the simulation's stated conventions):

### Forces
- Newtonian gravity: `F = m1*m2/r^2`, PE = `-m1*m2/r`, F = -dV/dr verified
- Coulomb force: `F = -q1*q2/r^2`, PE = `+q1*q2/r`, signs correct for like-repel
- Magnetic dipole-dipole: `F = -3*mu1*mu2/r^4`, PE = `+mu1*mu2/r^3`, aligned dipoles repel
- GM dipole: `F = +3*L1*L2/r^4` (co-rotating attract), PE = `-L1*L2/r^3`
- Yukawa potential: `F = g^2*m1*m2*exp(-mu*r)*(1/r^2 + mu/r)`, PE = `-g^2*m1*m2*exp(-mu*r)/r`
- Gravity and Coulomb analytical jerks: correct derivatives of 1/r^2 force
- Biot-Savart B-field from moving charges: standard form in natural units
- Gravitomagnetic Bgz: correct GEM sign (`-m*(v x r_hat)/r^2`, `-2L/r^3`)
- Frame-dragging torque: drives spins toward co-rotation, correct 1/r^3 scaling
- Tidal locking: correct qualitative behavior, includes Coulomb tidal contribution
- Bazanski cross-term: vanishes for identical particles (verified)
- Scalar Breit Hamiltonian: correct for massive scalar boson exchange, (1+mu*r) factor
- External fields: uniform gravity, electric, magnetic correctly applied

### GEM Sign Conventions
- All GEM interactions verified attractive (gravity has one sign of charge)
- GM dipole: positive = attractive (opposite to EM)
- GM Boris parameter: `+2*Bgz` with factor of 4 from GEM
- Bgz field: negative Biot-Savart sign consistent with GEM
- Display force reconstruction: `4*m*v x Bgz` matches Boris rotation

### Relativity
- Proper velocity (celerity) `w = gamma*v` as state variable: automatic subluminal `v = w/sqrt(1+w^2)`
- Relativistic KE: `wSq/(gamma+1)*m` avoids catastrophic cancellation at low v
- Relativistic momentum: `p = m*w` correct
- Angular proper velocity: `omega = W/sqrt(1+W^2*r^2)` caps surface speed at c
- Cosmological expansion: Hubble flow + momentum redshift correct

### Boris Integrator
- Standard half-kick/rotate/half-kick structure
- Relativistic gamma correction in rotation parameter
- Exact |v| preservation in B-field rotation
- EM Boris parameter: `q*Bz/(2m)*dt/gamma`
- GM Boris parameter: `2*Bgz*dt/gamma`
- Adaptive substepping: acceleration + cyclotron criteria correct, MAX_SUBSTEPS=32

### 1PN Corrections
- Velocity-Verlet correction: store F_old, recompute F_new after drift, correct w += (F_new-F_old)*dt/(2m)
- Always pairwise even when Barnes-Hut on (correct design choice)
- EIH + Darwin EM + Bazanski + Scalar Breit all corrected

### Signal Delay
- Light-cone equation `g(t) = |x_src(t) - x_obs| - (now - t) = 0`
- NR derivative `g' = (d.v)/|d| + 1 > 0` guarantees monotonicity and convergence
- Quadratic solve on piecewise-linear segments is exact (not approximate)
- Root selection: most recent valid root = physical (retarded) solution
- Dead particle handling: blocks backward extrapolation, deathTime guard
- Creation time guard: respects causality for newly placed particles
- Dead particles fade out after light-cone passes all observers

### Radiation
- Larmor prefactor `tau = 2*q^2/(3*m)` correct in natural units
- EM quadrupole `P = (1/180)|d^3 Q_ij/dt^3|^2` correct factor
- GW quadrupole `P = (1/5)|d^3 I_ij/dt^3|^2` correct factor
- Third time derivative of mass/charge quadrupole: correct formula `6*v*F + 2*x*J`
- LL force clamping at 0.5 * |F_ext| prevents runaway
- Scalar Larmor `P = g^2*F^2/3`: angular factor 1/3 for spin-0 (vs 2/3 for spin-1)

### Hawking Radiation
- Kerr-Newman surface gravity formula correct for Q=0 (Kerr and Schwarzschild)
- Hawking temperature `T = kappa/(2*pi)` correct in natural units
- Stefan-Boltzmann `P = sigma*T^4*A` with sigma = pi^2/60 (single scalar DOF)
- Horizon area `A = 4*pi*(r+^2 + a^2)` standard Kerr-Newman
- Extremal BH handling: disc <= 0 -> P = 0 (correct: zero temperature)
- Naked singularity floor at 0.5*M prevents disappearing particles

### Pion Physics
- Pion velocity: `v = sqrt(KE*(KE+2m))/(KE+m)` correct relativistic kinematics
- Proper velocity: `w = gamma*v = p/m` correct
- GR deflection factor `(1+v^2)`: interpolates between 1 (Newtonian) and 2 (null geodesic)
- Pion mass = Yukawa mu parameter (Yukawa's 1935 insight)
- Pion momentum tracking: `m*w` correct
- Absorption momentum transfer: `E*v = m*gamma*v = m*w = p` correct

### Photon Physics
- Gravitational lensing: factor of 2 (full GR for null geodesics)
- Speed renormalized to c=1 after deflection
- Absorption momentum: `p = E/c = E` in natural units, `delta_w = E*v_hat/m`

### Scalar Fields
- Mexican hat potential `V(phi) = -mu^2*phi^2/2 + lambda*phi^4/4` with `lambda = mu^2 = m_H^2/2`
- VEV = 1 at `phi = mu/sqrt(lambda) = 1`
- Mass generation `m_eff = baseMass * |phi|`
- Axion quadratic potential `V(a) = m_a^2*a^2/2`
- Axion EM coupling: `alpha_eff = alpha*(1+g*a)`, source `g*q^2`, force `g*q^2*grad(a)`
- PQ coupling: `+/-g*m` source (CP flip for antimatter), `yukMod = 1+/-g*a`, clamped >= 0
- Symplectic Euler for wave equation: preserves symplectic structure, no secular drift
- PQS (cubic B-spline) weights sum to 1, C^2 continuous, standard PIC shape functions
- C^2 gradient strategy: PQS-interpolate central-difference grid gradients
- Field energy: `integral(phi_dot^2/2 + |grad phi|^2/2 + V(phi)) * dA` correct
- Field momentum: `P_i = -integral(phi_dot * d_i phi) dA` correct (stress-energy T^{0i})
- Higgs vacuum energy offset: V(VEV=1) = 0 verified
- Damping: Higgs critical (2*m_H), Axion Q=1/g=20 (g*Q=1 for matched resonant/static response)
- Boundary conditions: Despawn->Dirichlet, Bounce->Neumann, Loop->Periodic all reasonable
- `axMod` and `yukMod` clamped >= 0 prevents EM/Yukawa force sign reversal
- Source-force consistency verified for both Higgs and Axion

### Numerical Methods
- Barnes-Hut theta=0.5: ~1% force accuracy, standard for interactive N-body
- QuadTree depth guard (max 48) prevents stack overflow from coincident particles
- Laplacian: standard 5-point stencil, O(h^2) on non-square grid
- Interior/border split for Laplacian reduces ~16K `_nb()` calls to ~504
- NR signal delay tolerance 1e-12: tight but achievable in Float64
- Plummer softening prevents force singularities
- NaN guards throughout integrator catch bad state
- `fastTanh()` Pade approximant: max error ~0.4%, adequate for visualization
- Fixed-timestep accumulator with MAX_FRAME_DT=0.1 and ACCUMULATOR_CAP=4 prevents spiral-of-death

### Collisions
- Merge conserves mass, charge, linear momentum (proper velocity), angular momentum (orbital + spin)
- Relativistic KE `wSq/(gamma+1)*m` used for merge energy tracking (avoids cancellation)
- Annihilation energy `2*m*c^2` correct
- Annihilation momentum `annihilated*(w1+w2)` correct (equal mass from each particle)
- Hertz contact `F = K*delta^{3/2}` standard

### Topology
- Torus: standard periodic wrapping, half-domain min-image correct
- Klein bottle: y-wrap with x-reflection and velocity/spin flip correct
- RP^2: both axes are glide reflections, 4 min-image candidates complete
- Scalar field `_nb()` correctly implements all three topologies

### Energy & Momentum
- Relativistic linear and spin KE formulas correct
- Non-relativistic fallback `0.5*m*v^2` correct
- Orbital angular momentum `r x (m*w)` and spin `I*angw` correct
- Darwin field energy (EM: `-q1*q2/(2r)*vel_term`, GM: opposite sign) correct
- EIH 1PN PE structurally consistent with force
- Effective potential includes all force contributions with correct signs

### Presets
All 19 presets verified as physically reasonable with correct force toggles:
- `kepler`: stable Keplerian orbits with gravity only
- `precession`: eccentric orbit with 1PN for perihelion advance
- `inspiral`: sub-circular orbit with GW radiation for binary decay
- `tidallock`: moon spin-down with tidal torque
- `roche`: plunge orbit inside Roche limit with disintegration
- `hawking`: small BH masses for visible evaporation
- `atom`: screened nuclear charge with spin-orbit
- `bremsstrahlung`: relativistic near-miss with radiation
- `magnetic`: aligned dipole grid with Lorentz deflection
- `nucleus`: Yukawa binding of nucleon ring
- `axion`: coupled atom-like systems with EM modulation
- `pionexchange`: nucleon ring with massive force carriers
- `higgs`: particles gaining mass from field VEV
- `higgsboson`: head-on collision exciting Higgs field
- `axionburst`: charged collision exciting axion field
- `pecceiQuinn`: matter vs antimatter with PQ coupling
- `phasetransition`: fast particles driving symmetry restoration
- `galaxy`: 100-body with BH and gravitomagnetic effects
- `expansion`: Hubble flow competition with gravity
