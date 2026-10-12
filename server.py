"""Local-only Substrate workbench service. Run: python server.py."""

from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit

from substrate_model import Simulator

PUBLIC = Path(__file__).parent / "public"
LIMIT_MS = 200
BODY_LIMIT = 4096


def fields(body, allowed, required=()):
    if not isinstance(body, dict):
        raise ValueError("Request body must be a JSON object")
    if set(body) - set(allowed):
        raise ValueError("Unknown field: " + ", ".join(sorted(set(body) - set(allowed))))
    if set(required) - set(body):
        raise ValueError("Missing field: " + ", ".join(sorted(set(required) - set(body))))


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def conductances(body):
    fields(body, ("g_na", "g_k"))
    return {key: number(value, key, 0, 240 if key == "g_na" else 72)
            for key, value in body.items()}


class Workbench:
    def __init__(self):
        self.lock = threading.Lock()
        self.sim = Simulator()

    def status(self, samples=()):
        sample = self.sim.sample()
        return {"sample": sample, "samples": list(samples),
                "parameters": asdict(self.sim.parameters), "dt_ms": self.sim.dt,
                "duration_limit_ms": LIMIT_MS, "done": self.sim.time >= LIMIT_MS}

    def dispatch(self, method, path, body):
        with self.lock:
            if method == "GET" and path == "/api/state":
                return self.status()
            if method == "GET" and path == "/api/recording":
                return self.sim.recording()
            if method != "POST":
                raise KeyError(path)
            if path == "/api/reset":
                changes = conductances(body)
                self.sim = Simulator()
                if changes:
                    self.sim.set_parameters(**changes)
                return self.status([self.sim.sample()])
            if path == "/api/advance":
                fields(body, ("steps",), ("steps",))
                steps = body["steps"]
                if isinstance(steps, bool) or not isinstance(steps, int) or not 0 <= steps <= 500:
                    raise ValueError("steps must be an integer between 0 and 500")
                steps = min(steps, round(LIMIT_MS / self.sim.dt) - self.sim.step_index)
                samples = []
                for _ in range(steps):
                    sample = self.sim.step()
                    if self.sim.step_index % self.sim.sample_every == 0:
                        samples.append(sample)
                return self.status(samples)
            if path == "/api/pulse":
                fields(body, ("amplitude", "duration"), ("amplitude", "duration"))
                amplitude = number(body["amplitude"], "amplitude", -20, 50)
                duration = number(body["duration"], "duration", 0.1, 10)
                if self.sim.time + duration > LIMIT_MS + 1e-10:
                    raise ValueError("Pulse would extend beyond the 200 ms experiment; reset first")
                # Validate combined drive at every possible change during the new pulse.
                start = self.sim.step_index
                end = start + round(duration / self.sim.dt)
                existing = [e for e in self.sim.events if e["kind"] == "pulse"]
                boundaries = {start}
                for event in existing:
                    boundaries.update((event["step"], event["step"] + event["duration_steps"]))
                for step in boundaries:
                    if start <= step < end:
                        total = amplitude + sum(e["amplitude"] for e in existing
                                                if e["step"] <= step < e["step"] + e["duration_steps"])
                        if not -20 <= total <= 50:
                            raise ValueError("Overlapping pulses must keep total applied current between -20 and 50")
                if len(self.sim.events) >= 1024:
                    raise ValueError("Experiment input limit reached; reset first")
                self.sim.add_pulse(amplitude, duration)
                return self.status()
            if path == "/api/parameters":
                changes = conductances(body)
                if len(self.sim.events) >= 1024:
                    raise ValueError("Experiment input limit reached; reset first")
                if changes:
                    self.sim.set_parameters(**changes)
                return self.status()
            raise KeyError(path)


class Handler(BaseHTTPRequestHandler):
    server_version = "SubstrateLocal/1"

    def log_message(self, *args):
        pass

    def _send(self, code, data, content_type="application/json; charset=utf-8"):
        if not isinstance(data, bytes):
            data = json.dumps(data, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(data)

    def _trusted_request(self):
        allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        hosts = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        if len(hosts) != 1 or hosts[0] not in allowed:
            return False
        return not origins or (len(origins) == 1 and origins[0] == "http://" + hosts[0])

    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Transfer-Encoding is unsupported")
        if self.headers.get_content_type() != "application/json":
            raise ValueError("Content-Type must be application/json")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not lengths[0].isdigit():
            raise ValueError("One valid Content-Length is required")
        length = int(lengths[0])
        if not 0 < length <= BODY_LIMIT:
            raise ValueError("JSON body must be between 1 and 4096 bytes")
        self.connection.settimeout(3)
        raw = self.rfile.read(length)
        if len(raw) != length:
            raise ValueError("Incomplete JSON body")
        return json.loads(raw, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON number")))

    def _handle(self):
        if not self._trusted_request():
            self._send(403, {"error": "Only this local workbench origin is allowed"})
            return
        try:
            url = urlsplit(self.path)
            if url.scheme or url.netloc:
                raise ValueError("Absolute request URLs are unsupported")
            path = unquote(url.path)
            if path.startswith("/api/"):
                body = self._body() if self.command == "POST" else {}
                self._send(200, self.server.workbench.dispatch(self.command, path, body))
                return
            if self.command != "GET":
                raise KeyError(path)
            if "\x00" in path or "\\" in path or ".." in path.split("/"):
                raise KeyError(path)
            root = self.server.public.resolve()
            target = (root / (path.lstrip("/") or "index.html")).resolve()
            if not target.is_relative_to(root) or not target.is_file():
                raise KeyError(path)
            self._send(200, target.read_bytes(), mimetypes.guess_type(target)[0] or "application/octet-stream")
        except KeyError:
            self._send(404, {"error": "Not found"})
        except (ValueError, TypeError, UnicodeError) as error:
            self._send(400, {"error": str(error)})
        except ArithmeticError:
            self._send(422, {"error": "The experiment became numerically unstable; reset to continue"})
        except TimeoutError:
            self._send(408, {"error": "Request body timed out"})

    do_GET = _handle
    do_POST = _handle
    do_OPTIONS = _handle


def make_server(port=8765, public=PUBLIC):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.workbench = Workbench()
    server.public = Path(public)
    return server


if __name__ == "__main__":
    with make_server() as server:
        print("Substrate workbench: http://127.0.0.1:8765", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
