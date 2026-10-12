"""Classical squid-axon Hodgkin–Huxley model at 6.3 °C; no dependencies.

Time: ms. Voltage: mV. Current density: µA/cm². Conductance: mS/cm².
Positive applied current depolarizes; positive ionic current flows outward.
"""

from dataclasses import asdict, dataclass, replace
from copy import deepcopy
import math


@dataclass(frozen=True)
class Parameters:
    capacitance: float = 1.0
    g_na: float = 120.0
    g_k: float = 36.0
    g_leak: float = 0.3
    e_na: float = 50.0
    e_k: float = -77.0
    e_leak: float = -54.387

    def __post_init__(self):
        if not all(math.isfinite(v) for v in asdict(self).values()):
            raise ValueError("All parameters must be finite")
        if self.capacitance <= 0 or min(self.g_na, self.g_k, self.g_leak) < 0:
            raise ValueError("Capacitance must be positive and conductances nonnegative")


@dataclass(frozen=True)
class State:
    voltage: float
    m: float
    h: float
    n: float

    def __post_init__(self):
        if not all(math.isfinite(v) for v in asdict(self).values()):
            raise ValueError("State must be finite")
        if not all(0 <= gate <= 1 for gate in (self.m, self.h, self.n)):
            raise ValueError("Channel gating variables must be between zero and one")


def _trap(z):
    # z / (1 - exp(-z)), analytically continued at zero.
    if abs(z) < 1e-6:
        return 1 + z / 2 + z * z / 12
    return z / -math.expm1(-z)


def gate_rates(voltage):
    """Return alpha_m, beta_m, alpha_h, beta_h, alpha_n, beta_n in 1/ms."""
    return (
        _trap((voltage + 40) / 10),
        4 * math.exp(-(voltage + 65) / 18),
        0.07 * math.exp(-(voltage + 65) / 20),
        1 / (1 + math.exp(-(voltage + 35) / 10)),
        0.1 * _trap((voltage + 55) / 10),
        0.125 * math.exp(-(voltage + 65) / 80),
    )


def _steady_gates(voltage):
    am, bm, ah, bh, an, bn = gate_rates(voltage)
    return am / (am + bm), ah / (ah + bh), an / (an + bn)


def _currents(values, parameters):
    v, m, h, n = values
    p = parameters
    return (p.g_na * m**3 * h * (v - p.e_na),
            p.g_k * n**4 * (v - p.e_k),
            p.g_leak * (v - p.e_leak))


def resting_state(parameters=None):
    """Find a zero-current equilibrium by bisection on [-100, -40] mV.

    This defines initialization, not a claim that every parameter set has a
    unique or stable equilibrium. Supply State explicitly for other regimes.
    """
    p = parameters or Parameters()
    def residual(v):
        return sum(_currents((v, *_steady_gates(v)), p))
    low, high = -100.0, -40.0
    if residual(low) > 0 or residual(high) < 0:
        raise ValueError("No bracketed equilibrium; supply an explicit initial State")
    for _ in range(80):
        mid = (low + high) / 2
        if residual(mid) > 0:
            high = mid
        else:
            low = mid
    voltage = (low + high) / 2
    return State(voltage, *_steady_gates(voltage))


def _derivative(values, parameters, applied_current):
    v, m, h, n = values
    am, bm, ah, bh, an, bn = gate_rates(v)
    return ((applied_current - sum(_currents(values, parameters))) / parameters.capacitance,
            am * (1 - m) - bm * m,
            ah * (1 - h) - bh * h,
            an * (1 - n) - bn * n)


UNITS = {
    "time": "ms", "voltage": "mV", "m": "dimensionless",
    "h": "dimensionless", "n": "dimensionless", "i_na": "uA/cm^2",
    "i_k": "uA/cm^2", "i_leak": "uA/cm^2", "i_applied": "uA/cm^2",
    "capacitance": "uF/cm^2", "g_na": "mS/cm^2", "g_k": "mS/cm^2",
    "g_leak": "mS/cm^2", "e_na": "mV", "e_k": "mV", "e_leak": "mV",
}


