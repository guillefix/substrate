/** Immutable observations from one completed run. Inspection does not advance a solver. */
export class RecordedRun {
  constructor(record) {
    if (
      !record?.id ||
      !record.model ||
      !Array.isArray(record.samples) ||
      !record.samples.length
    )
      throw new Error("A recorded run needs an identity, model and samples");
    let last = -Infinity;
    for (const sample of record.samples) {
      if (!Number.isFinite(sample.time) || sample.time <= last)
        throw new Error(
          "Recorded times must be finite and strictly increasing",
        );
      last = sample.time;
    }
    const freeze = (value) => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
      return value;
    };
    this.data = freeze(structuredClone(record));
    Object.freeze(this);
  }
  at(index) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.data.samples.length
    )
      throw new Error("Inspection sample is outside this run");
    return this.data.samples[index];
  }
}
