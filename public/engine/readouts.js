/** Multiple presentations of the same observations, independent of output medium. */
export class Readouts {
  #bindings = new Map();
  bind({ id, observables, present }) {
    if (this.#bindings.has(id)) throw new Error(`Readout already exists: ${id}`);
    this.#bindings.set(id, { observables: [...observables], present });
    return () => this.#bindings.delete(id);
  }
  publish(observations) {
    for (const [id, { observables, present }] of this.#bindings) {
      const selected = {};
      for (const name of observables) {
        if (!(name in observations)) throw new Error(`Readout ${id} is missing observable ${name}`);
        selected[name] = observations[name];
      }
      present(Object.freeze(selected));
    }
  }
}
