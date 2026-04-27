// ─── Reference Deep-Dive Translations ───
// Long-form physics reference content shown in the Shift+click overlay.
// Mirrors the structure of src/reference.js: each entry is keyed
// `ref.<concept>.title` and `ref.<concept>.body`. Body strings contain
// trusted HTML+LaTeX — KaTeX renders the math regardless of language, so
// math expressions stay verbatim across en/ja.

const REF_EN = {
    'ref.gravity.title': 'Newtonian Gravity',
    'ref.gravity.body': `
<p>Every massive particle attracts every other massive particle. In natural units ($G = c = 1$), gravity is the simplest long-range force — and the architect of all large-scale structure in the universe.</p>

<h3>Lagrangian</h3>
<p>$$\\mathcal{L} = \\frac{1}{2}m v^2 + \\frac{m_1 m_2}{r}$$</p>
<p>The positive sign on the potential term means gravity lowers the total energy as particles approach — the system naturally tends toward collapse.</p>

<h3>Force</h3>
<p>$$\\mathbf{F} = +\\frac{m_1 m_2}{r^2}\\,\\hat{r}$$</p>
<p>Always attractive, with $1/r^2$ falloff — a geometric consequence of flux spreading over spherical surfaces. Plummer softening ($r \\to \\sqrt{r^2 + \\epsilon^2}$, $\\epsilon^2 = 64$) prevents divergence at close approach.</p>

<h3>Potential Energy</h3>
<p>$$V(r) = -\\frac{m_1 m_2}{r}$$</p>
<p>Negative and unbounded below. Total energy $E = \\text{KE} + V$ determines the orbit type:</p>
<ul>
<li>$E < 0$: bound orbit (ellipse)</li>
<li>$E = 0$: parabolic escape</li>
<li>$E > 0$: hyperbolic flyby</li>
</ul>

<h3>Kepler Orbits</h3>
<p>A test particle orbiting mass $M$ follows a conic section. For circular orbits:</p>
<p>$$v_{\\text{circ}} = \\sqrt{\\frac{M}{r}}, \\qquad T = 2\\pi\\sqrt{\\frac{r^3}{M}}$$</p>
<p>This is Kepler's third law: the orbital period squared is proportional to the semi-major axis cubed. The "Orbit" spawn mode uses this formula to give new particles exactly circular velocity.</p>

<h3>Escape Velocity</h3>
<p>$$v_{\\text{esc}} = \\sqrt{\\frac{2M}{r}} = \\sqrt{2}\\,v_{\\text{circ}}$$</p>
<p>A particle launched at exactly this speed has zero total energy and will coast to infinity, never returning.</p>

<h3>Two-Body Reduction</h3>
<p>Any two gravitating bodies can be reduced to an equivalent one-body problem using the reduced mass $\\mu = m_1 m_2/(m_1+m_2)$. The relative separation traces a Kepler ellipse. In pairwise mode with gravity only, this simulation conserves energy and angular momentum to machine precision.</p>

<h3>Tidal Locking</h3>
<p>Tidal locking synchronizes a body's rotation with its orbital period, so it always shows the same face to its companion. The Moon is tidally locked to Earth.</p>
<p>$$\\tau = -\\text{TIDAL\\_STRENGTH}\\cdot\\frac{C^2\\,R^5}{r^6}\\,(\\omega_{\\text{spin}}-\\omega_{\\text{orbit}})$$</p>
<p>where the coupling $C = m_{\\text{other}} + q_1 q_2/m$ combines gravitational and electrostatic tidal fields. The $r^{-6}$ dependence makes tidal torque extremely sensitive to distance — halving the separation increases it 64-fold.</p>
<p>A non-synchronous body develops a displaced tidal bulge whose gravitational pull creates a torque transferring angular momentum between spin and orbit:</p>
<ul>
<li>If $\\omega_{\\text{spin}} > \\omega_{\\text{orbit}}$: the body spins down, pushing the companion outward</li>
<li>If $\\omega_{\\text{spin}} < \\omega_{\\text{orbit}}$: the body spins up, pulling the companion inward</li>
</ul>
<p>Equilibrium is $\\omega_{\\text{spin}} = \\omega_{\\text{orbit}}$: tidal lock. The $C^2$ factor includes gravity-gravity, gravity-EM, EM-gravity, and EM-EM cross-terms. Always active when gravity is on (no separate toggle).</p>
`,

    'ref.coulomb.title': 'Coulomb Force',
    'ref.coulomb.body': `
<p>The electrostatic interaction between charged particles — the force that governs chemistry, electricity, and the structure of every atom.</p>

<h3>Lagrangian</h3>
<p>$$\\mathcal{L} = \\frac{1}{2}m v^2 - \\frac{q_1 q_2}{r}$$</p>

<h3>Force</h3>
<p>$$\\mathbf{F} = -\\frac{q_1 q_2}{r^2}\\,\\hat{r}$$</p>
<p>Like charges ($q_1 q_2 > 0$) repel; opposite charges ($q_1 q_2 < 0$) attract. Same $1/r^2$ falloff as gravity, but with two crucial differences: charge comes in two signs, and the coupling can be far stronger.</p>

<h3>Potential Energy</h3>
<p>$$V(r) = +\\frac{q_1 q_2}{r}$$</p>
<p>Positive for like charges (repulsive barrier), negative for opposite charges (attractive well). An electron-proton system has $V < 0$ at all distances, forming hydrogen-like bound orbits.</p>

<h3>Classical Bound States</h3>
<p>With both gravity and Coulomb active, a massive positive nucleus can bind lighter negative charges in stable orbits. The effective potential has a minimum where gravitational + Coulomb attraction balances centrifugal repulsion. These are not quantum atoms, but they capture the essential orbital mechanics.</p>

<h3>Screening &amp; Neutrality</h3>
<p>Unlike gravity (which only attracts), opposite charges cancel. A system with equal positive and negative charges appears neutral from far away. This is why electromagnetism doesn't dominate at cosmic scales — gravity does, because mass has only one sign.</p>
`,

    'ref.magnetic.title': 'Magnetic Interactions',
    'ref.magnetic.body': `
<p>Magnetism arises from charges in motion. This simulation models two distinct mechanisms: the Lorentz force from translating charges, and dipole-dipole interactions from spinning charges.</p>

<h3>Lorentz Force</h3>
<p>$$\\mathbf{F} = q\\,\\mathbf{v}\\times\\mathbf{B}$$</p>
<p>Always perpendicular to velocity, so it does no work — only deflects. In a uniform field, charges spiral in cyclotron orbits at radius $r_L = mv_\\perp/(qB)$. The Boris integrator handles this rotation exactly, preserving energy through the magnetic gyration.</p>

<h3>Magnetic Dipole–Dipole Interaction</h3>
<p>$$\\mathbf{F}_{\\text{dipole}} = +\\frac{3\\mu_1\\mu_2}{r^4}\\,\\hat{r}$$</p>
<p>Spinning charges act as magnetic dipoles with moment $\\mu = qr^2\\omega/5$ (uniform sphere). The dipole-dipole force is $1/r^4$ (steeper than $1/r^2$ Coulomb), making it dominant only at close range. Aligned dipoles attract; anti-aligned dipoles repel.</p>

<h3>The Sign Convention</h3>
<p>The simulation uses a <em>positive</em> sign for the dipole-dipole force. This is the opposite of the standard physics convention but matches the gravitomagnetic case below — both forms of magnetism use the same sign, making the GEM analogy clean.</p>
`,

    'ref.gravitomag.title': 'Gravitomagnetism',
    'ref.gravitomag.body': `
<p>General relativity predicts that mass currents create gravitational analogs of magnetic fields. Just as moving charges produce $\\mathbf{B}$, moving masses produce $\\mathbf{B}_g$ — a phenomenon called <b>gravitomagnetism</b> or <b>frame-dragging</b>.</p>

<h3>Frame-Dragging</h3>
<p>A spinning mass drags the surrounding spacetime around with it, like a stirring spoon in honey. Gyroscopes near the Earth precess slightly due to this effect — confirmed by the Gravity Probe B experiment in 2011.</p>

<h3>Gravitomagnetic Lorentz Force</h3>
<p>$$\\mathbf{F} = +4m\\,\\mathbf{v}\\times\\mathbf{B}_g$$</p>
<p>The factor of 4 comes from the linearized Einstein equations, and is twice the EM Lorentz coefficient. As with the magnetic Lorentz force, this is velocity-dependent and does no work directly.</p>

<h3>Gravitomagnetic Dipole Force</h3>
<p>$$\\mathbf{F} = +\\frac{3L_1 L_2}{r^4}\\,\\hat{r}$$</p>
<p>where $L = 2m r^2\\omega/5$ is the angular momentum of a spinning sphere. Like spins (co-rotating masses) attract — the opposite of EM dipoles, which repel when co-rotating. This is the GEM "sign flip."</p>

<h3>The GEM Analogy</h3>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr><th style="text-align:left;padding:4px 8px">Electromagnetism</th><th style="text-align:left;padding:4px 8px">Gravitoelectromagnetism</th></tr>
<tr><td style="padding:4px 8px">Charge $q$</td><td style="padding:4px 8px">Mass $m$</td></tr>
<tr><td style="padding:4px 8px">Magnetic moment $\\mu = qr^2\\omega/5$</td><td style="padding:4px 8px">Angular momentum $L = 2mr^2\\omega/5$</td></tr>
<tr><td style="padding:4px 8px">Like dipoles repel</td><td style="padding:4px 8px">Like dipoles attract</td></tr>
<tr><td style="padding:4px 8px">$\\mathbf{F}_L = q\\mathbf{v}\\times\\mathbf{B}$</td><td style="padding:4px 8px">$\\mathbf{F}_L = 4m\\mathbf{v}\\times\\mathbf{B}_g$</td></tr>
</table>
`,

    'ref.relativity.title': 'Special Relativity',
    'ref.relativity.body': `
<p>When particles move at appreciable fractions of $c$, Newtonian mechanics breaks down. Special relativity replaces velocity with proper velocity and prevents particles from ever reaching the speed of light.</p>

<h3>Proper Velocity</h3>
<p>$$\\mathbf{w} = \\gamma\\mathbf{v}, \\qquad \\gamma = \\frac{1}{\\sqrt{1-v^2}}$$</p>
<p>Unlike ordinary velocity $\\mathbf{v}$ (bounded by $c$), proper velocity $\\mathbf{w}$ is unbounded above. The simulation uses proper velocity as its primary state variable.</p>

<h3>Conversion</h3>
<p>$$\\mathbf{v} = \\frac{\\mathbf{w}}{\\sqrt{1+w^2}}, \\qquad \\gamma = \\sqrt{1+w^2}$$</p>
<p>This guarantees $|\\mathbf{v}| < 1$ for any $\\mathbf{w}$ — particles can be infinitely energetic but never reach light speed.</p>

<h3>Relativistic Energy</h3>
<p>$$E = \\gamma m, \\qquad \\text{KE} = (\\gamma - 1)m$$</p>
<p>At low speeds, $\\text{KE} \\approx \\frac{1}{2}mv^2$ (Newtonian limit). At high speeds, $\\text{KE} \\to \\infty$ as $v \\to c$ — this is why no finite force can accelerate a particle to light speed.</p>

<h3>Signal Delay</h3>
<p>With relativity enabled, forces propagate at finite speed: a particle responds to where the source <em>was</em> when its signal was emitted, not where it <em>is</em> now. The simulation searches each particle's history to find the emission event satisfying $|\\mathbf{r}_i(t) - \\mathbf{r}_j(t')| = c(t-t')$. This naturally produces phenomena like aberration and the gravitational/electromagnetic Doppler effect.</p>

<h3>Mass-Energy Equivalence</h3>
<p>The energy of a stationary particle is $E_0 = m$ (with $c=1$). All forms of energy contribute to gravity through the stress-energy tensor — radiated photons gravitate, kinetic energy gravitates, and field energy gravitates. The simulation tracks all these contributions to total energy conservation.</p>
`,

    'ref.radiation.title': 'Radiation',
    'ref.radiation.body': `
<p>Accelerating charges radiate electromagnetic waves; orbiting masses radiate gravitational waves. Both carry energy and momentum out of the system, causing orbits to decay. Three radiation channels are modeled.</p>

<h3>Larmor Dipole Radiation</h3>
<p>Requires Coulomb. An accelerating charge radiates power:</p>
<p>$$P = \\frac{2q^2}{3}a^2$$</p>
<p>The reaction on the emitter is the Landau-Lifshitz force, a physically consistent alternative to the Abraham-Lorentz force that avoids runaway solutions:</p>
<p>$$\\mathbf{F}_{\\text{rad}} = \\tau\\left[\\frac{\\dot{\\mathbf{F}}}{\\gamma^3} - \\frac{\\mathbf{v}F^2}{m\\gamma^2} + \\frac{\\mathbf{F}(\\mathbf{v}\\cdot\\mathbf{F})}{m\\gamma^4}\\right]$$</p>
<p>where $\\tau = 2q^2/(3m)$ is the radiation timescale. The force is clamped to 50% of the external force for numerical stability. Emitted photons follow a dipole angular distribution with relativistic aberration beaming.</p>

<h3>EM Quadrupole Radiation</h3>
<p>Requires Coulomb. A system with a time-varying charge quadrupole moment radiates:</p>
<p>$$P_{\\text{EM}} = \\frac{1}{180}\\left|\\dddot{Q}_{ij}\\right|^2, \\qquad Q_{ij} = \\sum_k q_k\\, x_i^{(k)} x_j^{(k)}$$</p>
<p>This is the next multipole order above dipole, significant for binary charged systems. Photon emission uses a TT-projected angular pattern via rejection sampling.</p>

<h3>Gravitational Wave Radiation</h3>
<p>Requires Gravity. The mass quadrupole formula — the leading-order source of gravitational waves:</p>
<p>$$P_{\\text{GW}} = \\frac{1}{5}\\left|\\dddot{I}_{ij}\\right|^2, \\qquad I_{ij} = \\sum_k m_k\\left(x_i^{(k)} x_j^{(k)} - \\frac{\\delta_{ij}}{3}r_k^2\\right)$$</p>
<p>For a circular binary, this reduces to the Peters formula:</p>
<p>$$P_{\\text{GW}} = \\frac{32}{5}\\frac{m_1^2 m_2^2(m_1+m_2)}{r^5}$$</p>
<p>The steep $1/r^5$ dependence means power grows dramatically as the orbit shrinks, creating a runaway inspiral. This is exactly what LIGO detects: the final moments of a billion-year inspiral, as the frequency chirps up to merger.</p>

<h3>Why No Gravitational Dipole?</h3>
<p>The gravitational dipole moment $\\sum m_i\\mathbf{x}_i$ is the center of mass, which moves at constant velocity by momentum conservation. No time-varying dipole means no dipole radiation — gravitational waves require at least the quadrupole, making them intrinsically weaker than electromagnetic waves.</p>

<h3>Energy Extraction</h3>
<p>Radiated energy is extracted from the emitter's kinetic energy by scaling the tangential velocity. Emitted photons (yellow for EM, red for gravitons) carry both energy and momentum, tracked by the simulation for conservation accounting.</p>
`,

    'ref.onepn.title': '1PN Corrections',
    'ref.onepn.body': `
<p>First post-Newtonian corrections are $O(v^2/c^2)$ terms that appear when expanding general relativity (or its EM analog) beyond leading order. They capture the first effects of finite light speed on the equations of motion.</p>

<h3>Einstein-Infeld-Hoffmann (EIH) — Gravitational Sector</h3>
<p>Requires Gravitomagnetic. The EIH equations of motion at 1PN produce the famous perihelion precession:</p>
<p>$$\\Delta\\phi = \\frac{6\\pi M}{a(1-e^2)} \\text{ rad/orbit}$$</p>
<p>For Mercury, this gives 43 arcseconds per century — the anomaly that led Einstein to general relativity. In this simulation, the precession appears as a slowly rotating ellipse.</p>
<p>The full EIH interaction Lagrangian at 1PN:</p>
<p>$$\\mathcal{L}_{\\text{EIH}} = \\frac{m_1 m_2}{2r}\\!\\left[3(v_1^2\\!+\\!v_2^2) - 7\\,\\mathbf{v}_1\\!\\cdot\\!\\mathbf{v}_2 - (\\mathbf{v}_1\\!\\cdot\\!\\hat{r})(\\mathbf{v}_2\\!\\cdot\\!\\hat{r})\\right] + \\frac{m_1 m_2(m_1\\!+\\!m_2)}{2r^2}$$</p>
<p>The resulting force is decomposed into a gravitomagnetic Lorentz piece (handled by the Boris rotation via $B_{gz}$) and a direct position-and-velocity-dependent remainder accumulated into the 1PN display vector.</p>

<h3>Darwin EM — Electromagnetic Sector</h3>
<p>Requires Magnetic. The Darwin Lagrangian for two charges at $O(v^2/c^2)$:</p>
<p>$$\\mathcal{L}_{\\text{Darwin}} = -\\frac{q_1 q_2}{2r}\\!\\left[(\\mathbf{v}_1 \\!\\cdot\\! \\mathbf{v}_2) + (\\mathbf{v}_1 \\!\\cdot\\! \\hat{r})(\\mathbf{v}_2 \\!\\cdot\\! \\hat{r})\\right]$$</p>
<p>This adds velocity-dependent corrections beyond Coulomb + Lorentz. It modifies atomic electron orbits and is the classical counterpart to the Breit interaction in quantum mechanics.</p>

<h3>Bazanski Cross-Term — Mixed Gravity-EM Sector</h3>
<p>Requires both Gravitomagnetic and Magnetic. A mixed gravity-EM interaction Lagrangian at 1PN:</p>
<p>$$\\mathcal{L}_{\\text{Baz}} = -\\frac{q_1 q_2(m_1+m_2) - (q_1^2 m_2 + q_2^2 m_1)}{2r^2}$$</p>
<p>Unlike the EIH and Darwin terms, this Lagrangian has no velocity dependence — it is purely a position-dependent $1/r^2$ potential correction. It vanishes for identical particles (when $q_1 = q_2$ and $m_1 = m_2$) and represents the gravitational correction to electromagnetic self-energy and vice versa.</p>

<h3>Scalar Breit — Yukawa Sector</h3>
<p>Requires Yukawa. The $O(v^2/c^2)$ relativistic correction for massive scalar (spin-0) boson exchange, derived from the Breit equation:</p>
<p>$$\\mathcal{L}_{\\text{Breit}} = \\frac{g^2 m_1 m_2\\,e^{-\\mu r}}{2r}\\left[\\mathbf{v}_1\\!\\cdot\\!\\mathbf{v}_2 + (\\hat{r}\\!\\cdot\\!\\mathbf{v}_1)(\\hat{r}\\!\\cdot\\!\\mathbf{v}_2)(1+\\mu r)\\right]$$</p>
<p>Because this interaction is bilinear in velocities, the Legendre transform gives $H = L$ — the Hamiltonian and Lagrangian are numerically identical. This is positive (repulsive), weakening the Yukawa attraction for fast-moving particles. The $(1+\\mu r)$ factor on the radial-velocity term comes from the massive propagator. Unlike EM (spin-1) exchange, scalar exchange produces no magnetic-type force — there is no Boris rotation component. All corrections are radial and velocity-dependent, with both radial and tangential force components accumulated into the 1PN display vector.</p>

<h3>Integration Scheme</h3>
<p>All four sectors use velocity-Verlet: the 1PN force is computed before and after the drift step, and the average is applied, giving second-order accuracy. This is necessary because 1PN forces depend on both position and velocity.</p>
`,

    'ref.blackhole.title': 'Black Hole Mode',
    'ref.blackhole.body': `
<p>When enabled, every particle is treated as a Kerr-Newman black hole — a rotating, charged singularity surrounded by an event horizon. This is the most general stationary black hole solution in general relativity.</p>

<h3>The No-Hair Theorem</h3>
<p>A black hole is completely characterized by just three numbers: mass $M$, angular momentum $J$, and charge $Q$. All other information about the matter that formed it is lost behind the horizon. This theorem is the namesake of this simulation.</p>

<h3>Kerr-Newman Horizon</h3>
<p>The outer event horizon radius:</p>
<p>$$r_+ = M + \\sqrt{M^2 - a^2 - Q^2}$$</p>
<p>where $a = J/M$ is the spin parameter. The horizon exists only when $M^2 \\geq a^2 + Q^2$; violations would produce a naked singularity, forbidden by cosmic censorship (the simulation clamps to the extremal radius $r_+ = M$).</p>

<h3>Ergosphere</h3>
<p>The region between the horizon $r_+$ and the static limit:</p>
<p>$$r_{\\text{ergo}} = M + \\sqrt{M^2 - a^2}$$</p>
<p>Inside the ergosphere, spacetime is dragged so strongly that nothing can remain stationary — everything must co-rotate with the black hole. The Penrose process can extract rotational energy by exploiting this region, converting spin energy to kinetic energy of escaping particles.</p>

<h3>Hawking Radiation</h3>
<p>Quantum effects near the horizon cause black holes to radiate thermally. The temperature depends on the surface gravity:</p>
<p>$$\\kappa = \\frac{\\sqrt{M^2 - a^2 - Q^2}}{2M\\,r_+}, \\qquad T = \\frac{\\kappa}{2\\pi}$$</p>
<p>Radiated power follows the Stefan-Boltzmann law:</p>
<p>$$P = \\sigma T^4 A, \\qquad \\sigma = \\frac{\\pi^2}{60}, \\qquad A = 4\\pi(r_+^2+a^2)$$</p>
<p>Smaller black holes are hotter and radiate faster, creating a runaway: mass decreases $\\to$ temperature rises $\\to$ radiation intensifies $\\to$ evaporation. The final instant produces a burst of photons.</p>

<h3>Extremal Limit</h3>
<p>When $M^2 = a^2 + Q^2$, the inner and outer horizons merge, surface gravity vanishes, and the temperature drops to zero — the black hole stops radiating. Extremal black holes are the most compact objects possible for their mass and charge, saturating the cosmic censorship bound.</p>

<h3>Schwinger Discharge</h3>
<p>A sufficiently charged black hole generates an electric field strong enough to rip electron-positron pairs from the vacuum — the <b>Schwinger effect</b>. The rate per unit time for a Kerr-Newman black hole:</p>
<p>$$\\Gamma = \\frac{e^2 Q^2}{\\pi^2 \\Sigma}\\,\\exp\\!\\left(-\\frac{\\pi\\, E_{\\text{cr}}\\,\\Sigma}{|Q|}\\right), \\qquad \\Sigma = r_+^2 + a^2$$</p>
<p>where $e$ is the elementary charge, $E_{\\text{cr}} = m_e^2/e$ is the critical Schwinger field, and $\\Sigma$ is the Kerr-Newman horizon area factor that encodes spin corrections. The exponential suppression means the rate is negligible until $E \\approx E_{\\text{cr}}$ (threshold at $0.5\\,E_{\\text{cr}}$).</p>
<p>The escaping lepton carries kinetic energy derived from the horizon electrostatic potential:</p>
<p>$$\\text{KE} = e\\,\\Phi_H - m_e, \\qquad \\Phi_H = \\frac{|Q|\\,r_+}{r_+^2 + a^2}$$</p>
<p>Each discharge event reduces the black hole's charge by one elementary unit and its mass by $m_e$. The same-sign lepton escapes; the opposite-sign partner falls back in. Over many events, this drives a charged black hole toward neutrality — enforcing cosmic censorship through pair production rather than naked singularity formation.</p>
`,

    'ref.kugelblitz.title': 'Kugelblitz Collapse',
    'ref.kugelblitz.body': `
<p>A <b>kugelblitz</b> is a concentration of radiation energy so dense that it undergoes gravitational collapse — forming a massive object from pure energy. This is a direct consequence of mass-energy equivalence: photons gravitate, and enough photons in a small enough region can trap themselves.</p>

<h3>Hoop Conjecture</h3>
<p>The threshold for collapse follows Thorne's hoop conjecture. In natural units ($G = c = 1$), a region of characteristic size $r$ containing total energy $E$ collapses when:</p>
<p>$$E > \\frac{r}{2}$$</p>
<p>The simulation detects this by walking the boson Barnes-Hut tree after aggregation. Each tree node stores the total source energy and bounding box size of its boson population. The smallest (deepest) node satisfying the threshold collapses first, preventing the entire boson population from collapsing when only a dense core qualifies.</p>

<h3>Collapse Resolution</h3>
<p>All photons, pions, and leptons within the collapsing tree node are consumed and replaced by a single massive particle at the energy-weighted center of mass. The spawned particle inherits:</p>
<ul>
<li><b>Mass</b> = total boson energy (photon energy + relativistic $\\gamma m$ for massive bosons)</li>
<li><b>Momentum</b> = vector sum of all consumed boson momenta</li>
<li><b>Charge</b> = sum of pion/lepton charges (photons contribute zero)</li>
<li><b>Angular momentum</b> = orbital $L$ of the boson cloud about its center of mass</li>
</ul>
<p>The resulting particle follows normal physics — it becomes a black hole only if black hole mode is independently enabled. A minimum of 4 bosons and total energy $\\geq 0.2$ is required to prevent trivial collapses.</p>

<h3>Activation</h3>
<p>Kugelblitz collapse is active whenever both <b>Gravity</b> and <b>Boson Interaction</b> are enabled. It requires no separate toggle.</p>
`,

    'ref.spinorbit.title': 'Spin-Orbit Coupling',
    'ref.spinorbit.body': `
<p>Spin-orbit coupling transfers energy and momentum between a particle's translational motion and its intrinsic rotation. This occurs whenever a spinning particle moves through a non-uniform field.</p>

<h3>Stern-Gerlach Force (Electromagnetic)</h3>
<p>A magnetic dipole in a non-uniform magnetic field feels a gradient force:</p>
<p>$$\\mathbf{F} = \\mu\\,\\nabla B_z$$</p>
<p>In the original 1922 experiment, Stern and Gerlach sent silver atoms through an inhomogeneous magnetic field and observed the beam split into discrete components — the first direct evidence of quantized angular momentum. This simulation shows the classical analog: spinning charged particles deflect toward or away from field concentrations depending on the sign of their spin.</p>

<h3>Mathisson-Papapetrou Force (Gravitational)</h3>
<p>$$\\mathbf{F} = -L\\,\\nabla B_{gz}$$</p>
<p>The opposite sign (the GEM sign flip) means spinning masses are deflected in the opposite direction from spinning charges in equivalent field geometries. This force produces subtle orbital corrections for spinning bodies around massive objects, such as the geodetic precession of pulsars.</p>

<h3>Spin-Orbit Energy Transfer</h3>
<p>Moving through a field gradient transfers energy between orbital kinetic energy and spin:</p>
<p>$$\\frac{dE}{dt} = -\\mu(\\mathbf{v}\\cdot\\nabla B_z) \\quad \\text{(EM)}, \\qquad \\frac{dE}{dt} = -L(\\mathbf{v}\\cdot\\nabla B_{gz}) \\quad \\text{(GM)}$$</p>
<p>This can speed up or slow down a particle's spin while adjusting its orbital energy to compensate, conserving total energy.</p>

<h3>Astrophysical Significance</h3>
<p>Spin-orbit coupling is crucial in binary pulsar systems, where rapidly spinning neutron stars precess due to gravitational spin-orbit effects (geodetic precession). Hulse-Taylor binary pulsar measurements of these effects provided some of the strongest early confirmations of general relativity.</p>
`,

    'ref.yukawa.title': 'Yukawa Potential',
    'ref.yukawa.body': `
<p>Proposed by Hideki Yukawa in 1935 to explain the strong nuclear force binding protons and neutrons inside atomic nuclei. His key insight: if the force is mediated by a massive particle, the potential must have an exponential cutoff.</p>

<h3>Lagrangian</h3>
<p>$$\\mathcal{L} = \\frac{1}{2}mv^2 + \\frac{g^2\\,m_1 m_2\\,e^{-\\mu r}}{r}$$</p>

<h3>Potential</h3>
<p>$$V(r) = -\\frac{g^2\\,m_1 m_2\\,e^{-\\mu r}}{r}$$</p>
<p>A screened Coulomb (or gravity) potential. The coupling $g^2$ sets the strength; the mediator mass $\\mu$ sets the range $\\lambda = 1/\\mu$.</p>

<h3>Force</h3>
<p>$$\\mathbf{F} = -g^2 m_1 m_2\\,\\frac{e^{-\\mu r}}{r^2}(1+\\mu r)\\,\\hat{r}$$</p>
<p>The $(1+\\mu r)$ factor comes from differentiating $e^{-\\mu r}/r$. At short range ($r \\ll 1/\\mu$), the exponential is approximately 1 and the force looks like gravity. At long range ($r \\gg 1/\\mu$), it vanishes exponentially.</p>

<h3>Physical Interpretation</h3>
<p>In quantum field theory, every force is mediated by a virtual particle. The mediator's mass $m$ determines the range through the uncertainty principle: a virtual particle can exist for time $\\Delta t \\sim \\hbar/(mc^2)$, traveling at most $c\\Delta t \\sim \\hbar/(mc) = 1/m$ (in natural units). This is the Compton wavelength.</p>
<ul>
<li><b>Massless mediator</b> ($\\mu = 0$): infinite range $\\to$ recovers $1/r$ potential (gravity, Coulomb)</li>
<li><b>Massive mediator</b> ($\\mu > 0$): range $\\sim 1/\\mu$ $\\to$ nuclear force (~1 fm for pions)</li>
</ul>
<p>The pion, with mass $\\sim 140$ MeV/$c^2$, gives a range of $\\sim 1.4$ fm, matching the observed range of nuclear binding. Yukawa predicted the pion's existence this way — it was discovered experimentally in 1947, earning him the Nobel Prize.</p>

<h3>Scalar Breit Correction</h3>
<p>When 1PN corrections are enabled, the Yukawa force receives $O(v^2/c^2)$ relativistic corrections from the Breit equation for massive scalar boson exchange. The correction Lagrangian is:</p>
<p>$$\\delta\\mathcal{L} = \\frac{g^2 m_1 m_2\\,e^{-\\mu r}}{2r}\\left[\\mathbf{v}_1\\!\\cdot\\!\\mathbf{v}_2 + (\\hat{r}\\!\\cdot\\!\\mathbf{v}_1)(\\hat{r}\\!\\cdot\\!\\mathbf{v}_2)(1+\\mu r)\\right]$$</p>
<p>Because this is bilinear in velocities, $H = L$ (the Legendre transform preserves the expression). This is positive (repulsive), weakening the attraction for fast-moving particles. Unlike EM or gravity, scalar (spin-0) exchange produces no magnetic-type force — all corrections are radial and velocity-dependent. The $(1+\\mu r)$ factor on the radial-velocity term comes from the massive propagator.</p>
<p>The resulting force has both radial and tangential components, accumulated into the 1PN display vector. A velocity-Verlet correction ensures accuracy for these velocity-dependent terms.</p>

<h3>Beyond Nuclear Physics</h3>
<p>The Yukawa form appears throughout physics: Debye screening in plasmas, screened Coulomb potentials in metals, and hypothetical fifth forces in modified gravity theories. Any massive scalar or vector boson exchange produces this characteristic exponential envelope.</p>
`,

    'ref.axion.title': 'Axion-Like Scalar Field',
    'ref.axion.body': `
<p>The axion is a hypothetical particle originally proposed to solve the strong CP problem in quantum chromodynamics — the puzzle of why the strong force conserves CP symmetry despite having no reason to. It has since become a leading dark matter candidate.</p>

<h3>The Dynamical Field</h3>
<p>The axion field $a(\\mathbf{x},t)$ lives on a 64×64 grid (CPU) or 128×128 grid (GPU), governed by the Klein-Gordon equation with a quadratic potential:</p>
<p>$$\\frac{\\partial^2 a}{\\partial t^2} = \\nabla^2 a - m_a^2\\,a - \\gamma\\dot{a} + \\text{source}$$</p>
<p>The potential $V(a) = \\frac{1}{2}m_a^2 a^2$ has its minimum at $a=0$ — unlike the Higgs, there is no symmetry breaking. The field oscillates around zero with frequency $m_a$, exactly as cosmological axion dark matter does. Damping $g\\,m_a\\dot{a}$ gives $Q = 1/g$, so the resonant buildup exactly compensates the coupling strength ($g \\cdot Q = 1$). In nature, the axion oscillation is essentially undamped (cosmological damping comes only from Hubble friction $3H\\dot{a}$).</p>

<h3>Scalar Coupling to Electromagnetism</h3>
<p>The QCD axion's pseudoscalar coupling $a\\,F_{\\mu\\nu}\\tilde{F}^{\\mu\\nu} \\propto a\\,\\mathbf{E}\\cdot\\mathbf{B}$ vanishes identically in 2D, where $\\mathbf{E}$ lies in the plane and $\\mathbf{B}$ is perpendicular. Instead, this simulation uses the <em>scalar</em> coupling to the EM field invariant $F_{\\mu\\nu}F^{\\mu\\nu}$, which is non-zero in 2D and is physically motivated for axion-like particles (ALPs):</p>
<p>$$\\mathcal{L}_{\\text{int}} = -\\tfrac{1}{4}\\bigl(1 + g\\,a\\bigr)\\,F_{\\mu\\nu}F^{\\mu\\nu}$$</p>
<p>This makes the fine structure constant position-dependent:</p>
<p>$$\\alpha_{\\text{eff}}(\\mathbf{x}) = \\alpha\\left(1 + g\\,a(\\mathbf{x})\\right)$$</p>
<p>All electromagnetic forces — Coulomb, magnetic dipole, Biot-Savart — use the <em>local</em> coupling evaluated at each particle's position. Spatial variation in the field creates regions of stronger and weaker EM interaction.</p>

<h3>Source and Gradient Force (EM)</h3>
<p>From the $aF^2$ vertex, the axion field equation acquires a source proportional to the local EM field energy. For point charges, the dominant contribution is the Coulomb self-energy ($\\propto q^2$), which is what particles deposit via PQS (cubic B-spline) interpolation. The gradient force arises from the position-dependence of this self-energy in the axion background:</p>
<p>$$\\text{source}_{\\text{EM}} = g\\,q^2, \\qquad \\mathbf{F}_{\\text{EM}} = +g\\,q^2\\,\\nabla a$$</p>
<p>The coupling $g = 0.05$ compensates for the field's high quality factor ($Q = 1/g = 20$); in nature, $g \\sim \\alpha/f_a$ is fantastically small.</p>

<h3>Peccei–Quinn Mechanism (Yukawa Coupling)</h3>
<p>When the Yukawa potential is also enabled, the axion field additionally couples to the strong sector via the Peccei–Quinn mechanism. The interaction Lagrangian is the pseudoscalar analog of the $aF^2$ EM coupling:</p>
<p>$$\\mathcal{L}_{\\text{PQ}} = \\frac{a}{f_a}\\,\\frac{g_s^2}{32\\pi^2}\\,G_{\\mu\\nu}^a\\tilde{G}^{a\\mu\\nu}$$</p>
<p>In QCD this couples the axion to the gluon topological charge density $G\\tilde{G}$. In this simulation, the strong sector is modeled by the Yukawa potential, so the coupling acts on the Yukawa interaction strength instead. Unlike the scalar EM coupling (same for matter and antimatter), this is a <em>pseudoscalar</em> coupling that flips sign under CP conjugation — the key signature that distinguishes matter from antimatter:</p>
<p>$$\\text{source}_{\\text{PQ}} = \\pm g\\,m, \\qquad \\mathbf{F}_{\\text{PQ}} = \\pm g\\,m\\,\\nabla a$$</p>
<p>where $+$ is for matter and $-$ for antimatter. The Yukawa coupling is locally modulated:</p>
<p>$$g^2_{\\text{eff}} = g^2\\left(1 + ga\\right) \\text{ (matter)}, \\qquad g^2\\left(1 - ga\\right) \\text{ (antimatter)}$$</p>
<p>At the vacuum $a = 0$, both are identical — CP is conserved. This is the Peccei–Quinn solution to the strong CP problem: the axion field dynamically relaxes to zero, eliminating the CP-violating parameter $\\theta$. When the field is displaced from vacuum (by particle sources, field excitations, or initial conditions), matter and antimatter experience different nuclear binding strengths.</p>

<h3>Detection Experiments</h3>
<p>Several major experiments search for axion-photon conversion:</p>
<ul>
<li><b>ADMX</b>: a resonant microwave cavity that converts dark matter axions to photons in a strong magnetic field</li>
<li><b>ABRACADABRA</b>: searches for oscillating magnetic flux induced by the axion-photon coupling</li>
<li><b>CASPEr</b>: looks for oscillating nuclear spin precession driven by axion-nucleon interaction</li>
</ul>

<h3>Field Visualization</h3>
<p>The field overlay shows $a > 0$ in indigo and $a < 0$ in yellow, with opacity proportional to field amplitude. Watch how particles source field excitations that propagate outward, oscillating at frequency $m_a$. With Coulomb on, the field modulates local EM coupling. With Yukawa on, the Peccei–Quinn coupling creates CP-violating asymmetry between matter and antimatter.</p>
`,

    'ref.higgs.title': 'Higgs Scalar Field',
    'ref.higgs.body': `
<p>The Higgs mechanism is how elementary particles acquire mass. It is the only fundamental scalar field in the Standard Model, confirmed by the discovery of the Higgs boson at CERN in 2012 (mass 125 GeV/$c^2$).</p>

<h3>Mexican Hat Potential</h3>
<p>$$V(\\phi) = -\\frac{1}{2}\\mu^2\\phi^2 + \\frac{1}{4}\\lambda\\phi^4$$</p>
<p>This potential has a local maximum at $\\phi = 0$ and a ring of degenerate minima at the vacuum expectation value (VEV):</p>
<p>$$v = \\frac{\\mu}{\\sqrt{\\lambda}}$$</p>
<p>The field spontaneously "rolls" to $\\phi = v$, breaking the symmetry. In this simulation, $v = 1$.</p>

<h3>Lagrangian</h3>
<p>The Klein-Gordon Lagrangian with the Mexican hat potential:</p>
<p>$$\\mathcal{L} = \\frac{1}{2}\\dot{\\phi}^2 - \\frac{1}{2}|\\nabla\\phi|^2 + \\frac{1}{2}\\mu^2\\phi^2 - \\frac{1}{4}\\lambda\\phi^4$$</p>
<p>Small excitations around the VEV ($\\phi = v + h$) propagate as the Higgs boson, with mass $m_H = \\mu\\sqrt{2}$.</p>

<h3>Mass Generation</h3>
<p>Particles couple to the field via Yukawa-type terms. Their effective mass depends on the local field value:</p>
<p>$$m_{\\text{eff}} = m_0\\cdot|\\phi(\\mathbf{x})|$$</p>
<p>where $m_0$ is the bare coupling strength. When $\\phi = v = 1$ (the vacuum), particles have their full mass. When $\\phi \\to 0$ (symmetry restored), particles become effectively massless — they lose all inertia.</p>

<h3>Gradient Force</h3>
<p>Particles feel a force toward regions of higher field:</p>
<p>$$\\mathbf{F} = +g\\,m_0\\,\\nabla\\phi$$</p>
<p>This is the classical analog of the Higgs mechanism: particles are attracted toward regions of enhanced $\\phi$ sourced by other particles, producing an attractive scalar Yukawa interaction.</p>

<h3>Field Equation</h3>
<p>$$\\ddot{\\phi} = \\nabla^2\\phi + \\mu^2\\phi - \\lambda\\phi^3 + \\rho_{\\text{source}} - 2m_H\\dot{\\phi}$$</p>
<p>The source term $\\rho$ comes from particle deposition (cubic B-spline interpolation), and the damping term $2m_H\\dot{\\phi}$ provides critical damping. The field is evolved via Störmer-Verlet (kick-drift-kick).</p>

<h3>Electroweak Phase Transition</h3>
<p>At high temperatures, thermal corrections modify the effective potential:</p>
<p>$$\\mu^2_{\\text{eff}} = \\mu^2 - T^2_{\\text{local}}$$</p>
<p>When $T^2 > \\mu^2$, the minimum at $\\phi = v$ disappears — the only equilibrium is $\\phi = 0$. The symmetry is restored and particles lose their mass. This models the electroweak phase transition that occurred $\\sim 10^{-12}$ seconds after the Big Bang, when the universe cooled below $\\sim 160$ GeV.</p>

<h3>Field Energy</h3>
<p>$$E = \\int\\!\\left(\\frac{1}{2}\\dot{\\phi}^2 + \\frac{1}{2}|\\nabla\\phi|^2 + V(\\phi) - V(v)\\right)dA$$</p>
<p>The vacuum energy $V(v)$ is subtracted so the ground state carries zero field energy.</p>

<h3>The Mass Slider</h3>
<p>Controls $m_H$ (range 0.25–0.75). Smaller $m_H$ means a shallower potential well, longer interaction range ($\\sim 1/m_H$), and weaker restoring force — easier to displace from the VEV and trigger phase transitions.</p>
`,

    'ref.expansion.title': 'Cosmological Expansion',
    'ref.expansion.body': `
<p>The universe is expanding: distant galaxies recede from us at speeds proportional to their distance. This is Hubble's law, the observational cornerstone of modern cosmology.</p>

<h3>Hubble Flow</h3>
<p>$$\\mathbf{v}_H = H\\cdot\\mathbf{r}$$</p>
<p>where $H$ is the Hubble parameter and $\\mathbf{r}$ is measured from the domain center. Every particle acquires an outward drift proportional to its distance. This is not a force — it is the stretching of space itself.</p>

<h3>Hubble Drag (Cosmological Redshift)</h3>
<p>Peculiar velocities (motion relative to the Hubble flow) redshift over time:</p>
<p>$$\\mathbf{v}_{\\text{pec}} \\to \\mathbf{v}_{\\text{pec}}(1-H\\,dt)$$</p>
<p>A photon emitted by a distant galaxy arrives with a longer wavelength because space expanded while it was in transit. The same effect decelerates particles that are not bound together.</p>

<h3>Bound vs. Unbound Systems</h3>
<p>The key physical result: gravitationally bound systems resist expansion. A binary orbit where the binding energy exceeds the Hubble kinetic energy stays together, while unbound particles are swept apart.</p>
<p>This is exactly how large-scale cosmic structure forms — dense regions collapse under gravity while the expanding background carries diffuse matter apart, creating a cosmic web of galaxies, filaments, and voids.</p>

<h3>Limitations</h3>
<p>This implementation uses a constant $H$ (de Sitter expansion). The real universe has $H(t)$ that evolves with matter, radiation, and dark energy content. The simulation locks boundary mode to "despawn" when expansion is active, since periodic boundaries would conflict with the outward flow.</p>
`,

    'ref.disintegration.title': 'Disintegration & Roche Limit',
    'ref.disintegration.body': `
<p>A body approaching a more massive companion can be torn apart by tidal forces when the differential gravity across its diameter exceeds its own self-gravity. The critical distance at which this occurs is the Roche limit.</p>

<h3>Disintegration Criterion</h3>
<p>A particle fragments when combined disruptive stresses exceed self-binding:</p>
<p>$$\\underbrace{\\frac{M_{\\text{other}}\\cdot R}{d^3}}_{\\text{tidal}} + \\underbrace{\\omega^2 R}_{\\text{centrifugal}} + \\underbrace{\\frac{q^2}{4R^2}}_{\\text{Coulomb self-repulsion}} > \\underbrace{\\frac{m}{R^2}}_{\\text{self-gravity}}$$</p>
<p>Each term represents a different mechanism trying to tear the particle apart, balanced against the gravitational binding that holds it together.</p>

<h3>Roche Lobe Overflow</h3>
<p>Before catastrophic disruption, a particle can gradually transfer mass to its companion through the <em>Roche lobe</em> — the teardrop-shaped region around each body where its own gravity dominates. The lobe radius (Eggleton formula):</p>
<p>$$r_R \\approx 0.462\\,d\\left(\\frac{m}{m+M}\\right)^{1/3}$$</p>
<p>When a particle's radius exceeds $r_R$, surface material feels a stronger pull toward the companion and flows through the inner Lagrange point (L1) at a rate proportional to the overflow.</p>

<h3>Astrophysical Context</h3>
<p>Roche lobe overflow powers some of the most dramatic phenomena in astrophysics:</p>
<ul>
<li><b>Cataclysmic variables</b>: a white dwarf accreting from a red giant companion, sometimes detonating as a Type Ia supernova</li>
<li><b>X-ray binaries</b>: a neutron star or black hole accreting material heated to X-ray temperatures</li>
<li><b>Saturn's rings</b>: likely formed when a moon crossed inside Saturn's Roche limit and was torn apart by tidal forces</li>
</ul>
`,

    'ref.barneshut.title': 'Barnes-Hut Algorithm',
    'ref.barneshut.body': `
<p>Direct computation of all pairwise forces scales as $O(N^2)$ — doubling the particle count quadruples the work. The Barnes-Hut algorithm reduces this to $O(N\\log N)$ using a spatial tree, enabling simulations with hundreds of particles at interactive framerates.</p>

<h3>Quadtree Construction</h3>
<p>The domain is recursively subdivided into four quadrants. Each leaf holds at most 4 particles. Internal nodes store aggregate properties: total mass, total charge, center of mass, total magnetic moment, and total angular momentum.</p>

<h3>Opening Angle Criterion</h3>
<p>When computing the force on a particle, the tree is walked from the root. At each node:</p>
<p>$$\\frac{s}{d} < \\theta \\qquad (\\theta = 0.5)$$</p>
<p>If the cell size $s$ divided by the distance $d$ to the cell's center of mass is less than $\\theta$, the entire group is treated as a single body using its aggregate properties. Otherwise, the node is opened and its children examined.</p>

<h3>Accuracy vs. Performance</h3>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr><th style="text-align:left;padding:4px 8px">Mode</th><th style="text-align:left;padding:4px 8px">Scaling</th><th style="text-align:left;padding:4px 8px">Conservation</th></tr>
<tr><td style="padding:4px 8px">Pairwise (off)</td><td style="padding:4px 8px">$O(N^2)$</td><td style="padding:4px 8px">Machine precision</td></tr>
<tr><td style="padding:4px 8px">Barnes-Hut (on)</td><td style="padding:4px 8px">$O(N\\log N)$</td><td style="padding:4px 8px">Approximate</td></tr>
</table>
<p>With Barnes-Hut off, Newton's third law is exploited exactly (each pair computed once), so momentum and angular momentum are conserved to floating-point precision. With Barnes-Hut on, the asymmetric force evaluation breaks exact reciprocity, introducing small conservation drift.</p>

<h3>Implementation</h3>
<p>The tree uses a flat Structure-of-Arrays layout with pre-allocated typed arrays for zero garbage collection. Nodes are pooled and reset each substep rather than allocated and freed, keeping the per-substep tree rebuild fast and free of GC pauses.</p>
`,

    'ref.collision.title': 'Collision Modes',
    'ref.collision.body': `
<h3>Pass</h3>
<p>Particles move through each other freely — no collision detection. Useful for studying pure force dynamics without contact effects, or for maximizing performance with many particles.</p>

<h3>Bounce (Hertz Contact)</h3>
<p>Overlapping particles feel a repulsive contact force modeled by Hertz contact mechanics:</p>
<p>$$F = K\\,\\delta^{3/2}$$</p>
<p>where $\\delta$ is the overlap depth and $K$ is the stiffness. The 3/2 exponent comes from the elastic deformation of spheres — it produces a stiffer response at deeper overlaps, preventing excessive penetration. Tangential friction transfers angular momentum between spinning particles during contact.</p>

<h3>Merge (Inelastic Collision)</h3>
<p>Overlapping particles combine into a single particle, conserving:</p>
<ul>
<li><b>Mass</b>: $m = m_1 + m_2$</li>
<li><b>Charge</b>: $q = q_1 + q_2$</li>
<li><b>Momentum</b>: $m\\mathbf{w} = m_1\\mathbf{w}_1 + m_2\\mathbf{w}_2$</li>
<li><b>Angular momentum</b>: $I\\omega = I_1\\omega_1 + I_2\\omega_2 + \\text{orbital}$</li>
</ul>

<h3>Antimatter Annihilation</h3>
<p>When a matter and antimatter particle merge, the lesser mass is annihilated from both, converting rest mass energy $E = 2m_{\\text{annihilated}}$ into a burst of photons.</p>
`,

    'ref.boundary.title': 'Boundary Modes',
    'ref.boundary.body': `
<h3>Despawn</h3>
<p>Particles are removed when they leave the viewport. Models an open system where particles can escape to infinity. Required when cosmological expansion is active.</p>

<h3>Loop (Periodic Boundaries)</h3>
<p>Particles exiting one side re-enter from the opposite side, creating a topologically closed space. Forces use the <em>minimum image convention</em>: each particle interacts with the nearest copy (real or periodic ghost) of every other particle. Three topologies are available when using loop boundaries.</p>

<h3>Bounce (Elastic Walls)</h3>
<p>Walls exert Hertz contact repulsion on approaching particles:</p>
<p>$$F = K\\,\\delta^{3/2}$$</p>
<p>where $\\delta$ is the depth of wall penetration. Tangential friction from wall sliding transfers torque to spinning particles, gradually slowing their rotation. Creates a bounded billiard-like domain.</p>
`,

    'ref.topology.title': 'Surface Topology',
    'ref.topology.body': `
<p>When boundaries are set to "Loop," the simulation domain becomes a closed 2D surface. The choice of topology determines how the edges are identified — and whether the space is orientable.</p>

<h3>Torus ($T^2$)</h3>
<p>Both pairs of edges wrap normally: right$\\leftrightarrow$left, top$\\leftrightarrow$bottom. The familiar "Pac-Man" topology. The torus is orientable — a clockwise-spinning particle remains clockwise after wrapping. Forces use the minimum image convention.</p>

<h3>Klein Bottle ($K^2$)</h3>
<p>The x-axis wraps normally, but the y-axis wraps with a reflection: exiting the top re-enters from the bottom with x-coordinate mirrored and horizontal velocity reversed. The Klein bottle is <em>non-orientable</em> — a clockwise-spinning particle becomes counterclockwise after a y-boundary crossing. This surface cannot be embedded in 3D without self-intersection.</p>

<h3>Real Projective Plane ($\\mathbb{RP}^2$)</h3>
<p>Both axes wrap with a perpendicular flip — each crossing reverses the perpendicular velocity component and reflects the perpendicular coordinate. $\\mathbb{RP}^2$ is the most exotic topology: non-orientable, and the only closed 2D surface where <em>every non-contractible</em> loop is orientation-reversing. Force computation requires checking 4 minimum-image candidates.</p>
`,

    'ref.external.title': 'External Background Fields',
    'ref.external.body': `
<p>Uniform fields that pervade the entire domain, acting on every particle independently of the particle-particle force toggles.</p>

<h3>Uniform Gravitational Field</h3>
<p>$$\\mathbf{F} = m\\mathbf{g}$$</p>
<p>All particles experience the same acceleration $\\mathbf{g}$ regardless of mass — the equivalence principle in action. Direction is set in degrees (0$^\\circ$ = right, 90$^\\circ$ = down). Models surface gravity, projectile motion, or any uniform gravitational environment.</p>

<h3>Uniform Electric Field</h3>
<p>$$\\mathbf{F} = q\\mathbf{E}$$</p>
<p>Accelerates particles proportional to their charge. Opposite charges deflect in opposite directions, enabling beam separation and drift velocity experiments. Neutral particles are unaffected.</p>

<h3>Uniform Magnetic Field ($B_z$)</h3>
<p>An out-of-plane magnetic field produces cyclotron motion:</p>
<p>$$\\omega_c = \\frac{qB}{m}, \\qquad r_L = \\frac{mv_\\perp}{qB}$$</p>
<p>The Larmor radius $r_L$ grows with mass and speed; heavier or faster particles orbit in larger circles. The Boris integrator handles the rotation exactly, preserving kinetic energy through every gyration.</p>

<h3>$\\mathbf{E}\\times\\mathbf{B}$ Drift</h3>
<p>Combining electric and magnetic fields produces a drift perpendicular to both: all particles drift at speed $E/B$ regardless of charge or mass. This is a fundamental result of plasma physics, responsible for particle confinement in tokamaks and the dynamics of the magnetosphere.</p>
`,

    'ref.spin.title': 'Particle Spin',
    'ref.spin.body': `
<p>Each particle rotates as a uniform-density solid sphere with moment of inertia:</p>
<p>$$I = \\frac{2}{5}mr^2$$</p>
<p>The spin slider sets the angular celerity $W$ (range $-0.99$ to $+0.99$). Positive values mean clockwise rotation.</p>

<h3>Relativistic Spin</h3>
<p>Angular celerity maps to angular velocity:</p>
<p>$$\\omega = \\frac{W}{\\sqrt{1+W^2 r^2}}$$</p>
<p>This guarantees $|\\omega|r < c$, preventing unphysical surface speeds even at extreme spin values. At low spin, $\\omega \\approx W$.</p>

<h3>Derived Quantities</h3>
<p>Spin determines two important physical properties:</p>
<ul>
<li><b>Magnetic moment</b>: $\\mu = q\\omega r^2/5$ — the source of magnetic dipole interactions</li>
<li><b>Angular momentum</b>: $L = 2m\\omega r^2/5$ — the source of gravitomagnetic dipole interactions</li>
</ul>
<p>Spin evolves dynamically under torques from tidal locking, frame dragging, and spin-orbit energy transfer.</p>
`,

    'ref.charge.title': 'Charge & Quantization',
    'ref.charge.body': `
<p>The charge slider sets the electric charge of newly placed particles. Charge determines the strength of Coulomb and magnetic interactions, and is one of the three quantities (mass, charge, spin) that fully characterize a black hole.</p>

<h3>Quantization</h3>
<p>All charges are quantized in units of the <b>boson charge</b> $e$ (default 0.1). Particle charges are rounded to the nearest multiple of $e$ on creation. Every charge-transfer process — pion emission, lepton pair production, Schwinger discharge, disintegration — conserves charge in discrete $\\pm e$ increments.</p>

<h3>Consequences</h3>
<p>Quantization means a black hole cannot shed an arbitrary fraction of its charge. Schwinger discharge removes exactly $e$ per event, so a BH with charge $Q$ requires $|Q|/e$ discharge events to reach neutrality. Pion emission similarly transfers $\\pm e$ or $0$ (neutral pion). This discreteness prevents continuous charge drift and makes conservation exact up to floating-point precision.</p>

<h3>Annihilation</h3>
<p>Opposite-charge pions ($\\pi^+\\pi^-$) annihilate into photon pairs when they collide. Neutral pions are identified by $|q| < \\epsilon$ rather than exact zero, accommodating floating-point rounding.</p>
`,

    'ref.energy.title': 'Energy Conservation',
    'ref.energy.body': `
<p>Total energy is tracked as the sum of five components:</p>
<ul>
<li><b>Linear KE</b>: $\\sum_i(\\gamma_i-1)m_i$ — relativistic translational kinetic energy</li>
<li><b>Spin KE</b>: $\\sum_i\\frac{1}{2}I_i\\omega_i^2$ — rotational kinetic energy</li>
<li><b>Potential</b>: gravitational + Coulomb + magnetic/GM dipole + 1PN corrections + Yukawa</li>
<li><b>Field</b>: Darwin velocity-dependent corrections at $O(v^2/c^2)$</li>
<li><b>Radiated</b>: cumulative energy carried away by photons and gravitons</li>
</ul>

<h3>Conservation Quality</h3>
<p>Energy is exactly conserved (to machine precision) with gravity + Coulomb only, in pairwise mode. Additional forces affect conservation differently:</p>
<ul>
<li><b>Magnetic / GM</b>: velocity-dependent forces carry energy in fields not fully modeled — small drift expected</li>
<li><b>Radiation</b>: energy leaves the system (tracked in the "Radiated" line)</li>
<li><b>Barnes-Hut</b>: approximate force evaluation breaks exact symmetry — small drift</li>
<li><b>Axion</b>: external oscillating field injects and extracts energy — no conservation expected</li>
<li><b>Expansion</b>: Hubble drag dissipates peculiar kinetic energy — no conservation expected</li>
</ul>
<p>The "Drift" line tracks cumulative numerical error as a percentage of the initial total energy, giving a real-time measure of simulation accuracy.</p>
`,

    'ref.pion.title': 'Pion Exchange (Yukawa Force Carriers)',
    'ref.pion.body': `
<p>The Yukawa potential was proposed in 1935 by Hideki Yukawa, who predicted that the short-range nuclear force must be mediated by a massive particle — the <b>pion</b>. In this simulation, pions are emitted automatically during Yukawa interactions as massive force carriers, analogous to how photons mediate electromagnetic radiation.</p>

<h3>Emission: Scalar Larmor Radiation</h3>
<p>A particle accelerating under the Yukawa force radiates pions with power:</p>
<p>$$P = \\frac{1}{3}\\,g^2 m^2 a^2 = \\frac{1}{3}\\,g^2 F_{\\text{Yuk}}^2$$</p>
<p>The scalar charge is $Q = gm$ (since the Yukawa coupling is proportional to mass), so $Q^2 a^2 = g^2 m^2 (F/m)^2 = g^2 F^2$. The factor of $\\frac{1}{3}$ comes from integrating the $\\cos^2\\theta$ angular pattern of spin-0 radiation over the sphere — compared to $\\frac{2}{3}$ for the $\\sin^2\\theta$ dipole pattern of spin-1 (EM) Larmor radiation. The ratio $1:2$ reflects the single polarization state of a scalar vs. two for a photon.</p>

<h3>Pion Mass</h3>
<p>The pion rest mass equals the Yukawa range parameter $\\mu$:</p>
<p>$$m_\\pi = \\mu, \\qquad V(r) = -g^2 \\frac{e^{-\\mu r}}{r}$$</p>
<p>This is Yukawa's key insight: the range of the force ($\\sim 1/\\mu$) is inversely proportional to the mediator mass. Heavier pions mean shorter-range forces.</p>

<h3>Kinematics</h3>
<p>Unlike massless photons ($|v| = c$), pions travel at $v < c$ using proper velocity:</p>
<p>$$\\mathbf{v} = \\frac{\\mathbf{w}}{\\sqrt{1 + w^2}}$$</p>
<p>Gravitational deflection uses the massive-particle geodesic factor $(1 + v^2)$, which correctly reduces to $2\\times$ (null geodesic) as $v \\to c$ and $1\\times$ (Newtonian) as $v \\to 0$.</p>

<h3>Decay</h3>
<p>Pions decay after a finite lifetime. Neutral pions decay faster than charged pions (half-life 32 vs 64), reflecting the electromagnetic vs weak decay channels:</p>
<ul>
<li>$\\pi^0 \\to 2\\gamma$ — two photons emitted back-to-back in the rest frame, Lorentz-boosted to the lab</li>
<li>$\\pi^+ \\to e^+ + \\gamma$ — positron + photon (simplified from $\\mu^+\\nu_\\mu$)</li>
<li>$\\pi^- \\to e^- + \\gamma$ — electron + photon (simplified from $\\mu^-\\bar{\\nu}_\\mu$)</li>
</ul>
<p>Charged pion decay uses exact two-body kinematics: in the rest frame, the electron/positron and photon share the pion rest energy with back-to-back momenta, then both are Lorentz-boosted to the lab frame.</p>

<h3>Radiation Reaction</h3>
<p>When a pion is emitted, the emitting particle's kinetic energy is reduced by the pion's total energy (rest mass + kinetic). This prevents double-counting: the Yukawa force is already computed directly between particles, so the pion emission represents the radiation channel only.</p>
`,

    'ref.fieldExcitation.title': 'Scalar Field Dynamics',
    'ref.fieldExcitation.body': `
<p>When particles merge, kinetic energy lost in the inelastic collision excites the active scalar fields (Higgs and/or Axion). These excitations propagate as wave packets — the simulation's analog of <b>Higgs bosons</b> and <b>axion particles</b>.</p>

<h3>Mechanism</h3>
<p>The kinetic energy before and after an inelastic merge determines the excitation energy:</p>
<p>$$\\Delta E = \\text{KE}_{\\text{before}} - \\text{KE}_{\\text{after}}$$</p>
<p>This energy is deposited as a Gaussian bump in the field's time derivative $\\dot{\\phi}$ (or $\\dot{a}$):</p>
<p>$$\\dot{\\phi}(\\mathbf{x}) \\mathrel{+}= A \\exp\\!\\left(-\\frac{|\\mathbf{x} - \\mathbf{x}_0|^2}{2\\sigma^2}\\right)$$</p>
<p>where $A = 0.5\\sqrt{\\Delta E}$ and $\\sigma = 2$ grid cells. The existing Klein-Gordon wave equation then propagates the excitation naturally.</p>

<h3>Higgs Boson Analog</h3>
<p>When the Higgs field is active, merge energy creates oscillations around the vacuum expectation value $\\langle\\phi\\rangle = 1$. These ripples are the 2D analog of the Higgs boson — excitations of the field that gives particles their mass. The Mexican hat potential:</p>
<p>$$V(\\phi) = -\\frac{1}{2}\\mu^2\\phi^2 + \\frac{1}{4}\\lambda\\phi^4$$</p>
<p>determines the oscillation frequency: $\\omega = m_H = \\mu\\sqrt{2}$.</p>

<h3>Axion Particle Analog</h3>
<p>When the Axion field is active, merge energy creates oscillations around the vacuum $\\langle a \\rangle = 0$. These propagating wave packets are the simulation's analog of axion particles — quanta of the axion-like scalar field. The quadratic potential:</p>
<p>$$V(a) = \\frac{1}{2}m_a^2 a^2$$</p>
<p>gives simple harmonic oscillation at frequency $\\omega = m_a$.</p>

<h3>Physical Motivation</h3>
<p>In quantum field theory, particles <em>are</em> field excitations. The Higgs boson discovered at the LHC in 2012 is a quantum of the Higgs field; axions (if they exist) would be quanta of an axion-like field. This simulation captures the classical wave analog: localized disturbances that propagate, disperse, and interact with particles through the same coupling that governs the background field.</p>

<h3>Higgs Portal Coupling</h3>
<p>When both the Higgs and Axion fields are active, they interact through a <b>portal coupling</b>:</p>
<p>$$V_{\\text{portal}} = \\tfrac{1}{2}\\lambda\\,\\phi^2 a^2$$</p>
<p>This gauge-invariant quartic interaction is one of the most natural ways for an axion-like particle to couple to the Standard Model Higgs. It produces two effects:</p>
<ul>
<li><b>Axion effective mass shift</b>: The Higgs VEV contributes to the axion mass — $m_{a,\\text{eff}}^2 = m_a^2 + \\lambda\\langle\\phi\\rangle^2$. During a Higgs phase transition ($\\langle\\phi\\rangle \\to 0$), the axion becomes lighter.</li>
<li><b>Energy transfer</b>: Oscillations in one field can pump energy into the other, visible as correlated wave patterns in both field overlays.</li>
</ul>
<p>The coupling constant $\\lambda = 0.01$ is fixed. The portal energy contributes to total energy conservation.</p>

<h3>Field Gravity</h3>
<p>When gravity is enabled, the scalar field's energy density gravitates — just as all forms of energy curve spacetime in general relativity.</p>

<h4>Energy Density</h4>
<p>Each grid cell carries energy density from kinetic, gradient, and potential contributions:</p>
<p>$$\\rho = \\frac{1}{2}\\dot{\\phi}^2 + \\frac{1}{2}|\\nabla\\phi|^2 + V(\\phi)$$</p>
<p>At vacuum ($\\phi = v$), all three terms vanish — only field excitations gravitate.</p>

<h4>Particle–Field Gravity</h4>
<p>Each grid cell acts as a point mass $\\rho\\,dA$ that attracts particles via Newtonian gravity:</p>
<p>$$\\mathbf{F} = m\\sum_j \\frac{\\rho_j\\,dA}{r_j^2}\\,\\hat{r}_j$$</p>
<p>This is a direct $O(N \\times G^2)$ summation over all grid cells ($G$ = 64 on CPU, 128 on GPU), using the same Plummer softening as particle–particle gravity. Topology-aware for periodic boundaries.</p>

<h4>Field Self-Gravity</h4>
<p>The field's own energy density curves the local geometry, modifying its wave equation. In the weak-field limit ($|\\Phi| \\ll 1$), the Klein-Gordon equation gains GR corrections:</p>
<p>$$\\ddot{\\phi} = (1 + 4\\Phi)\\,\\nabla^2\\phi + 2\\,\\nabla\\Phi \\cdot \\nabla\\phi - (1 + 2\\Phi)\\,V'(\\phi)$$</p>
<p>where $\\Phi$ is the Newtonian gravitational potential sourced by $\\rho$. The three correction terms represent:</p>
<ul>
<li>$4\\Phi\\,\\nabla^2\\phi$ — spatial curvature modifying wave propagation speed</li>
<li>$2\\,\\nabla\\Phi \\cdot \\nabla\\phi$ — gravitational lensing of the field gradient</li>
<li>$2\\Phi\\,V'(\\phi)$ — redshift of the potential's restoring force</li>
</ul>
<p>The potential $\\Phi$ is computed via FFT convolution with the Green's function $G(r) = -1/\\sqrt{r^2 + \\varepsilon^2}$ on the full field grid — $O(N^2 \\log N)$ via forward FFT, pointwise multiply in Fourier space, inverse FFT.</p>
`,

    'ref.conserved.title': 'Conserved Quantities',
    'ref.conserved.body': `
<h3>Linear Momentum</h3>
<p>$$\\mathbf{P} = \\sum_i m_i\\mathbf{w}_i + \\mathbf{P}_{\\text{field}} + \\mathbf{P}_{\\text{radiated}}$$</p>
<p>Conserved by Noether's theorem from translational symmetry of space. Particle momentum uses proper velocity $\\mathbf{w}$ (which reduces to $m\\mathbf{v}$ when relativity is off). Field and radiated contributions are tracked separately.</p>

<h3>Angular Momentum</h3>
<p>$$J = \\underbrace{\\sum_i\\mathbf{r}_i \\times m_i\\mathbf{w}_i}_{\\text{orbital}} + \\underbrace{\\sum_i I_i W_i}_{\\text{spin}}$$</p>
<p>Conserved from rotational symmetry of space. Computed about the center of mass. Tidal locking, frame dragging, and spin-orbit coupling transfer angular momentum between orbital and spin reservoirs, but the total is preserved.</p>

<h3>When Conservation Breaks</h3>
<p>Velocity-dependent forces (magnetic, gravitomagnetic) carry momentum in electromagnetic and gravitomagnetic fields that the simulation doesn't fully track, producing small drift. This is a fundamental limitation of the particle-only approach — a full field theory would restore exact conservation. The drift percentage quantifies this effect.</p>
`,
};

