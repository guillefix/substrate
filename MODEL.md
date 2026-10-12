# Substrate neuron model

A renderer-independent, single membrane compartment with classical
Hodgkin–Huxley sodium, potassium, and leak currents. The first experiment is
an excitable membrane patch, suitable for exploring why stimulation produces
a spike and how changing channel conductance changes that response.

## Run

No numerical dependencies are required. From the project directory:

```sh
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m examples.record_neuron
```

The second command writes `examples/neuron_trace.json`: a 90 ms experiment
with a 10 µA/cm², 1 ms pulse at 5 ms, sodium conductance removed at 45 ms,
and an identical pulse at 50 ms. The second response cannot produce the
normal sodium-mediated spike. Removing sodium conductance also changes the
resting balance; this is an intervention on the existing state, not a reset.

## Interface for any renderer

```python
from substrate_model import Simulator

neuron = Simulator(dt=0.01, sample_interval=0.05)
neuron.add_pulse(amplitude=10, duration=1, start=5)
neuron.run(6)                       # Advance simulated time, in milliseconds.
readout = neuron.sample()          # Voltage, gates, currents, and time.
neuron.set_parameters(g_na=60)     # A live edit at the current step boundary.
neuron.add_pulse(15, 2)            # A live pulse beginning now.
neuron.step(100)                   # Exactly 1 ms at this timestep.
checkpoint = neuron.checkpoint()
resumed = Simulator.restore(checkpoint)
experiment = neuron.recording()    # JSON-serializable inputs and sample data.
replayed = Simulator.replay(experiment)
```

The simulation owns time and state. The display owns its refresh rate, camera,
layout, input widgets, and presentation speed. At each display refresh it can
advance an integer number of physics steps and read a fresh sample. It may
interpolate readouts visually, but must not change the integrator timestep to
match display frames. A paused display simply stops calling `step`.

Current pulses and parameter edits take effect at step boundaries. Scheduled
times and pulse durations must be integer multiples of `dt`; misaligned
times raise an error rather than silently rounding. Pulses are half-open
intervals `[start, end)` and overlapping pulses add. Applied current and
parameters are constant through the four RK stages of each step. Editing
conductance preserves voltage and all gates. Edits at the same time apply
in insertion order. Inputs cannot be retroactively inserted into the past.

`sample()` returns a fresh dictionary with `time`, `voltage`, `m`, `h`, `n`,
`i_na`, `i_k`, `i_leak`, and `i_applied`. It applies any parameter changes due
at that boundary; reading does not advance the simulation clock. Current
values are **instantaneous boundary readouts**, not averages over a sample
interval. At an input discontinuity they describe the new input.

Use one owner/thread for mutation and send copied readouts to renderers.
This initial API is synchronous, has no locking, and stores its trace in
memory. Long experiments will need streaming or bounded recording.

## Model and conventions

The membrane equation is:

```text
C dV/dt = I_applied - I_Na - I_K - I_leak
I_Na   = g_Na m³h (V - E_Na)
I_K    = g_K n⁴  (V - E_K)
I_leak = g_leak  (V - E_leak)
dx/dt  = alpha_x(V)(1 - x) - beta_x(V)x
```

Positive applied current depolarizes. Positive ionic current flows outward.
Voltage uses the absolute convention in which rest is approximately −65 mV.
Gates are deterministic dimensionless activation/inactivation variables;
they are not individual channel particles.

| Quantity | Default | Units |
|---|---:|---|
| Capacitance | 1 | µF/cm² |
| Maximum sodium conductance | 120 | mS/cm² |
| Maximum potassium conductance | 36 | mS/cm² |
| Leak conductance | 0.3 | mS/cm² |
| Sodium reversal | 50 | mV |
| Potassium reversal | −77 | mV |
| Leak reversal | −54.387 | mV |
| Temperature | 6.3 | °C, fixed |
| Physics timestep | 0.01 | ms |
| Recorded sample spacing | 0.05 | ms |

