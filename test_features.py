"""Tests for the 3.9 features: sampling profiles, variety, rotation, prefixes, run history,
saved briefs and caption scripts, direct captions, auto-crop boxes, folder export and ComfyUI."""
import base64
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

import scene_director as sd
import test_scene_director as fixture
from test_scene_director import FakeServer, brief, collect, reply, scene


class EngineFeatureTests(unittest.TestCase):
    def test_sampling_profiles(self):
        self.assertEqual(sd.sampling_profile("scenes"), "creative")
        for workflow in ("edit_prompt", "rewrite", "dataset_caption", "change_image"):
            self.assertEqual(sd.sampling_profile(workflow), "precise")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings.json"
            self.assertEqual(sd.saved_sampling(path)["temperature"], 0.8)
            self.assertEqual(sd.saved_sampling(path, "precise")["temperature"], 0.3)
            path.write_text(json.dumps({"sampling_precise": {"temperature": 0.1}}))
            precise = sd.saved_sampling(path, "precise")
            self.assertEqual((precise["temperature"], precise["presence_penalty"]), (0.1, 0.0))

    def test_optional_settings_retry_only_for_related_errors(self):
        with FakeServer([reply("carves a spoon")], reject_extras=True) as server:
            code, events, _ = collect(brief(), 1, server.url)
        self.assertEqual(code, 0)
        self.assertEqual(len(server.requests), 2)
        self.assertTrue(any("optional" in e.get("message", "") for e in events if e["type"] == "notice"))
        self.assertFalse(sd.OPTIONAL_REJECTED_RE.search("API error 400: This model does not support images"))

    def test_rotating_choices_spread_over_batches(self):
        b = brief(parameters={"framing": "close-up | medium | full body", "setting": "indoors"})
        data = json.loads(sd.build_user_message(b, 2, [], offset=2))
        self.assertEqual(data["parameters"], {"setting": "indoors"})
        self.assertEqual([c["framing"] for c in data["per_prompt_choices"]], ["full body", "close-up"])
        self.assertIn("ROTATING CHOICES", sd.brief_system_prompt(b))
        self.assertNotIn("ROTATING CHOICES", sd.brief_system_prompt(brief(parameters={"setting": "indoors"})))
        with FakeServer([reply("carves a spoon", "sands a chair"), reply("oils a table")]) as server:
            code, _, lines = collect(b, 3, server.url, batch_size=2)
        self.assertEqual((code, len(lines)), (0, 3))
        second = json.loads(server.requests[1]["messages"][1]["content"])
        self.assertEqual(second["per_prompt_choices"], [{"framing": "full body"}])

    def test_long_runs_send_earlier_topics(self):
        notes = [f"scene number {i} with a long description of the place and activity" for i in range(40)]
        data = json.loads(sd.build_user_message(brief(), 5, notes))
        self.assertEqual(len(data["previous_scenes"]), 30)
        self.assertEqual(len(data["earlier_scene_topics"]), 10)
        self.assertEqual(data["earlier_scene_topics"][0], "scene number 0 with a long description of")
        self.assertNotIn("earlier_scene_topics", json.loads(sd.build_user_message(brief(), 5, notes[:30])))

    def test_near_duplicates_are_replaced(self):
        same = scene("checks the drip line")
        first = json.dumps({"ideas": ["A nurse checks a drip line beside a hospital bed at night"], "prompts": [same]})
        second = json.dumps({"ideas": ["A nurse checks the drip line by a hospital bed during the night", "Idea: sands a chair"],
                             "prompts": [same.replace("broad", "wide"), scene("sands a chair")]})
        with FakeServer([first, second]) as server:
            code, events, lines = collect(brief(), 2, server.url, batch_size=1)
        self.assertEqual(code, 0)
        self.assertIn("sands a chair", lines[1])
        self.assertTrue(any("nearly repeated" in e.get("message", "") for e in events))

    def test_prefix_seed_scenes_and_unsaved_runs(self):
        b = sd.request_from_json({"subject": "woman", "direction": "jobs", "count": 1, "output_prefix": " cybexpr1 ",
                                  "previous_scenes": ["Idea: carves a spoon"], "save_output": False})[0]
        with FakeServer([reply("sands a chair")]) as server:
            code, events, lines = collect(b, 1, server.url)
        self.assertEqual((code, lines), (0, []))
        self.assertTrue(next(e for e in events if e["type"] == "prompt")["text"].startswith("cybexpr1, A woman sands"))
        self.assertIsNone(events[-1]["file"])
        self.assertEqual(json.loads(server.requests[0]["messages"][1]["content"])["previous_scenes"], ["Idea: carves a spoon"])
        self.assertEqual(sd.with_prefix("tok,", "A b"), "tok, A b")
        for bad in ({"output_prefix": "a\nb"}, {"previous_scenes": "x"}, {"save_output": "no"},
                    {"workflow": "edit_prompt", "source_prompt": "x", "changes": "y", "output_prefix": "z"}):
            with self.assertRaises(sd.GenerationError):
                sd.request_from_json({"subject": "woman", "direction": "jobs", **bad})

    def test_run_record_is_written_next_to_the_prompts(self):
        with tempfile.TemporaryDirectory() as folder:
            b = brief(parameters={"framing": "close | wide"}, output_prefix="tok")
            with FakeServer([reply("carves a spoon")]) as server:
                self.assertEqual(sd.run(b, 1, sd.Client(server.url, timeout=10), lambda _e: None, 5, folder), 0)
            record = json.loads(next(Path(folder).glob("*.json")).read_text(encoding="utf-8"))
        self.assertEqual(record["request"]["parameters"], {"framing": "close | wide"})
        self.assertEqual(record["request"]["output_prefix"], "tok")
        self.assertEqual((record["ideas"], record["count"]), (["Idea: carves a spoon"], 1))
        self.assertEqual(record["sampling"]["temperature"], 0.8)

    def test_parse_box_formats(self):
        self.assertEqual(sd.parse_box('{"box": [100, 200, 500, 900]}'), [100, 200, 500, 900])
        self.assertEqual(sd.parse_box('[{"bbox_2d": [500, 900, 100, 200], "label": "face"}]'), [100, 200, 500, 900])
        self.assertEqual(sd.parse_box('```json\n{"box": [0.1, 0.2, 0.5, 0.9]}\n```'), [100, 200, 500, 900])
        self.assertEqual(sd.parse_box("The face spans (120, 80) to (300, 400)."), [120, 80, 300, 400])
        self.assertIsNone(sd.parse_box('{"box": null}'))
        self.assertIsNone(sd.parse_box("not found"))

    def test_caption_traits_and_cancel(self):
        b = sd.request_from_json({"workflow": "dataset_caption", "rewrite_use_vision": True,
                                  "rewrite_system": "Caption. Omit {CONSTANT_TRAITS}.", "reference_image": fixture.reference_data(),
                                  "caption_trigger": "tok", "caption_traits": "red hair,  freckles"})[0]
        system = sd.caption_system(b)
        self.assertIn("Omit red hair, freckles.", system)
        self.assertIn("CONSTANT TRAITS", system)
        with self.assertRaises(sd.GenerationError):
            sd.request_from_json({"workflow": "rewrite", "rewrite_system": "x", "rewrite_prompt": "y", "caption_traits": "z"})
        stop = threading.Event()
        stop.set()
        with self.assertRaises(sd.Cancelled):
            sd.caption_image(b, sd.Client("http://127.0.0.1:9/v1"), stop)


