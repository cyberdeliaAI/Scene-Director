"""Tests for the Anima target: hybrid prompt shape, looks, the tag block and LoRA identity tags."""
import contextlib
import io
import json
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

import scene_director as sd
import scene_director_web as web
from test_scene_director import FakeServer, reference_data, scene

BLOCK = "masterpiece, best quality, highres, score_7, score_8, safe"


def anima(**overrides):
    values = dict(subject="woman", direction="crafts", target="anima")
    values.update(overrides)
    return sd.Brief(**values)


def hybrid(lead, activity, extra=""):
    return lead + ". " + scene(activity, extra)


def run(brief, replies, count=1, **server):
    events = []
    with tempfile.TemporaryDirectory() as folder, FakeServer(replies, **server) as model:
        code = sd.run(brief, count, sd.Client(model.url, timeout=10), events.append, 5, folder)
        files = sorted(Path(folder).glob("*.txt"))
        lines = files[0].read_text(encoding="utf-8").splitlines() if files else []
        records = [json.loads(p.read_text(encoding="utf-8")) for p in Path(folder).glob("*.json")]
        names = [p.name for p in files]
        sent = [request["messages"] for request in model.requests]
    return code, events, lines, records, names, sent


class InstructionTests(unittest.TestCase):
    def test_profile_shape_and_look_reach_the_model(self):
        text = sd.brief_system_prompt(anima(anima_look="realistic"))
        self.assertIn("TARGET: Anima", text)
        self.assertIn("a short tag lead, then a natural-language description of usually 50-100 words", text)
        self.assertIn("LOOK: realistic.", text)
        self.assertIn("Never call it anime", text)
        self.assertNotIn("one self-contained paragraph", text)
        self.assertNotIn("{", text.replace('{"ideas"', "").replace('{"error"', ""))
        self.assertIn("80-130 words", sd.brief_system_prompt(anima(second_subject="man")))
        for look, phrase in (("anime", "LOOK: anime illustration."), ("screencap", "LOOK: anime screencap."),
                             ("semi_real", "LOOK: semi-realistic.")):
            self.assertIn(phrase, sd.brief_system_prompt(anima(anima_look=look)))

    def test_other_targets_keep_their_paragraph_rule_and_have_no_look(self):
        for target in ("krea2", "z-image-turbo"):
            text = sd.system_prompt(target)
            self.assertIn("one self-contained paragraph of natural sentences, usually 100-180 words", text)
            self.assertNotIn("LOOK:", text)
            self.assertNotIn("tag lead", text)


class TagBlockTests(unittest.TestCase):
    def test_style_tags_close_the_block_for_every_look(self):
        expected = {"anime": "anime", "screencap": "anime screenshot", "semi_real": "realistic", "realistic": "real life, realistic"}
        for look, style in expected.items():
            self.assertEqual(sd.anima_tag_block(anima(anima_look=look)), f"{BLOCK}, {style}")

    def test_duplicates_empty_quality_and_no_safety_tag(self):
        brief = anima(anima_look="realistic", anima_quality="masterpiece, Realistic,, score_8,  score_8 ", anima_safety="none")
        self.assertEqual(sd.anima_tag_block(brief), "masterpiece, score_8, real life, realistic")
        self.assertEqual(sd.anima_tag_block(anima(anima_quality="", anima_safety="none")), "anime")
        self.assertEqual(sd.anima_tag_block(anima(anima_quality="", anima_safety="nsfw")), "nsfw, anime")

    def test_lead_is_normalized_and_app_tags_are_removed(self):
        tags, text = sd.anima_tidy("1girl, Solo, denim_apron, masterpiece, score_8, anime, @someone, workshop. A woman carves. She smiles.")
        self.assertEqual(tags, ["1girl", "solo", "denim apron", "workshop"])
        self.assertEqual(text, "1girl, solo, denim apron, workshop. A woman carves. She smiles.")
        self.assertEqual(sd.anima_tidy("1girl 1boy, workshop. Two people work. They talk.")[0], ["1girl", "1boy", "workshop"])
        plain = "A woman, wearing an apron, kneads dough. She smiles."
        self.assertEqual(sd.anima_tidy(plain), ([], plain))


