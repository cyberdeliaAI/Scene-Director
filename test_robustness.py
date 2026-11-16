"""Regression checks for rotating-choice slots, settings files, server errors, the browser session link,
folder opening, page security, output filters and image checks."""
import base64
import contextlib
import http.client
import io
import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import warnings
from pathlib import Path
from unittest import mock

import scene_director as sd
import scene_director_web as web
from test_scene_director import FakeServer, reply, scene

HERE = Path(__file__).resolve().parent
FRAMING = {"framing": "close-up | medium | full body"}


def framings(events):
    return [event["choices"].get("framing") for event in events if event["type"] == "prompt"]


class RotatingSlotTests(unittest.TestCase):
    def run_brief(self, replies, count, batch_size, parameters=FRAMING):
        events = []
        with tempfile.TemporaryDirectory() as folder, FakeServer(replies) as model:
            code = sd.run(sd.Brief("woman", "crafts", parameters=dict(parameters)), count,
                          sd.Client(model.url, timeout=10), events.append, batch_size, folder)
            records = list(Path(folder).glob("*.json"))
            record = json.loads(records[0].read_text(encoding="utf-8")) if records else None
            sent = [json.loads(request["messages"][1]["content"]) for request in model.requests]
        return code, events, record, sent

    def test_rejected_draft_keeps_later_labels_and_reopens_its_slot(self):
        first = json.dumps({"ideas": ["Idea: carves a spoon", "Idea: sands a chair", "Idea: oils a table"],
                            "prompts": [scene("carves a spoon"), scene("sands a chair", " The saw hums loudly."),
                                        scene("oils a table")]})
        code, events, record, sent = self.run_brief([first, reply("glues a drawer")], 3, 3)
        self.assertEqual(code, 0)
        # The second draft was written for "medium". The third keeps "full body", and "medium" is asked again.
        self.assertEqual(framings(events), ["close-up", "full body", "medium"])
        self.assertEqual([c["framing"] for c in sent[0]["per_prompt_choices"]], ["close-up", "medium", "full body"])
        self.assertEqual(sent[1]["per_prompt_choices"], [{"framing": "medium"}])
        self.assertEqual([c["framing"] for c in record["choices"]], ["close-up", "full body", "medium"])

    def test_spread_stays_even_over_a_long_run_with_rejections(self):
        tasks = ["carves a spoon", "sands a chair", "oils a table", "glues a drawer", "planes a door", "turns a bowl",
                 "weaves a basket", "paints a stool", "drills a shelf", "varnishes a frame", "files a hinge", "stains a crate"]

        def batch(start, reject):
            activities = tasks[start:start + 3]
            prompts = [scene(a, " The motor hums." if i == reject else "") for i, a in enumerate(activities)]
            return json.dumps({"ideas": [f"Idea: {a}" for a in activities], "prompts": prompts})
        replies = [batch(0, 1), batch(3, None), batch(6, 0), batch(9, None)]
        code, events, record, _sent = self.run_brief(replies, 6, 3)
        self.assertEqual(code, 0)
        labels = framings(events)
        self.assertEqual(len(labels), 6)
        self.assertEqual({label: labels.count(label) for label in set(labels)},
                         {"close-up": 2, "medium": 2, "full body": 2})
        self.assertEqual([c["framing"] for c in record["choices"]], labels)

    def test_extra_drafts_without_requested_choices_are_not_used(self):
        code, events, _record, _sent = self.run_brief([reply("carves a spoon", "sands a chair", "oils a table")], 2, 2)
        self.assertEqual(code, 0)
        self.assertEqual(framings(events), ["close-up", "medium"])
        self.assertNotIn("oils a table", " ".join(e["text"] for e in events if e["type"] == "prompt"))

    def test_runs_without_rotation_are_unchanged(self):
        code, events, record, sent = self.run_brief([reply("carves a spoon", "sands a chair", "oils a table")], 2, 3,
                                                    parameters={"setting": "indoors"})
        self.assertEqual(code, 0)
        self.assertEqual([e["choices"] for e in events if e["type"] == "prompt"], [{}, {}])
        self.assertEqual(record["choices"], [])
        self.assertNotIn("per_prompt_choices", sent[0])

    def test_reply_positions_ignore_introductions_but_count_unusable_drafts(self):
        positions = sd.parse_reply_positions(json.dumps({"prompts": ["too short", 7, scene("carves a spoon")]}))
        self.assertEqual([p for p, _idea, _prompt in positions], [2])
        plain = "Here are your prompts:\n\n1. " + scene("carves a spoon") + "\n\n2. " + scene("sands a chair")
        self.assertEqual([p for p, _idea, _prompt in sd.parse_reply_positions(plain)], [0, 1])
        self.assertEqual(len(sd.parse_reply(plain)), 2)


class BrokenSettingsTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.settings_file = Path(self.folder.name) / "settings.json"
        self.settings_file.write_text(json.dumps({"api_url": "http://localhost:1234/v1", "sampling": {"temperature": 5},
                                                  "sampling_precise": {"top_k": 0.5}}), encoding="utf-8")

    def tearDown(self):
        self.folder.cleanup()

    def test_page_still_loads_and_save_repairs_the_file(self):
        server, app = web.create_server(port=0, output_dir=self.folder.name, settings_file=self.settings_file)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"

        def call(path, body=None):
            data = json.dumps(body).encode() if body is not None else None
            request = urllib.request.Request(base + path, data=data,
                                             headers={"Content-Type": "application/json"} if body is not None else {})
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.loads(response.read())
        try:
            state = call("/api/state")
            self.assertEqual(state["settings"]["sampling"], sd.validate_sampling())
            self.assertEqual(state["settings"]["sampling_precise"], sd.validate_sampling(defaults=sd.PRECISE_DEFAULTS))
            self.assertIn("Open Settings and press Save", state["settings"]["settings_warning"])
            self.assertIn("Generate scenes", state["settings"]["settings_warning"])
            self.assertTrue(call("/api/presets")["ok"])
            saved = call("/api/settings", {"sampling": {"temperature": 0.7}})
            self.assertTrue(saved["ok"], saved)
            self.assertNotIn("settings_warning", saved["settings"])
            self.assertEqual(sd.saved_sampling(self.settings_file)["temperature"], 0.7)
            self.assertEqual(sd.saved_sampling(self.settings_file, "precise"), sd.validate_sampling(defaults=sd.PRECISE_DEFAULTS))
        finally:
            app.stop()
            server.shutdown()
            server.server_close()

    def test_terminal_reports_but_web_worker_falls_back(self):
        with self.assertRaises(sd.GenerationError):
            sd.saved_sampling(self.settings_file)
        self.assertEqual(sd.saved_sampling(self.settings_file, fallback=True), sd.validate_sampling())
        request = Path(self.folder.name) / "request.json"
        events = []
        with FakeServer([reply("carves a spoon")]) as model, mock.patch.object(sd, "SETTINGS_FILE", self.settings_file):
            request.write_text(json.dumps({"subject": "woman", "direction": "jobs", "count": 1, "api_url": model.url,
                                           "output_dir": self.folder.name, "live": False}), encoding="utf-8")
            code = sd.run_request(str(request), events.append)
        self.assertEqual(code, 0, events)
        self.assertEqual(model.requests[0]["temperature"], sd.TEMPERATURE)


class UnexpectedErrorTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.server, self.app = web.create_server(port=0, output_dir=self.folder.name,
                                                  settings_file=Path(self.folder.name) / "settings.json")
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.app.stop()
        self.server.shutdown()
        self.server.server_close()
        self.folder.cleanup()

    def call(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data,
                                         headers={"Content-Type": "application/json"} if body is not None else {})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.code, json.loads(exc.read())

    def test_get_and_post_answer_with_json_and_log_only_type_and_place(self):
        stderr = io.StringIO()
        with warnings.catch_warnings(), contextlib.redirect_stderr(stderr), \
                mock.patch.object(self.app, "history", side_effect=KeyError("sk-secret-in-message")), \
                mock.patch.object(self.app, "favorite", side_effect=ValueError("bad value")):
            # Other completed tests may release file objects during this short stderr capture.
            # Keep the exact diagnostic/privacy assertions independent of Python cleanup warnings.
            warnings.simplefilter("ignore", ResourceWarning)
            get_status, get_body = self.call("/api/history")
            post_status, post_body = self.call("/api/favorite", {"prompt": "x"})
            state_status, _ = self.call("/api/state")
        self.assertEqual((get_status, get_body["ok"]), (500, False))
        self.assertIn("KeyError", get_body["error"])
        self.assertEqual((post_status, post_body["ok"]), (500, False))
        self.assertIn("ValueError", post_body["error"])
        self.assertEqual(state_status, 200)
        lines = stderr.getvalue().splitlines()
        self.assertEqual(len(lines), 2, lines)
        for line, kind in zip(lines, ("KeyError", "ValueError")):
            self.assertRegex(line, r"^Scene Director diagnostic: " + kind + r" at scene_director_web\.py:\d+$")
        self.assertNotIn("sk-secret", stderr.getvalue())

    def test_known_errors_keep_their_normal_answers(self):
        status, body = self.call("/api/history/item?file=/nonexistent.txt")
        self.assertEqual((status, body["ok"]), (200, False))
        self.assertIn("not in the current output folder", body["error"])


class SmallFixTests(unittest.TestCase):
    JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\xff\xd9"

    def test_jpeg_with_data_after_the_end_marker_is_accepted(self):
        self.assertEqual(sd.image_mime(self.JPEG + b"\x00\x00trailer"), "image/jpeg")
        url = "data:image/jpeg;base64," + base64.b64encode(self.JPEG + b"\x00" * 16).decode()
        self.assertEqual(sd.validate_reference({"data_url": url}).data_url, url)

    def test_cut_off_jpeg_is_still_refused(self):
        with self.assertRaises(sd.GenerationError):
            sd.image_mime(self.JPEG[:-2])
        with self.assertRaises(sd.GenerationError):
            sd.image_mime(b"\xff\xd8\xff\xd9")

    def test_desktop_help_text_names_no_single_platform(self):
        source = (HERE / "web" / "app.js").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"on this Mac\b", source))


