"""Run with: python -m examples.record_neuron [output.json]."""

import json
from pathlib import Path
import sys

from substrate_model import Simulator


def main():
    sim = Simulator()
    sim.add_pulse(10, 1, start=5)
    sim.set_parameters(at=45, g_na=0)
    sim.add_pulse(10, 1, start=50)
    sim.run(90)
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("examples/neuron_trace.json")
    target.write_text(json.dumps(sim.recording(), indent=2) + "\n")
    print(f"Wrote {len(sim.recording()['samples'])} samples across {sim.time:g} ms to {target}")


if __name__ == "__main__":
    main()
