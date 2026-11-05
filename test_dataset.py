"""Training-caption checks using mock vision servers, without dataset files."""
import json
import unittest

import scene_director as sd
import test_scene_director as fixture


def caption(**changes):
    data = {"workflow": "dataset_caption", "rewrite_use_vision": True,
            "rewrite_system": "Describe the visible crop for training. Begin with {TRIGGER}.",
            "reference_image": fixture.reference_data(), "caption_trigger": "my_character"}
    data.update(changes)
    return sd.request_from_json(data)[0]


class DatasetCaptionTests(unittest.TestCase):
    def test_caption_uses_vision_and_trigger_without_exporting_prompt_files(self):
        b = caption()
        with fixture.FakeServer(["A woman with auburn hair, wearing a blue coat in Amsterdam."], vision=True, stream=True) as model:
            code, events, lines = fixture.collect(b, 1, model.url, live=True)
        self.assertEqual(code, 0)
        self.assertEqual(lines, [])
        self.assertEqual(events[0]["workflow"], "dataset_caption")
        self.assertIsNone(events[-1]["file"])
        result = next(event["text"] for event in events if event["type"] == "prompt")
        self.assertTrue(result.startswith("my_character, A woman"))
        sent = model.requests[0]["messages"]
        self.assertNotIn("{TRIGGER}", sent[0]["content"])
        self.assertNotIn("DIRECTION: WORK", sent[0]["content"])
        self.assertIsInstance(sent[1]["content"], list)
        self.assertNotIn(b.reference.data_url, json.dumps(events))

    def test_existing_trigger_is_not_duplicated_and_no_token_is_invented(self):
        for trigger, reply, expected in [("my_token", "MY_TOKEN, blue shoes.", "my_token, blue shoes."),
                                         ("", "Blue shoes.", "Blue shoes.")]:
            with fixture.FakeServer([reply], vision=True) as model:
                code, events, _ = fixture.collect(caption(caption_trigger=trigger), 1, model.url)
            self.assertEqual(code, 0)
            self.assertEqual(next(event["text"] for event in events if event["type"] == "prompt"), expected)

    def test_caption_validation_and_empty_response(self):
        for changes in [{"rewrite_use_vision": False, "rewrite_prompt": "text"}, {"reference_image": None},
                        {"count": 2}, {"caption_trigger": []}, {"caption_trigger": "x"*201}]:
            with self.assertRaises(sd.GenerationError): caption(**changes)
        with self.assertRaises(sd.GenerationError):
            sd.request_from_json({"workflow": "rewrite", "rewrite_system": "Instructions", "rewrite_prompt": "Text", "caption_trigger": "token"})
        with fixture.FakeServer([""], vision=True) as model:
            code, events, lines = fixture.collect(caption(), 1, model.url)
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(lines, [])


class DatasetWebTests(unittest.TestCase):
    setUp = fixture.WebTests.setUp
    tearDown = fixture.WebTests.tearDown
    call = fixture.WebTests.call

    def test_assets_and_caption_job_identity(self):
        for path in ["/dataset.js", "/dataset-core.js", "/dataset.css"]:
            self.assertEqual(self.call(path)[0], 200)
        self.assertEqual(self.call("/../scene_director.py")[0], 404)
        with fixture.FakeServer(["A woman wearing a blue coat."], vision=True) as model:
            result = json.loads(self.call("/api/generate", {"workflow": "dataset_caption", "rewrite_system": "Caption the image.",
                "rewrite_use_vision": True, "reference_image": fixture.reference_data(), "api_url": model.url})[1])
            self.assertTrue(result["ok"], result)
            self.assertEqual(json.loads(self.call("/api/state")[1])["job"]["workflow"], "dataset_caption")
            self.app.job.process.wait(timeout=20)


if __name__ == "__main__": unittest.main()