class BrowserSessionTests(unittest.TestCase):
    TOKEN = "t" * 43

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.server, self.app = web.create_server(port=0, output_dir=self.folder.name, session_token=self.TOKEN,
                                                  settings_file=Path(self.folder.name) / "settings.json")
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.app.stop()
        self.server.shutdown()
        self.server.server_close()
        self.folder.cleanup()

    def request(self, method, path, cookie=None, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Cookie": cookie} if cookie else {}
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_private_link_becomes_a_strict_cookie(self):
        status, headers, _ = self.request("GET", "/?token=" + self.TOKEN)
        self.assertEqual((status, headers["Location"]), (303, "/"))
        cookie = headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertTrue(cookie.startswith(f"scene_director_{self.port}={self.TOKEN};"))
        session = cookie.split(";")[0]
        self.assertEqual(self.request("GET", "/", session)[0], 200)
        self.assertEqual(self.request("GET", "/app.js", session)[0], 200)
        self.assertEqual(self.request("GET", "/api/state", session)[0], 200)
        self.assertEqual(self.request("POST", "/api/favorite", session, {"prompt": "A test prompt"})[0], 200)

    def test_everything_is_refused_without_the_link(self):
        wrong = f"scene_director_{self.port}={'x' * 43}"
        other_port = f"scene_director_{self.port + 1}={self.TOKEN}"
        for cookie in (None, wrong, other_port, "garbage;;=="):
            status, headers, body = self.request("GET", "/", cookie)
            self.assertEqual(status, 403)
            self.assertIn(b"private link", body)
            for path in ("/app.js", "/api/state", "/api/history"):
                self.assertEqual(self.request("GET", path, cookie)[0], 403, (path, cookie))
            for path, body in (("/api/open-folder", {"path": self.folder.name}),
                               ("/api/dataset/write", {"folder": self.folder.name, "files": [{"name": "x.txt", "text": "x"}]})):
                status, _, answer = self.request("POST", path, cookie, body)
                self.assertEqual(status, 403)
                self.assertFalse(json.loads(answer)["ok"])
        self.assertEqual(self.request("GET", "/?token=" + "y" * 43)[0], 403)
        self.assertFalse((Path(self.folder.name) / "x.txt").exists())

    def test_launch_opens_the_private_link(self):
        opened = []
        with mock.patch.object(web.webbrowser, "open", side_effect=opened.append), \
                mock.patch.object(web.LoopbackHTTPServer, "serve_forever", side_effect=KeyboardInterrupt), \
                mock.patch.object(web.threading, "Timer", side_effect=lambda _delay, fn, args: mock.Mock(start=lambda: fn(*args))), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(web.launch(port=0, output_dir=self.folder.name), 0)
        self.assertEqual(len(opened), 1)
        self.assertRegex(opened[0], r"^http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9_-]{40,}$")
        self.assertIn(opened[0], output.getvalue())

    def test_desktop_token_mode_is_unchanged(self):
        server, app = web.create_server(port=0, output_dir=self.folder.name, auth_token="d" * 64,
                                        settings_file=Path(self.folder.name) / "settings.json")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
            connection.request("GET", "/api/state", headers={"X-Scene-Director-Token": "d" * 64})
            self.assertEqual(connection.getresponse().status, 200)
            connection.close()
            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=10)
            connection.request("GET", "/api/state")
            response = connection.getresponse()
            self.assertEqual(response.status, 403)
            self.assertIn(b"Desktop session required", response.read())
            connection.close()
        finally:
            app.stop()
            server.shutdown()
            server.server_close()


class OpenFolderTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / "prompts" / "sub").mkdir(parents=True)
        (self.root / "prompts" / "run.txt").write_text("x\n", encoding="utf-8")
        (self.root / "elsewhere").mkdir()
        self.app = web.App({"output_dir": str(self.root / "prompts")}, settings_file=self.root / "settings.json")

    def tearDown(self):
        self.folder.cleanup()

    def test_only_the_output_folder_and_folders_inside_it_open(self):
        with mock.patch.object(web.subprocess, "Popen") as popen, mock.patch.object(web.os, "startfile", create=True) as startfile:
            for allowed in ("prompts", "prompts/sub", "prompts/run.txt"):
                self.app.open_folder(str(self.root / allowed))
            for refused in ("elsewhere", ".", "prompts/../elsewhere", "/"):
                with self.assertRaises(sd.GenerationError) as caught:
                    self.app.open_folder(str(self.root / refused) if refused != "/" else "/")
                self.assertIn("Only the output folder", str(caught.exception))
            with self.assertRaises(sd.GenerationError) as caught:
                self.app.open_folder(str(self.root / "prompts" / "missing"))
            self.assertIn("does not exist yet", str(caught.exception))
        self.assertEqual(popen.call_count + startfile.call_count, 3)
        opened = [str(call.args[0][-1] if call.args and isinstance(call.args[0], list) else call.args[0])
                  for call in popen.call_args_list + startfile.call_args_list]
        self.assertTrue(all(Path(path).resolve().is_dir() for path in opened), opened)

    def test_saved_output_folder_counts_too(self):
        saved = self.root / "elsewhere"
        self.app.save_settings({"api_url": "http://localhost:1234/v1", "output_dir": str(saved)})
        with mock.patch.object(web.subprocess, "Popen"), mock.patch.object(web.os, "startfile", create=True):
            self.app.open_folder(str(saved))


