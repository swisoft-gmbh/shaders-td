"""scaffold.py and article.py, run the way an agent runs them (as scripts)."""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import fake_td

PLUGIN = fake_td.PLUGIN
SCAFFOLD = PLUGIN / "skills/build/scripts/scaffold.py"
ARTICLE = PLUGIN / "skills/explain/scripts/article.py"
CHECKER = PLUGIN / "skills/review/scripts/check_study.py"
SEEDS = ["contour-loom", "phosphor-memory", "contour-material", "orbital-relic",
         "lantern-fog", "pigment-census", "resonant-foil", "tidal-ink"]


def run(*args):
    return subprocess.run([sys.executable, "-B", *map(str, args)], capture_output=True, text=True)


def digest(folder):
    """One hash over every file's path and bytes in a folder."""
    total = hashlib.sha256()
    for path in sorted(p for p in folder.rglob("*") if p.is_file() and "__pycache__" not in p.parts):
        total.update(str(path.relative_to(folder)).encode() + b"\0" + path.read_bytes())
    return total.hexdigest()


def body(path):
    """A file's text without the three-line licence header scaffold.py adds."""
    return path.read_text().split("\n", 3)[3]


class Scaffold(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.studies = {}
        cls.before = {seed: digest(PLUGIN / "examples" / seed) for seed in SEEDS}
        for seed in SEEDS:
            target = Path(cls.tmp.name) / seed
            result = run(SCAFFOLD, target, "--example", seed)
            assert result.returncode == 0, result.stderr
            cls.studies[seed] = target

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def each(self):
        for seed, study in self.studies.items():
            with self.subTest(seed):
                yield study

    def test_the_examples_native_evidence_is_not_copied(self):
        for study in self.each():
            self.assertFalse((study / "native").exists())
            self.assertFalse((study / "captures").exists())
            for experiment in json.loads((study / "experiments.json").read_text()):
                self.assertNotIn("capture", experiment)
                self.assertNotIn("observation", experiment)

    def test_validation_and_design_records_start_as_pending(self):
        for study in self.each():
            validation = json.loads((study / "validation.json").read_text())
            self.assertEqual({v["status"] for v in validation.values()}, {"pending"})
            self.assertEqual({v["evidence"] for v in validation.values()}, {None})
            self.assertEqual(json.loads((study / "decisions.json").read_text()), [])
            self.assertEqual(json.loads((study / "co-design.json").read_text())["user_feedback"], [])

    def test_the_tutorial_no_longer_claims_native_captures(self):
        for study in self.each():
            article = (study / "article.md").read_text()
            self.assertNotIn("Captured native stage", article)
            self.assertNotIn("Native experiment", article)
            self.assertNotIn("captures/", article)

    def test_the_new_study_passes_both_static_checks(self):
        for study in self.each():
            for script, args in ((CHECKER, [study]), (ARTICLE, ["check", study])):
                result = run(script, *args)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_the_current_builder_and_helpers_replace_the_examples_old_copies(self):
        for study in self.each():
            self.assertEqual(body(study / "builder.py"), (SCAFFOLD.parent / "native_builder.py").read_text())
            self.assertEqual(body(study / "native.py"), (SCAFFOLD.parent / "native_tools.py").read_text())

    def test_every_code_file_and_the_folder_state_licence_and_credit(self):
        for study in self.each():
            notice = (study / "NOTICE.md").read_text()
            for words in ("CC BY-NC 4.0", "Maxime Heckel", "Swisoft GmbH", "non-commercial"):
                self.assertIn(words, notice)
            for path in [*study.rglob("*.py"), *study.rglob("*.frag"), *study.rglob("*.vert"), *study.rglob("*.glsl")]:
                head = "".join(path.read_text().splitlines(keepends=True)[:5])
                self.assertIn("CC BY-NC 4.0", head, path.name)
                self.assertIn("Maxime Heckel", head, path.name)

    def test_python_files_still_parse_after_the_header(self):
        for study in self.each():
            for path in study.rglob("*.py"):
                compile(path.read_text(), str(path), "exec")

    def test_the_bundled_examples_are_left_untouched(self):
        for seed in SEEDS:
            with self.subTest(seed):
                self.assertEqual(digest(PLUGIN / "examples" / seed), self.before[seed])

    def test_an_existing_destination_is_never_overwritten(self):
        result = run(SCAFFOLD, self.studies["contour-loom"])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exists", result.stderr)

    def test_a_copy_without_examples_says_what_is_missing_and_where_to_start(self):
        with tempfile.TemporaryDirectory() as tmp:
            scripts = Path(tmp) / "skills/build/scripts"
            scripts.mkdir(parents=True)
            for name in ("scaffold.py", "native_builder.py", "native_tools.py"):
                shutil.copy(SCAFFOLD.parent / name, scripts / name)
            result = run(scripts / "scaffold.py", Path(tmp) / "new-study")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Traceback", result.stderr)
        for words in ("examples", "native_builder.py", "native_tools.py"):
            self.assertIn(words, result.stderr)


def tutorial(tmp, experiment):
    root = Path(tmp)
    (root / "s.frag").write_text("// @begin main\nvoid main(){}\n// @end main\n")
    (root / "experiments.json").write_text(json.dumps([{
        "id": "look", "question": "What changes?", "prediction": "It brightens.", "parameters": {"Gain": 2},
        **experiment}]))
    (root / "article.source.md").write_text("# T\n\n## Look\n\n{{code:s.frag:main}}\n\n{{experiment:look}}\n")
    (root / "article-plan.json").write_text(json.dumps([{
        "heading": "Look", "question": "q", "snippets": [["s.frag", "main"]], "experiments": ["look"]}]))
    (root / "captures").mkdir()
    (root / "captures/look.png").write_bytes(b"png")
    return root


class Article(unittest.TestCase):
    def render(self, experiment):
        with tempfile.TemporaryDirectory() as tmp:
            root = tutorial(tmp, experiment)
            result = run(ARTICLE, "render", root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(run(ARTICLE, "check", root).returncode, 0)
            return (root / "article.md").read_text()

    def test_a_native_capture_is_captioned_as_native(self):
        text = self.render({"capture": "captures/look.png"})
        self.assertIn("**Native experiment `look`:**", text)
        self.assertIn("Captured native stage", text)

    def test_a_preview_image_is_never_captioned_as_native(self):
        text = self.render({"capture": "captures/look.png", "evidence": "preview"})
        self.assertNotIn("native", text.lower().replace("not rendered in touchdesigner", ""))
        self.assertIn("Preview", text)
        self.assertIn("captures/look.png", text)

    def test_a_picture_from_a_port_of_the_maths_is_captioned_as_a_port(self):
        text = self.render({"capture": "captures/look.png", "evidence": "port"})
        self.assertIn("port of the shader", text)
        self.assertNotIn("Preview image", text)
        self.assertNotIn("native", text.lower())

    def test_an_experiment_nobody_ran_is_not_called_native(self):
        text = self.render({})
        self.assertIn("**Experiment `look`:**", text)
        self.assertNotIn("Native", text)

    def test_an_unknown_evidence_label_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = run(ARTICLE, "render", tutorial(tmp, {"evidence": "certified"}))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("certified", result.stderr)

    def test_an_experiments_own_note_replaces_the_stock_sentence(self):
        text = self.render({"note": "Time keeps running in this one."})
        self.assertIn("Time keeps running in this one.", text)
        self.assertNotIn("Time and unrelated controls are fixed", text)

    def test_a_python_region_is_excerpted_with_a_python_fence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = tutorial(tmp, {})
            (root / "clock.py").write_text("# @begin advance\nphase += speed * step\n# @end advance\n")
            (root / "article.source.md").write_text(
                "# T\n\n## Look\n\n{{code:s.frag:main}}\n\n{{code:clock.py:advance}}\n\n{{experiment:look}}\n")
            (root / "article-plan.json").write_text(json.dumps([{
                "heading": "Look", "question": "q", "snippets": [["s.frag", "main"], ["clock.py", "advance"]],
                "experiments": ["look"]}]))
            self.assertEqual(run(ARTICLE, "render", root).returncode, 0)
            self.assertEqual(run(ARTICLE, "check", root).returncode, 0)
            text = (root / "article.md").read_text()
        self.assertIn("```python\nphase += speed * step\n```", text)
        self.assertIn("```glsl\nvoid main(){}\n```", text)

    def test_a_plain_project_is_reported_as_not_a_dossier_for_both_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "article.md").write_text("# A hand-written tutorial\n")
            for command in ("check", "render"):
                with self.subTest(command):
                    result = run(ARTICLE, command, tmp)
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertIn("article.source.md", result.stderr)
                    self.assertIn("read the tutorial", result.stderr)
                    self.assertNotIn("Errno", result.stderr)
            self.assertEqual((Path(tmp) / "article.md").read_text(), "# A hand-written tutorial\n")

    def test_the_native_examples_tutorials_are_unchanged(self):
        for seed in SEEDS:
            with self.subTest(seed):
                result = run(ARTICLE, "check", PLUGIN / "examples" / seed)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
