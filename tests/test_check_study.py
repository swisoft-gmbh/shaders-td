"""check_study.py: static recipe checks. Run: python3 -m unittest discover -s tests"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import fake_td

CHECKER = fake_td.PLUGIN / "skills/review/scripts/check_study.py"
check_study = fake_td.load("skills/review/scripts/check_study.py", "check_study")

GOOD_MAIN = "out vec4 fragColor;\nvoid main(){fragColor=TDOutputSwizzle(vec4(1.));}\n"
CODE = {"id": "code", "type": "textDAT", "source": "s.frag"}
REF = [{"node": "g", "parameter": "pixeldat", "target": "code"}]


def study(tmp, frag, uniforms=(), references=REF, experiments=None):
    root = Path(tmp)
    for name in ("build.py", "builder.py", "native.py"):
        (root / name).write_text("def build():\n    pass\n")
    (root / "experiments.json").write_text(json.dumps(experiments if experiments is not None else [
        {"id": "final", "question": "q", "prediction": "p", "parameters": {}}]))
    (root / "s.frag").write_text(frag)
    spec = {"id": "s", "title": "s", "controls": [], "output": "g", "wires": [],
            "nodes": [CODE, {"id": "g", "type": "glslTOP", "uniforms": list(uniforms)}]}
    if references is not None:
        spec["references"] = references
    (root / "study.json").write_text(json.dumps(spec))
    return root


class Uniforms(unittest.TestCase):
    def errors(self, frag, uniforms=(), **kw):
        with tempfile.TemporaryDirectory() as tmp:
            return check_study.check(study(tmp, frag, uniforms, **kw))["errors"]

    def test_unbound_uniform_is_reported(self):
        errors = self.errors("uniform float uA;\n" + GOOD_MAIN)
        self.assertTrue(any("uA" in e for e in errors), errors)

    def test_each_name_of_a_multi_name_declaration_is_bound(self):
        frag = "uniform float uA, uB;\n" + GOOD_MAIN
        both = [{"name": "uA", "values": [1]}, {"name": "uB", "values": [1]}]
        self.assertEqual(self.errors(frag, both), [])
        self.assertTrue(any("uB" in e for e in self.errors(frag, both[:1])))

    def test_array_and_precision_qualified_uniforms_are_read(self):
        frag = "uniform highp vec3 uPts[4];\n" + GOOD_MAIN
        self.assertEqual(self.errors(frag, [{"name": "uPts", "values": [0, 0, 0]}]), [])

    def test_a_named_sampler_without_a_binding_is_reported(self):
        errors = self.errors("uniform sampler2D sScene;\n" + GOOD_MAIN)
        self.assertTrue(any("sampler" in e and "sScene" in e for e in errors), errors)

    def test_a_named_sampler_binding_is_matched_to_its_declaration(self):
        frag = "uniform sampler2D sScene;\n" + GOOD_MAIN
        bound = [{"name": "sScene", "kind": "sampler", "values": ["op('scene')"]}]
        self.assertEqual(self.errors(frag, bound), [])
        stray = [{"name": "sOther", "kind": "sampler", "values": ["op('scene')"]}]
        self.assertTrue(any("sOther" in e for e in self.errors(frag, stray)))

    def test_a_sampler_bound_as_a_vector_is_reported(self):
        frag = "uniform sampler2D sScene;\n" + GOOD_MAIN
        self.assertNotEqual(self.errors(frag, [{"name": "sScene", "values": [0]}]), [])

    def test_an_initialiser_with_commas_declares_one_uniform(self):
        frag = "uniform vec3 uTint = vec3(1.0, 0.5, 0.2);\n" + GOOD_MAIN
        self.assertEqual(self.errors(frag, [{"name": "uTint", "values": [1, 0.5, 0.2]}]), [])

    def test_a_colour_uniform_is_bound_on_the_colors_page(self):
        frag = "uniform vec4 uTint;\n" + GOOD_MAIN
        self.assertEqual(self.errors(frag, [{"name": "uTint", "kind": "color", "values": [1, 0, 0, 1]}]), [])

    def test_a_commented_out_uniform_is_not_a_declaration(self):
        frag = "// uniform float uOld;\n/* uniform float uOlder; */\n" + GOOD_MAIN
        self.assertEqual(self.errors(frag), [])

    def test_touchdesigner_built_ins_need_no_binding(self):
        frag = "uniform sampler2D sTD2DInputs[1];\n" + GOOD_MAIN
        self.assertEqual(self.errors(frag), [])


class Contract(unittest.TestCase):
    def errors(self, frag, **kw):
        with tempfile.TemporaryDirectory() as tmp:
            return check_study.check(study(tmp, frag, **kw))["errors"]

    def test_a_study_without_references_is_checked_not_crashed(self):
        self.assertEqual(self.errors(GOOD_MAIN, references=None), [])

    def test_swizzle_named_only_in_a_comment_does_not_count(self):
        frag = "out vec4 fragColor;\n// TODO TDOutputSwizzle\nvoid main(){fragColor=vec4(1.);}\n"
        self.assertIn("Fragment output has no native swizzle", self.errors(frag))

    def test_version_inside_a_block_comment_is_ignored(self):
        self.assertEqual(self.errors("/*\n#version 330\n*/\n" + GOOD_MAIN), [])

    def test_a_real_version_line_is_reported(self):
        self.assertIn("TouchDesigner supplies #version", self.errors("#version 330\n" + GOOD_MAIN))


class Controls(unittest.TestCase):
    def check(self, mutate):
        with tempfile.TemporaryDirectory() as tmp:
            root = study(tmp, "uniform vec3 uInk;\n" + GOOD_MAIN, [
                {"name": "uInk", "values": ["parent().par.Inkr", "parent().par.Inkg", "parent().par.Inkb"]}],
                experiments=[{"id": "teal", "question": "q", "prediction": "p", "parameters": {"Inkr": 0, "Inkg": 0.5}}])
            spec = json.loads((root / "study.json").read_text())
            spec["controls"] = [{"name": "Ink" + ch, "group": "Ink", "label": "Ink", "type": "rgb", "default": 1}
                                for ch in "rgb"]
            mutate(spec, root)
            (root / "study.json").write_text(json.dumps(spec))
            return check_study.check(root)["errors"]

    def test_the_channels_of_an_rgb_control_are_known_to_expressions_and_experiments(self):
        self.assertEqual(self.check(lambda spec, root: None), [])

    def test_an_expression_naming_no_control_is_still_reported(self):
        def rename(spec, root):
            spec["controls"][0]["name"] = "Tintr"
        self.assertTrue(any("Inkr" in e for e in self.check(rename)))

    def test_a_python_dat_source_that_does_not_parse_is_reported(self):
        def add_broken_script(spec, root):
            (root / "clock.py").write_text("def onFrameStart(frame:\n    pass\n")
            spec["nodes"].append({"id": "clock", "type": "executeDAT", "source": "clock.py"})
        self.assertTrue(any("clock.py" in e for e in self.check(add_broken_script)))


class PlainProject(unittest.TestCase):
    def test_a_folder_without_study_json_is_reported_as_not_a_dossier(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "trail.frag").write_text(GOOD_MAIN)
            run = subprocess.run([sys.executable, "-B", str(CHECKER), tmp], capture_output=True, text=True)
        self.assertEqual(run.returncode, 2, run.stdout + run.stderr)
        self.assertIn("study.json", run.stderr)
        self.assertIn("read the project", run.stderr)
        self.assertNotIn("Traceback", run.stderr)

    def test_every_bundled_example_still_passes(self):
        for folder in sorted((fake_td.PLUGIN / "examples").iterdir()):
            if (folder / "study.json").is_file():
                with self.subTest(folder.name):
                    self.assertEqual(check_study.check(folder)["errors"], [])


if __name__ == "__main__":
    unittest.main()
