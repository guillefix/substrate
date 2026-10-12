import unittest

from substrate_model.comparison import run_comparison, validate_protocol
from server import Workbench


class ComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = run_comparison({'duration_ms': 15})

    def test_common_area_and_matched_total_current(self):
        lumped, cable = self.result['runs']
        area = cable['geometry']['area_um2']
        self.assertEqual(area, lumped['geometry']['area_um2'])
        l = next(s for s in lumped['samples'] if s['time'] == 5)
        c = next(s for s in cable['samples'] if s['time'] == 5)
        lumped_current = l['i_applied'] * area * 1e-8 * 1000
        cable_current = sum(s['i_applied'] for s in c['compartments']) * area / 21 * 1e-8 * 1000
        self.assertAlmostEqual(lumped_current, .6)
        self.assertAlmostEqual(cable_current, .6)
        self.assertEqual(c['i_applied'], 0)  # Middle probe is not directly stimulated.

    def test_shared_sample_times_and_budget_identity(self):
        lumped, cable = self.result['runs']
        self.assertEqual([s['time'] for s in lumped['samples']], [s['time'] for s in cable['samples']])
        for run in (lumped, cable):
            for sample in run['samples']:
                self.assertAlmostEqual(sample['d_v_dt'] * run['parameters']['capacitance'],
                                       sample['i_applied'] + sample['i_axial'] - sample['i_na'] - sample['i_k'] - sample['i_leak'], places=10)
        self.assertGreater(cable['metrics']['propagation_delay_ms'], 0)
        self.assertEqual(cable['metrics']['spike_count'], 1)

    def test_reproducibility_and_live_state_isolation(self):
        workbench = Workbench()
        workbench.dispatch('POST', '/api/pulse', {'amplitude': 10, 'duration': 1})
        workbench.dispatch('POST', '/api/advance', {'steps': 50})
        before = workbench.sim.checkpoint()
        result = workbench.dispatch('POST', '/api/comparison', {'duration_ms': 15})
        self.assertEqual(result, self.result)
        self.assertEqual(before, workbench.sim.checkpoint())

    def test_invalid_protocols_and_concurrent_comparison(self):
        for options in ({'bad': 1}, {'current_nA': 1.1}, {'g_na': -1}, {'duration_ms': 100},
                        {'current_nA': True}, {'pulse_duration_ms': .123}, {'duration_ms': 15.005}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                validate_protocol(options)
        workbench = Workbench()
        workbench.comparison_lock.acquire()
        try:
            with self.assertRaises(ValueError):
                workbench.dispatch('POST', '/api/comparison', {})
        finally:
            workbench.comparison_lock.release()


if __name__ == '__main__':
    unittest.main()