class FeatureWebTests(unittest.TestCase):
    setUp = fixture.WebTests.setUp
    tearDown = fixture.WebTests.tearDown
    call = fixture.WebTests.call

    def get(self, path):
        return json.loads(self.call(path)[1])

    def post(self, path, body):
        return json.loads(self.call(path, body)[1])

    def run_job(self, body):
        result = self.post("/api/generate", body)
        self.assertTrue(result["ok"], result)
        self.app.job.process.wait(timeout=30)

    def test_settings_profiles_and_comfy_defaults(self):
        settings = self.get("/api/state")["settings"]
        self.assertEqual((settings["sampling_precise"]["temperature"], settings["comfy_url"]), (0.3, "http://127.0.0.1:8188"))
        self.assertFalse(self.post("/api/settings", {"api_url": "http://localhost:1234/v1", "comfy_url": "ftp://x"})["ok"])
        saved = self.post("/api/settings", {"api_url": "http://localhost:1234/v1", "sampling_precise": {"temperature": 0.2}})["settings"]
        self.assertEqual((saved["sampling_precise"]["temperature"], saved["sampling"]["temperature"]), (0.2, 0.8))

    def test_precise_profile_reaches_edit_runs(self):
        with FakeServer(["A man in a blue coat."]) as llm:
            self.run_job({"workflow": "edit_prompt", "source_prompt": "A woman in a blue coat.", "changes": "Make her a man",
                          "api_url": llm.url, "output_dir": self.folder.name})
        self.assertEqual((llm.requests[-1]["temperature"], llm.requests[-1]["presence_penalty"]), (0.3, 0.0))

    def test_history_edits_and_favorites(self):
        with FakeServer([reply("carves a spoon", "sands a chair")]) as llm:
            self.run_job({"subject": "woman", "direction": "jobs", "count": 2, "api_url": llm.url, "output_dir": self.folder.name})
        runs = self.get("/api/history")["runs"]
        self.assertEqual((runs[0]["count"], runs[0]["label"]), (2, "woman · jobs"))
        item = self.get("/api/history/item?file=" + quote(runs[0]["file"]))
        self.assertEqual((item["request"]["direction"], len(item["prompts"])), ("jobs", 2))
        saved = self.post("/api/run-file", {"file": runs[0]["file"], "prompts": [item["prompts"][1]], "ideas": [item["ideas"][1]]})
        self.assertEqual(saved["count"], 1)
        self.assertEqual(self.get("/api/history/item?file=" + quote(runs[0]["file"]))["ideas"], ["Idea: sands a chair"])
        self.assertFalse(self.post("/api/run-file", {"file": str(fixture.__file__), "prompts": []})["ok"])
        self.assertTrue(self.post("/api/favorite", {"prompt": "A  star\nprompt"})["starred"])
        self.assertEqual(self.get("/api/favorites")["prompts"], ["A star prompt"])
        self.assertNotIn("favorites.txt", [run["name"] for run in self.get("/api/history")["runs"]])
        self.assertFalse(self.post("/api/favorite", {"prompt": "A star prompt", "remove": True})["starred"])
        self.assertEqual(self.get("/api/favorites")["prompts"], [])

    def test_brief_and_caption_script_stores(self):
        self.assertEqual(self.post("/api/briefs", {"action": "save", "name": " Nurse  set ", "brief": {"direction": "nurse"}})["briefs"][0]["name"], "Nurse set")
        self.post("/api/briefs", {"action": "save", "name": "nurse SET", "brief": {"direction": "x"}})
        self.assertEqual([b["brief"]["direction"] for b in self.get("/api/briefs")["briefs"]], ["x"])
        self.post("/api/briefs", {"action": "delete", "name": "Nurse set"})
        self.assertEqual(self.get("/api/briefs")["briefs"], [])
        first = self.post("/api/caption-scripts", {"action": "save", "title": "Krea char", "prompt": "Caption {TRIGGER}."})
        self.assertFalse(self.post("/api/caption-scripts", {"action": "save", "title": "krea  CHAR", "prompt": "Other"})["ok"])
        updated = self.post("/api/caption-scripts", {"action": "save", "id": first["id"], "title": "Krea char v2", "prompt": "New"})
        self.assertEqual([s["title"] for s in updated["scripts"]], ["Krea char v2"])
        self.post("/api/caption-scripts", {"action": "delete", "id": first["id"]})
        self.assertEqual(self.get("/api/caption-scripts")["scripts"], [])

    def test_direct_caption_locate_and_stop(self):
        with FakeServer(["A woman with a coat.", '{"box": [10, 20, 300, 400]}'], vision=True) as llm:
            result = self.post("/api/caption", {"rewrite_system": "Caption the crop.", "caption_trigger": "tok",
                                                "caption_traits": "red hair", "reference_image": fixture.reference_data(),
                                                "api_url": llm.url, "token": "t1"})
            self.assertEqual(result["text"], "tok, A woman with a coat.", result)
            self.assertIn("red hair", llm.requests[0]["messages"][0]["content"])
            self.assertEqual(llm.requests[0]["temperature"], 0.3)
            box = self.post("/api/locate", {"image": fixture.reference_data()["data_url"], "target": "face", "api_url": llm.url})
            self.assertEqual(box["box"], [10, 20, 300, 400])
        self.assertFalse(self.post("/api/locate", {"image": "https://example.com/x.png", "target": "face"})["ok"])
        event = threading.Event()
        self.app.cancels["x"] = event
        self.assertEqual(self.post("/api/caption/stop", {})["stopped"], 1)
        self.assertTrue(event.is_set())

    def test_dataset_folder_export(self):
        target = Path(self.folder.name) / "export"
        target.mkdir()
        files = [{"name": "a.png", "data": base64.b64encode(b"img").decode()}, {"name": "a.txt", "text": "tok, caption\n"}]
        body = {"folder": str(target), "subfolder": "10_tok woman", "files": files}
        self.assertTrue(self.post("/api/dataset/write", body)["ok"])
        self.assertEqual((target / "10_tok woman" / "a.png").read_bytes(), b"img")
        again = self.post("/api/dataset/write", body)
        self.assertIn("already exists", again["error"])
        self.assertTrue(self.post("/api/dataset/write", {**body, "overwrite": True})["ok"])
        for bad in ("../x.txt", "a/b.txt", ".hidden", "x:y.txt"):
            self.assertFalse(self.post("/api/dataset/write", {"folder": str(target), "files": [{"name": bad, "text": "x"}]})["ok"], bad)
        self.assertFalse(self.post("/api/dataset/write", {"folder": "relative/path", "files": files})["ok"])
        self.assertFalse(self.post("/api/dataset/write", {"folder": str(target), "subfolder": "..", "files": files})["ok"])
        self.assertEqual(self.post("/api/dataset/check", {"folder": str(target), "subfolder": "10_tok woman"})["files"], ["a.png", "a.txt"])

    def test_comfy_inspect_and_queue(self):
        graph = {"3": {"class_type": "KSampler", "inputs": {"seed": 5, "steps": 8}},
                 "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "placeholder", "clip": ["4", 1]}, "_meta": {"title": "Positive prompt"}}}
        workflow, editor = Path(self.folder.name) / "wf.json", Path(self.folder.name) / "ui.json"
        workflow.write_text(json.dumps(graph))
        editor.write_text(json.dumps({"nodes": [], "links": []}))
        self.assertIn("Export (API)", self.post("/api/comfy/inspect", {"workflow": str(editor)})["error"])
        inspected = self.post("/api/comfy/inspect", {"workflow": str(workflow)})
        self.assertEqual((inspected["candidates"][0]["node"], inspected["seeds"]), ("6", 1))
        received = []

        class Comfy(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                data = json.dumps({"prompt_id": f"id{len(received)}"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        comfy = ThreadingHTTPServer(("127.0.0.1", 0), Comfy)
        threading.Thread(target=comfy.serve_forever, daemon=True).start()
        try:
            self.post("/api/settings", {"api_url": "http://localhost:1234/v1", "comfy_url": f"http://127.0.0.1:{comfy.server_port}",
                                        "comfy_workflow": str(workflow), "comfy_node": "6", "comfy_input": "text"})
            result = self.post("/api/comfy/queue", {"prompts": ["first prompt", "second prompt"]})
        finally:
            comfy.shutdown()
            comfy.server_close()
        self.assertEqual(result["ids"], ["id1", "id2"])
        self.assertEqual(received[1]["prompt"]["6"]["inputs"]["text"], "second prompt")
        self.assertEqual(received[0]["prompt"]["6"]["inputs"]["clip"], ["4", 1])
        self.assertNotEqual(received[0]["prompt"]["3"]["inputs"]["seed"], 5)
        self.assertIn("Cannot reach ComfyUI", self.post("/api/comfy/queue", {"prompts": ["x"]})["error"])


if __name__ == "__main__":
    unittest.main()
