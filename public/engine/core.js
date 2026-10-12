/** Renderer-independent systems, experiments and observations.
 * No biology, browser APIs, transport, numerical integrator, or graphics imports.
 */
function frozenCopy(value) {
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}

export class System {
  constructor({ id, label, model, representations = [] }) {
    if (!id) throw new Error('A system needs a stable identity');
    this.id = id;
    this.label = label;
    this.model = model;
    this.representations = frozenCopy(representations);
    this.state = null;
    this.parameters = null;
    this.time = null;
  }
  acceptSnapshot({ state, parameters, time }) {
    if (!Number.isFinite(time)) throw new Error('Snapshot time must be finite');
    this.state = frozenCopy(state);
    this.parameters = frozenCopy(parameters);
    this.time = time;
  }
}

export class Experiment {
  constructor({ id, system, observables, sensors, inputs = [] }) {
    this.id = id;
    this.system = system;
    this.observables = Object.freeze({ ...observables });
    this.sensors = frozenCopy(sensors);
    this.inputs = frozenCopy(inputs);
    const ids = new Set();
    for (const sensor of sensors) {
      if (ids.has(sensor.id)) throw new Error('Sensor identities must be unique');
      ids.add(sensor.id);
      if (!observables[sensor.observable]) throw new Error('Sensor references an unknown observable');
      if (sensor.systemId !== system.id) throw new Error('Sensor references a different system');
    }
  }
  observe(context = {}) {
    if (this.system.state === null) return {};
    return Object.fromEntries(this.sensors.map(sensor => {
      const variable = this.observables[sensor.observable];
      return [sensor.observable, frozenCopy({
        value: variable.read(this.system.state, this.system.parameters, context),
        unit: variable.unit, time: this.system.time, timeUnit: sensor.timeUnit,
        systemId: this.system.id, sensorId: sensor.id,
        source: sensor.source, measurementModel: sensor.measurementModel,
        ...(context.scope ? { modelId: context.scope.modelId, runId: context.scope.runId, probeId: context.scope.probeId } : {}),
      })];
    }));
  }
}
