"""Local-only RGB simulator controls; no platform APIs or broker secrets in the page."""
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

DEFAULT_STATE = {"power": False, "color": "#FF0000", "mode": "solid", "brightness": 100}


def validate_changes(changes):
    if not isinstance(changes, dict) or not changes or set(changes) - set(DEFAULT_STATE):
        raise ValueError("Choose power, color, mode, or brightness.")
    result = dict(changes)
    for key, value in result.items():
        valid = ((key == "power" and type(value) is bool)
                 or (key == "color" and isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value))
                 or (key == "mode" and value in ("solid", "blink", "strobe"))
                 or (key == "brightness" and type(value) is int and 0 <= value <= 100))
        if not valid:
            raise ValueError(f"Invalid {key} value.")
    if "color" in result:
        result["color"] = result["color"].upper()
    return result


def load_state(path):
    return {**DEFAULT_STATE, **validate_changes(json.loads(path.read_text()))} if path.exists() else dict(DEFAULT_STATE)


def save_state(path, state):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state))
    temporary.replace(path)


def serve_controls(simulator, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, status, body, content_type="application/json"):
            data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def trusted_request(self):
            hosts = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            return self.headers.get("Host") in hosts and self.headers.get("Origin") in (None, *["http://" + host for host in hosts])

        def do_GET(self):
            if not self.trusted_request():
                return self.respond(403, {"error": "Local requests only."})
            if self.path == "/":
                return self.respond(200, Path(__file__).with_name("rgb_controls.html").read_text(), "text/html; charset=utf-8")
            if self.path == "/state":
                with simulator.lock:
                    return self.respond(200, {"values": simulator.values, "online": simulator.online})
            self.respond(404, {"error": "Not found."})

        def do_POST(self):
            if not self.trusted_request():
                return self.respond(403, {"error": "Local requests only."})
            if self.path != "/state":
                return self.respond(404, {"error": "Not found."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096 or self.headers.get("Content-Type") != "application/json":
                    raise ValueError("Send a small JSON state change.")
                simulator.apply_rgb_changes(json.loads(self.rfile.read(size)))
                with simulator.lock:
                    self.respond(200, {"values": simulator.values, "online": simulator.online})
            except (ValueError, TypeError, UnicodeDecodeError) as error:
                self.respond(422, {"error": str(error)})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    print(f"RGB local controls: http://127.0.0.1:{server.server_port}", flush=True)
    return server