const REF_JA = {
    'ref.gravity.title': 'ニュートン重力',
    'ref.gravity.body': `
<p>すべての質量を持つ粒子は、互いに引き合います。自然単位系 ($G = c = 1$) では、重力は最も単純な長距離力であり、宇宙の大規模構造を形づくる設計者です。</p>

<h3>ラグランジアン</h3>
<p>$$\\mathcal{L} = \\frac{1}{2}m v^2 + \\frac{m_1 m_2}{r}$$</p>
<p>ポテンシャル項が正であることは、粒子が近づくほど系全体のエネルギーが下がることを意味します — 系は自然と崩壊へ向かいます。</p>

<h3>力</h3>
<p>$$\\mathbf{F} = +\\frac{m_1 m_2}{r^2}\\,\\hat{r}$$</p>
<p>常に引力で、$1/r^2$ で減衰します — これは流束が球面上に広がることの幾何学的帰結です。プラマー軟化 ($r \\to \\sqrt{r^2 + \\epsilon^2}$, $\\epsilon^2 = 64$) により近接時の発散を防ぎます。</p>

<h3>ポテンシャルエネルギー</h3>
<p>$$V(r) = -\\frac{m_1 m_2}{r}$$</p>
<p>負で下に有界ではありません。全エネルギー $E = \\text{KE} + V$ が軌道の種類を決めます：</p>
<ul>
<li>$E < 0$：束縛軌道（楕円）</li>
<li>$E = 0$：放物線的脱出</li>
<li>$E > 0$：双曲線的フライバイ</li>
</ul>

<h3>ケプラー軌道</h3>
<p>質量 $M$ を周回する試験粒子は円錐曲線を描きます。円軌道では：</p>
<p>$$v_{\\text{circ}} = \\sqrt{\\frac{M}{r}}, \\qquad T = 2\\pi\\sqrt{\\frac{r^3}{M}}$$</p>
<p>これがケプラーの第三法則：軌道周期の2乗は半長軸の3乗に比例します。「軌道」生成モードはこの式から正確に円速度を割り当てます。</p>

<h3>脱出速度</h3>
<p>$$v_{\\text{esc}} = \\sqrt{\\frac{2M}{r}} = \\sqrt{2}\\,v_{\\text{circ}}$$</p>
<p>この速度で打ち出された粒子は全エネルギーがゼロで、戻ることなく無限遠へ向かいます。</p>

<h3>二体問題の換算</h3>
<p>互いに重力を及ぼし合う任意の二体は、換算質量 $\\mu = m_1 m_2/(m_1+m_2)$ を用いて等価な一体問題に帰着できます。相対座標はケプラー楕円を描きます。重力のみのペアワイズモードでは、エネルギーと角運動量は機械精度で保存されます。</p>

<h3>潮汐ロック</h3>
<p>潮汐ロックは天体の自転を公転と同期させ、常に同じ面を相手に向けるようにします。月は地球に対して潮汐ロックされています。</p>
<p>$$\\tau = -\\text{TIDAL\\_STRENGTH}\\cdot\\frac{C^2\\,R^5}{r^6}\\,(\\omega_{\\text{spin}}-\\omega_{\\text{orbit}})$$</p>
<p>結合 $C = m_{\\text{other}} + q_1 q_2/m$ は重力的・静電的な潮汐場を合わせたものです。$r^{-6}$ 依存性により、潮汐トルクは距離に極めて敏感です — 距離を半分にすると64倍になります。</p>
<p>非同期な天体には変位した潮汐バルジが生じ、その重力が自転と公転の間で角運動量を移すトルクを生みます：</p>
<ul>
<li>$\\omega_{\\text{spin}} > \\omega_{\\text{orbit}}$ のとき：自転は減速し、相手は外側へ押し出されます</li>
<li>$\\omega_{\\text{spin}} < \\omega_{\\text{orbit}}$ のとき：自転は加速し、相手は内側へ引き寄せられます</li>
</ul>
<p>平衡は $\\omega_{\\text{spin}} = \\omega_{\\text{orbit}}$：潮汐ロックです。$C^2$ 因子は重力－重力、重力－電磁、電磁－重力、電磁－電磁の交差項を含みます。重力がオンのとき常に有効です（独立トグルなし）。</p>
`,

    'ref.coulomb.title': 'クーロン力',
    'ref.coulomb.body': `
<p>荷電粒子間の静電気的相互作用 — 化学・電気・あらゆる原子の構造を司る力です。</p>

<h3>ラグランジアン</h3>
<p>$$\\mathcal{L} = \\frac{1}{2}m v^2 - \\frac{q_1 q_2}{r}$$</p>

<h3>力</h3>
<p>$$\\mathbf{F} = -\\frac{q_1 q_2}{r^2}\\,\\hat{r}$$</p>
<p>同符号 ($q_1 q_2 > 0$) は反発、異符号 ($q_1 q_2 < 0$) は引力。重力と同じ $1/r^2$ で減衰しますが、決定的な違いが2つあります：電荷には2つの符号があり、結合は遥かに強くなり得ます。</p>

<h3>ポテンシャルエネルギー</h3>
<p>$$V(r) = +\\frac{q_1 q_2}{r}$$</p>
<p>同符号で正（反発障壁）、異符号で負（引力井戸）。電子－陽子系はあらゆる距離で $V < 0$ となり、水素様の束縛軌道を作ります。</p>

<h3>古典的束縛状態</h3>
<p>重力とクーロンの両方を有効にすると、重く正の原子核が軽い負電荷を安定軌道に束縛できます。重力＋クーロンの引力と遠心力が釣り合う場所に有効ポテンシャルの極小が現れます。これは量子原子ではありませんが、軌道力学の本質を捉えています。</p>

<h3>遮蔽と中性</h3>
<p>重力（引力のみ）と異なり、異符号の電荷は打ち消し合います。正電荷と負電荷が等量ある系は遠方からは中性に見えます。電磁気が宇宙的スケールで支配的でない理由はここにあります — 質量は1符号しか持たない重力が支配します。</p>
`,

    'ref.magnetic.title': '磁気相互作用',
    'ref.magnetic.body': `
<p>磁気は運動する電荷から生じます。本シミュレーションでは2つの異なる機構をモデル化します：並進電荷によるローレンツ力と、自転電荷による双極子間相互作用です。</p>

<h3>ローレンツ力</h3>
<p>$$\\mathbf{F} = q\\,\\mathbf{v}\\times\\mathbf{B}$$</p>
<p>常に速度に垂直なため仕事をせず、軌道を曲げるだけです。一様磁場中では電荷は半径 $r_L = mv_\\perp/(qB)$ のサイクロトロン軌道を描きます。ボリス積分器はこの回転を厳密に処理し、ジャイレーションを通じてエネルギーを保存します。</p>

<h3>磁気双極子間相互作用</h3>
<p>$$\\mathbf{F}_{\\text{dipole}} = +\\frac{3\\mu_1\\mu_2}{r^4}\\,\\hat{r}$$</p>
<p>自転する電荷はモーメント $\\mu = qr^2\\omega/5$（一様球）の磁気双極子として振る舞います。双極子間力は $1/r^4$ （クーロンの $1/r^2$ より急峻）で、近距離でのみ支配的です。整列した双極子は引き合い、反整列は反発します。</p>

<h3>符号規約</h3>
<p>本シミュレーションは双極子間力に<em>正</em>の符号を採用しています。これは標準的な物理規約とは逆ですが、下記の重力磁気の場合と一致させるためです — 2種類の磁気で同じ符号にしておくと、GEM（重力電磁気）対応がきれいになります。</p>
`,

    'ref.gravitomag.title': '重力磁気',
    'ref.gravitomag.body': `
<p>一般相対論は質量の流れが磁場の重力的アナロジーを生むと予言します。電荷の運動が $\\mathbf{B}$ を生むように、質量の運動が $\\mathbf{B}_g$ を生む — これを<b>重力磁気</b>または<b>フレームドラッギング</b>と呼びます。</p>

<h3>フレームドラッギング</h3>
<p>自転する質量は、蜂蜜をかき混ぜるスプーンのように、周囲の時空を引きずり回します。地球近傍のジャイロスコープがこの効果でわずかに歳差運動することは、2011年の Gravity Probe B 実験で確認されました。</p>

<h3>重力磁気ローレンツ力</h3>
<p>$$\\mathbf{F} = +4m\\,\\mathbf{v}\\times\\mathbf{B}_g$$</p>
<p>係数 4 は線形化アインシュタイン方程式に由来し、電磁ローレンツ係数の2倍です。電磁ローレンツ力と同様、速度依存で直接には仕事をしません。</p>

<h3>重力磁気双極子間力</h3>
<p>$$\\mathbf{F} = +\\frac{3L_1 L_2}{r^4}\\,\\hat{r}$$</p>
<p>ここで $L = 2m r^2\\omega/5$ は自転球の角運動量です。同方向のスピン（共回転質量）は引き合い — 共回転すると反発するEM双極子と逆です。これがGEMの「符号反転」です。</p>

<h3>GEM 対応表</h3>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr><th style="text-align:left;padding:4px 8px">電磁気</th><th style="text-align:left;padding:4px 8px">重力電磁気 (GEM)</th></tr>
<tr><td style="padding:4px 8px">電荷 $q$</td><td style="padding:4px 8px">質量 $m$</td></tr>
<tr><td style="padding:4px 8px">磁気モーメント $\\mu = qr^2\\omega/5$</td><td style="padding:4px 8px">角運動量 $L = 2mr^2\\omega/5$</td></tr>
<tr><td style="padding:4px 8px">同方向の双極子は反発</td><td style="padding:4px 8px">同方向の双極子は引力</td></tr>
<tr><td style="padding:4px 8px">$\\mathbf{F}_L = q\\mathbf{v}\\times\\mathbf{B}$</td><td style="padding:4px 8px">$\\mathbf{F}_L = 4m\\mathbf{v}\\times\\mathbf{B}_g$</td></tr>
</table>
`,

    'ref.relativity.title': '特殊相対論',
    'ref.relativity.body': `
<p>粒子が光速の相当な割合で動くとき、ニュートン力学は破綻します。特殊相対論は速度を固有速度で置き換え、粒子が光速に到達することを防ぎます。</p>

<h3>固有速度</h3>
<p>$$\\mathbf{w} = \\gamma\\mathbf{v}, \\qquad \\gamma = \\frac{1}{\\sqrt{1-v^2}}$$</p>
<p>通常速度 $\\mathbf{v}$（$c$ で上限）と異なり、固有速度 $\\mathbf{w}$ には上限がありません。本シミュレーションは固有速度を主たる状態変数としています。</p>

<h3>変換</h3>
<p>$$\\mathbf{v} = \\frac{\\mathbf{w}}{\\sqrt{1+w^2}}, \\qquad \\gamma = \\sqrt{1+w^2}$$</p>
<p>これにより任意の $\\mathbf{w}$ で $|\\mathbf{v}| < 1$ が保証されます — 粒子は無限のエネルギーを持ち得ますが光速には到達しません。</p>

<h3>相対論的エネルギー</h3>
<p>$$E = \\gamma m, \\qquad \\text{KE} = (\\gamma - 1)m$$</p>
<p>低速では $\\text{KE} \\approx \\frac{1}{2}mv^2$（ニュートン極限）。高速では $v \\to c$ で $\\text{KE} \\to \\infty$ — これが、有限の力で粒子を光速まで加速できない理由です。</p>

<h3>信号遅延</h3>
<p>相対論を有効にすると、力は有限速度で伝播します：粒子は信号が放出された時点での発信源の位置に応答し、現在位置ではありません。シミュレーションは各粒子の履歴を探索し、$|\\mathbf{r}_i(t) - \\mathbf{r}_j(t')| = c(t-t')$ を満たす放出事象を見つけます。これにより光行差や重力／電磁ドップラー効果といった現象が自然に生じます。</p>

<h3>質量とエネルギーの等価性</h3>
<p>静止粒子のエネルギーは $E_0 = m$（$c=1$）。あらゆる形のエネルギーは応力エネルギーテンソルを通じて重力に寄与します — 放射光子も、運動エネルギーも、場のエネルギーも重力源です。シミュレーションはこれら全寄与をエネルギー保存のために追跡します。</p>
`,

    'ref.radiation.title': '放射',
    'ref.radiation.body': `
<p>加速する電荷は電磁波を、軌道運動する質量は重力波を放出します。いずれも系からエネルギーと運動量を持ち去り、軌道を減衰させます。3つの放射チャネルをモデル化しています。</p>

<h3>ラーモア双極子放射</h3>
<p>クーロンが必要。加速する電荷は次のパワーで放射します：</p>
<p>$$P = \\frac{2q^2}{3}a^2$$</p>
<p>放射元への反作用はランダウ＝リフシッツ力で、暴走解を避ける物理的に整合した代替（アブラハム＝ローレンツ力に対する）です：</p>
<p>$$\\mathbf{F}_{\\text{rad}} = \\tau\\left[\\frac{\\dot{\\mathbf{F}}}{\\gamma^3} - \\frac{\\mathbf{v}F^2}{m\\gamma^2} + \\frac{\\mathbf{F}(\\mathbf{v}\\cdot\\mathbf{F})}{m\\gamma^4}\\right]$$</p>
<p>ここで $\\tau = 2q^2/(3m)$ は放射時間スケールです。数値安定性のため、この力は外力の50%にクランプされます。放出光子は相対論的なビーミングを伴う双極子角分布に従います。</p>

<h3>EM 四重極放射</h3>
<p>クーロンが必要。電荷四重極モーメントが時間変化する系は次を放射します：</p>
<p>$$P_{\\text{EM}} = \\frac{1}{180}\\left|\\dddot{Q}_{ij}\\right|^2, \\qquad Q_{ij} = \\sum_k q_k\\, x_i^{(k)} x_j^{(k)}$$</p>
<p>これは双極子の次のマルチポール次数で、荷電連星系で重要となります。光子放出はリジェクションサンプリングで TT 投影された角分布を用います。</p>

<h3>重力波放射</h3>
<p>重力が必要。質量四重極公式 — 重力波の最低次源：</p>
<p>$$P_{\\text{GW}} = \\frac{1}{5}\\left|\\dddot{I}_{ij}\\right|^2, \\qquad I_{ij} = \\sum_k m_k\\left(x_i^{(k)} x_j^{(k)} - \\frac{\\delta_{ij}}{3}r_k^2\\right)$$</p>
<p>円軌道連星では、ピーターズの公式に帰着します：</p>
<p>$$P_{\\text{GW}} = \\frac{32}{5}\\frac{m_1^2 m_2^2(m_1+m_2)}{r^5}$$</p>
<p>急峻な $1/r^5$ 依存性により、軌道が縮むとパワーは劇的に増し、暴走的なインスパイラルを引き起こします。これがまさに LIGO が検出するもの：10億年に及ぶインスパイラルの最後の瞬間に、周波数が合体に向けてチャープ上昇する様子です。</p>

<h3>なぜ重力双極子はないのか</h3>
<p>重力双極子モーメント $\\sum m_i\\mathbf{x}_i$ は重心であり、運動量保存則により等速で動きます。時間変化する双極子がなければ双極子放射もありません — 重力波には少なくとも四重極が必要であり、本質的に電磁波より弱いものになります。</p>

<h3>エネルギー抽出</h3>
<p>放射エネルギーは、放射元の運動エネルギーから接線速度をスケールすることで取り出されます。放出光子（EM は黄色、重力子は赤）はエネルギーと運動量を運び、保存量計算のためシミュレーションで追跡されます。</p>
`,

    'ref.onepn.title': '1PN補正',
    'ref.onepn.body': `
<p>第1ポストニュートン補正は、一般相対論（あるいはその電磁版）を最低次を超えて展開した際に現れる $O(v^2/c^2)$ の項です。光速有限の効果が運動方程式に最初に現れる場面を捉えます。</p>

<h3>アインシュタイン＝インフェルト＝ホフマン (EIH) — 重力部門</h3>
<p>重力磁気が必要。1PN での EIH 運動方程式は有名な近日点歳差を生みます：</p>
<p>$$\\Delta\\phi = \\frac{6\\pi M}{a(1-e^2)} \\text{ rad/軌道}$$</p>
<p>水星では1世紀あたり 43 秒角となり — アインシュタインを一般相対論へ導いた異常です。本シミュレーションでは、ゆっくり回転する楕円として現れます。</p>
<p>1PN での完全な EIH 相互作用ラグランジアン：</p>
<p>$$\\mathcal{L}_{\\text{EIH}} = \\frac{m_1 m_2}{2r}\\!\\left[3(v_1^2\\!+\\!v_2^2) - 7\\,\\mathbf{v}_1\\!\\cdot\\!\\mathbf{v}_2 - (\\mathbf{v}_1\\!\\cdot\\!\\hat{r})(\\mathbf{v}_2\\!\\cdot\\!\\hat{r})\\right] + \\frac{m_1 m_2(m_1\\!+\\!m_2)}{2r^2}$$</p>
<p>結果として得られる力は、重力磁気ローレンツ部分（$B_{gz}$ によるボリス回転で扱われる）と、位置・速度に依存する直接項（1PN表示ベクトルへ蓄積される）に分解されます。</p>

<h3>ダーウィン EM — 電磁部門</h3>
<p>磁気が必要。$O(v^2/c^2)$ における2電荷ダーウィンラグランジアン：</p>
<p>$$\\mathcal{L}_{\\text{Darwin}} = -\\frac{q_1 q_2}{2r}\\!\\left[(\\mathbf{v}_1 \\!\\cdot\\! \\mathbf{v}_2) + (\\mathbf{v}_1 \\!\\cdot\\! \\hat{r})(\\mathbf{v}_2 \\!\\cdot\\! \\hat{r})\\right]$$</p>
<p>これはクーロン＋ローレンツを超える速度依存補正を加えます。原子内電子軌道を変調し、量子力学のブライト相互作用の古典版に相当します。</p>

<h3>バザンスキ交差項 — 重力EM混合部門</h3>
<p>重力磁気と磁気の両方が必要。1PN での重力EM混合相互作用ラグランジアン：</p>
<p>$$\\mathcal{L}_{\\text{Baz}} = -\\frac{q_1 q_2(m_1+m_2) - (q_1^2 m_2 + q_2^2 m_1)}{2r^2}$$</p>
<p>EIH やダーウィン項と異なり、このラグランジアンは速度依存性を持たず、純粋に位置依存の $1/r^2$ ポテンシャル補正です。同一粒子（$q_1 = q_2$ かつ $m_1 = m_2$）では消え、電磁的自己エネルギーへの重力補正およびその逆を表します。</p>

<h3>スカラー・ブライト — 湯川部門</h3>
<p>湯川が必要。質量を持つスカラー（スピン0）ボソン交換に対する $O(v^2/c^2)$ 相対論補正で、ブライト方程式から導かれます：</p>
<p>$$\\mathcal{L}_{\\text{Breit}} = \\frac{g^2 m_1 m_2\\,e^{-\\mu r}}{2r}\\left[\\mathbf{v}_1\\!\\cdot\\!\\mathbf{v}_2 + (\\hat{r}\\!\\cdot\\!\\mathbf{v}_1)(\\hat{r}\\!\\cdot\\!\\mathbf{v}_2)(1+\\mu r)\\right]$$</p>
<p>速度に対して双線形であるため、ルジャンドル変換により $H = L$ — ハミルトニアンとラグランジアンが数値的に同一になります。これは正（反発的）で、高速粒子に対して湯川の引力を弱めます。動径速度項にかかる $(1+\\mu r)$ 因子は質量を持つプロパゲータに由来します。EM（スピン1）交換と異なり、スカラー交換は磁気型の力を生まず — ボリス回転成分はありません。すべての補正は動径かつ速度依存で、動径成分・接線成分とも 1PN 表示ベクトルへ蓄積されます。</p>

<h3>積分スキーム</h3>
<p>4部門すべてにおいて速度ヴェルレ法を使用：1PN力をドリフト前と後に計算し、平均を適用することで2次精度を得ます。1PN 力は位置と速度の両方に依存するため、これが必要となります。</p>
`,

    'ref.blackhole.title': 'ブラックホールモード',
    'ref.blackhole.body': `
<p>有効にすると、各粒子はカー＝ニューマンBH — 回転し帯電した特異点が事象の地平面に囲まれたもの — として扱われます。これは一般相対論における最も一般的な定常BH解です。</p>

<h3>無毛定理</h3>
<p>BHは、質量 $M$、角運動量 $J$、電荷 $Q$ の3つの数だけで完全に特徴づけられます。形成した物質の他の情報はすべて地平面の彼方へ失われます。この定理は本シミュレーションの名前の由来です。</p>

<h3>カー＝ニューマン地平面</h3>
<p>外側事象の地平面の半径：</p>
<p>$$r_+ = M + \\sqrt{M^2 - a^2 - Q^2}$$</p>
<p>$a = J/M$ はスピンパラメータ。$M^2 \\geq a^2 + Q^2$ のときのみ地平面が存在します。これに違反すると裸の特異点が現れますが、宇宙検閲により禁じられています（シミュレーションは極限半径 $r_+ = M$ にクランプします）。</p>

<h3>エルゴ球</h3>
<p>地平面 $r_+$ と静止限界の間の領域：</p>
<p>$$r_{\\text{ergo}} = M + \\sqrt{M^2 - a^2}$$</p>
<p>エルゴ球の内側では時空が極めて強く引きずられ、何ものも静止できません — すべてはBHと共回転せざるを得ません。ペンローズ過程はこの領域を利用して回転エネルギーを抽出し、脱出する粒子の運動エネルギーへ変換できます。</p>

<h3>ホーキング放射</h3>
<p>地平面近傍の量子効果によりBHは熱的に放射します。温度は表面重力に依存します：</p>
<p>$$\\kappa = \\frac{\\sqrt{M^2 - a^2 - Q^2}}{2M\\,r_+}, \\qquad T = \\frac{\\kappa}{2\\pi}$$</p>
<p>放射パワーはステファン＝ボルツマンの法則に従います：</p>
<p>$$P = \\sigma T^4 A, \\qquad \\sigma = \\frac{\\pi^2}{60}, \\qquad A = 4\\pi(r_+^2+a^2)$$</p>
<p>小さなBHほど高温で放射が速く、暴走を生みます：質量減少 $\\to$ 温度上昇 $\\to$ 放射激化 $\\to$ 蒸発。最後の瞬間に光子バーストを放ちます。</p>

<h3>極限</h3>
<p>$M^2 = a^2 + Q^2$ のとき、内側と外側の地平面が合体し、表面重力が消え、温度はゼロまで下がります — BHは放射を止めます。極限BHは、質量と電荷に対して可能な最もコンパクトな天体で、宇宙検閲の限界を飽和します。</p>

<h3>シュウィンガー放電</h3>
<p>十分に帯電したBHは真空から電子陽電子対を引き剥がせるほど強い電場を生みます — <b>シュウィンガー効果</b>です。カー＝ニューマンBHにおける単位時間あたりのレート：</p>
<p>$$\\Gamma = \\frac{e^2 Q^2}{\\pi^2 \\Sigma}\\,\\exp\\!\\left(-\\frac{\\pi\\, E_{\\text{cr}}\\,\\Sigma}{|Q|}\\right), \\qquad \\Sigma = r_+^2 + a^2$$</p>
<p>ここで $e$ は素電荷、$E_{\\text{cr}} = m_e^2/e$ は臨界シュウィンガー電場、$\\Sigma$ はスピン補正を含むカー＝ニューマン地平面面積因子。指数抑制により $E \\approx E_{\\text{cr}}$ となるまでレートは無視できます（しきい値は $0.5\\,E_{\\text{cr}}$）。</p>
<p>脱出するレプトンは地平面の静電ポテンシャルから運動エネルギーを得ます：</p>
<p>$$\\text{KE} = e\\,\\Phi_H - m_e, \\qquad \\Phi_H = \\frac{|Q|\\,r_+}{r_+^2 + a^2}$$</p>
<p>各放電事象でBHの電荷は素電荷1単位、質量は $m_e$ 減少します。同符号レプトンは脱出し、反対符号は落下します。多数の事象を経て、帯電BHは中性へ向かい — 裸の特異点ではなく対生成を通じて宇宙検閲が実現されます。</p>
`,

    'ref.kugelblitz.title': 'クーゲルブリッツ崩壊',
    'ref.kugelblitz.body': `
<p><b>クーゲルブリッツ</b>は、放射エネルギーが重力崩壊を起こすほど密に集中したもので、純粋なエネルギーから質量物体が形成されます。これは質量とエネルギーの等価性の直接的帰結です：光子は重力源となり、十分多くの光子が十分小さな領域に集まれば自ら閉じ込められます。</p>

<h3>フープ予想</h3>
<p>崩壊のしきい値はソーンのフープ予想に従います。自然単位系 ($G = c = 1$) で、特性サイズ $r$ かつ全エネルギー $E$ の領域は次の条件で崩壊します：</p>
<p>$$E > \\frac{r}{2}$$</p>
<p>シミュレーションは集約後にボソンのバーンズ＝ハットツリーを走査して検出します。各ノードは部分木のボソン全エネルギー源とバウンディングボックスのサイズを保持。最小（最深）の閾値満足ノードから先に崩壊し、密なコアのみが満たすときに全ボソン群が一斉に崩壊することを防ぎます。</p>

<h3>崩壊の解決</h3>
<p>崩壊するノード内のすべての光子・パイオン・レプトンが消費され、エネルギー重み付き重心の単一の質量粒子に置き換えられます。生成粒子は次を継承します：</p>
<ul>
<li><b>質量</b> = ボソン全エネルギー（光子エネルギー＋質量を持つボソンの相対論的 $\\gamma m$）</li>
<li><b>運動量</b> = 消費された全ボソン運動量のベクトル和</li>
<li><b>電荷</b> = パイオン／レプトンの電荷の和（光子は寄与なし）</li>
<li><b>角運動量</b> = ボソン雲の重心まわりの軌道 $L$</li>
</ul>
<p>結果の粒子は通常の物理に従います — ブラックホールモードが独立に有効な場合のみBHになります。最低 4 ボソンかつ全エネルギー $\\geq 0.2$ が必要で、自明な崩壊を防ぎます。</p>

<h3>有効化</h3>
<p>クーゲルブリッツ崩壊は、<b>重力</b>と<b>ボソン相互作用</b>の両方が有効なときに常に作動します。独立トグルは不要です。</p>
`,

    'ref.spinorbit.title': 'スピン軌道結合',
    'ref.spinorbit.body': `
<p>スピン軌道結合は、粒子の並進運動と内在的な回転の間でエネルギーと運動量を移動させます。自転する粒子が非一様場中を動くたびに生じます。</p>

<h3>シュテルン＝ゲルラッハ力（電磁）</h3>
<p>非一様磁場中の磁気双極子は勾配力を受けます：</p>
<p>$$\\mathbf{F} = \\mu\\,\\nabla B_z$$</p>
<p>1922年の元となる実験で、シュテルンとゲルラッハは銀原子を不均一磁場に通し、ビームが離散的な成分に分裂することを観測しました — 角運動量量子化の最初の直接証拠です。本シミュレーションは古典版を示します：自転する荷電粒子はスピンの符号に応じて場の集中部へ／から偏向します。</p>

<h3>マティソン＝パパペトロウ力（重力）</h3>
<p>$$\\mathbf{F} = -L\\,\\nabla B_{gz}$$</p>
<p>反対符号（GEM 符号反転）は、自転する質量が、等価な場形状での自転電荷とは逆方向に偏向されることを意味します。この力は質量天体まわりの自転体に微妙な軌道補正を生み、パルサーの測地歳差などに現れます。</p>

<h3>スピン軌道エネルギー輸送</h3>
<p>場勾配の中を運動することで、軌道運動エネルギーとスピンの間でエネルギーが移ります：</p>
<p>$$\\frac{dE}{dt} = -\\mu(\\mathbf{v}\\cdot\\nabla B_z) \\quad \\text{(EM)}, \\qquad \\frac{dE}{dt} = -L(\\mathbf{v}\\cdot\\nabla B_{gz}) \\quad \\text{(GM)}$$</p>
<p>これにより粒子のスピンが加減速し、それに応じて軌道エネルギーが調整されることで、全エネルギーは保存されます。</p>

<h3>天体物理学的意義</h3>
<p>スピン軌道結合は連星パルサー系で決定的役割を果たします。高速自転する中性子星は重力的なスピン軌道効果（測地歳差）で歳差します。ハルス＝テイラー連星パルサーによるこれらの効果の測定は、一般相対論の初期の最強の確認の一つを提供しました。</p>
`,

    'ref.yukawa.title': '湯川ポテンシャル',
    'ref.yukawa.body': `
<p>1935年に湯川秀樹が、原子核内で陽子と中性子を束縛する強い核力を説明するために提唱しました。彼の鍵となる洞察：力が質量を持つ粒子により媒介されるなら、ポテンシャルは指数的なカットオフを持たねばならない。</p>

<h3>ラグランジアン</h3>
<p>$$\\mathcal{L} = \\frac{1}{2}mv^2 + \\frac{g^2\\,m_1 m_2\\,e^{-\\mu r}}{r}$$</p>

<h3>ポテンシャル</h3>
<p>$$V(r) = -\\frac{g^2\\,m_1 m_2\\,e^{-\\mu r}}{r}$$</p>
<p>遮蔽されたクーロン（または重力）ポテンシャル。結合 $g^2$ が強さを、媒介子質量 $\\mu$ が到達距離 $\\lambda = 1/\\mu$ を決めます。</p>

<h3>力</h3>
<p>$$\\mathbf{F} = -g^2 m_1 m_2\\,\\frac{e^{-\\mu r}}{r^2}(1+\\mu r)\\,\\hat{r}$$</p>
<p>$(1+\\mu r)$ 因子は $e^{-\\mu r}/r$ の微分に由来します。短距離 ($r \\ll 1/\\mu$) では指数因子はほぼ1で、力は重力的に見えます。長距離 ($r \\gg 1/\\mu$) では指数関数的に消えます。</p>

<h3>物理的解釈</h3>
<p>場の量子論ではあらゆる力が仮想粒子により媒介されます。媒介子の質量 $m$ は不確定性原理を介して到達距離を決めます：仮想粒子は時間 $\\Delta t \\sim \\hbar/(mc^2)$ 存在でき、最大 $c\\Delta t \\sim \\hbar/(mc) = 1/m$（自然単位系）まで進みます。これがコンプトン波長です。</p>
<ul>
<li><b>無質量媒介子</b> ($\\mu = 0$): 無限到達距離 $\\to$ $1/r$ ポテンシャル（重力・クーロン）に帰着</li>
<li><b>有質量媒介子</b> ($\\mu > 0$): 到達距離 $\\sim 1/\\mu$ $\\to$ 核力（パイオンで約 1 fm）</li>
</ul>
<p>質量 $\\sim 140$ MeV/$c^2$ のパイオンは到達距離 $\\sim 1.4$ fm を与え、観測される核束縛の到達距離と一致します。湯川はこのようにパイオンの存在を予言し — 1947年に実験で発見され、ノーベル賞を受賞しました。</p>

<h3>スカラー・ブライト補正</h3>
<p>1PN補正を有効にすると、湯川力は質量を持つスカラーボソン交換に対するブライト方程式由来の $O(v^2/c^2)$ 相対論補正を受けます。補正ラグランジアン：</p>
<p>$$\\delta\\mathcal{L} = \\frac{g^2 m_1 m_2\\,e^{-\\mu r}}{2r}\\left[\\mathbf{v}_1\\!\\cdot\\!\\mathbf{v}_2 + (\\hat{r}\\!\\cdot\\!\\mathbf{v}_1)(\\hat{r}\\!\\cdot\\!\\mathbf{v}_2)(1+\\mu r)\\right]$$</p>
<p>速度に双線形なため、$H = L$（ルジャンドル変換が表式を保つ）。これは正（反発）で、高速粒子に対する引力を弱めます。EMや重力と異なり、スカラー（スピン0）交換は磁気型の力を生まず — すべての補正は動径かつ速度依存です。動径速度項にかかる $(1+\\mu r)$ 因子は質量を持つプロパゲータに由来します。</p>
<p>結果の力は動径成分と接線成分の両方を持ち、1PN表示ベクトルへ蓄積されます。これら速度依存項の精度のため速度ヴェルレ補正が用いられます。</p>

<h3>核物理を超えて</h3>
<p>湯川型はあらゆる物理に現れます：プラズマのデバイ遮蔽、金属内の遮蔽クーロンポテンシャル、修正重力理論における仮想第五力など。あらゆる質量を持つスカラーまたはベクトルボソン交換が、この特徴的な指数包絡を生みます。</p>
`,

    'ref.axion.title': 'アクシオン様スカラー場',
    'ref.axion.body': `
<p>アクシオンはもともと、量子色力学における強いCP問題 — 強い力に CP を保存する理由がないにもかかわらず保存しているという謎 — を解くために提唱された仮想粒子です。以来、有力なダークマター候補となっています。</p>

<h3>動的場</h3>
<p>アクシオン場 $a(\\mathbf{x},t)$ は 64×64 格子（CPU）または 128×128 格子（GPU）上に存在し、二次ポテンシャルを持つクライン＝ゴルドン方程式に従います：</p>
<p>$$\\frac{\\partial^2 a}{\\partial t^2} = \\nabla^2 a - m_a^2\\,a - \\gamma\\dot{a} + \\text{源}$$</p>
<p>ポテンシャル $V(a) = \\frac{1}{2}m_a^2 a^2$ は $a=0$ で極小をとります — ヒッグスと違って対称性の破れはありません。場は周波数 $m_a$ で零点まわりに振動し、宇宙論的アクシオンダークマターと同様に振る舞います。減衰 $g\\,m_a\\dot{a}$ は $Q = 1/g$ を与え、共鳴的増幅が結合強度をちょうど補償します ($g \\cdot Q = 1$)。自然界ではアクシオンの振動は本質的に減衰しません（宇宙論的減衰はハッブル摩擦 $3H\\dot{a}$ のみ）。</p>

<h3>電磁気へのスカラー結合</h3>
<p>QCDアクシオンの擬スカラー結合 $a\\,F_{\\mu\\nu}\\tilde{F}^{\\mu\\nu} \\propto a\\,\\mathbf{E}\\cdot\\mathbf{B}$ は、$\\mathbf{E}$ が平面内、$\\mathbf{B}$ が垂直方向となる2次元では恒等的に消えます。代わりに本シミュレーションは、2次元で非ゼロでアクシオン様粒子 (ALP) として物理的に動機づけられる、EM 場不変量 $F_{\\mu\\nu}F^{\\mu\\nu}$ への<em>スカラー</em>結合を用います：</p>
<p>$$\\mathcal{L}_{\\text{int}} = -\\tfrac{1}{4}\\bigl(1 + g\\,a\\bigr)\\,F_{\\mu\\nu}F^{\\mu\\nu}$$</p>
<p>これにより微細構造定数が位置依存になります：</p>
<p>$$\\alpha_{\\text{eff}}(\\mathbf{x}) = \\alpha\\left(1 + g\\,a(\\mathbf{x})\\right)$$</p>
<p>すべての電磁力 — クーロン、磁気双極子、ビオ・サバール — は各粒子位置で評価された<em>局所</em>結合を用います。場の空間変化は、強弱の異なるEM相互作用領域を作り出します。</p>

<h3>源と勾配力 (EM)</h3>
<p>$aF^2$ 頂点から、アクシオン場方程式は局所 EM 場エネルギーに比例する源を獲得します。点電荷では支配的な寄与はクーロン自己エネルギー ($\\propto q^2$) で、粒子はこれを PQS（三次Bスプライン）補間で堆積します。勾配力はこの自己エネルギーがアクシオン背景中で位置依存になることから生じます：</p>
<p>$$\\text{源}_{\\text{EM}} = g\\,q^2, \\qquad \\mathbf{F}_{\\text{EM}} = +g\\,q^2\\,\\nabla a$$</p>
<p>結合 $g = 0.05$ は場の高い品質係数 ($Q = 1/g = 20$) を補償します。自然界では $g \\sim \\alpha/f_a$ は途方もなく小さいです。</p>

<h3>ペッチェイ＝クイン機構（湯川結合）</h3>
<p>湯川ポテンシャルも有効なとき、アクシオン場はペッチェイ＝クイン機構を介して強い部門にも結合します。相互作用ラグランジアンは $aF^2$ EM 結合の擬スカラー版です：</p>
<p>$$\\mathcal{L}_{\\text{PQ}} = \\frac{a}{f_a}\\,\\frac{g_s^2}{32\\pi^2}\\,G_{\\mu\\nu}^a\\tilde{G}^{a\\mu\\nu}$$</p>
<p>QCD ではアクシオンをグルーオンのトポロジカル電荷密度 $G\\tilde{G}$ に結合させます。本シミュレーションでは強い部門を湯川ポテンシャルでモデル化しているので、この結合は湯川相互作用強度に作用します。スカラーEM結合（物質と反物質で同じ）と異なり、これはCP共役で符号反転する<em>擬スカラー</em>結合 — 物質と反物質を区別する鍵となる兆候です：</p>
<p>$$\\text{源}_{\\text{PQ}} = \\pm g\\,m, \\qquad \\mathbf{F}_{\\text{PQ}} = \\pm g\\,m\\,\\nabla a$$</p>
<p>物質は $+$、反物質は $-$。湯川結合は局所的に変調されます：</p>
<p>$$g^2_{\\text{eff}} = g^2\\left(1 + ga\\right) \\text{ (物質)}, \\qquad g^2\\left(1 - ga\\right) \\text{ (反物質)}$$</p>
<p>真空 $a = 0$ では両者は同一 — CPは保存されます。これがペッチェイ＝クインの強いCP問題への解：アクシオン場は動的にゼロへ緩和し、CP破れパラメータ $\\theta$ を消去します。場が真空から変位したとき（粒子源、場の励起、初期条件により）、物質と反物質は異なる核束縛強度を経験します。</p>

<h3>検出実験</h3>
<p>アクシオン－光子変換を探す主要実験：</p>
<ul>
<li><b>ADMX</b>: 強磁場中でダークマター・アクシオンを光子に変換する共鳴マイクロ波空洞</li>
<li><b>ABRACADABRA</b>: アクシオン－光子結合により誘起される振動磁束を探索</li>
<li><b>CASPEr</b>: アクシオン－核子相互作用に駆動される振動核スピン歳差を探索</li>
</ul>

<h3>場の可視化</h3>
<p>場のオーバーレイは $a > 0$ をインディゴ、$a < 0$ を黄色で表示し、不透明度は場の振幅に比例します。粒子が場の励起を発生させ、$m_a$ で振動しながら外向きに伝播するさまを観察できます。クーロン有効時は場が局所EM結合を変調します。湯川有効時はペッチェイ＝クイン結合が物質と反物質の間にCP破れの非対称性を生みます。</p>
`,

    'ref.higgs.title': 'ヒッグス・スカラー場',
    'ref.higgs.body': `
<p>ヒッグス機構は素粒子が質量を獲得する仕組みです。標準模型における唯一の基本スカラー場で、2012年に CERN でヒッグス粒子の発見（質量 125 GeV/$c^2$）により確認されました。</p>

<h3>メキシカンハット型ポテンシャル</h3>
<p>$$V(\\phi) = -\\frac{1}{2}\\mu^2\\phi^2 + \\frac{1}{4}\\lambda\\phi^4$$</p>
<p>このポテンシャルは $\\phi = 0$ で局所的最大値を持ち、真空期待値 (VEV) で縮退した極小値の輪を持ちます：</p>
<p>$$v = \\frac{\\mu}{\\sqrt{\\lambda}}$$</p>
<p>場は $\\phi = v$ へ自発的に「転がり落ち」、対称性が破れます。本シミュレーションでは $v = 1$。</p>

<h3>ラグランジアン</h3>
<p>メキシカンハット型ポテンシャルを伴うクライン＝ゴルドン・ラグランジアン：</p>
<p>$$\\mathcal{L} = \\frac{1}{2}\\dot{\\phi}^2 - \\frac{1}{2}|\\nabla\\phi|^2 + \\frac{1}{2}\\mu^2\\phi^2 - \\frac{1}{4}\\lambda\\phi^4$$</p>
<p>VEV まわりの小さな励起 ($\\phi = v + h$) はヒッグス粒子として伝播し、質量は $m_H = \\mu\\sqrt{2}$。</p>

<h3>質量生成</h3>
<p>粒子は湯川型項を介して場と結合します。有効質量は局所的な場の値に依存します：</p>
<p>$$m_{\\text{eff}} = m_0\\cdot|\\phi(\\mathbf{x})|$$</p>
<p>$m_0$ は裸の結合強度。$\\phi = v = 1$（真空）のとき粒子は完全な質量を持ちます。$\\phi \\to 0$（対称性回復）で粒子は実質的に無質量となり — すべての慣性を失います。</p>

<h3>勾配力</h3>
<p>粒子は場が高い領域へ向かう力を受けます：</p>
<p>$$\\mathbf{F} = +g\\,m_0\\,\\nabla\\phi$$</p>
<p>これがヒッグス機構の古典版です：粒子は他の粒子が源となる $\\phi$ の増強領域へ引き寄せられ、引力的なスカラー湯川相互作用を生みます。</p>

<h3>場の方程式</h3>
<p>$$\\ddot{\\phi} = \\nabla^2\\phi + \\mu^2\\phi - \\lambda\\phi^3 + \\rho_{\\text{源}} - 2m_H\\dot{\\phi}$$</p>
<p>源項 $\\rho$ は粒子の堆積（三次Bスプライン補間）から、減衰項 $2m_H\\dot{\\phi}$ は臨界減衰を与えます。場はストーマー＝ヴェルレ法（kick-drift-kick）で時間発展します。</p>

<h3>電弱相転移</h3>
<p>高温では熱補正が有効ポテンシャルを変えます：</p>
<p>$$\\mu^2_{\\text{eff}} = \\mu^2 - T^2_{\\text{local}}$$</p>
<p>$T^2 > \\mu^2$ となると $\\phi = v$ の極小は消滅し — 唯一の平衡は $\\phi = 0$ となります。対称性が回復し粒子は質量を失います。これはビッグバン後 $\\sim 10^{-12}$ 秒で宇宙が $\\sim 160$ GeV を下回って冷却した際に起きた電弱相転移をモデル化したものです。</p>

<h3>場のエネルギー</h3>
<p>$$E = \\int\\!\\left(\\frac{1}{2}\\dot{\\phi}^2 + \\frac{1}{2}|\\nabla\\phi|^2 + V(\\phi) - V(v)\\right)dA$$</p>
<p>真空エネルギー $V(v)$ を引き、基底状態が場のエネルギーゼロになるようにしています。</p>

<h3>質量スライダー</h3>
<p>$m_H$ を制御します（範囲 0.25–0.75）。$m_H$ が小さいほどポテンシャル井戸が浅く、相互作用到達距離は長く ($\\sim 1/m_H$)、復元力も弱くなります — VEV から動かしやすく、相転移を引き起こしやすくなります。</p>
`,

    'ref.expansion.title': '宇宙膨張',
    'ref.expansion.body': `
<p>宇宙は膨張しています：遠方銀河は距離に比例した速度で我々から遠ざかっています。これがハッブルの法則 — 現代宇宙論の観測的礎石です。</p>

<h3>ハッブル流</h3>
<p>$$\\mathbf{v}_H = H\\cdot\\mathbf{r}$$</p>
<p>$H$ はハッブルパラメータ、$\\mathbf{r}$ は領域中心からの位置。すべての粒子は距離に比例した外向きドリフトを獲得します。これは力ではなく、空間そのものの伸長です。</p>

<h3>ハッブルドラッグ（宇宙論的赤方偏移）</h3>
<p>固有速度（ハッブル流に対する運動）は時間とともに赤方偏移します：</p>
<p>$$\\mathbf{v}_{\\text{pec}} \\to \\mathbf{v}_{\\text{pec}}(1-H\\,dt)$$</p>
<p>遠方銀河から放たれた光子は、伝搬中に空間が膨張するため、より長い波長で到着します。同じ効果が、束縛されていない粒子を減速させます。</p>

<h3>束縛系と非束縛系</h3>
<p>核心的な物理結果：重力的に束縛された系は膨張に抗います。束縛エネルギーがハッブル運動エネルギーを上回る連星軌道はまとまりを保ち、非束縛粒子は引き離されます。</p>
<p>これが大規模宇宙構造の形成の仕組みそのものです — 密な領域は重力で崩壊する一方、膨張する背景は希薄物質を引き離し、銀河・フィラメント・ボイドの宇宙ウェブを作ります。</p>

<h3>制約</h3>
<p>本実装は一定の $H$（ドジッター膨張）を用います。実際の宇宙では $H(t)$ が物質・放射・ダークエネルギー含有量とともに進化します。膨張が有効なときシミュレーションは境界モードを「消滅」に固定します — 周期境界は外向き流と矛盾するためです。</p>
`,

    'ref.disintegration.title': '分裂とロッシュ限界',
    'ref.disintegration.body': `
<p>より重い相手に近づく天体は、直径方向の重力差がその自己重力を超えると、潮汐力により引き裂かれます。これが起きる臨界距離がロッシュ限界です。</p>

<h3>分裂条件</h3>
<p>合計の破壊応力が自己束縛を超えると粒子は分裂します：</p>
<p>$$\\underbrace{\\frac{M_{\\text{other}}\\cdot R}{d^3}}_{\\text{潮汐}} + \\underbrace{\\omega^2 R}_{\\text{遠心}} + \\underbrace{\\frac{q^2}{4R^2}}_{\\text{クーロン自己反発}} > \\underbrace{\\frac{m}{R^2}}_{\\text{自己重力}}$$</p>
<p>各項は粒子を引き裂こうとする異なる機構を表し、束ねている重力束縛と釣り合います。</p>

<h3>ロッシュローブ・オーバーフロー</h3>
<p>致命的な破壊の前に、粒子は <em>ロッシュローブ</em> — 各天体の重力が支配する涙滴形領域 — を通じて徐々に質量を相手へ移すことがあります。ローブ半径（エグルトンの公式）：</p>
<p>$$r_R \\approx 0.462\\,d\\left(\\frac{m}{m+M}\\right)^{1/3}$$</p>
<p>粒子半径が $r_R$ を超えると、表面物質は相手側へより強く引かれ、内側のラグランジュ点 (L1) を通って溢れた量に比例した割合で流れます。</p>

<h3>天体物理学的文脈</h3>
<p>ロッシュローブ・オーバーフローは天体物理で最も劇的な現象のいくつかを駆動します：</p>
<ul>
<li><b>激変変光星</b>：白色矮星が赤色巨星の伴星から降着し、Ia型超新星として爆発することもある</li>
<li><b>X線連星</b>：中性子星またはBHがX線温度まで加熱された物質を降着</li>
<li><b>土星のリング</b>：おそらく衛星が土星のロッシュ限界内へ入り潮汐力で引き裂かれて形成された</li>
</ul>
`,

    'ref.barneshut.title': 'バーンズ＝ハットアルゴリズム',
    'ref.barneshut.body': `
<p>すべてのペア力を直接計算すると $O(N^2)$ — 粒子数を倍にすれば計算量は4倍になります。バーンズ＝ハット・アルゴリズムは空間ツリーを用いてこれを $O(N\\log N)$ に減らし、数百個の粒子でも対話的フレームレートのシミュレーションを可能にします。</p>

<h3>四分木の構築</h3>
<p>領域を再帰的に4象限へ分割します。各葉には最大4個の粒子。内部ノードは集約量を保持：全質量、全電荷、重心、全磁気モーメント、全角運動量。</p>

<h3>開き角基準</h3>
<p>粒子に働く力を計算する際、ツリーをルートから走査します。各ノードで：</p>
<p>$$\\frac{s}{d} < \\theta \\qquad (\\theta = 0.5)$$</p>
<p>セルサイズ $s$ をセル重心までの距離 $d$ で割った値が $\\theta$ より小さければ、群全体を集約量で1体として扱います。そうでなければノードを開いて子を調べます。</p>

<h3>精度と性能</h3>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr><th style="text-align:left;padding:4px 8px">モード</th><th style="text-align:left;padding:4px 8px">計算量</th><th style="text-align:left;padding:4px 8px">保存則</th></tr>
<tr><td style="padding:4px 8px">ペアワイズ（オフ）</td><td style="padding:4px 8px">$O(N^2)$</td><td style="padding:4px 8px">機械精度</td></tr>
<tr><td style="padding:4px 8px">バーンズ＝ハット（オン）</td><td style="padding:4px 8px">$O(N\\log N)$</td><td style="padding:4px 8px">近似</td></tr>
</table>
<p>バーンズ＝ハットがオフのときはニュートンの第3法則が厳密に活用され（各ペアを1度だけ計算）、運動量と角運動量は浮動小数点精度で保存されます。オンでは非対称な力評価が厳密な相反性を破り、わずかな保存則ドリフトを生みます。</p>

<h3>実装</h3>
<p>ツリーはガベージコレクション無しのフラットな Structure-of-Arrays レイアウトで、事前確保された型付き配列を用います。ノードはプールされ各サブステップでリセット — 確保／解放ではなく、毎サブステップのツリー再構築を高速かつGC停止なしに保ちます。</p>
`,

    'ref.collision.title': '衝突モード',
    'ref.collision.body': `
<h3>すり抜け</h3>
<p>粒子は互いを自由にすり抜けます — 衝突検出なし。接触効果なしの純粋な力学を調べたい場合、または多数粒子で性能を最大化したい場合に有用です。</p>

<h3>反発（ヘルツ接触）</h3>
<p>重なる粒子はヘルツ接触力学でモデル化された反発接触力を受けます：</p>
<p>$$F = K\\,\\delta^{3/2}$$</p>
<p>$\\delta$ は重なり深さ、$K$ は剛性。3/2 のべき指数は球の弾性変形に由来し — 深い重なりほど剛い応答を生み、過度な貫入を防ぎます。接線方向の摩擦は接触中の自転粒子の間で角運動量を移します。</p>

<h3>合体（非弾性衝突）</h3>
<p>重なる粒子は単一粒子に統合され、次が保存されます：</p>
<ul>
<li><b>質量</b>：$m = m_1 + m_2$</li>
<li><b>電荷</b>：$q = q_1 + q_2$</li>
<li><b>運動量</b>：$m\\mathbf{w} = m_1\\mathbf{w}_1 + m_2\\mathbf{w}_2$</li>
<li><b>角運動量</b>：$I\\omega = I_1\\omega_1 + I_2\\omega_2 + \\text{軌道}$</li>
</ul>

<h3>反物質対消滅</h3>
<p>物質と反物質の粒子が合体するとき、両者から少ない方の質量が消滅し、静止質量エネルギー $E = 2m_{\\text{消滅}}$ が光子バーストへ変換されます。</p>
`,

    'ref.boundary.title': '境界モード',
    'ref.boundary.body': `
<h3>消滅</h3>
<p>粒子はビューポートを離れると除去されます。粒子が無限遠へ脱出可能な開放系をモデル化。宇宙膨張が有効なときは必須です。</p>

<h3>ループ（周期境界）</h3>
<p>片側を出た粒子は反対側から再進入し、トポロジカルに閉じた空間を作ります。力は <em>最小像規約</em>を用います：各粒子は他のあらゆる粒子の最も近い複製（実体または周期的ゴースト）と相互作用します。ループ境界使用時は3つのトポロジーが選択可能です。</p>

<h3>反発（弾性壁）</h3>
<p>壁は接近する粒子にヘルツ接触反発を及ぼします：</p>
<p>$$F = K\\,\\delta^{3/2}$$</p>
<p>$\\delta$ は壁への貫入深さ。壁を滑る際の接線摩擦が自転粒子へトルクを移し、その回転を徐々に遅らせます。境界のあるビリヤード様の領域を作ります。</p>
`,

    'ref.topology.title': '面のトポロジー',
    'ref.topology.body': `
<p>境界が「ループ」のとき、シミュレーション領域は閉じた2次元曲面になります。トポロジーの選択により、辺の同一視の仕方 — そして空間が向き付け可能かどうか — が決まります。</p>

<h3>トーラス ($T^2$)</h3>
<p>両軸の辺対が通常通りラップします：右$\\leftrightarrow$左、上$\\leftrightarrow$下。おなじみの「パックマン」トポロジー。トーラスは向き付け可能 — 時計回りに自転する粒子はラップ後も時計回りのまま。力は最小像規約を用います。</p>

<h3>クライン壺 ($K^2$)</h3>
<p>x軸は通常ラップしますが、y軸は反射付きでラップします：上を出ると、x座標が反転し水平速度が反転して下から再進入します。クライン壺は<em>向き付け不可能</em> — 時計回りに自転する粒子はy境界横断後に反時計回りになります。この曲面は自己交差なしには3次元に埋め込めません。</p>

<h3>実射影平面 ($\\mathbb{RP}^2$)</h3>
<p>両軸が垂直方向の反転を伴ってラップします — 各横断は垂直速度成分を反転し、垂直座標を反射します。$\\mathbb{RP}^2$ は最も奇妙なトポロジー：向き付け不可能で、<em>あらゆる非可縮ループ</em>が向き反転を引き起こす唯一の閉2次元曲面です。力計算は4つの最小像候補をチェックする必要があります。</p>
`,

    'ref.external.title': '外部背景場',
    'ref.external.body': `
<p>領域全体に存在する一様場で、粒子間力のトグルとは独立にすべての粒子に作用します。</p>

<h3>一様重力場</h3>
<p>$$\\mathbf{F} = m\\mathbf{g}$$</p>
<p>すべての粒子は質量によらず同じ加速度 $\\mathbf{g}$ を経験します — 等価原理の実演です。方向は度数で指定します（0$^\\circ$ = 右、90$^\\circ$ = 下）。表面重力、放物運動、その他の一様重力環境をモデル化します。</p>

<h3>一様電場</h3>
<p>$$\\mathbf{F} = q\\mathbf{E}$$</p>
<p>電荷に比例して粒子を加速します。異符号の電荷は逆方向に偏向し、ビーム分離やドリフト速度実験を可能にします。中性粒子は影響を受けません。</p>

<h3>一様磁場 ($B_z$)</h3>
<p>面外向きの磁場はサイクロトロン運動を生みます：</p>
<p>$$\\omega_c = \\frac{qB}{m}, \\qquad r_L = \\frac{mv_\\perp}{qB}$$</p>
<p>ラーモア半径 $r_L$ は質量と速さとともに大きくなります。重い粒子や速い粒子はより大きな円を描きます。ボリス積分器は回転を厳密に処理し、ジャイレーションごとに運動エネルギーを保存します。</p>

<h3>$\\mathbf{E}\\times\\mathbf{B}$ ドリフト</h3>
<p>電場と磁場を組み合わせると両方に垂直なドリフトが生じます：すべての粒子は電荷や質量によらず速度 $E/B$ でドリフトします。これはプラズマ物理の基本結果で、トカマク内の粒子閉じ込めや磁気圏の力学に関わります。</p>
`,

    'ref.spin.title': '粒子のスピン',
    'ref.spin.body': `
<p>各粒子は次の慣性モーメントを持つ一様密度の剛体球として回転します：</p>
<p>$$I = \\frac{2}{5}mr^2$$</p>
<p>スピンスライダーは角速度パラメータ $W$ を設定します（範囲 $-0.99$ から $+0.99$）。正の値は時計回り。</p>

<h3>相対論的スピン</h3>
<p>角速度パラメータは角速度に対応します：</p>
<p>$$\\omega = \\frac{W}{\\sqrt{1+W^2 r^2}}$$</p>
<p>これにより極端なスピン値でも $|\\omega|r < c$ が保証され、非物理的な表面速度を防ぎます。低スピンでは $\\omega \\approx W$。</p>

<h3>派生量</h3>
<p>スピンは2つの重要な物理量を決定します：</p>
<ul>
<li><b>磁気モーメント</b>：$\\mu = q\\omega r^2/5$ — 磁気双極子相互作用の源</li>
<li><b>角運動量</b>：$L = 2m\\omega r^2/5$ — 重力磁気双極子相互作用の源</li>
</ul>
<p>スピンは潮汐ロック・フレームドラッギング・スピン軌道エネルギー輸送によるトルクの下で動的に変化します。</p>
`,

    'ref.charge.title': '電荷と量子化',
    'ref.charge.body': `
<p>電荷スライダーは新しく配置する粒子の電荷を設定します。電荷はクーロンと磁気相互作用の強さを決め、BHを完全に特徴づける3量（質量・電荷・スピン）の1つです。</p>

<h3>量子化</h3>
<p>すべての電荷は<b>ボソン電荷</b> $e$（既定値0.1）の単位で量子化されます。粒子電荷は生成時に最も近い $e$ の整数倍へ丸められます。すべての電荷移動過程 — パイオン放出、レプトン対生成、シュウィンガー放電、分裂 — は離散的な $\\pm e$ 増分で電荷を保存します。</p>

<h3>帰結</h3>
<p>量子化は、BHが任意の割合で電荷を放出できないことを意味します。シュウィンガー放電は1事象で正確に $e$ を取り除くので、電荷 $Q$ のBHが中性になるには $|Q|/e$ 回の放電事象が必要です。パイオン放出も同様に $\\pm e$ または $0$（中性パイオン）を移します。この離散性は連続的な電荷ドリフトを防ぎ、保存を浮動小数点精度で厳密にします。</p>

<h3>対消滅</h3>
<p>異符号パイオン ($\\pi^+\\pi^-$) は衝突時に光子対へ消滅します。中性パイオンは厳密ゼロではなく $|q| < \\epsilon$ で識別され、浮動小数点丸めに対応します。</p>
`,

    'ref.energy.title': 'エネルギー保存',
    'ref.energy.body': `
<p>全エネルギーは5成分の和として追跡されます：</p>
<ul>
<li><b>並進KE</b>：$\\sum_i(\\gamma_i-1)m_i$ — 相対論的並進運動エネルギー</li>
<li><b>スピンKE</b>：$\\sum_i\\frac{1}{2}I_i\\omega_i^2$ — 回転運動エネルギー</li>
<li><b>ポテンシャル</b>：重力 + クーロン + 磁気/重力磁気双極子 + 1PN補正 + 湯川</li>
<li><b>場</b>：$O(v^2/c^2)$ のダーウィン速度依存補正</li>
<li><b>放射</b>：光子と重力子により持ち去られた累積エネルギー</li>
</ul>

<h3>保存の質</h3>
<p>重力 + クーロンのみ・ペアワイズモードでは、エネルギーは厳密に保存されます（機械精度）。追加の力は保存に異なる影響を与えます：</p>
<ul>
<li><b>磁気 / 重力磁気</b>：速度依存力は完全にはモデル化されない場の中にエネルギーを運ぶ — 小さなドリフトが見込まれる</li>
<li><b>放射</b>：エネルギーが系を離れる（「放射」行で追跡）</li>
<li><b>バーンズ＝ハット</b>：近似的な力評価が厳密な対称性を破る — 小さなドリフト</li>
<li><b>アクシオン</b>：外部振動場がエネルギーを注入・抽出する — 保存は期待されない</li>
<li><b>宇宙膨張</b>：ハッブルドラッグが固有運動エネルギーを散逸する — 保存は期待されない</li>
</ul>
<p>「ドリフト」行は初期全エネルギーに対する累積数値誤差を百分率で追跡し、シミュレーション精度のリアルタイム指標となります。</p>
`,

    'ref.pion.title': 'パイオン交換（湯川力の媒介子）',
    'ref.pion.body': `
<p>湯川ポテンシャルは1935年に湯川秀樹が提唱し、短距離核力は質量を持つ粒子 — <b>パイオン</b> — により媒介されると予言しました。本シミュレーションでは、湯川相互作用の最中にパイオンが質量を持つ媒介子として自動的に放出されます。光子が電磁放射を媒介するのと類似です。</p>

<h3>放出：スカラー・ラーモア放射</h3>
<p>湯川力で加速する粒子は次のパワーでパイオンを放射します：</p>
<p>$$P = \\frac{1}{3}\\,g^2 m^2 a^2 = \\frac{1}{3}\\,g^2 F_{\\text{Yuk}}^2$$</p>
<p>スカラー電荷は $Q = gm$（湯川結合は質量に比例するため）で、$Q^2 a^2 = g^2 m^2 (F/m)^2 = g^2 F^2$。係数 $\\frac{1}{3}$ はスピン0放射の $\\cos^2\\theta$ 角分布を球面で積分した結果 — スピン1（EM）ラーモア放射の $\\sin^2\\theta$ 双極子分布の $\\frac{2}{3}$ と比較してください。$1:2$ の比は、スカラーの単一偏極状態と光子の2偏極状態を反映しています。</p>

<h3>パイオンの質量</h3>
<p>パイオンの静止質量は湯川到達距離パラメータ $\\mu$ に等しい：</p>
<p>$$m_\\pi = \\mu, \\qquad V(r) = -g^2 \\frac{e^{-\\mu r}}{r}$$</p>
<p>これが湯川の核心の洞察：力の到達距離 ($\\sim 1/\\mu$) は媒介子質量に反比例します。重いパイオンは短い到達距離を意味します。</p>

<h3>運動学</h3>
<p>無質量光子 ($|v| = c$) と異なり、パイオンは固有速度を用いて $v < c$ で進みます：</p>
<p>$$\\mathbf{v} = \\frac{\\mathbf{w}}{\\sqrt{1 + w^2}}$$</p>
<p>重力偏向は質量を持つ粒子の測地線因子 $(1 + v^2)$ を用い、$v \\to c$ で $2\\times$（光的測地線）、$v \\to 0$ で $1\\times$（ニュートン）に正しく帰着します。</p>

<h3>崩壊</h3>
<p>パイオンは有限寿命の後に崩壊します。中性パイオンは荷電パイオンより速く崩壊（半減期 32 vs 64）し、電磁チャネル対弱チャネルを反映します：</p>
<ul>
<li>$\\pi^0 \\to 2\\gamma$ — 静止系で背中合わせに放出された2光子をラボ系へローレンツブースト</li>
<li>$\\pi^+ \\to e^+ + \\gamma$ — 陽電子＋光子（$\\mu^+\\nu_\\mu$ から簡略化）</li>
<li>$\\pi^- \\to e^- + \\gamma$ — 電子＋光子（$\\mu^-\\bar{\\nu}_\\mu$ から簡略化）</li>
</ul>
<p>荷電パイオン崩壊は厳密な二体運動学を用います：静止系で電子／陽電子と光子はパイオン静止エネルギーを背中合わせの運動量で分け合い、両者ともラボ系へローレンツブーストされます。</p>

<h3>放射反作用</h3>
<p>パイオンが放出されると、放出元粒子の運動エネルギーはパイオンの全エネルギー（静止質量＋運動）の分だけ減ります。これは二重カウントを防ぎます：湯川力はすでに粒子間で直接計算されているので、パイオン放出は放射チャネルのみを表します。</p>
`,

    'ref.fieldExcitation.title': 'スカラー場の動力学',
    'ref.fieldExcitation.body': `
<p>粒子が合体する際、非弾性衝突で失われる運動エネルギーは活性なスカラー場（ヒッグス・アクシオン）を励起します。これらの励起は波束として伝播し — シミュレーションにおける<b>ヒッグスボソン</b>と<b>アクシオン粒子</b>に相当します。</p>

<h3>機構</h3>
<p>非弾性合体の前後の運動エネルギーが励起エネルギーを決めます：</p>
<p>$$\\Delta E = \\text{KE}_{\\text{前}} - \\text{KE}_{\\text{後}}$$</p>
<p>このエネルギーは場の時間導関数 $\\dot{\\phi}$（または $\\dot{a}$）にガウシアン状の盛り上がりとして堆積されます：</p>
<p>$$\\dot{\\phi}(\\mathbf{x}) \\mathrel{+}= A \\exp\\!\\left(-\\frac{|\\mathbf{x} - \\mathbf{x}_0|^2}{2\\sigma^2}\\right)$$</p>
<p>$A = 0.5\\sqrt{\\Delta E}$、$\\sigma = 2$ グリッドセル。既存のクライン＝ゴルドン波動方程式が励起を自然に伝播させます。</p>

<h3>ヒッグスボソンのアナロジー</h3>
<p>ヒッグス場が活性なとき、合体エネルギーは真空期待値 $\\langle\\phi\\rangle = 1$ まわりの振動を生みます。これらの波紋は2次元におけるヒッグスボソンのアナログ — 粒子に質量を与える場の励起です。メキシカンハット型ポテンシャル：</p>
<p>$$V(\\phi) = -\\frac{1}{2}\\mu^2\\phi^2 + \\frac{1}{4}\\lambda\\phi^4$$</p>
<p>が振動周波数を決めます：$\\omega = m_H = \\mu\\sqrt{2}$。</p>

<h3>アクシオン粒子のアナロジー</h3>
<p>アクシオン場が活性なとき、合体エネルギーは真空 $\\langle a \\rangle = 0$ まわりの振動を生みます。これらの伝播波束はアクシオン粒子のシミュレーション版 — アクシオン様スカラー場の量子です。二次ポテンシャル：</p>
<p>$$V(a) = \\frac{1}{2}m_a^2 a^2$$</p>
<p>は周波数 $\\omega = m_a$ の単振動を与えます。</p>

<h3>物理的動機</h3>
<p>場の量子論において粒子<em>とは</em>場の励起です。2012年にLHCで発見されたヒッグスボソンはヒッグス場の量子で、アクシオン（存在するならば）はアクシオン様場の量子となります。本シミュレーションはこの古典波アナログを捉えています：局在化した擾乱が伝播し、分散し、背景場を支配する同じ結合を介して粒子と相互作用します。</p>

<h3>ヒッグス・ポータル結合</h3>
<p>ヒッグスとアクシオン両方の場が活性なとき、両者は<b>ポータル結合</b>を介して相互作用します：</p>
<p>$$V_{\\text{portal}} = \\tfrac{1}{2}\\lambda\\,\\phi^2 a^2$$</p>
<p>このゲージ不変な4次相互作用は、アクシオン様粒子が標準模型ヒッグスに結合する最も自然な方法の一つです。2つの効果を生みます：</p>
<ul>
<li><b>アクシオンの有効質量シフト</b>：ヒッグスVEVがアクシオン質量に寄与 — $m_{a,\\text{eff}}^2 = m_a^2 + \\lambda\\langle\\phi\\rangle^2$。ヒッグス相転移時 ($\\langle\\phi\\rangle \\to 0$)、アクシオンは軽くなります。</li>
<li><b>エネルギー輸送</b>：一方の場の振動が他方にエネルギーを送り込み、両方の場のオーバーレイで相関した波形として可視化されます。</li>
</ul>
<p>結合定数 $\\lambda = 0.01$ は固定。ポータルエネルギーは全エネルギー保存に寄与します。</p>

<h3>場の重力</h3>
<p>重力が有効なとき、スカラー場のエネルギー密度は重力源となります — 一般相対論であらゆる形態のエネルギーが時空を曲げるのと同様です。</p>

<h4>エネルギー密度</h4>
<p>各グリッドセルは運動・勾配・ポテンシャルからのエネルギー密度を持ちます：</p>
<p>$$\\rho = \\frac{1}{2}\\dot{\\phi}^2 + \\frac{1}{2}|\\nabla\\phi|^2 + V(\\phi)$$</p>
<p>真空 ($\\phi = v$) では3項すべて消滅 — 場の励起のみが重力源になります。</p>

<h4>粒子―場の重力</h4>
<p>各グリッドセルは点質量 $\\rho\\,dA$ として、ニュートン重力で粒子を引き寄せます：</p>
<p>$$\\mathbf{F} = m\\sum_j \\frac{\\rho_j\\,dA}{r_j^2}\\,\\hat{r}_j$$</p>
<p>これは全グリッドセル ($G$ = CPU で 64、GPU で 128) にわたる直接の $O(N \\times G^2)$ 総和で、粒子―粒子重力と同じプラマー軟化を用います。周期境界に対してトポロジー対応。</p>

<h4>場の自己重力</h4>
<p>場自身のエネルギー密度が局所的な幾何を曲げ、波動方程式を変えます。弱場極限 ($|\\Phi| \\ll 1$) ではクライン＝ゴルドン方程式がGR補正を獲得します：</p>
<p>$$\\ddot{\\phi} = (1 + 4\\Phi)\\,\\nabla^2\\phi + 2\\,\\nabla\\Phi \\cdot \\nabla\\phi - (1 + 2\\Phi)\\,V'(\\phi)$$</p>
<p>$\\Phi$ は $\\rho$ を源とするニュートン重力ポテンシャル。3つの補正項はそれぞれ：</p>
<ul>
<li>$4\\Phi\\,\\nabla^2\\phi$ — 波伝播速度を変える空間曲率</li>
<li>$2\\,\\nabla\\Phi \\cdot \\nabla\\phi$ — 場の勾配の重力レンズ効果</li>
<li>$2\\Phi\\,V'(\\phi)$ — ポテンシャルの復元力の赤方偏移</li>
</ul>
<p>ポテンシャル $\\Phi$ は全場グリッド上で、グリーン関数 $G(r) = -1/\\sqrt{r^2 + \\varepsilon^2}$ とのFFT畳み込みで計算 — 順方向FFT、フーリエ空間での点ごと積、逆FFTにより $O(N^2 \\log N)$。</p>
`,

    'ref.conserved.title': '保存量',
    'ref.conserved.body': `
<h3>運動量</h3>
<p>$$\\mathbf{P} = \\sum_i m_i\\mathbf{w}_i + \\mathbf{P}_{\\text{場}} + \\mathbf{P}_{\\text{放射}}$$</p>
<p>空間の並進対称性からネーターの定理により保存。粒子運動量は固有速度 $\\mathbf{w}$（相対論オフ時は $m\\mathbf{v}$ に帰着）を用います。場と放射の寄与は別々に追跡されます。</p>

<h3>角運動量</h3>
<p>$$J = \\underbrace{\\sum_i\\mathbf{r}_i \\times m_i\\mathbf{w}_i}_{\\text{軌道}} + \\underbrace{\\sum_i I_i W_i}_{\\text{スピン}}$$</p>
<p>空間の回転対称性から保存。重心まわりで計算します。潮汐ロック・フレームドラッギング・スピン軌道結合は軌道とスピンのリザーバ間で角運動量を移しますが、合計は保存されます。</p>

<h3>保存が破れる場合</h3>
<p>速度依存力（磁気・重力磁気）は、シミュレーションが完全には追跡しない電磁場・重力磁気場の中に運動量を運び、小さなドリフトを生みます。これは粒子のみのアプローチの根本的な限界です — 完全な場の理論は厳密な保存を回復します。ドリフト百分率はこの効果を定量化します。</p>
`,
};

export const REFERENCE_STRINGS = { en: REF_EN, ja: REF_JA };
