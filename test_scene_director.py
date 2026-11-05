"""Behavioral checks with fake LM Studio / OpenAI servers. Run: python3 -m unittest"""

import contextlib
import base64
import io
import json
import subprocess
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import zlib
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import scene_director as sd
import scene_director_web as web

HERE = Path(__file__).resolve().parent


def png_bytes():
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\x00\x94\xb0\x82")) + chunk(b"IEND", b""))


def reference_data(mode="inspiration", notes=""):
    return {"data_url": "data:image/png;base64," + base64.b64encode(png_bytes()).decode(), "mode": mode, "notes": notes}


def scene(activity, extra=""):
    return (f"A woman {activity} at a broad wooden workbench beside a tall window. "
            "She wears a faded canvas apron over a loose cotton shirt, with sleeves "
            "rolled above her wrists. Small tools rest in a shallow tray near her "
            "hand, while unfinished pieces occupy shelves behind her. A medium "
            "side view keeps her gesture and the working surface clearly visible. "
            "Soft window light crosses the bench from the left, revealing fine dust "
            "in the wood and leaving the far wall in gentle shadow." + extra)


def reply(*activities, ideas=True):
    prompts = [scene(a) for a in activities]
    data = {"prompts": prompts}
    if ideas:
        data["ideas"] = [f"Idea: {a}" for a in activities]
    return json.dumps(data)


class FakeServer:
    """LM Studio-like server. lmstudio=False behaves like a plain OpenAI server."""

    def __init__(self, replies, lmstudio=True, loaded=True, reject_extras=False, messages=None,
                 stream=False, reasoning="", stream_error=None, require_key=None,
                 vision=False, v1_models=None, reject_image_uri=False, reject_images=False):
        self.replies = iter(replies)
        self.messages = messages
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def send_json(self, value, status=200):
                data = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def refused(self):
                if require_key and self.headers.get("Authorization") != f"Bearer {require_key}":
                    self.send_json({"error": "Unauthorized"}, 401)
                    return True
                return False

            def do_GET(self):
                if self.refused():
                    return None
                if self.path == "/api/v1/models" and v1_models is not None:
                    return self.send_json({"models": v1_models})
                if self.path == "/api/v0/models":
                    if not lmstudio:
                        return self.send_json({"error": "not found"}, 404)
                    return self.send_json({"data": [
                        {"id": "big-model-70b", "type": "llm", "state": "not-loaded"},
                        {"id": "qwen3.5-9b", "type": "vlm" if vision else "llm", "state": "loaded" if loaded else "not-loaded"},
                        {"id": "nomic-embed", "type": "embeddings", "state": "loaded"}]})
                return self.send_json({"data": [{"id": "embedding-model"}, {"id": "llama-3-8b"}]})

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.refused():
                    return None
                owner.requests.append(payload)
                content = payload["messages"][1]["content"]
                if isinstance(content, list):
                    if reject_images:
                        return self.send_json({"error": "This model does not support images"}, 400)
                    image_url = content[1]["image_url"]["url"]
                    if reject_image_uri and image_url.startswith("data:"):
                        return self.send_json({"error": "'url' field must be a base64 encoded image"}, 400)
                if reject_extras and "reasoning_effort" in payload:
                    return self.send_json({"error": "unsupported reasoning_effort"}, 400)
                if owner.messages is not None:
                    message = next(owner.messages, {"content": "[]"})
                    return self.send_json({"choices": [message]})
                content = next(owner.replies, "[]")
                if stream and payload.get("stream"):
                    return self.send_stream(content)
                return self.send_json({"choices": [{"message": {"content": content}, "finish_reason": "stop"}]})

            def send_stream(self, content):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                chunks = [{"reasoning_content": reasoning[i:i + 7]} for i in range(0, len(reasoning), 7)]
                chunks += [{"content": content[i:i + 9]} for i in range(0, len(content), 9)]
                for delta in chunks:
                    self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": delta}]}).encode() + b"\n\n")
                if stream_error:
                    self.wfile.write(b"data: " + json.dumps({"error": {"message": stream_error}}).encode() + b"\n\n")
                finish = "length" if reasoning and not content else "stop"
                self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": finish}]}).encode() + b"\n\n")
                self.wfile.write(b"data: [DONE]\n\n")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1"

    def __enter__(self):
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


def brief(**overrides):
    values = dict(subject="woman", direction="jobs")
    values.update(overrides)
    return sd.Brief(**values)


def collect(run_brief, count, server_url, **kwargs):
    events = []
    with tempfile.TemporaryDirectory() as folder:
        code = sd.run(run_brief, count, sd.Client(server_url, timeout=10), events.append,
                      kwargs.get("batch_size", sd.BATCH_SIZE), folder, kwargs.get("live", False))
        files = list(Path(folder).glob("*.txt"))
        lines = files[0].read_text(encoding="utf-8").splitlines() if files else []
    return code, events, lines


