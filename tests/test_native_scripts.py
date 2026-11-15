"""native_builder.py and native_tools.py against the fake td module (no TouchDesigner)."""
import itertools
import json
import tempfile
import unittest
from pathlib import Path

import fake_td

CONTROLS = [
    {"name": "Warp", "label": "Warp", "type": "float", "default": 0.5},
    {"name": "Bands", "label": "Bands", "type": "float", "default": 10, "max": 40},
    {"name": "Scale", "label": "Scene scale", "type": "float", "default": 1, "setup": True},
]
MORE_CONTROLS = [
    *({"name": "Ink" + ch, "group": "Ink", "label": "Ink colour", "type": "rgb", "default": v}
      for ch, v in zip("rgb", (1.0, 0.2, 0.6))),
    {"name": "Source", "label": "Source TOP", "type": "top", "default": "", "setup": True, "page": "Inputs"},
    {"name": "Note", "label": "Note", "type": "string", "default": "", "setup": True},
    {"name": "Steps", "label": "Steps", "type": "int", "default": 8, "max": 64},
    {"name": "Clear", "label": "Clear trail", "type": "pulse"},
]
EXPERIMENTS = [
    {"id": "warped", "question": "q", "prediction": "p", "parameters": {"Warp": 0.9}},
    {"id": "dense", "question": "q", "prediction": "p", "parameters": {"Bands": 30}},
    {"id": "final", "question": "q", "prediction": "p", "parameters": {}},
]


def write_study(tmp, nodes=None, uniforms=None, **extra):
    root = Path(tmp)
    spec = {"id": "test-study", "title": "Test", "controls": CONTROLS, "output": "out", "wires": [
        {"from": "render", "to": "out"}], "references": [{"node": "render", "parameter": "pixeldat", "target": "code"}],
            "nodes": nodes or [
                {"id": "code", "type": "textDAT", "source": "s.frag"},
                {"id": "render", "type": "glslTOP", "uniforms": uniforms or []},
                {"id": "out", "type": "nullTOP"}], **extra}
    (root / "study.json").write_text(json.dumps(spec))
    (root / "experiments.json").write_text(json.dumps(EXPERIMENTS))
    (root / "s.frag").write_text("void main(){}\n")
    (root / "article.md").write_text("# Test\n")
    (root / "native.py").write_text((fake_td.PLUGIN / "skills/build/scripts/native_tools.py").read_text())
    return root


class Host(unittest.TestCase):
    def setUp(self):
        self.td, self.root = fake_td.install()
        self.builder = fake_td.load("skills/build/scripts/native_builder.py", "native_builder")
        self.tools = fake_td.load("skills/build/scripts/native_tools.py", "native_tools")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def build(self, **kw):
        return self.builder.build(write_study(self.tmp.name, **kw))


class Builder(Host):
    def test_a_wrong_parameter_on_a_strict_node_stops_the_build_and_names_it(self):
        nodes = [{"id": "code", "type": "textDAT", "source": "s.frag"},
                 {"id": "render", "type": "glslTOP", "parameters": {"nosuchpar": 1}},
                 {"id": "out", "type": "nullTOP"}]
        with self.assertRaisesRegex(RuntimeError, "nosuchpar"):
            self.build(nodes=nodes)

    def test_a_wrong_parameter_on_a_lenient_node_becomes_a_stored_warning(self):
        nodes = [{"id": "code", "type": "textDAT", "source": "s.frag"},
                 {"id": "render", "type": "glslTOP"},
                 {"id": "demo", "type": "noiseTOP", "lenient": True, "parameters": {"nosuchpar": 1, "period": 2}},
                 {"id": "out", "type": "nullTOP"}]
        component = self.build(nodes=nodes)
        warnings = component.fetch("study_warnings")
        self.assertEqual(len(warnings), 1, warnings)
        self.assertIn("nosuchpar", warnings[0])
        self.assertEqual(component.op("demo").par.period.val, 2)

    def test_a_colour_uniform_is_bound_on_the_colors_page_not_the_vectors_page(self):
        component = self.build(uniforms=[
            {"name": "uAmount", "values": [0.5]},
            {"name": "uTint", "kind": "color", "values": [1, 0.5, 0.25, 1]}])
        render = component.op("render")
        self.assertEqual(render.seq.vec.numBlocks, 1)
        self.assertEqual(render.seq.color.numBlocks, 1)
        self.assertEqual(render.par.color0name.val, "uTint")
        self.assertEqual([render.par.color0rgbr.val, render.par.color0rgbg.val,
                          render.par.color0rgbb.val, render.par.color0alpha.val], [1, 0.5, 0.25, 1])

    def test_a_sampler_uniform_is_bound_on_the_samplers_page(self):
        component = self.build(uniforms=[{"name": "sScene", "kind": "sampler", "values": ["op('scene')"]}])
        render = component.op("render")
        self.assertEqual(render.seq.vec.numBlocks, 0)
        self.assertEqual(render.par.sampler0name.val, "sScene")
        self.assertEqual(render.par.sampler0top.expr, "op('scene')")

    def test_a_sequence_can_be_sized_before_its_parameters_are_set(self):
        nodes = [{"id": "code", "type": "textDAT", "source": "s.frag"},
                 {"id": "render", "type": "glslTOP"},
                 {"id": "levels", "type": "constantCHOP", "sequences": {"const": 2},
                  "parameters": {"const0name": "low", "const1name": "high", "const1value": 0.8}},
                 {"id": "out", "type": "nullTOP"}]
        levels = self.build(nodes=nodes).op("levels")
        self.assertEqual([levels.par.const0name.val, levels.par.const1name.val, levels.par.const1value.val],
                         ["low", "high", 0.8])

    def test_every_glsl_operator_gets_an_info_dat_including_glsl_multi(self):
        nodes = [{"id": "code", "type": "textDAT", "source": "s.frag"},
                 {"id": "render", "type": "glslmultiTOP"},
                 {"id": "out", "type": "nullTOP"}]
        component = self.build(nodes=nodes)
        self.assertEqual(component.op("info_render").OPType, "infoDAT")

    def test_the_build_only_adds_one_component_to_the_parent(self):
        self.root.create("textDAT", "users_own_node")
        self.build()
        self.assertEqual(sorted(self.root.kids), ["test_study", "users_own_node"])


