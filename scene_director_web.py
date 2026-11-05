"""Local web interface for Scene Director. Standard library only.

The page talks to this small server on 127.0.0.1. Each run starts the engine
(scene_director.py) as a child process that reports progress as JSON lines,
so Stop ends a run at once and finished batches stay saved.
"""

import json
import hmac
import os
import re
import subprocess
import sys
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import scene_director as engine
import scene_director_presets as prompt_presets

HERE = Path(__file__).resolve().parent
PAGE = HERE / "web" / "index.html"
FONT_DIR = HERE / "web" / "fonts"
FONT_RE = re.compile(r"/fonts/([a-z0-9-]+\.woff2)")
SETTINGS_FILE = engine.SETTINGS_FILE
DEFAULT_PORT = 7863
MAX_BODY = 4 * ((engine.MAX_IMAGE_BYTES + 2) // 3) + 512 * 1024
SETTING_KEYS = ("server", "api_url", "model", "output_dir", "preset_dir", "vision_preset_dir")


class Job:
    def __init__(self, process, workflow="scenes"):
        self.id = uuid.uuid4().hex[:12]
        self.process = process
        self.workflow = workflow
        self.events = []
        self.lock = threading.Lock()
        self.finished = False
        self.cancelled = False
        self.saved = {"file": None, "count": 0}
        self.log = []

    def add(self, event):
        with self.lock:
            if self.finished:
                return
            event = dict(event, seq=len(self.events))
            self.events.append(event)
            if event["type"] == "saved":
                self.saved = {"file": event.get("file"), "count": event.get("count", 0)}
            elif event["type"] == "log":
                self.log = (self.log + [event.get("message", "")])[-6:]
            elif event["type"] in ("done", "error", "stopped"):
                self.finished = True

    def since(self, start):
        with self.lock:
            return self.events[start:], self.finished


class App:
    def __init__(self, defaults, settings_file=SETTINGS_FILE, worker_command=None):
        self.defaults = defaults
        self.settings_file = Path(settings_file)
        self.job = None
        self.lock = threading.Lock()
        self.worker_command = worker_command or [sys.executable, "-u", str(HERE / "scene_director.py")]

    # Settings ------------------------------------------------------------

    def _saved(self):
        try:
            saved = json.loads(self.settings_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return {k: v for k, v in saved.items() if isinstance(v, str) or
                (k == "sampling" and isinstance(v, dict))} if isinstance(saved, dict) else {}

    def settings(self):
        """Settings for the page. The API key itself never leaves this process."""
        saved = self._saved()
        values = dict(self.defaults)
        values.update({k: v for k, v in saved.items() if k in SETTING_KEYS})
        values["has_api_key"] = bool(saved.get("api_key"))
        values["sampling"] = engine.validate_sampling(saved.get("sampling"))
        return values

    def save_settings(self, data):
        unknown = set(data) - set(SETTING_KEYS) - {"api_key", "forget_api_key", "sampling"}
        if unknown:
            raise engine.GenerationError("Unsupported setting: " + ", ".join(sorted(unknown)))
        previous = self.settings()
        values = {k: str(data.get(k, previous.get(k, ""))).strip() for k in SETTING_KEYS}
        for key in ("preset_dir", "vision_preset_dir"):
            if key in data and (not isinstance(data[key], str) or len(data[key]) > 4096 or "\x00" in data[key]):
                raise engine.GenerationError("Enter a valid preset folder path.")
        if not values["api_url"]:
            raise engine.GenerationError("Enter a server address.")
        if not values["output_dir"]:
            values["output_dir"] = str(engine.OUTPUT_DIR)
        values["sampling"] = engine.validate_sampling(data.get("sampling"), base=previous["sampling"])
        key = str(data.get("api_key") or "").strip()
        old_key = self._saved().get("api_key", "")
        if data.get("forget_api_key"):
            key = ""
        elif not key:
            key = old_key  # a blank field keeps the saved key
        if key:
            values["api_key"] = key
        try:
            temporary = self.settings_file.with_suffix(".tmp")
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(values, output, indent=2, allow_nan=False)
                output.write("\n")
            os.chmod(temporary, 0o600)
            temporary.replace(self.settings_file)
        except OSError as exc:
            raise engine.GenerationError(f"Could not save the settings to {self.settings_file}: {exc}") from exc
        return self.settings()

    def api_key(self, data):
        """A key typed in the page wins, then the saved key, then the environment."""
        return str(data.get("api_key") or "").strip() or self._saved().get("api_key", "") or engine.API_KEY

    # Models ----------------------------------------------------------------

    def models(self, data):
        client = engine.Client(str(data.get("api_url") or engine.DEFAULT_API_URL),
                               self.api_key(data), "", engine.LIST_TIMEOUT)
        try:
            models, kind = client.list_models()
        except engine.GenerationError as exc:
            return {"ok": False, "error": str(exc)}
        try:
            auto, note = engine.Client.choose(models, kind, require_vision=data.get("require_vision") is True), None
        except engine.GenerationError as exc:
            auto, note = None, str(exc)
        return {"ok": True, "server": kind, "models": models, "auto": auto, "note": note}

    # Runs ----------------------------------------------------------------

    def start(self, data):
        with self.lock:
            if self.job is not None and not self.job.finished:
                raise engine.GenerationError("A run is already in progress. Stop it first.")
            payload = {k: v for k, v in data.items() if k != "api_key"}
            payload["sampling"] = engine.validate_sampling(data.get("sampling"), base=self.settings()["sampling"])
            engine.request_from_json(payload)  # validate before starting a process
            env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
            env.pop("SCENE_DIRECTOR_DESKTOP_TOKEN", None)
            key = self.api_key(data)
            if key:
                env["SCENE_DIRECTOR_API_KEY"] = key  # passed privately, never on the command line
            command = [*self.worker_command, "--jsonl", "--request", "-"]
            kwargs = {}
            if sys.platform == "win32":
                kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                       errors="replace", env=env, cwd=str(HERE), **kwargs)
            process.stdin.write(json.dumps(payload))
            process.stdin.close()
            job = Job(process, payload.get("workflow", "scenes"))
            self.job = job
        threading.Thread(target=self._read, args=(job,), daemon=True).start()
        return job

    @staticmethod
    def _read(job):
        try:
            for line in job.process.stdout:
                try:
                    event = json.loads(line)
                except ValueError:
                    event = None
                if isinstance(event, dict) and isinstance(event.get("type"), str):
                    job.add(event)
                elif line.strip():
                    job.add({"type": "log", "message": line.rstrip()})
        finally:
            code = job.process.wait()
            if job.cancelled:
                job.add({"type": "stopped", **job.saved, "saved": job.saved["count"]})
            elif not job.finished:
                detail = " ".join(job.log[-3:])
                job.add({"type": "error", "saved": job.saved["count"], "file": job.saved["file"],
                         "message": f"The generator stopped unexpectedly (exit code {code}). {detail}".strip()})

    def stop(self):
        job = self.job
        if job is None or job.finished:
            return False
        job.cancelled = True
        try:
            job.process.terminate()
        except OSError:
            pass
        return True

    @staticmethod
    def open_folder(path_text):
        path = Path(str(path_text or "")).expanduser()
        if path.is_file():
            path = path.parent
        if not path.is_dir():
            raise engine.GenerationError("That folder does not exist yet. It is created when the first prompts are saved.")
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        elif sys.platform == "win32":
            os.startfile(str(path))  # noqa: S606 - opens a local folder for the user
        else:
            subprocess.Popen(["xdg-open", str(path)])


def make_handler(app, port_holder, auth_token=None):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"SceneDirector/{engine.VERSION}"

        def log_message(self, *_args):
            pass

        # Helpers -----------------------------------------------------------

        def _host_ok(self):
            # Refuse requests that reach this port under another host name.
            host = (self.headers.get("Host") or "").lower()
            port = port_holder["port"]
            return host in (f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}")

        def _authorized(self):
            return auth_token is None or hmac.compare_digest(
                (self.headers.get("X-Scene-Director-Token") or "").encode("utf-8"),
                auth_token.encode("utf-8"))

        def _send(self, status, body, content_type="application/json; charset=utf-8"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            if content_type.startswith("text/html"):
                self.send_header("Content-Security-Policy",
                                 "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                                 "style-src 'self' 'unsafe-inline'; "
                                 "font-src 'self'; img-src 'self' data: blob:; "
                                 "connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def _body(self):
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                return None
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return None
            try:
                value = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeError):
                return None
            return value if isinstance(value, dict) else None

        # Routes ----------------------------------------------------------------

        def do_GET(self):
            if not self._host_ok():
                return self._send(403, {"ok": False, "error": "Forbidden host."})
            if not self._authorized():
                return self._send(403, {"ok": False, "error": "Desktop session required."})
            url = urlparse(self.path)
            if url.path in ("/", "/index.html"):
                try:
                    return self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
                except OSError:
                    return self._send(500, b"web/index.html is missing.", "text/plain; charset=utf-8")
            font = FONT_RE.fullmatch(url.path)
            assets = {"/dataset.js": "text/javascript; charset=utf-8", "/dataset-core.js": "text/javascript; charset=utf-8",
                      "/dataset.css": "text/css; charset=utf-8", "/app-icon.png": "image/png"}
            if url.path in assets:
                try:
                    return self._send(200, (HERE / "web" / url.path[1:]).read_bytes(), assets[url.path])
                except OSError:
                    return self._send(404, {"ok": False, "error": "Not found."})
            if font:
                try:
                    return self._send(200, (FONT_DIR / font.group(1)).read_bytes(), "font/woff2")
                except OSError:
                    return self._send(404, {"ok": False, "error": "Not found."})
            if url.path == "/api/state":
                job = app.job
                return self._send(200, {
                    "ok": True, "version": engine.VERSION, "settings": app.settings(),
                    "presets": {k: {"label": v[0], "url": v[1]} for k, v in engine.SERVER_PRESETS.items()},
                    "default_output_dir": str(engine.OUTPUT_DIR),
                    "sampling_defaults": engine.validate_sampling(),
                    "job": {"id": job.id, "finished": job.finished, "workflow": job.workflow} if job else None,
                })
            if url.path == "/api/presets":
                return self._send(200, prompt_presets.list_presets(app.settings()))
            if url.path == "/api/job":
                query = parse_qs(url.query)
                job = app.job
                if job is None or query.get("id", [""])[0] != job.id:
                    return self._send(404, {"ok": False, "error": "Unknown run."})
                try:
                    start = max(0, int(query.get("since", ["0"])[0]))
                except ValueError:
                    start = 0
                events, finished = job.since(start)
                return self._send(200, {"ok": True, "events": events, "finished": finished})
            return self._send(404, {"ok": False, "error": "Not found."})

        def do_POST(self):
            if not self._host_ok():
                return self._send(403, {"ok": False, "error": "Forbidden host."})
            if not self._authorized():
                return self._send(403, {"ok": False, "error": "Desktop session required."})
            data = self._body()
            if data is None:
                return self._send(400, {"ok": False, "error": "Send a JSON object."})
            path = urlparse(self.path).path
            try:
                if path == "/api/models":
                    return self._send(200, app.models(data))
                if path == "/api/settings":
                    return self._send(200, {"ok": True, "settings": app.save_settings(data)})
                if path == "/api/generate":
                    job = app.start(data)
                    return self._send(200, {"ok": True, "id": job.id})
                if path == "/api/stop":
                    return self._send(200, {"ok": True, "stopping": app.stop()})
                if path == "/api/open-folder":
                    app.open_folder(data.get("path"))
                    return self._send(200, {"ok": True})
            except engine.GenerationError as exc:
                return self._send(200, {"ok": False, "error": str(exc)})
            except OSError as exc:
                return self._send(200, {"ok": False, "error": f"{exc.__class__.__name__}: {exc}"})
            return self._send(404, {"ok": False, "error": "Not found."})

    return Handler


def create_server(port=None, api_url=None, model=None, output_dir=None, settings_file=SETTINGS_FILE,
                  auth_token=None, worker_command=None):
    defaults = {
        "server": "lmstudio" if (api_url or engine.API_URL) == engine.DEFAULT_API_URL else "custom",
        "api_url": api_url or engine.API_URL,
        "model": model or "",
        "output_dir": str(output_dir or engine.OUTPUT_DIR),
        "preset_dir": "",
        "vision_preset_dir": "",
    }
    app = App(defaults, settings_file, worker_command)
    holder = {"port": 0}
    handler = make_handler(app, holder, auth_token)
    candidates = [port] if port is not None else list(range(DEFAULT_PORT, DEFAULT_PORT + 20))
    last_error = None
    for candidate in candidates:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), handler)
            break
        except OSError as exc:
            last_error = exc
    else:
        raise OSError(f"No free port found for the web interface: {last_error}")
    server.daemon_threads = True
    holder["port"] = server.server_address[1]
    return server, app


def launch(port=None, open_browser=True, api_url=None, model=None, output_dir=None):
    try:
        server, app = create_server(port, api_url, model, output_dir)
    except OSError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"{engine.APP_NAME} {engine.VERSION} is running at {url}")
    print("Keep this window open while you use it. Press Ctrl+C to quit.")
    if open_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        app.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(launch())
