"""Uniform cylindrical HH cable: sealed ends, finite volumes, coupled RK4.

Geometry is independent of the illustrative Allen arbor. Each segment retains
its own voltage and HH gates. Axial current is positive into a compartment.
"""
from dataclasses import asdict, dataclass
import math

from .hh import Parameters, State, gate_rates, resting_state, _currents


@dataclass(frozen=True)
class CableGeometry:
    length_um: float = 1000.0
    diameter_um: float = 2.0
    nseg: int = 21
    ra_ohm_cm: float = 100.0

    def __post_init__(self):
        if isinstance(self.nseg, bool) or not isinstance(self.nseg, int) or not 1 <= self.nseg <= 201:
            raise ValueError("nseg must be an integer between 1 and 201")
        if any(not math.isfinite(v) or v <= 0 for v in (self.length_um, self.diameter_um, self.ra_ohm_cm)):
            raise ValueError("Cable dimensions and axial resistivity must be positive and finite")

    @property
    def area_um2(self):
        # Cylindrical lateral membrane; sealed numerical ends add no membrane caps.
        return math.pi * self.diameter_um * self.length_um

    @property
    def segment_area_cm2(self):
        return self.area_um2 / self.nseg * 1e-8

    @property
    def axial_density_conductance(self):
        # d/(4 Ra dx²) S/cm², multiplied by 1000 to mS/cm².
        dx_cm = self.length_um / self.nseg * 1e-4
        return 1000 * self.diameter_um * 1e-4 / (4 * self.ra_ohm_cm * dx_cm**2)

    def metadata(self):
        centers = [(i + .5) * self.length_um / self.nseg for i in range(self.nseg)]
        return {**asdict(self), "area_um2": self.area_um2, "boundary": "sealed ends",
                "centers_um": centers, "probe_index": self.nseg // 2,
                "compartments": [{"index": i, "x_um": x, "area_um2": self.area_um2 / self.nseg}
                                 for i, x in enumerate(centers)]}


class CableSimulator:
    def __init__(self, geometry=None, parameters=None, states=None, dt=0.005):
        self.geometry = geometry or CableGeometry()
        self.parameters = parameters or Parameters()
        if not math.isfinite(dt) or not 0 < dt <= .01:
            raise ValueError("Cable dt must lie in (0, 0.01] ms")
        coupling = self.geometry.axial_density_conductance / self.parameters.capacitance
        if self.geometry.nseg > 1 and dt * coupling > .5:
            raise ValueError("Cable dt is too large for this spatial grid; reduce dt")
        self.dt = dt
        self.step_index = 0
        if states is None:
            states = [resting_state(self.parameters)] * self.geometry.nseg
        if len(states) != self.geometry.nseg:
            raise ValueError("One initial State is required per segment")
        self.values = [(s.voltage, s.m, s.h, s.n) for s in states]
        self.pulses = []

    @property
    def time(self):
        return self.step_index * self.dt

    def aligned_steps(self, time):
        if not math.isfinite(time) or time < 0:
            raise ValueError("Time must be finite and nonnegative")
        steps = round(time / self.dt)
        if not math.isclose(steps * self.dt, time, rel_tol=1e-10, abs_tol=1e-10):
            raise ValueError("Time must align to the cable timestep")
        return steps

    def add_pulse(self, total_current_nA, duration, start=0, compartment=0):
        if not math.isfinite(total_current_nA):
            raise ValueError("Total pulse current must be finite")
        if compartment != "uniform" and (isinstance(compartment, bool) or not isinstance(compartment, int)
                or not 0 <= compartment < self.geometry.nseg):
            raise ValueError("Pulse location must be a compartment index or 'uniform'")
        first, width = self.aligned_steps(start), self.aligned_steps(duration)
        if first < self.step_index or width < 1:
            raise ValueError("Pulse must start now or later and have positive duration")
        self.pulses.append({"start_step": first, "end_step": first + width,
                            "total_current_nA": total_current_nA, "compartment": compartment})

    def current_densities(self):
        current = [0.0] * self.geometry.nseg
        for pulse in self.pulses:
            if pulse["start_step"] <= self.step_index < pulse["end_step"]:
                density = pulse["total_current_nA"] * .001 / self.geometry.segment_area_cm2
                target = pulse["compartment"]
                if target == "uniform":
                    current = [value + density / self.geometry.nseg for value in current]
                else:
                    current[target] += density
        return current

    def axial_currents(self, values=None):
        values = self.values if values is None else values
        axial = [0.0] * len(values)
        conductance = self.geometry.axial_density_conductance
        for i in range(len(values) - 1):
            inward = conductance * (values[i + 1][0] - values[i][0])
            axial[i] += inward
            axial[i + 1] -= inward
        return axial

    def _derivative(self, values, injected):
        axial = self.axial_currents(values)
        p = self.parameters
        derivatives = []
        for i, (v, m, h, n) in enumerate(values):
            am, bm, ah, bh, an, bn = gate_rates(v)
            ionic = sum(_currents((v, m, h, n), p))
            derivatives.append(((injected[i] + axial[i] - ionic) / p.capacitance,
                                am * (1-m) - bm * m, ah * (1-h) - bh * h,
                                an * (1-n) - bn * n))
        return derivatives

    def step(self, count=1):
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("Step count must be a nonnegative integer")
        dt = self.dt
        def offset(y, k, factor):
            return [tuple(a + factor * b for a, b in zip(row, derivative)) for row, derivative in zip(y, k)]
        for _ in range(count):
            y = self.values
            injected = self.current_densities()
            try:
                k1 = self._derivative(y, injected)
                k2 = self._derivative(offset(y, k1, dt / 2), injected)
                k3 = self._derivative(offset(y, k2, dt / 2), injected)
                k4 = self._derivative(offset(y, k3, dt), injected)
                updated = [tuple(a + dt * (b + 2*c + 2*d + e) / 6 for a, b, c, d, e in zip(row, a1, a2, a3, a4))
                           for row, a1, a2, a3, a4 in zip(y, k1, k2, k3, k4)]
                if any(not math.isfinite(value) for row in updated for value in row):
                    raise ValueError("Nonfinite state")
                if any(not 0 <= gate <= 1 for row in updated for gate in row[1:]):
                    raise ValueError("Gate outside [0,1]")
            except (OverflowError, ValueError) as error:
                raise ArithmeticError("Cable integration became unstable; reduce timestep/input") from error
            self.values = updated
            self.step_index += 1

    def run(self, duration):
        self.step(self.aligned_steps(duration))

    def sample(self, probe_index=None):
        probe_index = self.geometry.nseg // 2 if probe_index is None else probe_index
        if not 0 <= probe_index < self.geometry.nseg:
            raise ValueError("Probe index outside cable")
        current, axial = self.current_densities(), self.axial_currents()
        compartments = []
        for i, (v, m, h, n) in enumerate(self.values):
            ina, ik, ileak = _currents((v, m, h, n), self.parameters)
            compartments.append({"voltage": v, "m": m, "h": h, "n": n,
                                 "i_na": ina, "i_k": ik, "i_leak": ileak,
                                 "i_applied": current[i], "i_axial": axial[i],
                                 "d_v_dt": (current[i] + axial[i] - ina - ik - ileak) / self.parameters.capacitance})
        return {"time": self.time, **compartments[probe_index], "compartments": compartments}
