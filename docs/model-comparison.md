# One experiment, multiple models

The first controlled comparison is implemented: a single HH compartment and
a 21-compartment idealized cable, independent completed runs, matched current
and area, near/far metrics and traces, model/anatomy views, and time/probe
inspection linked to current-balance explanations. Later branches below remain
planned. See MODEL.md and SERVER.md for numerical evidence and exact protocol.

## Purpose

Ask what an added mechanism changes under a controlled experiment. More detail
is not automatically more accurate: each model needs a stated domain, parameter
provenance, and validation appropriate to the question. Compare predictions
with one another and, when available, with independent experimental evidence.

Models need not form a single ladder. Spatial extent, channel kinetics,
stochasticity, and chemical dynamics are separate dimensions of detail.

## First comparison

Compare a spatially uniform HH membrane with a short cable of electrically
coupled compartments using the same membrane kinetics. Inject a current pulse
at one end and observe voltage near and far from the input. The spatial model
can represent propagation and local differences; the lumped model has only one
voltage. Its readout must say “uniform model prediction,” not pretend that it
contains separate local measurements.

Start with a simple cable before using a reconstructed branching morphology.
This isolates spatial coupling from changes in ion-channel types and makes
verification manageable. Evaluate NEURON as the spatial solver before writing
another cable-equation implementation.

Keep the anatomical representation of the subject available throughout. A
separate model view reveals the current approximation: one compartment, a
segmented cable, or a compartmental tree. View selection and model selection
are independent. In this first comparison the cable is an explicitly idealized
surrogate, not an unannounced replacement of the physical subject or a claimed
faithful reduction of its measured arbor. A later branch-specific comparison
must identify its anatomical correspondence and parameter derivation.

Hold temperature, membrane kinetics, total area, initial preparation, and the
injected total-current waveform fixed where scientifically appropriate. Define
explicitly how current is distributed over area: equal current density and
equal total current are different comparisons. Save the normalization policy.
Allow each solver its own converged numerical timestep; compare observations
on a declared time grid without using display refresh as the solver clock.

Show synchronized views, overlaid traces, and an optional difference trace at
corresponding probes. Report spike occurrence, latency (with a declared threshold),
peak voltage, and runtime measured under the same conditions. A missing spike
or unsupported observable is a meaningful result, not a zero-valued measurement.

## Later branches

1. **Morphology and channel distribution:** change branching, compartment size,
   and channel densities while preserving a recorded comparison protocol.
2. **Stochastic channel populations:** compare repeated trials with deterministic
   population gating; record channel counts, conductances, and random seeds.
   Show distributions and uncertainty, not only one attractive trajectory.
3. **Alternative channel mechanisms:** compare explicitly sourced kinetic models
   with HH gating. Protein structure alone does not supply transition rates.
4. **Concentrations and reaction–diffusion:** introduce changing ion concentrations,
   transport and selected chemistry, with explicit flux and conservation contracts.

These branches can eventually be combined, but each should first demonstrate
what it contributes on its own. Adding a second neuron and synapse is a separate
system-composition experiment rather than an automatic fidelity upgrade.

## Engine concepts

- **Model definition:** equations/backend/version, state schema, units,
  assumptions, parameter sources, supported observables and inputs.
- **Protocol:** initial preparation, timed interventions, probe locations,
  duration, and normalization choices; independent of a particular renderer.
- **Run:** one model instance executing a protocol, owning its state, parameters,
  time, events and (where relevant) seed. A model choice never overwrites another
  run's state or history.
- **Comparison:** a set of runs plus explicit correspondences between systems,
  probes and observables. It records which features are comparable or absent.

Preserve conceptual system identity while qualifying simulated state and every
observation by run/model. A simulated system instance belongs to one run.
Biological geometry that affects coupling belongs to the model; illustrative
geometry remains a readout. Visual detail must not imply simulated detail.

## Switching models

The implemented interaction selects a result or reruns the same protocol with a
different model. It does not silently transfer a running state. Live model
replacement would require an explicit initialization/projection rule, checking
units, charge/concentrations, hidden states, and equilibration. That is later work.

## Acceptance checks for the first comparison

- Independent runs cannot mutate one another, and exports reproduce their inputs.
- The spatial solver passes temporal and spatial convergence checks and a
  passive-cable reference case before claims about propagation.
- A uniform, identically initialized cable with uniform stimulation agrees with
  its matched single-compartment limit within documented numerical tolerances.
- Model identity, units, input normalization and measurement location are visible.
- Changing view or selected result does not change simulation state or time.
- Unsupported local observables are marked absent rather than fabricated.

## Scientific references

- [HH dynamics and population gating](https://neuronaldynamics.epfl.ch/online/Ch2.S2.html)
- [Compartmental modeling and morphology](https://neuronaldynamics.epfl.ch/online/Ch3.S4.html)
- [NEURON reaction–diffusion tutorials](https://www.neuronsimulator.org/en/latest/rxd-tutorials/index.html)