class PromptInstructionTests(unittest.TestCase):
    def test_work_rules_only_for_work_directions(self):
        self.assertIn("DIRECTION: WORK", sd.brief_system_prompt(brief(direction="jobs")))
        self.assertIn("DIRECTION: WORK", sd.brief_system_prompt(brief(direction="beroepen")))
        for direction in ("sport", "working out at the gym", "homework help", "quiet daily moments"):
            self.assertNotIn("DIRECTION: WORK", sd.brief_system_prompt(brief(direction=direction)), direction)
        self.assertNotIn("occupation", sd.brief_system_prompt(brief(direction="sport")))
        self.assertIsNone(brief(direction="yoga", wishes="No work uniforms").theme)
        self.assertIsNone(brief(direction="exercise after work").theme)
        narrow = sd.brief_system_prompt(brief(direction="working as a night-shift nurse"))
        self.assertIn("keep it in every prompt", narrow)

    def test_core_rules_present_for_both_targets(self):
        for target in sd.TARGET_PROFILES:
            text = sd.system_prompt(target)
            self.assertIn("one coherent activity", text)
            self.assertIn("visible features of the intended image", text)
            self.assertIn("For illustration, graphic or abstract work", text)
            self.assertIn(f"TARGET: {sd.TARGET_LABELS[target]}", text)
            self.assertNotIn("{word_range}", text)
        self.assertIn("Do not require a new identity", sd.system_prompt("z-image-turbo"))
        self.assertNotIn("different appearance in each prompt", sd.system_prompt("krea2"))

    def test_two_subject_brief_has_independent_identities(self):
        b = brief(second_subject="man", second_identity_mode="free", interaction="colleagues")
        data = json.loads(sd.build_user_message(b, 3, []))
        self.assertNotIn("identity_mode", data)
        self.assertEqual([s["identity_mode"] for s in data["subjects"]], ["lora", "free"])
        self.assertIn("SCENE: TWO SUBJECTS", sd.brief_system_prompt(b))
        self.assertIn("two plausible roles", sd.brief_system_prompt(b))
        self.assertIn("both requested subjects remain clearly visible", sd.brief_system_prompt(b))

    def test_previous_scenes_are_short_notes(self):
        notes = [f"note {i}" for i in range(50)]
        data = json.loads(sd.build_user_message(brief(), 5, notes))
        self.assertEqual(data["previous_scenes"], notes[-30:])
        self.assertEqual(sd.scene_note(None, scene("carves a spoon")).split()[:3], ["A", "woman", "carves"])
        self.assertLessEqual(len(sd.scene_note("x " * 80, "").split()), 30)


class ParsingTests(unittest.TestCase):
    def test_json_with_ideas_fences_and_reasoning(self):
        text = "<think>planning</think>\n```json\n" + reply("carves a spoon", "sands a chair") + "\n```"
        pairs = sd.parse_reply(text)
        self.assertEqual([idea for idea, _ in pairs], ["Idea: carves a spoon", "Idea: sands a chair"])

    def test_preamble_and_truncated_json_are_salvaged(self):
        full = json.dumps({"ideas": ["a", "b"], "prompts": [scene("carves a spoon"), scene("sands a chair")]})
        cut = full[: full.rindex(scene("sands a chair")[:40])]
        self.assertEqual(len(sd.parse_reply("Here you go:\n" + full)), 2)
        self.assertEqual(sd.parse_prompts(cut), [scene("carves a spoon")])

    def test_unfinished_reasoning_is_never_a_prompt(self):
        self.assertEqual(sd.parse_prompts("<think>" + scene("carves a spoon")), [])

    def test_plain_text_lists_still_work(self):
        text = "Prompt 1: " + scene("carves a spoon") + "\n\n2. " + scene("sands a chair")
        self.assertEqual(len(sd.parse_prompts(text)), 2)

    def test_model_reported_conflict_is_an_error(self):
        with self.assertRaises(sd.GenerationError):
            sd.parse_reply('{"error": "indoors conflicts with beach"}')


class FilterTests(unittest.TestCase):
    def test_identity_guard(self):
        self.assertTrue(sd.identity_violation("Her long auburn hair falls over her apron.", "lora"))
        self.assertTrue(sd.identity_violation("Her green eyes follow the needle.", "lora"))
        self.assertTrue(sd.identity_violation("Light falls on her pale skin.", "lora"))
        self.assertFalse(sd.identity_violation("A barber trims a client's beard with a hair clipper.", "lora"))
        self.assertFalse(sd.identity_violation("She traces a tattoo stencil on a client's forearm.", "lora"))
        self.assertFalse(sd.identity_violation("Her long auburn hair falls over her apron.", "free"))

    def test_mixed_identity_is_left_to_instructions(self):
        b = brief(second_subject="man", identity_mode="lora", second_identity_mode="free")
        self.assertFalse(sd.brief_identity_violation("His grey hair is cropped short.", b))

    def test_nonvisual_drafts_are_flagged_without_deleting_content(self):
        text = scene("carves a spoon", " A radio hums on the shelf behind her. The air feels heavy with sawdust.")
        self.assertEqual(len(sd.nonvisual_sentences(text)), 2)
        self.assertTrue(sd.nonvisual_sentences("The smell of bread fills a bakery. " + scene("kneads dough")))
        self.assertEqual(sd.nonvisual_sentences(scene("kneads dough")), [])
        self.assertFalse(sd.identity_violation("Her eyes follow the tool and her brows draw together.", "lora"))


