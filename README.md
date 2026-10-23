# Geon

Geon is a browser sandbox for relativistic many-body physics. You spawn charged,
spinning particles, switch forces and corrections on and off, and watch orbits precess,
charges radiate, black holes evaporate, and scalar fields ripple, with live conservation
readouts to check the numbers.

**[Open it](https://a9l.im/geon)** · part of [a9l.im](https://a9l.im)

## What's in it

The simulation is two-dimensional, in natural units (c = G = ħ = 1). Particles carry
proper velocity, so nothing outruns light, and a Boris integrator with adaptive
substepping advances them.

- **Forces.** Newtonian gravity, Coulomb, magnetic dipole and Lorentz forces,
  gravitomagnetism (frame dragging), tidal locking, Yukawa (a screened nuclear force
  with a massive pion mediator), spin-curvature coupling, and uniform external
  gravitational, electric, and magnetic fields. Forces can be summed pairwise or with a
  Barnes–Hut tree.
- **Relativity.** First post-Newtonian corrections (Einstein–Infeld–Hoffmann for
  gravity, Darwin for electromagnetism, Bažański cross terms, scalar Breit for Yukawa)
  and signal delay: forces come from where sources were when their signal left, with a
  scalar aberration factor. This is a toy model of finite-speed propagation, not a full
  field solution.
- **Black holes.** Kerr–Newman horizons set by mass, spin, and charge (super-extremal
  inputs are clamped to an effective radius), a Paczyński–Wiita gravity well that
  swallows bodies crossing the horizon, ergosphere rendering, Hawking evaporation,
  Schwinger discharge that sheds charge one lepton at a time, extremal charge shedding,
  and axion superradiance that spins a hole down until it saturates.
- **Radiation and bosons.** Larmor radiation with Landau–Lifshitz reaction,
  electromagnetic and gravitational-wave quadrupole losses, and pion emission. Photons,
  pions, and leptons are real particles: they carry energy and momentum, other bodies
  absorb them, and pions decay. With boson interaction on they are lensed by masses,
  gravitate and repel among themselves, annihilate in opposite-charge pairs, and
  collapse into a new particle when enough energy gathers in one place (a kugelblitz).
  Matter meeting antimatter annihilates into photon pairs.
- **Scalar fields.** A Higgs field with a Mexican-hat potential that sets particle
  masses, and an axion field that modulates the electromagnetic coupling and, with
  Yukawa on, couples with opposite sign to matter and antimatter (a Peccei–Quinn toy).
  Both evolve on a grid, carry self-gravity, and are excited by collisions.
- **Charge quantization.** Every charge is a multiple of 0.1, and emission, absorption,
  decay, and discharge move charge in whole units.
- **Space.** Despawn, bounce, or periodic boundaries; periodic space can be a torus, a
  Klein bottle, or the real projective plane. Cosmological expansion adds a Hubble flow.
- **Analysis.** Energy, momentum, and angular-momentum totals with drift percentages; a
  per-force breakdown for the selected particle; a potential heatmap (gravity,
  electric, Yukawa, or all); and, on the CPU backend, a phase-space plot and an
  effective-potential curve for the selected particle against the heaviest body.
- **Presets.** Fifteen scenarios, from Kepler orbits and binary inspiral through
  Hawking evaporation, atoms, nuclei, and pion exchange to the Higgs boson, axion
  bursts, and an expanding universe.
- **Save and load.** Quick save to the browser, or download and upload the state as
  JSON (particles, toggles, settings, and camera).
- **Reference.** The `?` buttons beside controls open short explanations;
  Shift+click opens a longer reference page with the equations. The interface is in
  English and Japanese.

## Controls

- **Mouse.** Click to spawn a particle; drag to launch it. Right-click spawns
  antimatter. Clicking a particle of the button's kind (left for matter, right for
  antimatter) selects it; clicking one of the other kind deletes it. Scroll to zoom,
  middle-drag to pan, hover for a readout.
- **Touch.** Tap to spawn, drag to launch, pinch with two fingers to zoom and pan. The
  antimatter button switches taps to antimatter.
- **Keyboard.** Space pauses, `/` steps, `R` resets, `,` and `.` change speed, `1`–`9`
  load presets, `X` toggles antimatter mode, `T` the theme, `S` the sidebar. `Ctrl+S` /
  `Ctrl+L` quick save and load. `?` opens the about panel with the full list.

## Running locally

The project has no build step of its own; it loads the shared design system from
the parent site by absolute path. From a checkout of
[a9lim.github.io](https://github.com/a9lim/a9lim.github.io) with submodules:

    npm install && npm run build
    python3 -m http.server --directory dist 8000   # http://localhost:8000/geon/

WebGPU is used when the browser supports it; add `?cpu=1` to force the CPU backend.

## How it's built

Vanilla JavaScript modules with two interchangeable backends. The WebGPU backend runs
the physics as WGSL compute shaders (up to 512 particles, with a lock-free GPU tree and
128 × 128 field grids) and draws with instanced rendering; the CPU backend runs the
same physics in JavaScript (up to 128 particles, 64 × 64 grids) and draws with Canvas
2D. Shared controls, theme, and typography come from the parent site, and KaTeX renders
the reference pages. [AGENTS.md](AGENTS.md) maps the code.

## License

[AGPL-3.0](LICENSE)
