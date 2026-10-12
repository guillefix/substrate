"""Matched-area, matched-total-current comparisons in independent run state."""
from dataclasses import asdict
import hashlib
import json
import math

from .hh import Parameters, Simulator, UNITS, resting_state
from .cable import CableGeometry, CableSimulator

DEFAULT_PROTOCOL = {"current_nA": .6, "pulse_start_ms": 5.0, "pulse_duration_ms": 1.0,
                    "duration_ms": 40.0, "g_na": 120.0, "g_k": 36.0}
BOUNDS = {"current_nA": (0, 1), "pulse_start_ms": (1, 10), "pulse_duration_ms": (.1, 3),
          "duration_ms": (15, 60), "g_na": (0, 240), "g_k": (0, 72)}


def validate_protocol(options):
    if not isinstance(options, dict) or set(options) - set(DEFAULT_PROTOCOL):
        raise ValueError("Comparison accepts only current_nA, pulse_start_ms, pulse_duration_ms, duration_ms, g_na and g_k")
    result = {**DEFAULT_PROTOCOL, **options}
    for key, value in result.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{key} must be a finite number")
        low, high = BOUNDS[key]
        if not low <= value <= high:
            raise ValueError(f"{key} must lie between {low} and {high}")
        if key.endswith('_ms') and not math.isclose(round(value / .005) * .005, value, abs_tol=1e-10):
            raise ValueError(f"{key} must align to 0.005 ms")
    if result['pulse_start_ms'] + result['pulse_duration_ms'] > result['duration_ms']:
        raise ValueError("Pulse must finish within the comparison")
    # Keep an exact final observation on the common sampling grid.
    if not math.isclose(round(result['duration_ms'] * 10) / 10, result['duration_ms'], abs_tol=1e-10):
        raise ValueError("Comparison duration must align to 0.1 ms samples")
    return result


def metrics(samples, probe_index=0):
    peak = max(samples, key=lambda s: s['voltage'])
    crossings = []
    for left, right in zip(samples, samples[1:]):
        if left['voltage'] < 0 <= right['voltage']:
            fraction = -left['voltage'] / (right['voltage'] - left['voltage'])
            crossings.append(left['time'] + fraction * (right['time'] - left['time']))
    return {'peak_voltage_mV': peak['voltage'], 'peak_time_ms': peak['time'],
            'first_spike_ms': crossings[0] if crossings else None, 'spike_count': len(crossings),
            'rest_voltage_mV': samples[0]['voltage'], 'final_voltage_mV': samples[-1]['voltage'],
            'max_abs_axial_current_uA_cm2': max(abs(s['i_axial']) for s in samples),
            'probe_index': probe_index}


def run_comparison(options=None):
    settings = validate_protocol({} if options is None else options)
    geometry = CableGeometry()
    p = Parameters(g_na=settings['g_na'], g_k=settings['g_k'])
    # Both begin from precisely the same default HH equilibrium. Conductance
    # changes are protocol interventions, not independently refitted resting states.
    initial = resting_state()
    dt, sample_interval = .005, .1
    lumped = Simulator(parameters=p, state=initial, dt=dt, sample_interval=sample_interval)
    cable = CableSimulator(geometry, parameters=p, states=[initial] * geometry.nseg, dt=dt)
    density = settings['current_nA'] * .001 / (geometry.area_um2 * 1e-8)
    lumped.add_pulse(density, settings['pulse_duration_ms'], settings['pulse_start_ms'])
    cable.add_pulse(settings['current_nA'], settings['pulse_duration_ms'], settings['pulse_start_ms'], compartment=0)
    def lumped_sample():
        s = lumped.sample()
        return {**s, 'i_axial': 0.0,
                'd_v_dt': (s['i_applied'] - s['i_na'] - s['i_k'] - s['i_leak']) / p.capacitance}
    lumped_samples, cable_samples = [lumped_sample()], [cable.sample()]
    stride = round(sample_interval / dt)
    for _ in range(round(settings['duration_ms'] / sample_interval)):
        lumped.step(stride)
        cable.step(stride)
        lumped_samples.append(lumped_sample())
        cable_samples.append(cable.sample())
    identity = hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()[:12]
    protocol = {**settings, 'id': 'matched-current-' + identity, 'request': settings.copy(), 'temperature_c': 6.3,
                'dt_ms': dt, 'sample_interval_ms': sample_interval, 'total_area_um2': geometry.area_um2,
                'initial_state': asdict(initial), 'stimulus_location': 'proximal compartment (cable); whole area (lumped)',
                'probe_location': .5, 'matching': 'equal total lateral membrane area and equal total injected current',
                'current_convention': 'applied and axial currents inward-positive; ionic currents outward-positive',
                'spike_definition': 'upward zero-mV crossing interpolated between recorded samples'}
    compartment_metrics = [metrics([{'time': s['time'], **s['compartments'][i]} for s in cable_samples], i)
                           for i in range(geometry.nseg)]
    cable_metrics = metrics(cable_samples, geometry.nseg // 2)
    onset0, onsetN = compartment_metrics[0]['first_spike_ms'], compartment_metrics[-1]['first_spike_ms']
    cable_metrics['propagation_delay_ms'] = onsetN - onset0 if onset0 is not None and onsetN is not None else None
    units = {**UNITS, 'i_axial': 'uA/cm^2', 'd_v_dt': 'mV/ms', 'current_nA': 'nA', 'x_um': 'um'}
    return {'format': 'substrate.comparison.v1', 'protocol': protocol, 'units': units, 'runs': [
        {'id': 'hh-lumped', 'model': 'classic-squid-hh', 'label': 'Lumped Hodgkin–Huxley',
         'parameters': asdict(p), 'geometry': {'area_um2': geometry.area_um2, 'nseg': 1, 'probe_index': 0},
         'integrator': 'fixed-step-rk4', 'samples': lumped_samples, 'metrics': metrics(lumped_samples)},
        {'id': 'hh-cable', 'model': 'hh-cable', 'label': 'Spatial Hodgkin–Huxley cable',
         'parameters': asdict(p), 'geometry': geometry.metadata(), 'integrator': 'finite-volume-coupled-rk4',
         'samples': cable_samples, 'metrics': cable_metrics, 'compartment_metrics': compartment_metrics,
         'resolution_note': '21 segments are an exploratory spatial grid; refine before quantitative propagation claims.'}]}
