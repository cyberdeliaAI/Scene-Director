"""Preset compatibility and prompt-to-prompt integration checks."""

import json
import tempfile
import unittest
from pathlib import Path

import scene_director as sd
import scene_director_presets as presets
import test_scene_director as fixtures
from test_scene_director import FakeServer, collect, reference_data


def rewrite(**overrides):
    data = {"workflow": "rewrite", "rewrite_prompt": "A woman, auburn hair, blue shoes, in Amsterdam.",
            "rewrite_system": "Preserve all names and appearance. Return a single improved prompt."}
    data.update(overrides)
    return sd.request_from_json(data)[0]


class RewriteTests(unittest.TestCase):
    def test_custom_instructions_and_input_are_sent_without_scene_rules(self):
        result = "A woman with auburn hair and blue shoes stands in Amsterdam."
        b = rewrite()
        with FakeServer([result], stream=True) as server:
            code, events, lines = collect(b, 1, server.url, live=True)
        self.assertEqual(code, 0)
        self.assertEqual(lines, [result])
        self.assertEqual(len(server.requests), 1)
        sent = server.requests[0]["messages"]
        self.assertEqual(sent[0]["content"], b.rewrite_system)
        self.assertEqual(sent[1]["content"], b.rewrite_prompt)
        self.assertEqual(events[0]["workflow"], "rewrite")
        self.assertTrue(any(event["type"] == "delta" for event in events))
        self.assertIn("prompt-rewrite_text", events[-1]["file"])

    def test_short_weighted_or_json_reply_stays_one_result(self):
        for result in ["blue shoes", "(auburn hair:1.2), blue shoes, Amsterdam", '{"prompt":"blue shoes"}']:
            with FakeServer([result]) as server:
                code, events, lines = collect(rewrite(), 1, server.url)
            self.assertEqual(code, 0)
            self.assertEqual(lines, [result])
            self.assertEqual(sum(event["type"] == "prompt" for event in events), 1)

    def test_vision_uses_separate_instructions_and_optional_text(self):
        b = rewrite(rewrite_use_vision=True, rewrite_prompt="", reference_image=reference_data(),
                    rewrite_system="Caption this image without inventing a scene.")
        with FakeServer(["A blue circle on a warm gray background."], vision=True) as server:
            code, events, lines = collect(b, 1, server.url)
        self.assertEqual(code, 0)
        messages = server.requests[0]["messages"]
        self.assertEqual(messages[0]["content"], b.rewrite_system)
        self.assertEqual(messages[1]["content"][1]["image_url"]["url"], b.reference.data_url)
        self.assertNotIn(b.reference.data_url, json.dumps(events))
        self.assertIn("prompt-rewrite_vision", events[-1]["file"])

    def test_text_mode_ignores_a_retained_image(self):
        b = rewrite(reference_image={"invalid": "a stale image is irrelevant in text mode"})
        self.assertIsNone(b.reference)
        with FakeServer(["A woman with blue shoes."], vision=False) as server:
            code, _, _ = collect(b, 1, server.url)
        self.assertEqual(code, 0)
        self.assertIsInstance(server.requests[0]["messages"][1]["content"], str)

    def test_requirements_and_scene_system_override_guard(self):
        for changes in [{"rewrite_system": ""}, {"rewrite_prompt": ""}, {"count": 2},
                        {"rewrite_use_vision": "true"}, {"rewrite_use_vision": True},
                        {"rewrite_system": "x" * 65537}, {"rewrite_prompt": "x" * 20001}]:
            with self.assertRaises(sd.GenerationError):
                rewrite(**changes)
        for workflow in ["scenes", "change_image"]:
            with self.assertRaisesRegex(sd.GenerationError, "only available in Rewrite"):
                sd.request_from_json({"workflow": workflow, "rewrite_system": "Override scene rules"})

    def test_empty_output_errors_once_without_exporting(self):
        with FakeServer(["", "unused"]) as server:
            code, events, lines = collect(rewrite(), 1, server.url)
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(lines, [])
        self.assertEqual(len(server.requests), 1)


class PresetTests(unittest.TestCase):
    def test_shared_txt_format_and_separate_vision_library(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            text = root / "presets"; vision = root / "vision_presets"
            text.mkdir(); vision.mkdir()
            original = "Preserve a 50mm f/1.4 lens.\nOutput only the rewritten prompt."
            file = text / "Krea2 Composition Fixer Prompt.txt"
            file.write_text(original, encoding="utf-8")
            (vision / "Image caption.txt").write_text("Describe the image.", encoding="utf-8")
            library = presets.list_presets({"preset_dir": str(text), "vision_preset_dir": str(vision)})
            self.assertEqual(library["text"][-1]["prompt"], original)
            self.assertEqual(library["vision"][-1]["prompt"], "Describe the image.")
            self.assertEqual(file.read_text(), original)
            file.write_text("New instructions.")
            self.assertEqual(presets.list_presets({"preset_dir": str(text)})["text"][-1]["prompt"], "New instructions.")

    def test_unreadable_empty_oversize_and_external_symlink_are_skipped(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); shared = root / "presets"; shared.mkdir()
            (shared / "valid.txt").write_text("Valid instructions.")
            (shared / "empty.txt").write_text(" ")
            (shared / "huge.txt").write_bytes(b"x" * 65537)
            (shared / "invalid.txt").write_bytes(b"\xff\xfe")
            secret = root / "outside.txt"; secret.write_text("outside-content")
            (shared / "escape.txt").symlink_to(secret)
            (shared / "nested").mkdir(); (shared / "nested" / "hidden.txt").write_text("nested-content")
            library = presets.list_presets({"preset_dir": str(shared), "vision_preset_dir": str(root / "missing")})
            self.assertEqual([item["name"] for item in library["text"] if item["source"] == "shared"], ["valid"])
            self.assertGreaterEqual(len(library["warnings"]), 5)
            self.assertNotIn("outside-content", json.dumps(library))


class RewriteWebTests(unittest.TestCase):
    # Reuse the local server fixture without inheriting its entire test suite.
    setUp = fixtures.WebTests.setUp
    tearDown = fixtures.WebTests.tearDown
    call = fixtures.WebTests.call

    def test_folder_settings_refresh_and_override_scope(self):
        folder = Path(self.folder.name) / "presets"; folder.mkdir()
        file = folder / "Shared system.txt"; file.write_text("Exact system instructions.")
        result = json.loads(self.call("/api/settings", {"preset_dir": str(folder)})[1])
        self.assertTrue(result["ok"], result)
        self.assertEqual(json.loads(self.settings_file.read_text())["preset_dir"], str(folder))
        library = json.loads(self.call("/api/presets")[1])
        self.assertEqual(library["text"][-1]["prompt"], file.read_text())
        with FakeServer(["Blue shoes in a quiet studio."], stream=True) as server:
            result = json.loads(self.call("/api/generate", {"workflow": "rewrite", "rewrite_prompt": "blue shoes",
                "rewrite_system": file.read_text(), "api_url": server.url, "output_dir": self.folder.name})[1])
            self.assertTrue(result["ok"], result)
            self.app.job.process.wait(timeout=20)
        self.assertEqual(server.requests[0]["messages"][0]["content"], file.read_text())
        self.assertEqual(len(list(Path(self.folder.name).glob("prompt-rewrite_text_*.txt"))), 1)


if __name__ == "__main__":
    unittest.main()