The voltage-dependent rate formulas follow the classic squid-axon HH
convention, also documented in [NEURON's reference HH mechanism](https://raw.githubusercontent.com/neuronsimulator/nrn/master/src/nrnoc/hh.mod).
This project uses −54.387 mV for leak reversal to match Substrate's existing
HH exploration; NEURON's linked implementation uses −54.3 mV. We evaluate
rates directly rather than using NEURON's lookup table or solver.

Initialization solves the zero-current equilibrium in the interval
[−100, −40] mV and initializes gates at their voltage-dependent steady states.
Custom parameter choices can have multiple or unstable equilibria; callers
can supply an explicit `State` instead. Removable rate singularities at
−40 and −55 mV use an analytic limiting expression.

## Recording and continuation

`substrate.hh.trace.v1` includes model identity, units, fixed temperature,
integrator, timestep, sample spacing, initial parameters and state, input
events, and sampled states/currents. Event times use integer step indices,
avoiding drift in stimulus timing. Future scheduled events can be included
even when an experiment ends before they occur.

`recording()` includes the current boundary even when it is off the ordinary
sample grid. Calling it midway through a run preserves that extra sample in
the recorded history. Replay reproduces the **model state and regular sample
grid**; extra off-grid inspection samples are not themselves replay inputs.

`substrate.hh.checkpoint.v1` additionally preserves the current state,
parameters, event-application status, and sample history. Restore supports
exact continuation on the same Python/runtime arithmetic. Checkpoints and
recordings are copied so modifying returned data does not alter the model.
These formats are local development interfaces, not hardened parsers for
arbitrary external files. Do not mutate `Simulator.events` directly; use the
public scheduling methods so input validation is applied.

## Validation and limitations

The 12 tests cover unforced rest, subthreshold versus suprathreshold pulses,
loss of the normal spike after sodium block, rate singularities, agreement
with an analytic passive RC membrane, timestep convergence, selected
conductance/current stress cases, pulse boundaries/overlap, parameter-edit
ordering, copy isolation, and deterministic continuation/replay.

With a 1 ms stimulus at 5 ms:

- 2 µA/cm² reaches approximately −63.36 mV without a spike.
- 10 µA/cm² reaches approximately +39.01 mV at 7.50 ms.
- Halving `dt` from 0.01 to 0.005 ms changes the aligned voltage samples of
  that 30 ms experiment by less than 0.0001 mV.

The tests sample sodium conductance from 0 to 240 mS/cm², potassium
conductance from 0 to 72 mS/cm², and stimuli from −20 to +50 µA/cm² at the
default timestep. They do not prove stability for every combination. The
solver rejects nonfinite or out-of-bounds gates instead of silently clipping
them. Extreme stimuli, voltages, capacitances, or conductances can require a
smaller timestep; API acceptance is not a stability guarantee.

The original lumped model is a classical squid membrane model, **not a fitted human neuron**.
That lumped model has no dendritic morphology, axonal propagation, synaptic input,
stochastic channel gating, calcium dynamics, plasticity, changing ion
concentrations, or network. Reversal potentials are fixed unless explicitly
edited. A membrane illustration should be labeled schematic. These numerical
checks establish implementation behavior, not experimental validation or a
unique biological explanation. A later discovery-oriented workflow should
add measured data, parameter inference, uncertainty, and held-out stimuli.

## Spatial cable and matched-protocol comparisons

`substrate_model/cable.py` adds a uniform cylindrical cable with sealed ends.
Every finite-volume segment has its own voltage and m/h/n state, the same
local HH conductance densities, and axial coupling to its neighbors. This is
a new physical model; it does not simulate the separately displayed Allen
arbor or adopt the PDB protein structures as molecular dynamics.

The default geometry is 1,000 µm long and 2 µm in diameter, divided into 21
equal segments. Intracellular resistivity is 100 Ω·cm. Membrane area is the
cylindrical lateral area πdL, without extra end caps. Center positions and
segment areas are included in every cable run's geometry metadata.

The local voltage budget becomes:

```text
C dV_i/dt = I_applied,i + I_axial,i - I_Na,i - I_K,i - I_leak,i
I_axial,i = G_density × sum_over_neighbors(V_neighbor - V_i)
G_density = 1000 × d_cm / (4 × Ra_ohm_cm × dx_cm²)  [mS/cm²]
```

Each edge contributes equal and opposite axial currents to its two adjacent
segments; all segments have equal area. Positive axial current enters the
segment. The whole coupled system uses fixed-step RK4 at 0.005 ms. Stimulus
edges are step-aligned and held constant across all RK stages. The public
solver rejects timesteps beyond a conservative axial stability bound; this
bound alone does not guarantee stability for arbitrary channel parameters.

`substrate_model/comparison.py` runs two independent copies of a matched
protocol and returns recorded results. The default pulse is **0.6 nA total
current for 1 ms, starting at 5 ms**, over a 40 ms run. The lumped model has
the same total lateral area as the cable. Its single voltage distributes the
injected current over that area; the cable receives the same total current
in its proximal segment. This is an explicit difference in spatial input
distribution, not equal current density at every local membrane patch.

Both start from the exact same default resting voltage and gates. Optional
conductance changes are interventions at this initial state, not separate
resting-state fits. The middle cable segment is the default probe; every
recorded sample also includes all segment states and budgets. Each run is
independent of the live workbench and of the other comparison run.

The recording includes the protocol's exact replay request, units, geometry,
parameters, integrator and timestep. Sampling is every 0.1 ms. Spike counts
and onset estimates use upward crossings of 0 mV, with linear interpolation
between samples. Peak times are sampled peak times. Reported propagation
delay is the distal-minus-proximal first crossing time, not a fitted velocity.

### Numerical checks and independent reference

The cable is checked against:

- The lumped HH limit under uniform stimulation and uniform initial state.
- Axial current conservation and the complete per-segment voltage budget.
- Analytic decay of a passive discrete sealed-end cosine eigenmode.
- Second-order spatial convergence toward the continuous passive cable
  eigenmode under 7 → 21 → 63 segment refinement.
- Active waveform convergence when halving dt from 0.005 to 0.0025 ms.
- Deterministic repeated comparison runs and preservation of live model state.

NEURON was evaluated using its official [geometry/discretization documentation](https://www.neuronsimulator.org/en/latest/progref/modelspec/programmatic/topology/geometry.html),
[units](https://www.neuronsimulator.org/en/latest/guide/units.html), and
[installation documentation](https://www.neuronsimulator.org/en/latest/install/install_instructions.html).
NEURON 9.0.2 installs successfully in this project's Python 3.13 environment.
The small cable remains an inspectable standard-library implementation for
this bounded experiment; NEURON supplies an independent reference and is the
stronger next candidate for branched morphology, additional mechanisms and
larger simulations. It is not a runtime dependency of the local service.

The optional `test_independent_neuron_reference` constructs the same geometry
in NEURON, disables rate lookup interpolation, uses 6.3°C, the matching leak
reversal and conductances, a 0.001 ms timestep, and second-order integration.
The default cable's middle voltage differs by less than **0.00068 mV** from
that reference over 40 ms in the checked environment. The automated test
compares the first 15 ms with a 0.002 mV tolerance. It skips cleanly if NEURON
is unavailable; install `neuron==9.0.2` to reproduce it.

Matching another solver at the **same spatial grid** does not prove spatial
convergence. A separate NEURON refinement check gave maximum middle-voltage
differences from a 189-segment reference of approximately 20.03, 2.38 and
0.24 mV for 7, 21 and 63 segments respectively, primarily on the steep
upstroke. The 21-segment and 189-segment peaks were 37.90 and 37.97 mV. The
21-segment default is therefore an exploratory grid, not the endpoint for
quantitative propagation studies. Refine both space and time before such
claims; [NEURON's d-lambda guidance](https://www.neuronsimulator.org/en/latest/guide/using_the_d_lambda_rule.html)
is relevant when adapting real morphologies.

The default matched experiment produces one spike in both models: the lumped
peak is approximately 38.33 mV at 7.6 ms; the cable's middle peak is 37.90 mV
at 7.0 ms. Its proximal-to-distal onset delay is approximately 1.80 ms. These
are consequences of this illustrative geometry and stimulation protocol,
not predictions for the mouse morphology or human/rat channel references.