class ControlTypes(Host):
    def build_more(self):
        root = write_study(self.tmp.name)
        spec = json.loads((root / "study.json").read_text())
        spec["controls"] = CONTROLS + MORE_CONTROLS
        (root / "study.json").write_text(json.dumps(spec))
        (root / "experiments.json").write_text(json.dumps(EXPERIMENTS + [
            {"id": "teal", "question": "q", "prediction": "p", "parameters": {"Inkr": 0.0, "Inkg": 0.5, "Inkb": 0.5}}]))
        return self.builder.build(root)

    def test_an_rgb_control_becomes_three_parameters_with_its_default(self):
        component = self.build_more()
        self.assertEqual([component.par.Inkr.val, component.par.Inkg.val, component.par.Inkb.val], [1.0, 0.2, 0.6])

    def test_operator_string_int_and_pulse_controls_are_created(self):
        component = self.build_more()
        self.assertEqual(component.par.Source.val, "")
        self.assertEqual(component.par.Note.val, "")
        self.assertEqual(component.par.Steps.val, 8)
        self.assertEqual(component.par.Clear.pulsed, 0)

    def test_an_unknown_control_type_stops_the_build_and_names_it(self):
        root = write_study(self.tmp.name)
        spec = json.loads((root / "study.json").read_text())
        spec["controls"] = [{"name": "Odd", "label": "Odd", "type": "matrix", "default": 0}]
        (root / "study.json").write_text(json.dumps(spec))
        with self.assertRaisesRegex(RuntimeError, "matrix"):
            self.builder.build(root)

    def test_an_experiment_sets_and_a_later_one_resets_an_rgb_control(self):
        component = self.build_more()
        self.tools.apply(component, "teal")
        self.assertEqual([component.par.Inkr.val, component.par.Inkg.val, component.par.Inkb.val], [0.0, 0.5, 0.5])
        self.tools.apply(component, "final")
        self.assertEqual([component.par.Inkr.val, component.par.Inkg.val, component.par.Inkb.val], [1.0, 0.2, 0.6])


class Tools(Host):
    def values(self, component):
        return {p.name: p.val for p in component.customPars}

    def test_an_experiment_does_not_inherit_the_previous_experiments_values(self):
        component = self.build()
        self.tools.apply(component, "warped")
        self.tools.apply(component, "dense")
        self.assertEqual(self.values(component), {"Warp": 0.5, "Bands": 30, "Scale": 1})

    def test_experiments_give_the_same_result_in_any_order(self):
        ids = [e["id"] for e in EXPERIMENTS]
        for last in ids:
            results = []
            for before in itertools.permutations([i for i in ids if i != last]):
                self.root.kids.clear()
                component = self.build()
                for experiment_id in (*before, last):
                    self.tools.apply(component, experiment_id)
                results.append(self.values(component))
            with self.subTest(last):
                self.assertTrue(all(r == results[0] for r in results), results)

    def test_setup_controls_describe_the_users_scene_and_are_never_reset(self):
        component = self.build()
        component.par.Scale = 3
        self.tools.apply(component, "final")
        self.assertEqual(component.par.Scale.val, 3)

    def test_a_control_driven_by_an_expression_is_left_alone_and_reported(self):
        component = self.build()
        component.par.Warp.expr = "absTime.seconds"
        result = self.tools.apply(component, "dense")
        self.assertEqual(result["not_reset"], ["Warp"])
        self.assertEqual(component.par.Warp.expr, "absTime.seconds")

    def test_inspect_still_reports_after_the_user_deleted_a_node(self):
        component = self.build()
        del component.kids["render"]
        report = self.tools.inspect(component)
        self.assertEqual(report["missing"], ["render"])

    def test_python_errors_are_reported_and_stop_a_capture(self):
        component = self.build()
        component.script_error_text = "NameError in callbacks"
        self.assertIn("NameError", self.tools.inspect(component)["script_errors"])
        with self.assertRaises(RuntimeError):
            self.tools.capture(component, str(Path(self.tmp.name) / "shots" / "a.png"))

    def test_a_clean_component_is_captured_with_a_receipt(self):
        component = self.build()
        target = Path(self.tmp.name) / "shots" / "a.png"
        self.tools.capture(component, str(target))
        receipt = json.loads(Path(str(target) + ".json").read_text())
        self.assertEqual(receipt["capture"], "a.png")
        self.assertEqual(receipt["missing"], [])


if __name__ == "__main__":
    unittest.main()
