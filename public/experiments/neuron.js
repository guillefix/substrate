import { System, Experiment } from "../engine/core.js";
import { hhModel } from "../models/hh.js";

/** Scientific concepts independent of Babylon, DOM, transport, and numerical solver.
 * This experiment uses ideal simulated sensors. A hardware adapter would provide
 * measured observations with its own sampling, calibration and provenance.
 */
export function createExperiment() {
  const observables = {
    voltage: { label: "Membrane voltage", unit: "mV", read: (s) => s.voltage },
    sodiumCurrent: {
      label: "Sodium current density",
      unit: "µA/cm²",
      read: (s, p, r) => r.i_na,
    },
    potassiumCurrent: {
      label: "Potassium current density",
      unit: "µA/cm²",
      read: (s, p, r) => r.i_k,
    },
    leakCurrent: {
      label: "Leak current density",
      unit: "µA/cm²",
      read: (s, p, r) => (Number.isFinite(r.i_leak) ? r.i_leak : null),
    },
    axialCurrent: {
      label: "Net inward axial current density",
      unit: "µA/cm²",
      read: (s, p, r) =>
        Number.isFinite(r.i_axial)
          ? r.i_axial
          : r.scope?.modelId === "hh-cable"
            ? null
            : 0,
    },
    capacitance: {
      label: "Membrane capacitance per area",
      unit: "µF/cm²",
      read: (s, p) => p.capacitance ?? null,
    },
    sodiumConductance: {
      label: "Maximum sodium conductance",
      unit: "mS/cm²",
      read: (s, p) => p.g_na ?? null,
    },
    sodiumReversal: {
      label: "Sodium reversal potential",
      unit: "mV",
      read: (s, p) => p.e_na ?? null,
    },
    voltageSlope: {
      label: "Voltage slope from current balance",
      unit: "mV/ms",
      read: (s, p, r) => {
        if (Number.isFinite(r.d_v_dt)) return r.d_v_dt;
        if (
          !Number.isFinite(r.i_leak) ||
          !Number.isFinite(p.capacitance) ||
          p.capacitance <= 0
        )
          return null;
        const axial = r.scope?.modelId === "hh-cable" ? r.i_axial : 0;
        return Number.isFinite(axial)
          ? (r.i_applied + axial - r.i_na - r.i_k - r.i_leak) / p.capacitance
          : null;
      },
    },
    appliedCurrent: {
      label: "Applied current density",
      unit: "µA/cm²",
      read: (s, p, r) => r.i_applied,
    },
    sodiumOpenFraction: {
      label: "Sodium population open fraction",
      unit: "1",
      read: (s) => s.m ** 3 * s.h,
    },
    potassiumOpenFraction: {
      label: "Potassium population open fraction",
      unit: "1",
      read: (s) => s.n ** 4,
    },
    sodiumActivation: {
      label: "Sodium activation gate",
      unit: "1",
      read: (s) => s.m,
    },
    sodiumAvailability: {
      label: "Sodium availability gate",
      unit: "1",
      read: (s) => s.h,
    },
    potassiumActivation: {
      label: "Potassium activation gate",
      unit: "1",
      read: (s) => s.n,
    },
  };
  const system = new System({
    id: "membrane-1",
    label: "Excitable membrane",
    model: hhModel.id,
    // Different scales of representation, not three different physical models.
    representations: [
      {
        id: "neuron",
        label: "Cell context",
        systemId: "membrane-1",
        fidelity: "anatomical reference with an explicit model readout",
      },
      {
        id: "patch",
        label: "Membrane patch",
        systemId: "membrane-1",
        fidelity: "illustrative membrane with selected local readout",
      },
      {
        id: "channel",
        label: "Channel population",
        systemId: "membrane-1",
        fidelity: "structural reference with population gating readout",
      },
    ],
  });
  const sensors = Object.keys(observables).map((observable) => ({
    id: `probe-${observable}`,
    systemId: system.id,
    observable,
    kind: "ideal-simulated-probe",
    sampling: "simulation-boundary",
    source: "simulation",
    measurementModel: "ideal",
    timeUnit: "ms",
  }));
  const inputs = [
    { id: "current-clamp", kind: "stimulus", unit: "µA/cm²" },
    { id: "conductance-edit", kind: "parameter-intervention", unit: "mS/cm²" },
  ];
  const experiment = new Experiment({
    id: "neuron-experiment",
    system,
    observables,
    sensors,
    inputs,
  });
  experiment.model = hhModel;
  let readout = null;
  const observe = experiment.observe.bind(experiment);
  experiment.observe = () => (readout ? observe(readout) : {});
  experiment.accept = (payload) => {
    const r = payload.sample;
    for (const key of [
      "time",
      "voltage",
      "m",
      "h",
      "n",
      "i_na",
      "i_k",
      "i_applied",
    ]) {
      if (!Number.isFinite(r?.[key]))
        throw new Error(`Invalid simulation observation: ${key}`);
    }
    system.acceptSnapshot({
      state: { time: r.time, voltage: r.voltage, m: r.m, h: r.h, n: r.n },
      parameters: payload.parameters,
      time: r.time,
    });
    if (payload.modelDefinition) experiment.model = payload.modelDefinition;
    system.model = payload.scope?.modelId || experiment.model.id;
    readout = Object.freeze({
      ...r,
      scope: Object.freeze({
        modelId: experiment.model.id,
        runId: "live",
        probeId: "uniform",
        ...payload.scope,
      }),
    });
    return experiment.observe();
  };
  return experiment;
}
