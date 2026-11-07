"""Local web interface for Scene Director. Standard library only.

The page talks to this small server on 127.0.0.1. Each run starts the engine
(scene_director.py) as a child process that reports progress as JSON lines,
so Stop ends a run at once and finished batches stay saved.
"""

import base64
import binascii
import json
import hmac
import os
import random
import re
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
import webbrowser
from datetime import datetime
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
SETTING_KEYS = ("server", "api_url", "model", "output_dir", "preset_dir", "vision_preset_dir",
                "comfy_url", "comfy_workflow", "comfy_node", "comfy_input", "comfy_seed")
SAMPLING_KEYS = ("sampling", "sampling_precise")
DATASET_MAX_BODY = 160 * 1024 * 1024  # one image of up to 100 MB plus its caption, base64-encoded
FAVORITES = "favorites.txt"
SAFE_NAME = re.compile(r'[^\\/:*?"<>|\x00-\x1f]{1,200}')
PROMPT_INPUTS = ("text", "prompt", "positive", "text_g", "text_l", "string", "value", "caption")
WORKFLOW_LABELS = {"change_image": "Change an image", "rewrite": "Rewrite a prompt", "edit_prompt": "Edit a prompt"}
COMFY_DEFAULTS = {"comfy_url": "http://127.0.0.1:8188", "comfy_workflow": "", "comfy_node": "",
                  "comfy_input": "text", "comfy_seed": "random"}


