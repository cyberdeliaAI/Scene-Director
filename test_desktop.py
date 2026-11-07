"""Desktop service integration tests, also runnable against the bundled binary.

SCENE_DIRECTOR_TEST_BACKEND=/absolute/path/to/scene-director-backend python3 -m unittest test_desktop
"""

import contextlib
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from test_scene_director import FakeServer, reference_data, reply

HERE = Path(__file__).resolve().parent
TOKEN = "desktop-integration-test-" + "a" * 40


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.folder.name) / "data"
        self.output_dir = Path(self.folder.name) / "prompts"
        self.process = None
        self.env = {**os.environ, "SCENE_DIRECTOR_DESKTOP_TOKEN": TOKEN,
            "SCENE_DIRECTOR_DESKTOP_DATA_DIR": str(self.data_dir),
            "SCENE_DIRECTOR_DESKTOP_OUTPUT_DIR": str(self.output_dir)}
        executable = os.environ.get("SCENE_DIRECTOR_TEST_BACKEND")
        self.command = [executable] if executable else [sys.executable, "-u", str(HERE / "scene_director_desktop.py")]

    def launch(self):
        self.process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=self.env, cwd=self.folder.name)
        messages = queue.Queue()
        threading.Thread(target=lambda: messages.put(self.process.stdout.readline()), daemon=True).start()
        try:
            ready = messages.get(timeout=25)
        except queue.Empty:
            self.fail("Service startup timed out")
        self.assertTrue(ready, "Service exited before becoming ready")
        message = json.loads(ready)
        self.assertEqual(message["type"], "ready")
        self.base = "http://127.0.0.1:" + str(message["port"])

    def close_service(self):
        self.process.stdin.close()
        self.assertEqual(self.process.wait(timeout=8), 0, self.process.stderr.read().decode())
        self.process.stdout.close()
        self.process.stderr.close()
        self.process = None

    def tearDown(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.stdin.close()
                try:
                    self.process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            for stream in [self.process.stdin, self.process.stdout, self.process.stderr]:
                stream.close()
        self.folder.cleanup()

    def call(self, route, body=None, token=TOKEN):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-Scene-Director-Token"] = token
        request = urllib.request.Request(self.base + route, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            with contextlib.closing(error):
                return error.code, error.read()

    def run_job(self, body):
        result = json.loads(self.call("/api/generate", body)[1])
        self.assertTrue(result["ok"], result)
        job_id = result["id"]
        events = []
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            result = json.loads(self.call(f"/api/job?id={job_id}&since={len(events)}")[1])
            events.extend(result["events"])
            if result["finished"]:
                self.assertEqual(events[-1]["type"], "done", events)
                return events
            time.sleep(0.05)
        self.fail("Generation timed out")

    def test_private_session_assets_and_eof_shutdown(self):
        self.launch()
        for route, body in [("/", None), ("/api/state", None), ("/api/stop", {})]:
            self.assertEqual(self.call(route, body, token=None)[0], 403)
            self.assertEqual(self.call(route, body, token="wrong")[0], 403)
        self.assertEqual(self.call("/")[0], 200)
        for route in ('/app.js','/app.css','/prompt-core.js','/dataset.js','/dataset-core.js','/dataset.css','/app-icon.png'):
            self.assertEqual(self.call(route)[0], 200, route)
        self.assertEqual(self.call("/fonts/archivo.woff2")[0], 200)
        self.assertEqual(self.call("/settings.json")[0], 404)
        state = json.loads(self.call("/api/state")[1])
        self.assertEqual(state["default_output_dir"], str(self.output_dir))
        self.close_service()
        with self.assertRaises(urllib.error.URLError):
            urllib.request.urlopen(self.base + "/api/state", timeout=2)

    def test_settings_survive_relaunch_outside_bundle(self):
        self.launch()
        result = json.loads(self.call("/api/settings", {"api_url": "http://localhost:1234/v1",
            "sampling": {"temperature": 0.42}, "api_key": "fake-private-key"})[1])
        self.assertTrue(result["ok"], result)
        self.close_service()
        settings = self.data_dir / "settings.json"
        self.assertTrue(settings.exists())
        if os.name != "nt":
            self.assertEqual(settings.stat().st_mode & 0o777, 0o600)
        self.launch()
        status, body = self.call("/api/state")
        self.assertEqual(status, 200)
        self.assertNotIn(b"fake-private-key", body)
        self.assertEqual(json.loads(body)["settings"]["sampling"]["temperature"], 0.42)

    def test_worker_scenes_and_image_edits(self):
        edit = "Change her hair to auburn and her shoes to navy blue; preserve everything else in the original image."
        with FakeServer([reply("carves a spoon"), reply("sands a chair"),
                         json.dumps({"prompts": [edit]})], vision=True) as model:
            self.launch()
            for target in ["krea2", "z-image-turbo"]:
                self.run_job({"subject": "woman", "direction": "jobs", "count": 1,
                    "target": target, "api_url": model.url, "output_dir": str(self.output_dir)})
            self.run_job({"workflow": "change_image", "changes": "Change hair and shoes.",
                "edit_output": "edit_instruction", "reference_image": reference_data(),
                "api_url": model.url, "output_dir": str(self.output_dir)})
            self.assertEqual(len(model.requests), 3)
            self.assertIsInstance(model.requests[-1]["messages"][1]["content"], list)
        files = list(self.output_dir.glob("*.txt"))
        self.assertEqual(len(files), 3)
        self.assertTrue(any(file.read_text().strip() == edit for file in files))
        self.assertFalse(any("data:image" in file.read_text() for file in files))

    def test_parent_exit_stops_an_active_generation(self):
        entered = threading.Event()
        release = threading.Event()

        def stalled_reply():
            entered.set()
            release.wait(timeout=15)
            yield reply("carves a spoon")

        with FakeServer(stalled_reply()) as model:
            model.server.handle_error = lambda *_args: None  # client deliberately exits mid-request
            self.launch()
            result = json.loads(self.call("/api/generate", {"subject": "woman", "direction": "jobs",
                "count": 1, "api_url": model.url, "output_dir": str(self.output_dir)})[1])
            self.assertTrue(result["ok"], result)
            try:
                self.assertTrue(entered.wait(timeout=10), "Worker never contacted the model")
                self.close_service()
            finally:
                release.set()
        self.assertEqual(list(self.output_dir.glob("*.txt")), [])

    def test_shared_presets_and_rewrite_worker(self):
        shared = Path(self.folder.name) / "shared-presets"; shared.mkdir()
        system = "Preserve the lens value. Output one prompt only."
        (shared / "Composition.txt").write_text(system)
        with FakeServer(["A woman at a workbench, photographed with a 50mm f/1.4 lens.",
                         "A blue circle beside an orange square."], vision=True, stream=True) as model:
            self.launch()
            result = json.loads(self.call("/api/settings", {"preset_dir": str(shared), "vision_preset_dir": str(shared)})[1])
            self.assertTrue(result["ok"], result)
            library = json.loads(self.call("/api/presets")[1])
            self.assertEqual(library["text"][-1]["prompt"], system)
            self.assertEqual(library["vision"][-1]["prompt"], system)
            events = self.run_job({"workflow": "rewrite", "rewrite_system": system,
                "rewrite_prompt": "Woman, workbench, 50mm f/1.4.",
                "api_url": model.url, "output_dir": str(self.output_dir)})
            self.run_job({"workflow": "rewrite", "rewrite_system": "Describe the image faithfully.",
                "rewrite_use_vision": True, "rewrite_prompt": "", "reference_image": reference_data(),
                "api_url": model.url, "output_dir": str(self.output_dir)})
        self.assertEqual(events[0]["workflow"], "rewrite")
        self.assertEqual(model.requests[0]["messages"][0]["content"], system)
        self.assertEqual(len(list(self.output_dir.glob("prompt-rewrite_text_*.txt"))), 1)
        self.assertEqual(len(list(self.output_dir.glob("prompt-rewrite_vision_*.txt"))), 1)
        self.assertIsInstance(model.requests[1]["messages"][1]["content"], list)

    def test_targeted_prompt_edit_works_through_the_private_service(self):
        result = "A bare-faced woman, blue coat, Amsterdam."
        with FakeServer([result], stream=True, vision=False) as model:
            self.launch()
            events = self.run_job({"workflow": "edit_prompt",
                "source_prompt": "A woman with red lipstick, blue coat, Amsterdam.",
                "changes": "Remove her makeup.", "api_url": model.url, "output_dir": str(self.output_dir)})
        self.assertEqual(events[0]["workflow"], "edit_prompt")
        self.assertEqual(next(e["text"] for e in events if e["type"] == "prompt"), result)
        files = list(self.output_dir.glob("prompt-edit_*.txt"))
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].read_text().strip(), result)
        self.assertIsInstance(model.requests[0]["messages"][1]["content"], str)

    def test_dataset_caption_is_transient_and_uses_vision(self):
        with FakeServer(["A woman wearing a blue coat."], vision=True, stream=True) as model:
            self.launch()
            for asset in ["/dataset.js", "/dataset-core.js", "/dataset.css"]:
                self.assertEqual(self.call(asset)[0], 200)
            events = self.run_job({"workflow": "dataset_caption", "rewrite_system": "Caption only the visible crop.",
                "rewrite_use_vision": True, "caption_trigger": "test_token", "reference_image": reference_data(),
                "api_url": model.url, "output_dir": str(self.output_dir)})
        self.assertEqual(events[0]["workflow"], "dataset_caption")
        self.assertIsNone(events[-1]["file"])
        self.assertFalse(self.output_dir.exists())
        self.assertTrue(next(event["text"] for event in events if event["type"] == "prompt").startswith("test_token, "))


if __name__ == "__main__":
    unittest.main()
