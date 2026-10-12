import math
import importlib.util
import unittest

from substrate_model import Parameters, Simulator, State, resting_state
from substrate_model.cable import CableGeometry, CableSimulator


class CableTests(unittest.TestCase):
    def test_uniform_input_matches_lumped_hh(self):
        geometry = CableGeometry(nseg=7)
        cable = CableSimulator(geometry, dt=.005)
        lumped = Simulator(dt=.005)
        total_nA = .6
        density = total_nA * .001 / (geometry.area_um2 * 1e-8)
        cable.add_pulse(total_nA, 1, 5, compartment='uniform')
        lumped.add_pulse(density, 1, 5)
        cable.run(12); lumped.run(12)
        for v, m, h, n in cable.values:
            self.assertAlmostEqual(v, lumped.state.voltage, places=9)
            self.assertAlmostEqual(m, lumped.state.m, places=11)
            self.assertAlmostEqual(h, lumped.state.h, places=11)
            self.assertAlmostEqual(n, lumped.state.n, places=11)

    def test_axial_flow_conserves_total_current(self):
        initial = resting_state()
        states = [State(-60 + i, initial.m, initial.h, initial.n) for i in range(7)]
        cable = CableSimulator(CableGeometry(nseg=7), states=states)
        currents = cable.axial_currents()
        self.assertGreater(currents[0], 0)
        self.assertLess(currents[-1], 0)
        self.assertAlmostEqual(sum(currents), 0, places=12)
        sample = cable.sample()
        for s in sample['compartments']:
            self.assertAlmostEqual(s['d_v_dt'], s['i_applied'] + s['i_axial'] - s['i_na'] - s['i_k'] - s['i_leak'], places=12)

    def test_passive_discrete_cable_eigenmode_matches_analytic_decay(self):
        geometry = CableGeometry(nseg=21)
        p = Parameters(g_na=0, g_k=0, e_leak=-65)
        rest = resting_state(p)
        initial = [State(-65 + 5 * math.cos(math.pi * (i+.5) / geometry.nseg), rest.m, rest.h, rest.n)
                   for i in range(geometry.nseg)]
        cable = CableSimulator(geometry, p, initial, dt=.005)
        time = 2
        cable.run(time)
        rate = (p.g_leak + 4 * geometry.axial_density_conductance * math.sin(math.pi / (2*geometry.nseg))**2) / p.capacitance
        for index, actual in enumerate(cable.values):
            expected = -65 + 5 * math.cos(math.pi * (index+.5) / geometry.nseg) * math.exp(-rate*time)
            self.assertAlmostEqual(actual[0], expected, places=8)

    def test_passive_spatial_refinement_converges_to_continuum(self):
        errors = []
        p = Parameters(g_na=0, g_k=0, e_leak=-65)
        rest = resting_state(p)
        for nseg in (7, 21, 63):
            geometry = CableGeometry(nseg=nseg)
            initial = [State(-65 + 5 * math.cos(math.pi*(i+.5)/nseg), rest.m, rest.h, rest.n) for i in range(nseg)]
            cable = CableSimulator(geometry, p, initial, dt=.001)
            cable.run(2)
            # Continuous sealed-end cosine mode. D = d/(4Ra C), with unit conversion.
            rate = (p.g_leak + geometry.axial_density_conductance * (math.pi/nseg)**2) / p.capacitance
            errors.append(max(abs(row[0] - (-65 + 5*math.cos(math.pi*(i+.5)/nseg)*math.exp(-rate*2))) for i,row in enumerate(cable.values)))
        self.assertLess(errors[1], errors[0]/7)
        self.assertLess(errors[2], errors[1]/7)

    def test_active_timestep_convergence_and_propagation(self):
        traces = []
        for dt in (.005, .0025):
            cable = CableSimulator(dt=dt)
            cable.add_pulse(.6, 1, 5)
            trace = []
            for _ in range(120):
                cable.run(.1)
                trace.append(cable.sample())
            traces.append(trace)
        maximum = max(abs(a['compartments'][i]['voltage'] - b['compartments'][i]['voltage'])
                      for a,b in zip(*traces) for i in range(21))
        self.assertLess(maximum, .01)
        starts = [next(s['time'] for s in traces[0] if s['compartments'][i]['voltage'] > 0) for i in (0,10,20)]
        self.assertLess(starts[0], starts[1]); self.assertLess(starts[1], starts[2])

    def test_total_injected_current_and_input_validation(self):
        cable = CableSimulator()
        cable.add_pulse(.6, 1)
        current_nA = sum(cable.current_densities()) * cable.geometry.segment_area_cm2 * 1000
        self.assertAlmostEqual(current_nA, .6, places=12)
        with self.assertRaises(ValueError):
            CableSimulator(CableGeometry(nseg=201), dt=.01)
        with self.assertRaises(ValueError):
            cable.add_pulse(.6, .003)
        with self.assertRaises(ValueError):
            cable.add_pulse(.6, 1, compartment=21)

    @unittest.skipUnless(importlib.util.find_spec('neuron'), 'Optional NEURON independent reference is not installed')
    def test_independent_neuron_reference(self):
        from neuron import h
        h.load_file('stdrun.hoc')
        section = h.Section(name='substrate_reference')
        section.L, section.diam, section.nseg = 1000, 2, 21
        section.Ra, section.cm = 100, 1
        section.insert('hh')
        h.celsius, h.usetable_hh, h.dt, h.secondorder = 6.3, 0, .001, 2
        for segment in section:
            segment.hh.gnabar, segment.hh.gkbar, segment.hh.gl = .12, .036, .0003
            segment.hh.el, segment.ena, segment.ek = -54.387, 50, -77
        stimulus = h.IClamp(section(.5 / 21))
        stimulus.delay, stimulus.dur, stimulus.amp = 5, 1, .6
        reference = h.Vector().record(section(.5)._ref_v, .1)
        try:
            h.finitialize(resting_state().voltage)
            h.continuerun(15)
            cable = CableSimulator()
            cable.add_pulse(.6, 1, 5)
            actual = [cable.sample()['voltage']]
            for _ in range(150):
                cable.run(.1)
                actual.append(cable.sample()['voltage'])
            self.assertEqual(len(actual), len(reference))
            self.assertLess(max(abs(a-b) for a,b in zip(actual, reference)), .002)
        finally:
            reference = None  # Release recording vector before deleting its section.
            h.delete_section(sec=section)


if __name__ == '__main__':
    unittest.main()