def comfy_error(raw):
    try:
        data = json.loads(raw.decode("utf-8", errors="replace"))
    except ValueError:
        return raw.decode("utf-8", errors="replace")[:300]
    error = data.get("error") if isinstance(data, dict) else None
    message = error.get("message") if isinstance(error, dict) else str(error or "unknown error")
    for node_id, item in (data.get("node_errors") or {}).items() if isinstance(data, dict) else ():
        errors = item.get("errors") if isinstance(item, dict) else None
        if errors and isinstance(errors[0], dict):
            return f"{message} Node {node_id}: {errors[0].get('message', '')} {errors[0].get('details', '')}".strip()
    return message


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
        self.store_lock = threading.Lock()
        self.cancels = {}
        self.cancelled_tokens = {}
        self.resolved = {}
        self.vision_slots = threading.Semaphore(4)

    # Settings ------------------------------------------------------------

    def _saved(self):
        try:
            saved = json.loads(self.settings_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return {k: v for k, v in saved.items() if isinstance(v, str) or
                (k in SAMPLING_KEYS and isinstance(v, dict))} if isinstance(saved, dict) else {}

    def settings(self):
        """Settings for the page. The API key itself never leaves this process."""
        saved = self._saved()
        values = dict(self.defaults)
        values.update({k: v for k, v in saved.items() if k in SETTING_KEYS})
        values["has_api_key"] = bool(saved.get("api_key"))
        for key, default in COMFY_DEFAULTS.items():
            values.setdefault(key, default)
        values["sampling"] = engine.validate_sampling(saved.get("sampling"))
        values["sampling_precise"] = engine.validate_sampling(saved.get("sampling_precise"), defaults=engine.PRECISE_DEFAULTS)
        return values

    def save_settings(self, data):
        unknown = set(data) - set(SETTING_KEYS) - {"api_key", "forget_api_key", *SAMPLING_KEYS}
        if unknown:
            raise engine.GenerationError("Unsupported setting: " + ", ".join(sorted(unknown)))
        previous = self.settings()
        values = {k: str(data.get(k, previous.get(k, ""))).strip() for k in SETTING_KEYS}
        for key in ("preset_dir", "vision_preset_dir"):
            if key in data and (not isinstance(data[key], str) or len(data[key]) > 4096 or "\x00" in data[key]):
                raise engine.GenerationError("Enter a valid preset folder path.")
        if not values["api_url"]:
            raise engine.GenerationError("Enter a server address.")
        if values["comfy_url"] and not re.match(r"https?://[^\s/]+", values["comfy_url"]):
            raise engine.GenerationError("Enter the ComfyUI address with http:// or https://, such as http://127.0.0.1:8188.")
        if len(values["comfy_workflow"]) > 4096 or "\x00" in values["comfy_workflow"]:
            raise engine.GenerationError("Enter a valid ComfyUI workflow path.")
        if values["comfy_seed"] not in ("random", "fixed"):
            values["comfy_seed"] = "random"
        if not values["output_dir"]:
            values["output_dir"] = str(engine.OUTPUT_DIR)
        values["sampling"] = engine.validate_sampling(data.get("sampling"), base=previous["sampling"])
        values["sampling_precise"] = engine.validate_sampling(data.get("sampling_precise"), base=previous["sampling_precise"])
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
            profile = engine.sampling_profile(str(data.get("workflow") or "scenes"))
            base = self.settings()["sampling_precise" if profile == "precise" else "sampling"]
            payload["sampling"] = engine.validate_sampling(data.get("sampling"), base=base)
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

    # Stores beside settings.json -------------------------------------------------

    @property
    def data_dir(self):
        return self.settings_file.parent

    def _read_store(self, name, default):
        try:
            value = json.loads((self.data_dir / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return default
        return value if isinstance(value, type(default)) else default

    def _write_store(self, name, value):
        path = self.data_dir / name
        temporary = path.with_name(path.name + ".tmp")
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(value, output, ensure_ascii=False, indent=2)
                output.write("\n")
            temporary.replace(path)
        except OSError as exc:
            raise engine.GenerationError(f"Could not save {path.name}: {exc}") from exc

    @staticmethod
    def _title(value, limit, what):
        title = " ".join(str(value or "").split())
        if not title or len(title) > limit:
            raise engine.GenerationError(f"Enter a {what} of at most {limit} characters.")
        return title

    @staticmethod
    def _same(first, second):
        return unicodedata.normalize("NFKC", first).casefold() == unicodedata.normalize("NFKC", second).casefold()

    def briefs(self):
        items = [i for i in self._read_store("briefs.json", []) if isinstance(i, dict) and isinstance(i.get("name"), str)]
        return {"ok": True, "briefs": items}

    def save_brief(self, data):
        action = data.get("action")
        if action not in ("save", "delete"):
            raise engine.GenerationError("Choose save or delete.")
        name = self._title(data.get("name"), 100, "brief name")
        with self.store_lock:
            items = [i for i in self.briefs()["briefs"] if not self._same(i["name"], name)]
            if action == "save":
                brief = data.get("brief")
                if not isinstance(brief, dict) or len(json.dumps(brief)) > 200_000:
                    raise engine.GenerationError("This brief cannot be saved.")
                if len(items) >= 200:
                    raise engine.GenerationError("Delete a saved brief first; up to 200 are kept.")
                items.append({"name": name, "brief": brief, "saved": datetime.now().isoformat(timespec="seconds")})
                items.sort(key=lambda item: item["name"].casefold())
            self._write_store("briefs.json", items)
        return {"ok": True, "briefs": items}

    def caption_scripts(self):
        items = [i for i in self._read_store("caption_scripts.json", []) if isinstance(i, dict)
                 and all(isinstance(i.get(k), str) for k in ("id", "title", "prompt"))]
        return {"ok": True, "scripts": items}

    def save_caption_script(self, data):
        action = data.get("action")
        with self.store_lock:
            items = self.caption_scripts()["scripts"]
            if action == "delete":
                items = [i for i in items if i["id"] != data.get("id")]
            elif action == "save":
                title = self._title(data.get("title"), 200, "script title")
                prompt = data.get("prompt")
                if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 100_000:
                    raise engine.GenerationError("The caption script is empty or longer than 100,000 characters.")
                script_id = data.get("id") if any(i["id"] == data.get("id") for i in items) else uuid.uuid4().hex[:12]
                if any(i["id"] != script_id and self._same(i["title"], title) for i in items):
                    raise engine.GenerationError("A saved caption script already uses this title. Choose another title.")
                if len(items) >= 200 and not any(i["id"] == script_id for i in items):
                    raise engine.GenerationError("Delete a saved caption script first; up to 200 are kept.")
                items = [i for i in items if i["id"] != script_id] + [{"id": script_id, "title": title, "prompt": prompt}]
                items.sort(key=lambda item: item["title"].casefold())
            else:
                raise engine.GenerationError("Choose save or delete.")
            self._write_store("caption_scripts.json", items)
        return {"ok": True, "scripts": items, "id": data.get("id") if action == "delete" else script_id}

    # Prompt files, history and favorites -----------------------------------------

    def _output_root(self):
        return Path(self.settings()["output_dir"] or engine.OUTPUT_DIR).expanduser().resolve()

    def _run_file(self, value):
        root = self._output_root()
        try:
            path = Path(str(value or "")).expanduser().resolve()
        except (OSError, RuntimeError, ValueError):
            path = None
        if path is None or path.parent != root or path.suffix.lower() != ".txt" or path.name == FAVORITES or not path.is_file():
            raise engine.GenerationError("That prompt file is not in the current output folder.")
        return path

    @staticmethod
    def _lines(path):
        return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    @staticmethod
    def _record(path):
        try:
            value = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return value if isinstance(value, dict) and value.get("app") == engine.APP_NAME else None

    @staticmethod
    def _prompts(path, record):
        text = path.read_text(encoding="utf-8")
        stored = record.get("prompts")
        if isinstance(stored, list) and all(isinstance(p, str) for p in stored):
            stored = [p.replace("\r\n", "\n").replace("\r", "\n") for p in stored]
            if "".join(p + "\n" for p in stored) == text:
                return stored
        # Older records did not keep boundaries. These workflows always wrote
        # one complete prompt; the 3.7 editor also had no JSON record at all.
        request = record.get("request") or {}
        workflow = request.get("workflow") if isinstance(request, dict) else None
        if (workflow in ("edit_prompt", "rewrite", "change_image") or
                path.name.startswith(("prompt-edit_", "prompt-rewrite_")) or "_image-changes_" in path.name):
            return [text.rstrip("\n")] if text.strip() else []
        return [line for line in text.splitlines() if line.strip()]

    @staticmethod
    def _choices(record, count):
        choices = record.get("choices")
        if (isinstance(choices, list) and len(choices) == count and
                all(isinstance(item, dict) and all(isinstance(k, str) and isinstance(v, str)
                    for k, v in item.items()) for item in choices)):
            return choices
        request = record.get("request") or {}
        parameters = request.get("parameters") if isinstance(request, dict) else None
        return engine.per_prompt_choices(parameters if isinstance(parameters, dict) else {}, count) or [{} for _ in range(count)]

    def history(self):
        root = self._output_root()
        if not root.is_dir():
            return {"ok": True, "folder": str(root), "runs": []}
        files = [p for p in root.glob("*.txt") if p.is_file() and p.name != FAVORITES]
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        runs = []
        for path in files[:200]:
            record = self._record(path) or {}
            request = record.get("request") if isinstance(record.get("request"), dict) else {}
            workflow = request.get("workflow")
            label = (f"{request.get('subject', '')}{' + ' + request['subject2'] if request.get('subject2') else ''} · {request.get('direction', '')}"
                     if workflow == "scenes" else WORKFLOW_LABELS.get(workflow, path.stem))
            try:
                count = len(self._prompts(path, record))
            except (OSError, UnicodeError):
                continue
            runs.append({"file": str(path), "name": path.name, "label": label, "workflow": workflow,
                         "count": count, "model": record.get("model"), "has_brief": bool(request),
                         "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")})
        return {"ok": True, "folder": str(root), "runs": runs}

    def history_item(self, file_value):
        path = self._run_file(file_value)
        record = self._record(path) or {}
        prompts = self._prompts(path, record)
        ideas = record.get("ideas") if isinstance(record.get("ideas"), list) else []
        ideas = [i if isinstance(i, str) else "" for i in ideas][:len(prompts)]
        return {"ok": True, "file": str(path), "prompts": prompts, "ideas": ideas + [""] * (len(prompts) - len(ideas)),
                "choices": self._choices(record, len(prompts)), "request": record.get("request"), "model": record.get("model")}

    def save_run(self, data):
        path = self._run_file(data.get("file"))
        prompts, ideas = data.get("prompts"), data.get("ideas")
        if not isinstance(prompts, list) or len(prompts) > 1000 or not all(isinstance(p, str) and len(p) <= 20000 for p in prompts):
            raise engine.GenerationError("Send up to 1,000 prompts of at most 20,000 characters.")
        if any(not p.strip() for p in prompts):
            raise engine.GenerationError("A prompt cannot be empty. Remove it from the run instead.")
        record = self._record(path) or {"app": engine.APP_NAME, "version": engine.VERSION}
        choices = data.get("choices", self._choices(record, len(prompts)))
        if (not isinstance(choices, list) or len(choices) != len(prompts) or
                any(not isinstance(item, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                    for k, v in item.items()) for item in choices)):
            raise engine.GenerationError("Send one set of parameter choices per prompt.")
        prompts = [p.replace("\r\n", "\n").replace("\r", "\n").strip() for p in prompts]
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text("".join(p + "\n" for p in prompts), encoding="utf-8")
        temporary.replace(path)
        record.update(count=len(prompts), prompts=prompts, choices=choices)
        if isinstance(ideas, list) and len(ideas) == len(prompts):
            record["ideas"] = [i if isinstance(i, str) else "" for i in ideas]
        record_path = path.with_suffix(".json")
        temporary = record_path.with_name(record_path.name + ".tmp")
        temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(record_path)
        return {"ok": True, "file": str(path), "count": len(prompts)}

    def favorites(self):
        path = self._output_root() / FAVORITES
        try:
            return {"ok": True, "file": str(path), "prompts": self._lines(path)}
        except (OSError, UnicodeError):
            return {"ok": True, "file": str(path), "prompts": []}

    def favorite(self, data):
        prompt = data.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 20000:
            raise engine.GenerationError("Choose a prompt to star.")
        prompt = " ".join(prompt.split())
        with self.store_lock:
            root = self._output_root()
            root.mkdir(parents=True, exist_ok=True)
            prompts = [p for p in self.favorites()["prompts"] if p != prompt]
            starred = data.get("remove") is not True
            if starred:
                prompts.append(prompt)
            path = root / FAVORITES
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_text("".join(p + "\n" for p in prompts), encoding="utf-8")
            temporary.replace(path)
        return {"ok": True, "starred": starred, "file": str(path), "count": len(prompts)}

    # Direct caption and locate requests (no worker process) ------------------------

    def _vision_client(self, data, settings, transport=None):
        sampling = engine.validate_sampling(data.get("sampling"), base=self.settings()["sampling_precise"])
        client = engine.Client(settings["api_url"], self.api_key(data), settings["model"], settings["timeout"], sampling=sampling, transport=transport)
        key = (client.url, client.key, client.model)
        with self.lock:
            hit = self.resolved.get(key)
        if hit and time.monotonic() - hit[1] < 60:
            client.model, client.vision_checked = hit[0], True
        else:
            model = client.pick_model(require_vision=True)
            with self.lock:
                self.resolved[key] = (model, time.monotonic())
        return client

    def _cancellable(self, data, action):
        token = str(data.get("token") or uuid.uuid4().hex)[:64]
        event = threading.Event()
        with self.lock:
            now = time.monotonic()
            self.cancelled_tokens = {t: deadline for t, deadline in self.cancelled_tokens.items() if deadline > now}
            if token in self.cancelled_tokens:
                event.set()
            self.cancels[token] = event
        try:
            while not self.vision_slots.acquire(timeout=0.05):
                if event.is_set():
                    raise engine.Cancelled("Vision request stopped.")
            try:
                if event.is_set():
                    raise engine.Cancelled("Vision request stopped.")
                result = action(event)
                if event.is_set():
                    raise engine.Cancelled("Vision request stopped.")
                return result
            finally:
                self.vision_slots.release()
        except engine.Cancelled as exc:
            return {"ok": False, "stopped": True, "error": str(exc)}
        finally:
            with self.lock:
                self.cancels.pop(token, None)

    def caption(self, data):
        payload = {k: v for k, v in data.items() if k not in ("token", "api_key")}
        payload.update(workflow="dataset_caption", count=1, rewrite_use_vision=True)
        brief, _, settings = engine.request_from_json(payload)
        def action(event):
            with engine.CancellableRequests(event) as transport:
                client = self._vision_client(data, settings, transport)
                text = engine.caption_image(brief, client, event)
                return {"ok": True, "text": text, "words": len(text.split()), "model": client.model}
        return self._cancellable(data, action)

    def locate(self, data):
        if set(data) - {"image", "target", "token", "api_url", "api_key", "model"}:
            raise engine.GenerationError("Unsupported auto-crop field.")
        target = data.get("target")
        if not isinstance(target, str) or not target.strip() or len(target) > 200:
            raise engine.GenerationError("Choose what to crop to.")
        image = engine.validate_reference({"data_url": data.get("image")})
        settings = {"api_url": str(data.get("api_url") or engine.API_URL), "model": str(data.get("model") or ""), "timeout": engine.TIMEOUT}
        def action(event):
            with engine.CancellableRequests(event) as transport:
                client = self._vision_client(data, settings, transport)
                return {"ok": True, "box": engine.locate_region(client, image, target.strip(), event)}
        return self._cancellable(data, action)

    def stop_vision(self, data):
        tokens = data.get("tokens")
        with self.lock:
            events = [e for t, e in self.cancels.items() if not isinstance(tokens, list) or t in tokens]
            # Stop may arrive before a large image request finishes uploading.
            # Remember its client token so it cannot start after cancellation.
            if isinstance(tokens, list):
                deadline = time.monotonic() + max(60, engine.TIMEOUT)
                for token in tokens[:1000]:
                    if isinstance(token, str) and 0 < len(token) <= 64:
                        self.cancelled_tokens[token] = deadline
                self.cancelled_tokens = dict(list(self.cancelled_tokens.items())[-2000:])
        for event in events:
            event.set()
        return {"ok": True, "stopped": len(events)}

    # Dataset folder export -----------------------------------------------------------

    @staticmethod
    def _safe_name(value, what="file name"):
        name = str(value or "")
        if not SAFE_NAME.fullmatch(name) or name in (".", "..") or name.startswith(".") or name != name.strip() or len(name.encode("utf-8")) > 240:
            raise engine.GenerationError(f"Invalid {what}: {name[:80]!r}")
        return name

    def _dataset_folder(self, data):
        text = str(data.get("folder") or "").strip()
        folder = Path(text).expanduser()
        if not text or "\x00" in text or not folder.is_absolute() or not folder.is_dir():
            raise engine.GenerationError("Enter the full path of an existing folder for the dataset.")
        folder = folder.resolve()
        sub = data.get("subfolder") or ""
        return folder / self._safe_name(sub, "subfolder name") if sub else folder

    def dataset_check(self, data):
        target = self._dataset_folder(data)
        names = sorted(p.name for p in target.iterdir() if p.is_file())[:20000] if target.is_dir() else []
        return {"ok": True, "path": str(target), "exists": target.is_dir(), "files": names}

    def dataset_write(self, data):
        target = self._dataset_folder(data)
        files = data.get("files")
        if not isinstance(files, list) or not 1 <= len(files) <= 20:
            raise engine.GenerationError("Send between 1 and 20 files at a time.")
        prepared = []
        for item in files:
            if not isinstance(item, dict):
                raise engine.GenerationError("Invalid dataset file.")
            name = self._safe_name(item.get("name"))
            if isinstance(item.get("text"), str):
                raw = item["text"].encode("utf-8")
            else:
                try:
                    raw = base64.b64decode(str(item.get("data") or ""), validate=True)
                except (ValueError, binascii.Error) as exc:
                    raise engine.GenerationError(f"The data for {name} is not valid.") from exc
            prepared.append((name, raw))
        target.mkdir(exist_ok=True)
        if data.get("overwrite") is not True:
            existing = [name for name, _ in prepared if (target / name).exists()]
            if existing:
                raise engine.GenerationError(f"{existing[0]} already exists in {target}. Choose Replace existing files or another folder.")
        for name, raw in prepared:
            temporary = target / f".{name}.part"
            temporary.write_bytes(raw)
            temporary.replace(target / name)
        return {"ok": True, "path": str(target), "written": len(prepared)}

    # ComfyUI ---------------------------------------------------------------------------

    @staticmethod
    def _comfy_workflow(value):
        text = str(value or "").strip()
        path = Path(text).expanduser()
        if not text or "\x00" in text or not path.is_file():
            raise engine.GenerationError("Choose a ComfyUI workflow file saved with Export (API) in Settings.")
        if path.stat().st_size > 20 * 1024 * 1024:
            raise engine.GenerationError("The ComfyUI workflow file is larger than 20 MB.")
        try:
            graph = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError) as exc:
            raise engine.GenerationError("The ComfyUI workflow file is not valid JSON.") from exc
        if isinstance(graph, dict) and "nodes" in graph and "links" in graph:
            raise engine.GenerationError("This is a ComfyUI editor workflow. In ComfyUI, use Export (API) and choose that file instead.")
        if not isinstance(graph, dict) or not graph or not all(
                isinstance(node, dict) and isinstance(node.get("class_type"), str) and isinstance(node.get("inputs"), dict)
                for node in graph.values()):
            raise engine.GenerationError("This file is not a ComfyUI API workflow.")
        return graph

    def comfy_inspect(self, data):
        graph = self._comfy_workflow(data.get("workflow") or self.settings()["comfy_workflow"])
        candidates = []
        for node_id, node in graph.items():
            title = (node.get("_meta") or {}).get("title") or node["class_type"]
            for name, value in node["inputs"].items():
                if isinstance(value, str) and (name.lower() in PROMPT_INPUTS or len(value) > 40):
                    rank = 0 if re.search(r"positive|prompt", title, re.I) else 1 if re.search(r"textencode|prompt", node["class_type"], re.I) else 2
                    candidates.append({"node": str(node_id), "input": name, "class_type": node["class_type"],
                                       "title": title, "preview": value[:120], "rank": rank})
        candidates.sort(key=lambda c: (c["rank"], c["node"]))
        seeds = sum(1 for node in graph.values() for k, v in node["inputs"].items()
                    if k in ("seed", "noise_seed") and isinstance(v, int) and not isinstance(v, bool))
        return {"ok": True, "candidates": candidates, "seeds": seeds}

    def comfy_queue(self, data):
        prompts = data.get("prompts")
        if not isinstance(prompts, list) or not 1 <= len(prompts) <= 500 or not all(isinstance(p, str) and p.strip() and len(p) <= 20000 for p in prompts):
            raise engine.GenerationError("Send between 1 and 500 prompts.")
        settings = self.settings()
        graph = self._comfy_workflow(settings["comfy_workflow"])
        node, field_name = settings["comfy_node"], settings["comfy_input"] or "text"
        if node not in graph or field_name not in graph[node]["inputs"]:
            raise engine.GenerationError("Choose the prompt node again in Settings → ComfyUI. The workflow no longer has it.")
        url = settings["comfy_url"].rstrip("/")
        queued = []
        for prompt in prompts:
            copy = json.loads(json.dumps(graph))
            copy[node]["inputs"][field_name] = prompt
            if settings["comfy_seed"] != "fixed":
                for item in copy.values():
                    for key, value in item["inputs"].items():
                        if key in ("seed", "noise_seed") and isinstance(value, int) and not isinstance(value, bool):
                            item["inputs"][key] = random.randrange(0, 2 ** 50)
            request = urllib.request.Request(url + "/prompt", headers={"Content-Type": "application/json"},
                                             data=json.dumps({"prompt": copy, "client_id": "scene-director"}).encode("utf-8"))
            done = f" {len(queued)} prompt{'s were' if len(queued) != 1 else ' was'} queued before this." if queued else ""
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    result = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                raise engine.GenerationError(f"ComfyUI refused the workflow ({exc.code}): {comfy_error(exc.read())}.{done}") from exc
            except (urllib.error.URLError, OSError, ValueError) as exc:
                raise engine.GenerationError(f"Cannot reach ComfyUI at {url}. Start ComfyUI or check the address in Settings.{done}") from exc
            queued.append(result.get("prompt_id") if isinstance(result, dict) else None)
        return {"ok": True, "queued": len(queued), "ids": queued}

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

        def _body(self, limit=MAX_BODY):
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                return None
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > limit:
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
            assets = {"/app.js": "text/javascript; charset=utf-8", "/prompt-core.js": "text/javascript; charset=utf-8", "/app.css": "text/css; charset=utf-8",
                      "/dataset.js": "text/javascript; charset=utf-8", "/dataset-core.js": "text/javascript; charset=utf-8",
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
                    "precise_defaults": engine.validate_sampling(defaults=engine.PRECISE_DEFAULTS),
                    "job": {"id": job.id, "finished": job.finished, "workflow": job.workflow} if job else None,
                })
            if url.path == "/api/presets":
                return self._send(200, prompt_presets.list_presets(app.settings()))
            simple = {"/api/history": app.history, "/api/briefs": app.briefs,
                      "/api/caption-scripts": app.caption_scripts, "/api/favorites": app.favorites}
            try:
                if url.path in simple:
                    return self._send(200, simple[url.path]())
                if url.path == "/api/history/item":
                    return self._send(200, app.history_item(parse_qs(url.query).get("file", [""])[0]))
            except engine.GenerationError as exc:
                return self._send(200, {"ok": False, "error": str(exc)})
            except (OSError, UnicodeError) as exc:
                return self._send(200, {"ok": False, "error": f"{exc.__class__.__name__}: {exc}"})
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
            path = urlparse(self.path).path
            data = self._body(DATASET_MAX_BODY if path == "/api/dataset/write" else MAX_BODY)
            if data is None:
                return self._send(400, {"ok": False, "error": "Send a JSON object."})
            routes = {"/api/run-file": app.save_run, "/api/favorite": app.favorite, "/api/briefs": app.save_brief,
                      "/api/caption-scripts": app.save_caption_script, "/api/caption": app.caption,
                      "/api/caption/stop": app.stop_vision, "/api/locate": app.locate,
                      "/api/dataset/check": app.dataset_check, "/api/dataset/write": app.dataset_write,
                      "/api/comfy/inspect": app.comfy_inspect, "/api/comfy/queue": app.comfy_queue}
            try:
                if path in routes:
                    return self._send(200, routes[path](data))
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
        **COMFY_DEFAULTS,
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
