import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest

from server import make_server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        public = cls.root / "public"
        public.mkdir()
        (public / "index.html").write_text("<title>Workbench</title>")
        (cls.root / "private.txt").write_text("not public")
        (public / "escape.txt").symlink_to(cls.root / "private.txt")
        cls.server = make_server(port=0, public=public)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, body=None, headers=None, raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        req_headers = {"Content-Type": "application/json", **(headers or {})}
        payload = raw if raw is not None else json.dumps(body) if body is not None else None
        connection.request("POST" if payload is not None else "GET", path, payload, req_headers)
        response = connection.getresponse()
        data = response.read()
        status = response.status
        content_type = response.getheader("Content-Type")
        connection.close()
        return status, json.loads(data) if "application/json" in content_type else data

    def setUp(self):
        self.request("/api/reset", {})

    def test_live_pulse_and_incremental_sample_protocol(self):
        status, initial = self.request("/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(initial["sample"]["time"], 0)
        status, pulse = self.request("/api/pulse", {"amplitude": 10, "duration": 1})
        self.assertEqual(status, 200)
        self.assertEqual(pulse["sample"]["i_applied"], 10)
        status, result = self.request("/api/advance", {"steps": 100})
        self.assertEqual(status, 200)
        self.assertEqual(result["sample"]["time"], 1)
        self.assertEqual(result["sample"]["i_applied"], 0)
        self.assertEqual(len(result["samples"]), 20)
        self.assertEqual(result["samples"][0]["time"], .05)
        _, trace = self.request("/api/recording")
        self.assertEqual(trace["events"][0]["amplitude"], 10)
        self.assertEqual(trace["duration_ms"], 1)

    def test_reset_changes_conductance_without_reinitializing_state(self):
        _, initial = self.request("/api/state")
        _, modified = self.request("/api/reset", {"g_na": 0, "g_k": 18})
        self.assertEqual(modified["sample"]["voltage"], initial["sample"]["voltage"])
        self.assertEqual(modified["parameters"]["g_na"], 0)
        self.assertEqual(modified["sample"]["i_na"], 0)
        self.assertEqual(len(modified["samples"]), 1)

    def test_reject_invalid_inputs_without_advancing(self):
        for path, body in (("advance", {"steps": -1}), ("advance", {"steps": 501}),
                           ("advance", {"steps": True}), ("advance", {"steps": 1.5}),
                           ("pulse", {"amplitude": 51, "duration": 1}),
                           ("pulse", {"amplitude": 1, "duration": .115}),
                           ("parameters", {"g_na": -1}), ("parameters", {"g_k": 73}),
                           ("parameters", {"e_na": 50}), ("reset", {"unrecognized": 1}),
                           ("advance", [])):
            with self.subTest(path=path, body=body):
                code, response = self.request("/api/" + path, body)
                self.assertEqual(code, 400)
                self.assertIn("error", response)
        _, state = self.request("/api/state")
        self.assertEqual(state["sample"]["time"], 0)

    def test_limit_stops_at_200_ms(self):
        for _ in range(40):
            status, response = self.request("/api/advance", {"steps": 500})
            self.assertEqual(status, 200)
        self.assertTrue(response["done"])
        self.assertEqual(response["sample"]["time"], 200)
        _, response = self.request("/api/advance", {"steps": 500})
        self.assertEqual(response["samples"], [])
        code, _ = self.request("/api/pulse", {"amplitude": 10, "duration": 1})
        self.assertEqual(code, 400)

    def test_overlap_is_bounded(self):
        self.assertEqual(self.request("/api/pulse", {"amplitude": 40, "duration": 1})[0], 200)
        self.assertEqual(self.request("/api/pulse", {"amplitude": 20, "duration": 1})[0], 400)
        self.assertEqual(self.request("/api/state")[1]["sample"]["i_applied"], 40)

    def test_host_origin_and_static_confinement(self):
        self.assertEqual(self.request("/")[0], 200)
        for path in ("/../private.txt", "/%2e%2e/private.txt", "/escape.txt", "/server.py", "/.git/config"):
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request("/api/state", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/api/reset", {}, headers={"Origin": "https://evil.example"})[0], 403)
        own = f"http://127.0.0.1:{self.server.server_port}"
        self.assertEqual(self.request("/api/reset", {}, headers={"Origin": own})[0], 200)

    def test_malformed_or_oversized_json(self):
        for raw in ('{"steps": NaN}', '{', '"' + 'x' * 4096 + '"'):
            self.assertEqual(self.request("/api/advance", raw=raw)[0], 400)
        self.assertEqual(self.request("/api/advance", {"steps": 1}, headers={"Content-Type": "text/plain"})[0], 400)


if __name__ == "__main__":
    unittest.main()