class ServerTests(unittest.TestCase):
    def test_lm_studio_picks_loaded_chat_model(self):
        with FakeServer([]) as server:
            models, kind = sd.Client(server.url).list_models()
            self.assertEqual(kind, "lmstudio")
            self.assertEqual([m["id"] for m in models], ["big-model-70b", "qwen3.5-9b"])
            self.assertEqual(sd.Client(server.url).pick_model(), "qwen3.5-9b")

    def test_lm_studio_without_loaded_model_explains(self):
        with FakeServer([], loaded=False) as server:
            with self.assertRaisesRegex(sd.GenerationError, "no model loaded"):
                sd.Client(server.url).pick_model()

    def test_openai_fallback_skips_embeddings(self):
        with FakeServer([], lmstudio=False) as server:
            models, kind = sd.Client(server.url).list_models()
            self.assertEqual((kind, [m["id"] for m in models]), ("openai", ["llama-3-8b"]))

    def test_thinking_without_answer_stops_at_once(self):
        messages = iter([{"message": {"content": "", "reasoning_content": "Let me think..."}, "finish_reason": "length"}])
        with FakeServer([], messages=messages) as server:
            code, events, _ = collect(brief(), 3, server.url)
        self.assertEqual(code, 1)
        self.assertEqual(len(server.requests), 1)
        self.assertIn("thinking", events[-1]["message"])

    def test_extras_dropped_when_rejected_and_reasoning_off_sent(self):
        with FakeServer([reply("carves a spoon")], reject_extras=True) as server:
            code, events, lines = collect(brief(), 1, server.url)
        self.assertEqual(code, 0)
        self.assertEqual(server.requests[0]["reasoning_effort"], "none")
        self.assertNotIn("top_k", server.requests[1])
        self.assertEqual(len(lines), 1)
        self.assertTrue(any(e["type"] == "notice" for e in events))


class StreamingTests(unittest.TestCase):
    def test_live_run_streams_deltas_and_keeps_results(self):
        content = reply("carves a spoon", "sands a chair")
        with FakeServer([content], stream=True, reasoning="Two scenes, then JSON.") as server:
            code, events, lines = collect(brief(), 2, server.url, live=True)
        self.assertEqual(code, 0)
        self.assertTrue(server.requests[0]["stream"])
        deltas = [e for e in events if e["type"] == "delta"]
        self.assertEqual("".join(e["text"] for e in deltas if e["channel"] == "content"), content)
        self.assertEqual("".join(e["text"] for e in deltas if e["channel"] == "reasoning"), "Two scenes, then JSON.")
        batch = next(e for e in events if e["type"] == "batch")
        self.assertEqual((batch["first"], batch["last"], batch["live"]), (1, 2, True))
        self.assertEqual(len(lines), 2)

    def test_server_that_ignores_streaming_still_works_live(self):
        with FakeServer([reply("carves a spoon")]) as server:
            code, events, lines = collect(brief(), 1, server.url, live=True)
        self.assertEqual((code, len(lines)), (0, 1))
        self.assertTrue(any(e["type"] == "delta" for e in events))

    def test_stream_without_answer_is_a_thinking_error(self):
        with FakeServer([""], stream=True, reasoning="Hmm, let me consider every option...") as server:
            code, events, _ = collect(brief(), 2, server.url, live=True)
        self.assertEqual(code, 1)
        self.assertEqual(len(server.requests), 1)
        self.assertIn("thinking", events[-1]["message"])

    def test_error_inside_stream_is_reported(self):
        with FakeServer([reply("carves a spoon")], stream=True, stream_error="Context length exceeded") as server:
            code, events, _ = collect(brief(), 1, server.url, live=True)
        self.assertEqual(code, 1)
        self.assertIn("Context length exceeded", events[-1]["message"])

    def test_delta_buffer_merges_pieces(self):
        events = []
        buffer = sd.DeltaBuffer(events.append, interval=60)
        for piece in ("a", "b", "c"):
            buffer("content", piece)
        buffer("reasoning", "x")
        buffer("content", "d")
        buffer.flush()
        self.assertEqual([(e["channel"], e["text"]) for e in events],
                         [("content", "abc"), ("reasoning", "x"), ("content", "d")])


