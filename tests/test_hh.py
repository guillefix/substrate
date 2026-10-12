import json
import math
import unittest

from substrate_model import Parameters, Simulator, gate_rates


class HodgkinHuxleyTests(unittest.TestCase):
    def test_unforced_equilibrium_is_stable(self):
        sim = Simulator()
        rest = sim.state
        sim.run(100)
        self.assertAlmostEqual(sim.state.voltage, rest.voltage, places=10)
        self.assertAlmostEqual(rest.voltage, -65, delta=0.01)

    def test_threshold_and_spike(self):
        peaks = []
        for amplitude in (2, 10):
            sim = Simulator()
            sim.add_pulse(amplitude, 1, start=5)
            sim.run(40)
            peaks.append(max(s["voltage"] for s in sim.recording()["samples"]))
            self.assertLess(abs(sim.state.voltage + 65), 1)
        self.assertLess(peaks[0], -55)
        self.assertGreater(peaks[1], 30)

    def test_sodium_block_prevents_regenerative_spike(self):
        sim = Simulator()
        sim.set_parameters(g_na=0)
        sim.add_pulse(10, 1, start=5)
        sim.run(40)
        trace = sim.recording()["samples"]
        self.assertLess(max(s["voltage"] for s in trace), -40)
        self.assertTrue(all(s["i_na"] == 0 for s in trace))

    def test_removable_singularities(self):
        for v in (-40, -55):
            self.assertTrue(all(math.isfinite(rate) and rate > 0 for rate in gate_rates(v)))
            for dv in (-1e-8, 1e-8):
                for a, b in zip(gate_rates(v), gate_rates(v + dv)):
                    self.assertAlmostEqual(a, b, places=7)

    def test_passive_membrane_matches_analytic_rc_solution(self):
        initial = Simulator().state
        p = Parameters(g_na=0, g_k=0)
        sim = Simulator(parameters=p, state=initial)
        sim.add_pulse(5, 10)
        sim.run(10)
        equilibrium = p.e_leak + 5 / p.g_leak
        expected = equilibrium + (initial.voltage - equilibrium) * math.exp(-10 * p.g_leak / p.capacitance)
        self.assertAlmostEqual(sim.state.voltage, expected, places=9)

    def test_timestep_convergence(self):
        traces = []
        for dt in (0.01, 0.005):
            sim = Simulator(dt=dt, sample_interval=0.05)
            sim.add_pulse(10, 1, start=5)
            sim.run(30)
            traces.append([s["voltage"] for s in sim.recording()["samples"]])
        self.assertEqual(len(traces[0]), len(traces[1]))
        error = max(abs(a - b) for a, b in zip(*traces))
        self.assertLess(error, 0.002)

    def test_gate_bounds_for_documented_experiment_envelope(self):
        for g_na, g_k, current in ((0, 36, 50), (120, 0, 20), (240, 72, 50), (120, 36, -20)):
            with self.subTest(g_na=g_na, g_k=g_k, current=current):
                sim = Simulator()
                sim.set_parameters(g_na=g_na, g_k=g_k)
                sim.add_pulse(current, 20, start=5)
                sim.run(60)
                for point in sim.recording()["samples"]:
                    self.assertTrue(all(0 <= point[gate] <= 1 for gate in ("m", "h", "n")))
                    self.assertTrue(math.isfinite(point["voltage"]))

    def test_snapshot_resume_and_replay_are_deterministic(self):
        sim = Simulator()
        sim.add_pulse(10, 1, start=5)
        sim.set_parameters(at=20, g_k=18)
        sim.run(7)
        checkpoint = json.loads(json.dumps(sim.checkpoint()))
        resumed = Simulator.restore(checkpoint)
        for instance in (sim, resumed):
            instance.add_pulse(15, 2, start=30)
            instance.run(43)
        self.assertEqual(sim.checkpoint(), resumed.checkpoint())
        record = json.loads(json.dumps(sim.recording()))
        replay = Simulator.replay(record)
        self.assertEqual(sim.state, replay.state)
        self.assertEqual(record, replay.recording())

    def test_inputs_are_step_aligned_and_pulses_add(self):
        sim = Simulator()
        sim.add_pulse(10, 1)
        sim.add_pulse(-2, 0.5)
        self.assertEqual(sim.sample()["i_applied"], 8)
        sim.run(0.5)
        self.assertEqual(sim.sample()["i_applied"], 10)
        sim.run(0.5)
        self.assertEqual(sim.sample()["i_applied"], 0)
        with self.assertRaises(ValueError):
            sim.add_pulse(1, 0.015)
        with self.assertRaises(ValueError):
            sim.add_pulse(1, 1, start=0)

    def test_parameter_edits_preserve_state_and_replay_order(self):
        sim = Simulator()
        initial = sim.state
        sim.set_parameters(at=10, g_k=12)
        sim.set_parameters(at=5, g_k=18)
        sim.set_parameters(g_na=60)
        self.assertEqual(sim.sample()["voltage"], initial.voltage)
        self.assertEqual(sim.state, initial)
        self.assertEqual(sim.parameters.g_na, 60)
        sim.run(6)
        self.assertEqual(sim.parameters.g_k, 18)
        sim.run(5)
        self.assertEqual(sim.parameters.g_k, 12)

    def test_snapshot_and_trace_do_not_alias_simulator(self):
        sim = Simulator()
        sim.add_pulse(10, 1, 5)
        checkpoint = sim.checkpoint()
        checkpoint["events"][0]["amplitude"] = 123
        trace = sim.recording()
        trace["events"][0]["amplitude"] = 456
        self.assertEqual(sim.events[0]["amplitude"], 10)

    def test_invalid_inputs_fail_clearly(self):
        with self.assertRaises(ValueError):
            Parameters(g_na=-1)
        with self.assertRaises(ValueError):
            Simulator(dt=0)
        with self.assertRaises(ValueError):
            Simulator(dt=0.1)
        with self.assertRaises(ValueError):
            Simulator().add_pulse(float("nan"), 1)


if __name__ == "__main__":
    unittest.main()
