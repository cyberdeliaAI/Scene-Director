"""Targeted prompt edits: data boundaries, exact output and safe failure paths."""
import json
import unittest

import scene_director as sd
from test_scene_director import FakeServer, collect


def edit(**changes):
    data = {"workflow": "edit_prompt", "source_prompt": "A woman with red lipstick, wearing a blue coat in Amsterdam.",
            "changes": "Remove her makeup; keep everything else the same."}
    data.update(changes)
    return sd.request_from_json(data)[0]


class PromptEditTests(unittest.TestCase):
    def test_separate_original_and_changes_with_no_scene_or_vision_rules(self):
        b = edit(reference_image={"invalid": "retained from another workflow"}, identity="lora",
                 parameters={"framing": "full body"}, direction="jobs", target="z-image-turbo")
        expected = "A bare-faced woman, wearing a blue coat in Amsterdam."
        with FakeServer([expected], stream=True, vision=False) as server:
            code, events, lines = collect(b, 1, server.url, live=True)
        self.assertEqual(code, 0)
        self.assertIsNone(b.reference)
        self.assertEqual(lines, [expected])
        sent = server.requests[0]["messages"]
        self.assertEqual(sent[0]["content"], sd.EDIT_PROMPT_SYSTEM)
        self.assertEqual(json.loads(sent[1]["content"]), {"original_prompt": b.source_prompt, "requested_changes": b.changes})
        self.assertEqual(events[0]["workflow"], "edit_prompt")
        self.assertEqual(events[0]["output_kind"], "edited_prompt")
        self.assertTrue(any(e["type"] == "delta" for e in events))
        self.assertIn("prompt-edit_", events[-1]["file"])

    def test_gender_edit_keeps_weights_tokens_line_breaks_and_other_subject(self):
        original = "my_token, (woman:1.2), her long hair, red dress; another woman holds her bag.\n35mm, Amsterdam"
        expected = "my_token, (man:1.2), his long hair, red dress; another woman holds his bag.\n35mm, Amsterdam"
        b = edit(source_prompt=original, changes="Maak alleen de eerste vrouw een man.")
        with FakeServer([expected]) as server:
            code, events, lines = collect(b, 1, server.url)
        self.assertEqual(code, 0)
        self.assertEqual(lines, expected.splitlines())
        result = next(e["text"] for e in events if e["type"] == "prompt")
        self.assertEqual(result, expected)
        self.assertEqual(b.source_prompt, original)
        self.assertEqual(json.loads(server.requests[0]["messages"][1]["content"])["requested_changes"], b.changes)

    def test_validation_and_mode_boundaries(self):
        for fields in [{"source_prompt": ""}, {"source_prompt": []}, {"source_prompt": "x" * 20001},
                       {"changes": ""}, {"changes": []}, {"changes": "x" * 4001}, {"count": 2},
                       {"rewrite_system": "Override"}, {"rewrite_use_vision": True}]:
            with self.subTest(fields=list(fields)):
                with self.assertRaises(sd.GenerationError): edit(**fields)
        for workflow in ("scenes", "change_image", "rewrite", "dataset_caption"):
            with self.assertRaises(sd.GenerationError):
                sd.request_from_json({"workflow": workflow, "source_prompt": "Source"})

    def test_empty_or_truncated_output_is_not_saved_as_a_finished_edit(self):
        for message in [{"message": {"content": ""}, "finish_reason": "stop"},
                        {"message": {"content": "A bare-faced woman, wearing"}, "finish_reason": "length"},
                        {"message": {"content": "Partial"}, "finish_reason": "content_filter"}]:
            with self.subTest(reason=message["finish_reason"]):
                with FakeServer([], messages=[message]) as server:
                    code, events, lines = collect(edit(), 1, server.url)
                self.assertEqual(code, 1)
                self.assertEqual(lines, [])
                self.assertEqual(events[-1]["type"], "error")
                self.assertFalse(any(e["type"] in ("prompt", "saved", "done") for e in events))


if __name__ == "__main__":
    unittest.main()