class RunTests(unittest.TestCase):
    def test_full_run_dedupes_filters_and_remembers(self):
        replies = [
            reply("carves a spoon", "carves a spoon", "sands a chair"),
            json.dumps({"ideas": ["x", "y"], "prompts": [
                "Her long auburn hair falls loose. " + scene("glues a joint"),
                scene("oils a table", " A radio hums behind her.")]}),
            reply("oils a table"),
        ]
        with FakeServer(replies) as server:
            code, events, lines = collect(brief(), 3, server.url, batch_size=3)
        self.assertEqual(code, 0)
        self.assertEqual(len(lines), 3)
        self.assertNotIn("hums", lines[2])
        second_brief = json.loads(server.requests[1]["messages"][1]["content"])
        self.assertEqual(second_brief["previous_scenes"], ["Idea: carves a spoon", "Idea: sands a chair"])
        self.assertEqual(second_brief["requested_count"], 1)
        kinds = [e["type"] for e in events]
        self.assertEqual(kinds[0], "start")
        self.assertEqual(kinds[-1], "done")
        self.assertEqual(server.requests[0]["model"], "qwen3.5-9b")

    def test_nonvisual_replacement_retains_second_subject(self):
        bad = scene("braces a board", " Across the bench, a man supports the board while a fan hums overhead.")
        good = scene("braces a board", " Across the bench, a man supports the board with both hands.")
        with FakeServer([json.dumps({"prompts": [bad]}), json.dumps({"prompts": [good]})]) as server:
            code, _, lines = collect(brief(second_subject="man"), 1, server.url)
        self.assertEqual(code, 0)
        self.assertEqual(lines, [good])
        correction = json.loads(server.requests[1]["messages"][1]["content"])["corrections_from_last_batch"]
        self.assertTrue(any("Preserve all requested subjects" in item for item in correction))

    def test_feedback_reaches_model_after_rejection(self):
        replies = [json.dumps({"prompts": ["Her blonde braid swings. " + scene("planes a board")]}),
                   reply("planes a board")]
        with FakeServer(replies) as server:
            code, _, _ = collect(brief(), 1, server.url)
        self.assertEqual(code, 0)
        feedback = json.loads(server.requests[1]["messages"][1]["content"])["corrections_from_last_batch"]
        self.assertTrue(any("hair" in item for item in feedback))

    def test_stalls_keep_partial_file(self):
        with FakeServer([reply("carves a spoon"), "nonsense", "nonsense", "nonsense"]) as server:
            code, events, lines = collect(brief(), 2, server.url, batch_size=1)
        self.assertEqual(code, 1)
        self.assertEqual(len(lines), 1)
        self.assertEqual(events[-1]["saved"], 1)

    def test_cli_jsonl_request_mode(self):
        with FakeServer([reply("carves a spoon", "sands a chair")]) as server, tempfile.TemporaryDirectory() as folder:
            request = {"subject": "woman", "direction": "jobs", "count": 2, "target": "z-image-turbo",
                       "api_url": server.url, "output_dir": folder, "avoid": ["rain"],
                       "parameters": [{"name": "setting", "value": "indoors"}, {"name": "", "value": ""}]}
            result = subprocess.run([sys.executable, str(HERE / "scene_director.py"), "--jsonl", "--request", "-"],
                                    input=json.dumps(request), capture_output=True, text=True, timeout=60)
            events = [json.loads(line) for line in result.stdout.splitlines()]
            sent = json.loads(server.requests[0]["messages"][1]["content"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(sent["parameters"], {"setting": "indoors"})
        self.assertEqual(sent["target_image_model"], "Z-Image Turbo")
        self.assertIn("TARGET: Z-Image Turbo", server.requests[0]["messages"][0]["content"])

    def test_request_validation(self):
        for bad in ({"count": 0}, {"target": "sdxl"}, {"creativity": "wild"},
                    {"parameters": [{"name": "setting", "value": ""}]},
                    {"parameters": ["a=1", "A=2"]}):
            with self.assertRaises(sd.GenerationError, msg=bad):
                sd.request_from_json(bad)
        b, count, settings = sd.request_from_json({"avoid": "rain; gyms"})
        self.assertEqual((b.subject, b.direction, count, b.avoid), ("person", "varied everyday scenes", 10, ["rain", "gyms"]))

    def test_dry_run_and_cli_errors_need_no_server(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(sd.main(["woman", "sport", "2", "--dry-run", "--target", "z-image-turbo"]), 0)
        self.assertIn("CREATIVE BRIEF", out.getvalue())
        for argv in (["woman", "jobs", "0"], ["woman", "jobs", "2", "-p", "broken"],
                     ["woman", "jobs", "2", "--interaction", "friends"]):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                sd.main(argv)


class WebTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.settings_file = Path(self.folder.name) / "settings.json"
        self.server, self.app = web.create_server(port=0, output_dir=self.folder.name,
                                                  settings_file=self.settings_file)
        self.port = self.server.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.app.stop()
        self.server.shutdown()
        self.server.server_close()
        self.folder.cleanup()

    def call(self, path, body=None, headers=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers or (
            {"Content-Type": "application/json"} if body is not None else {}))
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def test_page_fonts_and_guards(self):
        status, body = self.call("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Scene Director", body)
        self.assertNotIn(b"oMLX", body)
        self.assertEqual(self.call("/fonts/archivo.woff2")[0], 200)
        self.assertEqual(self.call("/fonts/../scene_director.py")[0], 404)
        self.assertEqual(self.call("/api/state", headers={"Host": "evil.example"})[0], 403)
        req = urllib.request.Request(self.base + "/api/stop", data=b"x=1",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(caught.exception.code, 400)

    def test_models_and_full_run_through_web(self):
        with FakeServer([reply("carves a spoon", "sands a chair")]) as llm:
            custom = sd.validate_sampling({"temperature": 0.45, "top_p": 0.83, "top_k": 8,
                                          "presence_penalty": 0.2, "reasoning_effort": None,
                                          "chat_template_kwargs": {"enable_thinking": None}})
            self.call("/api/settings", {"sampling": custom})
            status, body = self.call("/api/models", {"api_url": llm.url})
            models = json.loads(body)
            self.assertEqual((models["server"], models["auto"]), ("lmstudio", "qwen3.5-9b"))
            status, body = self.call("/api/generate", {"subject": "woman", "direction": "jobs", "count": 2,
                                                       "api_url": llm.url, "output_dir": self.folder.name})
            job = json.loads(body)
            self.assertTrue(job["ok"], job)
            events, deadline = [], time.time() + 30
            while time.time() < deadline:
                data = json.loads(self.call(f"/api/job?id={job['id']}&since={len(events)}")[1])
                events += data["events"]
                if data["finished"]:
                    break
                time.sleep(0.1)
        self.assertEqual(events[-1]["type"], "done", events)
        self.assertEqual(sum(e["type"] == "prompt" for e in events), 2)
        self.assertEqual(len(list(Path(self.folder.name).glob("*.txt"))), 1)
        self.assertTrue(any(e["type"] == "batch" for e in events))
        self.assertTrue(any(e["type"] == "delta" for e in events))
        sent = llm.requests[0]
        self.assertEqual((sent["temperature"], sent["top_p"], sent["top_k"], sent["presence_penalty"]), (0.45, 0.83, 8, 0.2))
        self.assertNotIn("reasoning_effort", sent)
        self.assertNotIn("chat_template_kwargs", sent)

    def test_only_allowed_generation_settings_can_be_saved_and_survive_restart(self):
        state = json.loads(self.call("/api/state")[1])
        self.assertEqual(state["sampling_defaults"], sd.validate_sampling())
        self.assertEqual(state["settings"]["sampling"], sd.validate_sampling())
        change = {"temperature": 1.1, "top_p": 0.9, "top_k": 42, "presence_penalty": -0.3,
                  "reasoning_effort": "low", "chat_template_kwargs": {"enable_thinking": True}}
        result = json.loads(self.call("/api/settings", {"sampling": change})[1])
        self.assertTrue(result["ok"], result)
        reloaded = web.App(self.app.defaults, self.settings_file).settings()
        self.assertEqual(reloaded["sampling"], change)
        self.assertEqual(sd.saved_sampling(self.settings_file), change)
        original = self.settings_file.read_bytes()
        for bad in ({"sampling": {"temperature": 3}}, {"sampling": {"top_k": 1.5}},
                    {"sampling": {"max_tokens": 99999}}, {"system_prompt": "override"},
                    {"sampling": {"chat_template_kwargs": {"custom_template": "override"}}}):
            result = json.loads(self.call("/api/settings", bad)[1])
            self.assertFalse(result["ok"], bad)
            self.assertEqual(self.settings_file.read_bytes(), original)
        result = json.loads(self.call("/api/settings", {"sampling": sd.validate_sampling()})[1])
        self.assertEqual(result["settings"]["sampling"], sd.validate_sampling())

    def test_saved_sampling_is_used_by_terminal_runs(self):
        self.call("/api/settings", {"sampling": {"temperature": 0.33, "top_p": 0.77}})
        with FakeServer([reply("carves a spoon")]) as llm, patch.object(sd, "SETTINGS_FILE", self.settings_file):
            with contextlib.redirect_stdout(io.StringIO()):
                code = sd.main(["woman", "jobs", "1", "--api-url", llm.url, "--output-dir", self.folder.name])
        self.assertEqual(code, 0)
        self.assertEqual((llm.requests[0]["temperature"], llm.requests[0]["top_p"]), (0.33, 0.77))

    def test_api_key_is_saved_kept_hidden_and_used(self):
        with FakeServer([reply("carves a spoon")], require_key="sk-local-123") as llm:
            refused = json.loads(self.call("/api/models", {"api_url": llm.url})[1])
            self.assertFalse(refused["ok"])
            self.assertIn("API key", refused["error"])
            saved = json.loads(self.call("/api/settings", {"api_url": llm.url, "api_key": "sk-local-123",
                                                           "output_dir": self.folder.name})[1])
            self.assertTrue(saved["settings"]["has_api_key"])
            state = self.call("/api/state")[1]
            self.assertNotIn(b"sk-local-123", state)
            self.assertTrue(json.loads(state)["settings"]["has_api_key"])
            self.assertIn("sk-local-123", self.settings_file.read_text())
            if sys.platform != "win32":
                self.assertEqual(self.settings_file.stat().st_mode & 0o777, 0o600)
            # A blank key field keeps the saved key; the saved key is used for models and runs.
            self.call("/api/settings", {"api_url": llm.url, "api_key": "", "output_dir": self.folder.name})
            self.assertTrue(json.loads(self.call("/api/models", {"api_url": llm.url})[1])["ok"])
            job = json.loads(self.call("/api/generate", {"subject": "woman", "direction": "jobs", "count": 1,
                                                         "api_url": llm.url, "output_dir": self.folder.name})[1])
            deadline, events = time.time() + 30, []
            while time.time() < deadline:
                data = json.loads(self.call(f"/api/job?id={job['id']}&since={len(events)}")[1])
                events += data["events"]
                if data["finished"]:
                    break
                time.sleep(0.1)
            self.assertEqual(events[-1]["type"], "done", events)
            forgotten = json.loads(self.call("/api/settings", {"api_url": llm.url, "forget_api_key": True,
                                                               "output_dir": self.folder.name})[1])
            self.assertFalse(forgotten["settings"]["has_api_key"])
            self.assertNotIn("sk-local-123", self.settings_file.read_text())

    def test_invalid_brief_is_refused_before_starting(self):
        status, body = self.call("/api/generate", {"count": 0})
        self.assertFalse(json.loads(body)["ok"])
        self.assertIsNone(self.app.job)
        for request in ({"sampling": {"system_prompt": "override"}}, {"max_tokens": 100000},
                        {"sampling": {"chat_template_kwargs": {"enable_thinking": "yes"}}}):
            result = json.loads(self.call("/api/generate", request)[1])
            self.assertFalse(result["ok"], request)
            self.assertIsNone(self.app.job)

    def test_reference_image_round_trip_does_not_save_image_or_return_it_in_events(self):
        image = reference_data("style", "Borrow the palette only.")
        with FakeServer([reply("carves a spoon")], vision=True, stream=True) as llm:
            models = json.loads(self.call("/api/models", {"api_url": llm.url, "require_vision": True})[1])
            self.assertEqual(models["auto"], "qwen3.5-9b")
            self.assertTrue(next(m for m in models["models"] if m["id"] == models["auto"])["vision"])
            result = json.loads(self.call("/api/generate", {
                "subject": "woman", "direction": "jobs", "count": 1, "reference_image": image,
                "api_url": llm.url, "output_dir": self.folder.name})[1])
            self.assertTrue(result["ok"], result)
            events, deadline = [], time.time() + 30
            while time.time() < deadline:
                data = json.loads(self.call(f"/api/job?id={result['id']}&since={len(events)}")[1])
                events += data["events"]
                if data["finished"]:
                    break
                time.sleep(0.05)
        self.assertEqual(events[-1]["type"], "done", events)
        content = llm.requests[0]["messages"][1]["content"]
        self.assertEqual(content[1]["image_url"]["url"], image["data_url"])
        self.assertEqual(json.loads(content[0]["text"])["reference_mode"], "style")
        self.assertNotIn(image["data_url"], json.dumps(events))
        self.assertNotIn(image["data_url"], self.call("/api/state")[1].decode())
        self.assertEqual([p.suffix for p in Path(self.folder.name).iterdir()], [".txt"])

    def test_bad_reference_is_refused_before_a_process_starts(self):
        for image in ({"data_url": "https://example.com/image.png"},
                      {**reference_data(), "mode": "custom_system_prompt"},
                      {"data_url": "data:image/png;base64,YWJj"}):
            result = json.loads(self.call("/api/generate", {"reference_image": image})[1])
            self.assertFalse(result["ok"], result)
            self.assertIsNone(self.app.job)

    def test_change_image_web_run_keeps_requested_appearance_changes(self):
        revised = scene("steadies a wooden bowl, her long auburn hair falling over a cream shirt and navy blue shoes visible beneath the bench")
        self.assertTrue(sd.identity_violation(revised, "lora"))
        with FakeServer([json.dumps({"ideas": ["Auburn hair and navy shoes"], "prompts": [revised]})], vision=True) as llm:
            result = json.loads(self.call("/api/generate", {
                "workflow": "change_image", "changes": "Change her hair to auburn and her shoes to navy blue.",
                "reference_image": reference_data(), "preserve": "Same face and pose.",
                "api_url": llm.url, "output_dir": self.folder.name})[1])
            self.assertTrue(result["ok"], result)
            events, deadline = [], time.time() + 30
            while time.time() < deadline:
                data = json.loads(self.call(f"/api/job?id={result['id']}&since={len(events)}")[1])
                events += data["events"]
                if data["finished"]:
                    break
                time.sleep(0.05)
        self.assertEqual(events[-1]["type"], "done", events)
        path = next(Path(self.folder.name).glob("*.txt"))
        self.assertIn("image-changes_full_prompt", path.name)
        self.assertEqual(path.read_text().strip(), revised)
        payload = llm.requests[0]
        system = payload["messages"][0]["content"]
        self.assertNotIn("SCENE: ONE SUBJECT", system)
        self.assertNotIn("DIRECTION: WORK", system)
        context = json.loads(payload["messages"][1]["content"][0]["text"])
        self.assertEqual(context["requested_count"], 1)
        self.assertEqual(context["preserve_notes"], "Same face and pose.")
        self.assertNotIn("identity_mode", context)


class SamplingTests(unittest.TestCase):
    def test_values_types_bounds_and_allowlist(self):
        for invalid in ({"temperature": True}, {"temperature": float("nan")}, {"temperature": float("inf")},
                        {"temperature": 10 ** 1000},
                        {"top_p": 0}, {"top_p": 1.1}, {"top_k": True}, {"top_k": 2.5},
                        {"top_k": 0}, {"top_k": 1001}, {"presence_penalty": 3},
                        {"presence_penalty": "0.6"}, {"reasoning_effort": "random"},
                        {"reasoning_effort": []}, {"chat_template_kwargs": []},
                        {"chat_template_kwargs": {"enable_thinking": 1}},
                        {"chat_template_kwargs": {"enable_thinking": True}},
                        {"reasoning_effort": "high"}, {"messages": []}):
            with self.assertRaises(sd.GenerationError, msg=invalid):
                sd.validate_sampling(invalid)
        first, second = sd.validate_sampling(), sd.validate_sampling()
        first["chat_template_kwargs"]["enable_thinking"] = True
        self.assertFalse(second["chat_template_kwargs"]["enable_thinking"])

    def test_custom_values_reach_server_and_compatibility_fallback_preserves_core_values(self):
        options = {"temperature": 1.2, "top_p": 0.8, "top_k": 12, "presence_penalty": 0.1,
                   "reasoning_effort": "low", "chat_template_kwargs": {"enable_thinking": True}}
        with FakeServer([reply("carves a spoon")], reject_extras=True) as server:
            client = sd.Client(server.url, model="qwen3.5-9b", sampling=options)
            client.chat("system", "brief", 500)
        self.assertEqual(server.requests[0]["reasoning_effort"], "low")
        self.assertTrue(server.requests[0]["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual((server.requests[1]["temperature"], server.requests[1]["top_p"]), (1.2, 0.8))
        for key in ("top_k", "presence_penalty", "reasoning_effort", "chat_template_kwargs"):
            self.assertNotIn(key, server.requests[1])


class ReferenceTests(unittest.TestCase):
    def test_reference_validation_modes_and_private_brief(self):
        for mode in sd.REFERENCE_MODES:
            image = sd.validate_reference(reference_data(mode, "Use the framing, not the person's appearance."))
            b, _, _ = sd.request_from_json({"reference_image": reference_data(mode), "subject2": "man"})
            self.assertEqual(b.reference.mode, mode)
            self.assertEqual(b.direction, "scenes guided by the reference image")
            self.assertNotIn(image.data_url, sd.build_user_message(b, 1, []))
            self.assertNotIn(image.data_url, repr(image))
            self.assertIn("REFERENCE IMAGE", sd.brief_system_prompt(b))
            self.assertIn("take priority", sd.brief_system_prompt(b))
        for bad in ({"data_url": "https://example.com/image.png"}, {"data_url": "/private/image.png"},
                    {"data_url": "data:image/svg+xml;base64,AAAA"},
                    {"data_url": "data:image/png;base64,YWJj"},
                    {**reference_data(), "mode": "override"}, {**reference_data(), "notes": "x" * 2001},
                    {**reference_data(), "system_prompt": "override"}, {**reference_data(), "notes": []},
                    {**reference_data(), "data_url": reference_data()["data_url"].replace("image/png", "image/jpeg")},
                    {"data_url": "data:image/png;base64," + "A" * (4 * ((sd.MAX_IMAGE_BYTES + 2) // 3) + 100)}):
            with self.assertRaises(sd.GenerationError):
                sd.validate_reference(bad)
        self.assertIsNone(sd.validate_reference(None))

    def test_vision_image_survives_optional_setting_retry_streaming_and_batches(self):
        image = sd.validate_reference(reference_data("composition", "Keep the side view."))
        with FakeServer([reply("carves a spoon"), reply("sands a chair")], vision=True,
                        reject_extras=True, stream=True) as server:
            code, events, lines = collect(brief(reference=image), 2, server.url, batch_size=1, live=True)
        self.assertEqual(code, 0)
        self.assertEqual(len(lines), 2)
        self.assertEqual(len(server.requests), 3)
        for payload in server.requests:
            content = payload["messages"][1]["content"]
            self.assertEqual(content[1]["image_url"]["url"], image.data_url)
            brief_data = json.loads(content[0]["text"])
            self.assertEqual(brief_data["reference_mode"], "composition")
            self.assertEqual(brief_data["reference_notes"], "Keep the side view.")
        self.assertNotIn(image.data_url, json.dumps(events))
        self.assertNotIn("top_k", server.requests[1])

    def test_text_only_model_refused_before_chat_and_unknown_capability_reported(self):
        image = sd.validate_reference(reference_data())
        with FakeServer([], vision=False) as server:
            code, events, _ = collect(brief(reference=image), 1, server.url)
        self.assertEqual(code, 1)
        self.assertIn("vision", events[-1]["message"])
        self.assertEqual(server.requests, [])
        with FakeServer([], lmstudio=False, reject_images=True) as server:
            code, events, _ = collect(brief(reference=image), 1, server.url)
        self.assertEqual(code, 1)
        self.assertIn("could not read the reference image", events[-1]["message"])
        self.assertEqual(len(server.requests), 2)

    def test_lm_studio_v1_chooses_loaded_vision_instance(self):
        models = [
            {"type": "llm", "key": "qwen3.5-9b-text", "capabilities": {"vision": False},
             "loaded_instances": [{"id": "qwen3.5-9b-text"}]},
            {"type": "llm", "key": "vision-model", "capabilities": {"vision": True},
             "loaded_instances": [{"id": "vision-instance"}]},
        ]
        with FakeServer([], v1_models=models) as server:
            self.assertEqual(sd.Client(server.url).pick_model(require_vision=True), "vision-instance")
            self.assertEqual(sd.Client(server.url, model="vision-model").pick_model(require_vision=True), "vision-model")
            with self.assertRaisesRegex(sd.GenerationError, "text-only"):
                sd.Client(server.url, model="qwen3.5-9b-text").pick_model(require_vision=True)

    def test_base64_compatibility_retry_keeps_sampling_and_image(self):
        image = sd.validate_reference(reference_data())
        with FakeServer([reply("carves a spoon")], vision=True, reject_image_uri=True) as server:
            code, _, _ = collect(brief(reference=image), 1, server.url)
        self.assertEqual(code, 0)
        self.assertEqual(len(server.requests), 2)
        self.assertEqual(server.requests[1]["messages"][1]["content"][1]["image_url"]["url"], image.data_url.split(",", 1)[1])
        self.assertIn("top_k", server.requests[1])

    def test_file_reference_dry_run_never_embeds_image_in_text(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "reference.png"
            path.write_bytes(png_bytes())
            result = io.StringIO()
            with contextlib.redirect_stdout(result):
                code = sd.main(["woman", "jobs", "1", "--reference-image", str(path),
                                "--reference-mode", "style", "--reference-notes", "Keep the light", "--dry-run"])
        self.assertEqual(code, 0)
        self.assertIn('"reference_mode": "style"', result.getvalue())
        self.assertNotIn("data:image", result.getvalue())


class ChangeImageTests(unittest.TestCase):
    def test_edit_requirements_and_limits(self):
        valid = {"workflow": "change_image", "reference_image": reference_data(), "changes": "Change the shoes to blue."}
        for changes in ({"reference_image": None}, {"changes": " "}, {"count": 2},
                        {"changes": "x" * 4001}, {"preserve": []}, {"edit_output": "raw_image"},
                        {"workflow": "unknown"}):
            with self.assertRaises(sd.GenerationError, msg=changes):
                sd.request_from_json({**valid, **changes})
        b, count, _ = sd.request_from_json({**valid, "identity": "lora", "subject2": "man", "parameters": {"occupation": "nurse"}})
        self.assertEqual(count, 1)
        self.assertEqual(b.subject_label, "source image")
        context = json.loads(sd.build_user_message(b, count, []))
        self.assertNotIn("subject", context)
        self.assertNotIn("parameters", context)
        self.assertFalse(sd.brief_identity_violation("Her long auburn hair falls over her coat.", b))
        self.assertIn("A hair-color change must not change the hairstyle", sd.brief_system_prompt(b))

    def test_short_edit_instruction_is_saved_without_scene_expansion(self):
        instruction = "Change her hair to auburn and her shoes to navy blue; preserve everything else in the original image."
        b, count, _ = sd.request_from_json({"workflow": "change_image", "reference_image": reference_data(),
            "changes": "Change her hair and shoe colors.", "edit_output": "edit_instruction"})
        with FakeServer([json.dumps({"ideas": ["Hair and shoe colors"], "prompts": [instruction]})], vision=True) as llm:
            code, events, lines = collect(b, count, llm.url)
        self.assertEqual(code, 0)
        self.assertEqual(lines, [instruction])
        self.assertEqual(events[0]["output_kind"], "edit_instruction")
        self.assertIn("image-changes_edit_instruction", events[-1]["file"])

    def test_invisible_target_error_stops_without_exporting_a_prompt(self):
        b, _, _ = sd.request_from_json({"workflow": "change_image", "reference_image": reference_data(),
                                       "changes": "Change the shoe color."})
        with FakeServer(['{"error":"The shoes are not visible. Upload an image that shows them."}'], vision=True) as llm:
            code, events, lines = collect(b, 1, llm.url)
        self.assertEqual(code, 1)
        self.assertEqual(lines, [])
        self.assertIn("not visible", events[-1]["message"])

    def test_cli_change_workflow_needs_no_subject_or_interactive_answers(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "source.png"
            path.write_bytes(png_bytes())
            output = io.StringIO()
            with contextlib.redirect_stdout(output), patch("builtins.input", side_effect=AssertionError("unexpected question")):
                code = sd.main(["--workflow", "change_image", "--reference-image", str(path),
                                "--changes", "Change the shoe color.", "--edit-output", "edit_instruction", "--dry-run"])
        self.assertEqual(code, 0)
        data = json.loads(output.getvalue().split("CREATIVE BRIEF\n", 1)[1])
        self.assertEqual(data["workflow"], "change_image")
        self.assertEqual(data["requested_count"], 1)
        self.assertNotIn("identity_mode", data)


if __name__ == "__main__":
    unittest.main()