class RunTests(unittest.TestCase):
    def test_scene_run_adds_the_block_prefix_and_records_the_choices(self):
        brief = anima(anima_look="semi_real", output_prefix="mytok")
        reply = json.dumps({"ideas": ["Idea: carves a spoon", "Idea: sands a chair"],
                            "prompts": [hybrid("1girl, solo, apron, score_9, workshop", "carves a spoon"), scene("sands a chair")]})
        code, events, lines, records, names, sent = run(brief, [reply], count=2)
        self.assertEqual(code, 0)
        self.assertTrue(lines[0].startswith(f"{BLOCK}, realistic, mytok, 1girl, solo, apron, workshop. A woman carves a spoon"), lines[0])
        self.assertTrue(lines[1].startswith(f"{BLOCK}, realistic, mytok, A woman sands a chair"), lines[1])
        self.assertTrue(names[0].startswith("anima_woman_crafts_"))
        request = records[0]["request"]
        self.assertEqual((request["target"], request["anima_look"], request["anima_quality"], request["anima_safety"]),
                         ("anima", "semi_real", sd.ANIMA_QUALITY_DEFAULT, "safe"))
        self.assertIn("LOOK: semi-realistic.", sent[0][0]["content"])
        self.assertEqual(json.loads(sent[0][1]["content"])["target_image_model"], "Anima")
        self.assertEqual([e["text"] for e in events if e["type"] == "prompt"], lines)

    def test_plain_description_without_lead_starts_a_new_sentence(self):
        code, _events, lines, *_ = run(anima(anima_look="realistic"), [json.dumps({"prompts": [scene("carves a spoon")]})])
        self.assertEqual(code, 0)
        self.assertTrue(lines[0].startswith(f"{BLOCK}, real life, realistic. A woman carves a spoon"), lines[0])

    def test_identity_tags_in_the_lead_are_replaced_for_lora_subjects(self):
        first = json.dumps({"prompts": [hybrid("1girl, solo, long hair, apron", "carves a spoon")]})
        second = json.dumps({"prompts": [hybrid("1girl, solo, closed eyes, hair ribbon, apron", "sands a chair")]})
        code, events, lines, *_ = run(anima(), [first, second])
        self.assertEqual(code, 0)
        self.assertIn("sands a chair", lines[0])
        self.assertTrue(any("hair or looks of a LoRA character" in e.get("message", "") for e in events))
        code, _events, lines, *_ = run(anima(identity_mode="free"), [first])
        self.assertEqual(code, 0)
        self.assertIn("long hair", lines[0])

    def test_other_targets_never_get_a_tag_block(self):
        reply = json.dumps({"prompts": [scene("carves a spoon")]})
        code, _events, lines, records, *_ = run(sd.Brief("woman", "crafts", target="krea2", anima_look="realistic"), [reply])
        self.assertEqual(code, 0)
        self.assertTrue(lines[0].startswith("A woman carves a spoon"))
        self.assertNotIn("anima_look", records[0]["request"])

    def test_image_changes_get_the_block_only_for_full_prompts(self):
        described = scene("carves a spoon")
        for output, expected in (("full_prompt", f"{BLOCK}, realistic. A woman carves a spoon"), ("edit_instruction", "A woman carves a spoon")):
            brief = sd.request_from_json({"workflow": "change_image", "target": "anima", "anima_look": "semi_real", "changes": "Change the apron.",
                                          "edit_output": output, "reference_image": reference_data()})[0]
            code, _events, lines, *_ = run(brief, [json.dumps({"ideas": ["apron"], "prompts": [described]})], vision=True)
            self.assertEqual(code, 0)
            self.assertTrue(lines[0].startswith(expected), lines[0])


class RequestTests(unittest.TestCase):
    def test_request_fields_are_validated_and_normalized(self):
        brief = sd.request_from_json({"subject": "woman", "direction": "jobs", "target": "anima", "anima_look": "realistic",
                                      "anima_quality": "  masterpiece,   score_9 ", "anima_safety": "none"})[0]
        self.assertEqual((brief.anima_look, brief.anima_quality, brief.anima_safety), ("realistic", "masterpiece, score_9", "none"))
        defaults = sd.request_from_json({"subject": "woman", "direction": "jobs", "target": "anima"})[0]
        self.assertEqual((defaults.anima_look, defaults.anima_quality, defaults.anima_safety), ("anime", sd.ANIMA_QUALITY_DEFAULT, "safe"))
        for bad in ({"anima_look": "photo"}, {"anima_safety": "unsafe"}, {"anima_quality": "a\nb"}, {"anima_quality": "x" * 301}, {"anima_quality": 7}):
            with self.assertRaises(sd.GenerationError, msg=bad):
                sd.request_from_json({"subject": "woman", "direction": "jobs", "target": "anima", **bad})

    def test_dry_run_shows_the_tag_block_and_negative(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = sd.main(["woman", "jobs", "2", "--target", "anima", "--anima-look", "realistic", "--anima-safety", "none", "--dry-run"])
        self.assertEqual(code, 0)
        text = output.getvalue()
        self.assertIn("LOOK: realistic.", text)
        self.assertIn("masterpiece, best quality, highres, score_7, score_8, real life, realistic\n", text)
        self.assertIn(sd.ANIMA_NEGATIVE, text)

    def test_service_reports_the_anima_choices_the_page_shows(self):
        with tempfile.TemporaryDirectory() as folder:
            server, app = web.create_server(port=0, output_dir=folder, settings_file=Path(folder) / "settings.json")
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/api/state", timeout=10) as response:
                    options = json.loads(response.read())["anima"]
            finally:
                app.stop()
                server.shutdown()
                server.server_close()
        self.assertEqual(options["looks"]["realistic"], {"label": "Realistic", "tags": "real life, realistic"})
        self.assertEqual(set(options["looks"]), set(sd.ANIMA_LOOKS))
        self.assertEqual((options["quality"], options["negative"]), (sd.ANIMA_QUALITY_DEFAULT, sd.ANIMA_NEGATIVE))
        page = (Path(web.HERE) / "web" / "index.html").read_text(encoding="utf-8")
        for look in sd.ANIMA_LOOKS:
            self.assertIn(f'<option value="{look}">', page)
        for safety in sd.ANIMA_SAFETY:
            self.assertIn(f'<option value="{safety}">', page)


if __name__ == "__main__":
    unittest.main()
