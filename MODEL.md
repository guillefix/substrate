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

This is a classical squid membrane model, **not a fitted human neuron**.
There is no dendritic morphology, axonal propagation, synaptic input,
stochastic channel gating, calcium dynamics, plasticity, changing ion
concentrations, or network. Reversal potentials are fixed unless explicitly
edited. A membrane illustration should be labeled schematic. These numerical
checks establish implementation behavior, not experimental validation or a
unique biological explanation. A later discovery-oriented workflow should
add measured data, parameter inference, uncertainty, and held-out stimuli.