class Simulator:
    """Fixed-step RK4 membrane with step-aligned, replayable input events.

    Physics advances only on step()/run(), never on a wall clock. Events take
    effect at the start of a step and stay constant across its four RK stages.
    Overlapping pulses add. The renderer owns display refresh and interpolation.
    """

    def __init__(self, parameters=None, state=None, dt=0.01, sample_interval=0.05):
        if not math.isfinite(dt) or not 0 < dt <= 0.05:
            raise ValueError("dt must be finite and in (0, 0.05] ms")
        self.dt = dt
        self.parameters = parameters or Parameters()
        self.state = state or resting_state(self.parameters)
        self.step_index = 0
        self.sample_every = self._steps(sample_interval)
        if self.sample_every < 1:
            raise ValueError("Sampling interval must be at least one step")
        self.events = []
        self._applied_parameter_events = set()
        self._initial_parameters = asdict(self.parameters)
        self._initial_state = asdict(self.state)
        self._samples = []

    @property
    def time(self):
        return self.step_index * self.dt

    def _steps(self, duration):
        if not math.isfinite(duration) or duration < 0:
            raise ValueError("Time must be finite and nonnegative")
        count = round(duration / self.dt)
        if not math.isclose(count * self.dt, duration, rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("Time must align to the fixed timestep")
        return count

    def add_pulse(self, amplitude, duration, start=None):
        """Schedule current density; start defaults to the current boundary."""
        if not math.isfinite(amplitude):
            raise ValueError("Pulse amplitude must be finite")
        start_step = self.step_index if start is None else self._steps(start)
        duration_steps = self._steps(duration)
        if start_step < self.step_index or duration_steps < 1:
            raise ValueError("Pulse must start now or later and last at least one step")
        self.events.append({"kind": "pulse", "step": start_step,
                            "duration_steps": duration_steps, "amplitude": amplitude})

    def set_parameters(self, *, at=None, **changes):
        """Change conductances/reversals/capacitance without resetting voltage/gates."""
        replace(self.parameters, **changes)  # Validate before accepting event.
        target = self.step_index if at is None else self._steps(at)
        if target < self.step_index:
            raise ValueError("Parameter events cannot occur in the past")
        self.events.append({"kind": "parameters", "step": target, "changes": changes})

    def _apply_parameters(self):
        # Sort by experiment time, then insertion order for same-time edits.
        for i, event in sorted(enumerate(self.events), key=lambda pair: (pair[1]["step"], pair[0])):
            if (event["kind"] == "parameters" and event["step"] <= self.step_index
                    and i not in self._applied_parameter_events):
                self.parameters = replace(self.parameters, **event["changes"])
                self._applied_parameter_events.add(i)

    def applied_current(self):
        return sum(e["amplitude"] for e in self.events if e["kind"] == "pulse"
                   and e["step"] <= self.step_index < e["step"] + e["duration_steps"])

    def sample(self):
        """Fresh readout at the current boundary; safe to hand to any renderer."""
        self._apply_parameters()
        s = self.state
        ina, ik, ileak = _currents((s.voltage, s.m, s.h, s.n), self.parameters)
        return {"time": self.time, **asdict(s), "i_na": ina, "i_k": ik,
                "i_leak": ileak, "i_applied": self.applied_current()}

    def _record(self, force=False):
        if force or self.step_index % self.sample_every == 0:
            point = self.sample()
            if self._samples and self._samples[-1]["time"] == self.time:
                self._samples[-1] = point
            else:
                self._samples.append(point)

    def step(self, count=1):
        if not isinstance(count, int) or count < 0:
            raise ValueError("Step count must be a nonnegative integer")
        for _ in range(count):
            self._apply_parameters()
            self._record()
            s = self.state
            y = (s.voltage, s.m, s.h, s.n)
            dt, current, p = self.dt, self.applied_current(), self.parameters
            try:
                k1 = _derivative(y, p, current)
                k2 = _derivative(tuple(a + dt * b / 2 for a, b in zip(y, k1)), p, current)
                k3 = _derivative(tuple(a + dt * b / 2 for a, b in zip(y, k2)), p, current)
                k4 = _derivative(tuple(a + dt * b for a, b in zip(y, k3)), p, current)
                new_state = State(*(a + dt * (b + 2*c + 2*d + e) / 6
                                    for a, b, c, d, e in zip(y, k1, k2, k3, k4)))
            except (OverflowError, ValueError) as error:
                raise ArithmeticError("Integration became unstable; reduce dt or stimulus/parameters") from error
            self.state = new_state
            self.step_index += 1
            self._record()
        return self.sample()

    def run(self, duration):
        """Advance by a duration in simulated milliseconds; return latest readout."""
        return self.step(self._steps(duration))

    def recording(self):
        """JSON-serializable experiment, including exact input schedule and readouts."""
        self._record(force=True)
        return {"format": "substrate.hh.trace.v1", "model": "classic-squid-hh",
                "temperature_c": 6.3, "integrator": "fixed-step-rk4",
                "dt_ms": self.dt, "sample_interval_ms": self.sample_every * self.dt,
                "duration_ms": self.time, "units": deepcopy(UNITS),
                "initial_parameters": deepcopy(self._initial_parameters),
                "initial_state": deepcopy(self._initial_state),
                "events": deepcopy(self.events), "samples": deepcopy(self._samples)}

    def checkpoint(self):
        """Complete independent snapshot for exact continuation (including inputs)."""
        self._apply_parameters()
        return {"format": "substrate.hh.checkpoint.v1", "dt": self.dt,
                "sample_every": self.sample_every, "step_index": self.step_index,
                "parameters": asdict(self.parameters), "state": asdict(self.state),
                "initial_parameters": deepcopy(self._initial_parameters),
                "initial_state": deepcopy(self._initial_state), "events": deepcopy(self.events),
                "applied_parameter_events": sorted(self._applied_parameter_events),
                "samples": deepcopy(self._samples)}

    @classmethod
    def restore(cls, checkpoint):
        if checkpoint["format"] != "substrate.hh.checkpoint.v1":
            raise ValueError("Unsupported checkpoint format")
        c = deepcopy(checkpoint)
        sim = cls(Parameters(**c["parameters"]), State(**c["state"]), c["dt"], c["dt"] * c["sample_every"])
        sim.step_index = c["step_index"]
        sim.events = c["events"]
        sim._applied_parameter_events = set(c["applied_parameter_events"])
        sim._initial_parameters = c["initial_parameters"]
        sim._initial_state = c["initial_state"]
        sim._samples = c["samples"]
        return sim

    @classmethod
    def replay(cls, recording):
        if recording["format"] != "substrate.hh.trace.v1":
            raise ValueError("Unsupported recording format")
        r = recording
        sim = cls(Parameters(**r["initial_parameters"]), State(**r["initial_state"]),
                  r["dt_ms"], r["sample_interval_ms"])
        for event in r["events"]:
            at = event["step"] * sim.dt
            if event["kind"] == "pulse":
                sim.add_pulse(event["amplitude"], event["duration_steps"] * sim.dt, at)
            elif event["kind"] == "parameters":
                sim.set_parameters(at=at, **event["changes"])
            else:
                raise ValueError("Unsupported input event")
        sim.run(r["duration_ms"])
        return sim