class PageSecurityTests(unittest.TestCase):
    def test_page_allows_only_its_own_scripts(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        server, app = web.create_server(port=0, output_dir=folder.name, settings_file=Path(folder.name) / "settings.json")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/", timeout=10) as response:
                policy = response.headers["Content-Security-Policy"]
                page = response.read().decode("utf-8")
        finally:
            app.stop()
            server.shutdown()
            server.server_close()
        script = next(part.strip() for part in policy.split(";") if part.strip().startswith("script-src"))
        self.assertEqual(script, "script-src 'self'")
        # Inline scripts and handler attributes would be blocked, so the page must have none.
        self.assertEqual(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", page), [])
        self.assertEqual(re.findall(r"\son[a-z]+\s*=", page), [])

    def test_desktop_builds_use_the_final_bundle_id(self):
        for name in ("build-native.cjs", "electron-signed.cjs"):
            source = (HERE / "desktop" / name).read_text(encoding="utf-8")
            self.assertIn("'nl.cyberdelia.scenedirector'", source)
            self.assertNotIn(".test'", source)


class FilterPrecisionTests(unittest.TestCase):
    def test_names_food_animals_and_figures_are_not_identity_details(self):
        for text in ("Lora kneads dough at a steel counter.", "A woman lifts her warm cinnamon bun from the tray.",
                     "A hazel-eyed spaniel waits by the door.", "A husky with pale blue eyes sits in the snow.",
                     "A blue-eyed doll sits on the shelf.", "She brushes the cat's green eyes clean."):
            self.assertFalse(sd.has_prompt_metadata(text) or sd.identity_violation(text, "lora"), text)
        for text in ("She ties her hair in a tight bun.", "She checks her bun in the mirror.",
                     "She strokes the cat, her green eyes half closed.", "The dog's owner, a brunette, waits.",
                     "A woman with green eyes holds a kitten."):
            self.assertTrue(sd.identity_violation(text, "lora"), text)
        for text in ("A LoRA character kneads dough.", "lora weight 0.8", "Two LoRAs are loaded.", "subject 1 smiles"):
            self.assertTrue(sd.has_prompt_metadata(text), text)

    def test_visual_uses_of_sound_words_pass(self):
        for text in ("The arch echoes the curve of the bridge behind it.", "A crackle glaze covers the vase.",
                     "Neon signs glow above a buzzing market street.", "She immerses the cloth in dye."):
            self.assertEqual(sd.nonvisual_sentences(text), [], text)
        for text in ("Footsteps echo through the hall.", "Her laughter echoes.", "A buzzing fluorescent tube flickers.",
                     "A fire crackles in the grate.", "An immersive scene.", "A radio hums on the shelf behind her."):
            self.assertTrue(sd.nonvisual_sentences(text), text)

    def test_retry_without_optional_settings_only_for_request_field_errors(self):
        for text in ('API error 400: {"error":"Unknown model: foo"}', "model not supported for chat",
                     "This model does not support images", "Invalid API key", "context length exceeded"):
            self.assertIsNone(sd.OPTIONAL_REJECTED_RE.search(text), text)
        for text in ("unsupported reasoning_effort", "Extra inputs are not permitted", "Unrecognized request argument supplied: top_k",
                     "Unknown parameter: 'presence_penalty'", "Unexpected field in request", "property 'foo' is not allowed",
                     "Unsupported param: min_p"):
            self.assertIsNotNone(sd.OPTIONAL_REJECTED_RE.search(text), text)

    def test_unknown_model_error_is_shown_instead_of_retried(self):
        client = sd.Client("http://127.0.0.1:9/v1", model="missing-model", timeout=10)
        refusal = sd.ApiError(400, '{"error":"Unknown model: missing-model"}')
        with mock.patch.object(sd.Client, "_open", side_effect=refusal) as sent:
            with self.assertRaises(sd.ApiError):
                client.chat("system", "user", 100)
        self.assertEqual(sent.call_count, 1)
        self.assertTrue(client.use_extras)


if __name__ == "__main__":
    unittest.main()
