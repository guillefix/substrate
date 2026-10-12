import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareEquationSnapshot,
  formatQuantity,
} from "../public/explanations/current-balance.js";

const observe = (value, unit = "µA/cm²", extra = {}) => ({
  value,
  unit,
  time: 5.25,
  timeUnit: "ms",
  runId: "pulse-normal",
  modelId: "hh-cable",
  probeId: "near",
  systemId: "compartment-0",
  ...extra,
});

test("ionic and applied/axial currents have opposite positive directions", () => {
  const input = {
    sodiumCurrent: observe(-12),
    potassiumCurrent: observe(4),
    leakCurrent: observe(0),
    appliedCurrent: observe(10),
    axialCurrent: observe(-2),
    voltageSlope: observe(15.73, "mV/ms"),
    capacitance: observe(1, "µF/cm²"),
  };
  const snapshot = prepareEquationSnapshot(input);
  assert.equal(snapshot.values.sodiumCurrent.direction, "inward");
  assert.equal(snapshot.values.potassiumCurrent.direction, "outward");
  assert.equal(snapshot.values.leakCurrent.direction, "No net current");
  assert.equal(snapshot.values.appliedCurrent.direction, "inward");
  assert.equal(snapshot.values.axialCurrent.direction, "outward");
  // The view uses the supplied derivative, even if rounded/exported currents
  // do not reconstruct that exact number. It is not a second solver.
  assert.equal(snapshot.values.voltageSlope.value, 15.73);
  assert.equal(input.sodiumCurrent.value, -12);
});

test("rejects mixing samples, runs, probe locations, models or incompatible units", () => {
  for (const difference of [
    { time: 5.26 },
    { runId: "pulse-blocked" },
    { probeId: "far" },
    { modelId: "hh-lumped" },
    { systemId: "compartment-4" },
    { unit: "nA" },
    { timeUnit: "s" },
    { value: NaN },
  ]) {
    const snapshot = prepareEquationSnapshot({
      sodiumCurrent: observe(-12),
      potassiumCurrent: observe(4, "µA/cm²", difference),
    });
    assert.equal(snapshot.valid, false, JSON.stringify(difference));
    assert.deepEqual(snapshot.values, {});
    assert.equal(snapshot.time, null);
  }
});

test("absence is distinct from an explicit zero and updates cannot retain stale terms", () => {
  const cable = prepareEquationSnapshot({ axialCurrent: observe(0) });
  assert.equal(cable.hasAxial, true);
  assert.equal(cable.values.axialCurrent.value, 0);
  const uniform = prepareEquationSnapshot({ voltage: observe(-65, "mV") });
  assert.equal(uniform.hasAxial, false);
  assert.equal(uniform.values.axialCurrent, undefined);
  assert.equal(uniform.values.sodiumCurrent, undefined);
  const incomplete = prepareEquationSnapshot({
    capacitance: observe(null, "µF/cm²"),
    voltage: observe(-65, "mV"),
  });
  assert.equal(incomplete.valid, true);
  assert.equal(incomplete.values.capacitance, undefined);
  assert.equal(incomplete.values.voltage.value, -65);
});

test("formatting preserves small current signs and snapshots cannot be edited", () => {
  assert.equal(formatQuantity(-0.000002), "-2.00e-6");
  assert.equal(formatQuantity(0), "0");
  assert.equal(formatQuantity(Infinity), "Unavailable");
  const observations = { sodiumActivation: observe(0.052, "1") };
  const snapshot = prepareEquationSnapshot(observations);
  observations.sodiumActivation.value = 0.9;
  assert.equal(snapshot.values.sodiumActivation.value, 0.052);
  assert.throws(() => {
    snapshot.values.sodiumActivation.value = 0.9;
  }, TypeError);
});
