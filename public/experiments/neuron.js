import { System, Experiment } from '../engine/core.js';
import { hhModel } from '../models/hh.js';

/** Scientific concepts independent of Babylon, DOM, transport, and numerical solver.
 * This experiment uses ideal simulated sensors. A hardware adapter would provide
 * measured observations with its own sampling, calibration and provenance.
 */
export function createExperiment() {
  const observables = {
    voltage: { label: 'Membrane voltage', unit: 'mV', read: s => s.voltage },
    sodiumCurrent: { label: 'Sodium current density', unit: 'µA/cm²', read: (s, p, r) => r.i_na },
    potassiumCurrent: { label: 'Potassium current density', unit: 'µA/cm²', read: (s, p, r) => r.i_k },
    appliedCurrent: { label: 'Applied current density', unit: 'µA/cm²', read: (s, p, r) => r.i_applied },
    sodiumOpenFraction: { label: 'Sodium population open fraction', unit: '1', read: s => s.m ** 3 * s.h },
    potassiumOpenFraction: { label: 'Potassium population open fraction', unit: '1', read: s => s.n ** 4 },
    sodiumActivation: { label: 'Sodium activation gate', unit: '1', read: s => s.m },
    sodiumAvailability: { label: 'Sodium availability gate', unit: '1', read: s => s.h },
    potassiumActivation: { label: 'Potassium activation gate', unit: '1', read: s => s.n },
  };
  const system = new System({
    id: 'membrane-1', label: 'Excitable membrane', model: hhModel.id,
    // Different scales of representation, not three different physical models.
    representations: [
      { id: 'neuron', label: 'Cell context', systemId: 'membrane-1', fidelity: 'single-compartment schematic' },
      { id: 'patch', label: 'Membrane patch', systemId: 'membrane-1', fidelity: 'same lumped membrane state' },
      { id: 'channel', label: 'Channel population', systemId: 'membrane-1', fidelity: 'mean-field gating schematic' },
    ],
  });
  const sensors = Object.keys(observables).map(observable => ({
    id: `probe-${observable}`, systemId: system.id, observable,
    kind: 'ideal-simulated-probe', sampling: 'simulation-boundary',
    source: 'simulation', measurementModel: 'ideal', timeUnit: 'ms',
  }));
  const inputs = [
    { id: 'current-clamp', kind: 'stimulus', unit: 'µA/cm²' },
    { id: 'conductance-edit', kind: 'parameter-intervention', unit: 'mS/cm²' },
  ];
  const experiment = new Experiment({ id: 'neuron-experiment', system, observables, sensors, inputs });
  experiment.model = hhModel;
  let readout = null;
  const observe = experiment.observe.bind(experiment);
  experiment.observe = () => readout ? observe(readout) : {};
  experiment.accept = payload => {
    const r = payload.sample;
    for (const key of ['time','voltage','m','h','n','i_na','i_k','i_applied']) {
      if (!Number.isFinite(r?.[key])) throw new Error(`Invalid simulation observation: ${key}`);
    }
    system.acceptSnapshot({
      state: { time: r.time, voltage: r.voltage, m: r.m, h: r.h, n: r.n },
      parameters: payload.parameters, time: r.time,
    });
    readout = Object.freeze({ ...r });
    return experiment.observe();
  };
  return experiment;
}
