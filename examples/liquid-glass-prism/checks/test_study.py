#!/usr/bin/env python3
"""Tests that need neither TouchDesigner nor a GPU.

  python3 checks/test_study.py

Covers the preset module (load and morph maths, with fake parameters), the
recipe's internal consistency, compatibility with the core Liquid Glass
presets (commit a6f95c6, copied to checks/core_presets_a6f95c6.json), the
back-face pass contract, and the match between the Stage menu and the
shader's debug stages.

The FamilySync class covers the family sync with the core study (review.md,
Family sync): the core's audit rounds 2 and 3 (R1 to R9: drift clock, Render
Pass TOP route, Inputs fields, experiment reset, shader hygiene, frost disc,
colour parameters, sampler settings and diagnostics) and the merge items C1 to
C9 (covered alpha, picking and colour buffers, the dispersion decision, no
dithering, the output cap and render diagnostics, screen orientation, fog,
Object size, demo backdrops), with fake TouchDesigner objects and a fake clock.

The FamilyClose class covers this study's share of the family close after
commit c94e849 (review.md, Family close): G1 Object size follows the family
rule, G2 one centre-line tie-break across the family, G6 the documented
picking form. The FamilyCloseCritic class covers a family critic's findings
after that (review.md, Family close critic fixes): PV1 what Fit measures on
the demo, PV2 the count of changed expectations, PV3 the Not done note, PV4
the labels of the lengths and of Object size.
"""
import builtins
import itertools
import json
from pathlib import Path
import re
import runpy
import sys
from types import ModuleType, SimpleNamespace
import unittest

STUDY = Path(__file__).resolve().parent.parent
SPEC = json.loads((STUDY / "study.json").read_text())
PRESETS = json.loads((STUDY / "presets.json").read_text())
CORE_PRESETS = json.loads((STUDY / "checks" / "core_presets_a6f95c6.json").read_text())
EXPERIMENTS = json.loads((STUDY / "experiments.json").read_text())
MODULE = runpy.run_path(str(STUDY / "presets.py"))
CONTROLS = {c["name"]: c for c in SPEC["controls"]}
NODES = {n["id"]: n for n in SPEC["nodes"]}
FRAG = (STUDY / "liquid_prism.frag").read_text()
VERT = (STUDY / "liquid_prism.vert").read_text()
PRISM_KEYS = ["Scenedepth", "Exittilt", "Innerreflect", "Caustic", "Causticspread"]

# native.py starts with `from td import *`; outside TouchDesigner an empty module stands in.
sys.modules.setdefault("td", ModuleType("td"))
NATIVE = runpy.run_path(str(STUDY / "native.py"))


class FakePar:
    def __init__(self, owner, name, value, menu_names=None):
        self.owner, self.name, self.val = owner, name, value
        self.menuNames = menu_names or []

    def eval(self):
        return self.val

    @property
    def menuIndex(self):
        return self.menuNames.index(self.val)


class FakePars:
    """A COMP's par collection: like TouchDesigner, comp.par.X = v sets the value."""

    def __init__(self, pars):
        object.__setattr__(self, "_pars", pars)

    def __getattr__(self, name):
        try:
            return self._pars[name]
        except KeyError:
            raise AttributeError(name) from None

    def __setattr__(self, name, value):
        self._pars[name].val = value


class FakeComp:
    """Just enough of a TouchDesigner COMP for presets.py, preset_exec.py and native.apply()."""

    count = 0

    def __init__(self, values, presets_text=None):
        FakeComp.count += 1  # a fresh path: presets.py keeps running drift per component path
        self.path = f"/project1/liquid_glass_prism{FakeComp.count}"
        self.par = FakePars({k: FakePar(self, k, v, CONTROLS.get(k, {}).get("names"))
                             for k, v in values.items()})
        self._ops = {
            "presets_data": SimpleNamespace(text=presets_text or (STUDY / "presets.json").read_text()),
            "presets": SimpleNamespace(module=SimpleNamespace(apply=MODULE["apply"])),
            "study_spec": SimpleNamespace(text=(STUDY / "study.json").read_text()),
            "study_experiments": SimpleNamespace(text=(STUDY / "experiments.json").read_text()),
        }

    def op(self, name):
        return self._ops[name]

    def state(self):
        return {k: v.val for k, v in self.par._pars.items()}


def defaults():
    return {c["name"]: c["default"] for c in SPEC["controls"] if c.get("default") is not None}


class PresetModule(unittest.TestCase):
    def test_apply_writes_every_preset_value(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "diamond_fire")
        for key, value in PRESETS["presets"]["diamond_fire"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        before = comp.state()
        MODULE["apply"](comp, "custom")
        self.assertEqual(before, comp.state())

    def test_morph_endpoints_and_midpoint(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "spectral_prism")
        comp.par.Morphtarget.val = "caustic_heart"
        a = PRESETS["presets"]["spectral_prism"]["values"]
        b = PRESETS["presets"]["caustic_heart"]["values"]
        for m, expect in ((0.0, lambda k: a[k]), (1.0, lambda k: b[k]), (0.5, lambda k: (a[k] + b[k]) / 2)):
            comp.par.Morph.val = m
            for key in SPEC["preset_keys"]:
                self.assertAlmostEqual(MODULE["u"](getattr(comp.par, key)), expect(key), 9, key)


class CoreCompatibility(unittest.TestCase):
    """The prism keeps the core's look controls: core presets load unchanged."""

    def test_every_core_preset_key_is_a_control_within_range(self):
        for name, preset in CORE_PRESETS["presets"].items():
            for key, value in preset["values"].items():
                self.assertIn(key, CONTROLS, f"{name}.{key}")
                c = CONTROLS[key]
                self.assertGreaterEqual(value, c["min"], f"{name}.{key}")
                self.assertLessEqual(value, c["max"], f"{name}.{key}")

    def test_core_presets_apply_and_leave_prism_values(self):
        comp = FakeComp(defaults(), presets_text=json.dumps(CORE_PRESETS))
        prism_before = {k: getattr(comp.par, k).val for k in PRISM_KEYS}
        for name, preset in CORE_PRESETS["presets"].items():
            MODULE["apply"](comp, name)
            for key, value in preset["values"].items():
                self.assertEqual(getattr(comp.par, key).val, value, f"{name}.{key}")
        self.assertEqual(prism_before, {k: getattr(comp.par, k).val for k in PRISM_KEYS})

    def test_core_looks_keep_core_values(self):
        for name, preset in PRESETS["presets"].items():
            if name in CORE_PRESETS["presets"]:
                core = CORE_PRESETS["presets"][name]["values"]
                self.assertEqual({k: preset["values"][k] for k in core}, core, name)

    def test_core_preset_keys_are_a_subset(self):
        core_keys = set(next(iter(CORE_PRESETS["presets"].values()))["values"])
        self.assertTrue(core_keys <= set(SPEC["preset_keys"]))
        self.assertEqual(set(SPEC["preset_keys"]) - core_keys, set(PRISM_KEYS))


class Recipe(unittest.TestCase):
    def test_twelve_complete_presets(self):
        self.assertEqual(len(PRESETS["presets"]), 12)
        self.assertEqual(PRESETS["order"], list(PRESETS["presets"]))
        for name, preset in PRESETS["presets"].items():
            self.assertEqual(sorted(preset["values"]), sorted(SPEC["preset_keys"]), name)
            for key, value in preset["values"].items():
                self.assertGreaterEqual(value, CONTROLS[key]["min"], f"{name}.{key}")
                self.assertLessEqual(value, CONTROLS[key]["max"], f"{name}.{key}")

    def test_control_defaults_are_the_default_preset(self):
        values = PRESETS["presets"][PRESETS["default"]]["values"]
        for key, value in values.items():
            self.assertEqual(CONTROLS[key]["default"], value, key)
        self.assertEqual(CONTROLS["Preset"]["default"], PRESETS["default"])

    def test_menus_offer_every_preset(self):
        self.assertEqual(CONTROLS["Preset"]["names"], ["custom"] + PRESETS["order"])
        self.assertEqual(CONTROLS["Morphtarget"]["names"], PRESETS["order"])

    def test_every_preset_value_reaches_a_morphed_uniform(self):
        for node_id in ("material", "material_back"):
            text = json.dumps(NODES[node_id]["uniforms"])
            morphed = re.findall(r"module\.u\(parent\(\)\.par\.(\w+)\)", text)
            self.assertEqual(sorted(morphed), sorted(SPEC["preset_keys"]), node_id)

    def test_both_materials_share_bindings_except_pass_and_back_sampler(self):
        front = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        back = {u["name"]: u["values"] for u in NODES["material_back"]["uniforms"]}
        self.assertEqual(sorted(front), sorted(back))
        self.assertEqual(sorted(k for k in front if front[k] != back[k]), ["sBackface", "uState"])
        self.assertEqual(front["uState"][1], 0)
        self.assertEqual(back["uState"][1], 1)
        self.assertEqual(back["sBackface"], ["op('blank')"])  # the back pass never reads itself

    def test_prism_uniform_packing_matches_shader_comments(self):
        front = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        # Scene depth is a length: since the family sync (C8) it is converted with Object size.
        self.assertEqual(front["uPrism"][:3], ["op('presets').module.u(parent().par.Scenedepth) * parent().par.Objectsize.eval()",
                                               "op('presets').module.u(parent().par.Exittilt)",
                                               "op('presets').module.u(parent().par.Innerreflect)"])
        self.assertEqual(front["uCaustic"][:2], [f"op('presets').module.u(parent().par.{k})"
                                                 for k in ("Caustic", "Causticspread")])
        self.assertIn("uniform vec4 uPrism;      // scene depth (scene units), exit tilt, inner reflection", FRAG)
        self.assertIn("uniform vec4 uCaustic;    // caustic glow, caustic spread", FRAG)

    def test_stage_menu_matches_shader_stages(self):
        names = CONTROLS["Stage"]["names"]
        numbered = sorted({int(n) for n in re.findall(r"stage == (\d+)", FRAG)})
        # 0 = final; 1..12 are tested explicitly; the last stage is the else branch.
        self.assertEqual(numbered, list(range(1, len(names) - 1)))
        self.assertEqual(names[:9], ["final", "normal", "refraction", "body", "reflection", "fresnel",
                                     "thickness", "film", "screenuv"])  # core order kept
        self.assertEqual(names[9:], ["exitnormal", "deviation", "tir", "bounce", "caustic"])

    def test_backface_pass_is_a_float_data_target(self):
        back = NODES["render_back"]
        self.assertEqual(back["parameters"]["format"], "rgba32float")
        self.assertEqual(back["parameters"]["antialias"], "aa1")       # no averaging of distances
        self.assertEqual(back["parameters"]["bgcolora"], 0)            # any alpha >= 0 = no glass
        self.assertFalse(back["parameters"]["premultrgbbyalpha"])
        mat = NODES["material_back"]["parameters"]
        self.assertFalse(mat["blending"])
        self.assertFalse(mat["postmultalpha"])
        self.assertEqual(mat["cullface"], "frontfaces")
        refs = {(r["node"], r["parameter"]): r["target"] for r in SPEC["references"]}
        self.assertEqual(refs[("render_back", "overridemat")], "material_back")
        self.assertIn("texelFetch(sBackface", FRAG)                     # no filtering needed or assumed
        # Distance stored negative: glass is alpha < 0, so any non-negative background reads as empty.
        self.assertIn("-surfaceDistance));", FRAG)
        self.assertIn("if (b.a < 0.0) {", FRAG)
        self.assertNotIn("if (b.a > 0.0)", FRAG)

    def test_backface_pass_renders_every_glass_object(self):
        back = NODES["render_back"]
        self.assertEqual(back["expressions"]["geometry"], "' '.join(o.path for o in parent().par.Glassgeo.evalOPs())")

    def test_backface_is_optional_by_default(self):
        self.assertFalse(CONTROLS["Backface"]["default"])
        sampler = next(u for u in NODES["material"]["uniforms"] if u["name"] == "sBackface")
        self.assertEqual(sampler["values"], ["op('render_back') if parent().par.Backface.eval() else op('blank')"])

    def test_every_pixel_output_goes_through_the_swizzle(self):
        # The material writes colour buffer 0 through the swizzle and zeros to any extra buffers
        # (family sync C2); the demo TOPs write their one output through the swizzle.
        for name in ("liquid_prism.frag", "backdrop.frag", "env.frag"):
            text = re.sub(r"//.*", "", (STUDY / name).read_text())
            writes = re.findall(r"fragColor(\[\d\])?\s*=\s*([^;]+);", text)
            self.assertTrue(writes, name)
            for index, w in writes:
                if index in ("", "[0]"):
                    self.assertTrue(w.strip().startswith("TDOutputSwizzle("), f"{name}: {w}")
                else:
                    self.assertEqual(w.strip(), "vec4(0.0)", f"{name}: {index} {w}")

    def test_no_per_pixel_noise_source(self):
        # The brief rules out dithering. Per-pixel noise needs a per-pixel seed. gl_FragCoord is read
        # only to place the pixel (screenUV() and, since the family sync, screenSign()), no sine hash
        # appears, and the integer lattice hash only feeds object-space value noise (liquid ripples and
        # film). The preview test frost_is_smooth_not_grainy checks the rendered image itself.
        functions = dict(re.findall(r"\n\w+ (\w+)\([^)]*\)\n\{(.*?)\n\}", FRAG, re.S))
        readers = {name for name, body in functions.items() if "gl_FragCoord" in body}
        self.assertEqual(readers, {"screenUV", "screenSign"})
        self.assertIsNone(re.search(r"fract\s*\(\s*sin", FRAG))
        callers = {name for name, body in re.findall(r"\n\w+ (\w+)\([^)]*\)\n\{(.*?)\n\}", FRAG, re.S) if "latticeHash(" in body}
        self.assertEqual(callers, {"valueNoise"})
        noise_users = {name for name, body in re.findall(r"\n\w+ (\w+)\([^)]*\)\n\{(.*?)\n\}", FRAG, re.S) if "valueNoise(" in body}
        self.assertEqual(noise_users, {"liquidField", "filmThickness"})
        # Family close G1: both lookups count the Geometry COMP's scale (worldScale()).
        self.assertIn("vec3 p = vObjPos * uWobble.y * scale;", FRAG)
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale()", FRAG)  # 2.5 swirls per Object size (C8)

    def test_derivatives_only_in_uniform_control_flow(self):
        # GLSL leaves dFdx/dFdy undefined in branches that neighbouring pixels take differently, and
        # after TDCheckDiscard() has discarded a neighbour (Derivative: it discards pixels for
        # order-independent transparency and dual-paraboloid rendering). Derivatives appear only at the
        # top of main() and in footprintLod(), which throughGlass() calls inside a loop whose count and
        # branches depend on uniforms only. Each pass calls TDCheckDiscard() after its last derivative.
        code = code_only(FRAG)
        funcs = dict(re.findall(r"\n\w+ (\w+)\([^)]*\)\n\{(.*?)\n\}", code, re.S))
        users = {name for name, body in funcs.items() if "dFdx" in body or "dFdy" in body}
        self.assertEqual(users, {"footprintLod", "main"})
        self.assertIsNone(re.search(r"\b(texture|fwidth)\s*\(", code))  # no implicit derivatives
        takes = set(users)  # functions that take derivatives, directly or through a call
        while True:
            more = {name for name, body in funcs.items()
                    if any(re.search(r"\b%s\s*\(" % t, body) for t in takes)} - takes
            if not more:
                break
            takes |= more
        self.assertEqual(takes, {"footprintLod", "throughGlass", "main"})
        calls = re.compile(r"\b(dFdx|dFdy|footprintLod|throughGlass)\s*\(")
        main = funcs["main"]
        back_start = main.index("if (uState.y > 0.5) {")
        back_end = main.index("return;", back_start)
        back, front = main[back_start:back_end], main[back_end:]
        # The top of main(): the position's and the projected position's derivatives, before any branch.
        self.assertLess(main.index("vec3 dPdx = dFdx(vWorldPos);"), back_start)
        self.assertLess(main.index("vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));"), back_start)
        self.assertEqual(main.count("TDCheckDiscard();"), 2)
        self.assertIsNone(re.search(calls, back))  # the back-face pass takes none after its discard
        self.assertIn("TDCheckDiscard();", back)
        self.assertLess(front.index("throughGlass("), front.index("TDCheckDiscard();"))
        self.assertIsNone(re.search(calls, front[front.index("TDCheckDiscard();"):]))
        self.assertIsNone(re.search(r"\bTDCheckDiscard\s*\(", main[:back_start]))
        trace = funcs["throughGlass"]
        self.assertIn("if (i >= count) break;", trace)
        self.assertIn("if (uPrism.z > 0.0) {", trace)

    def test_vertex_shader_supports_picking(self):
        # Write a GLSL MAT, Picking: TouchDesigner defines TD_PICKING_ACTIVE for Render Pick DAT/CHOP.
        self.assertIn("#ifndef TD_PICKING_ACTIVE", VERT)
        self.assertIn("TDWritePickingValues();", VERT)
        self.assertLess(VERT.index("gl_Position = TDWorldToProj(world);"), VERT.index("#ifndef TD_PICKING_ACTIVE"))

    def test_builder_reports_the_material_path(self):
        builder = (STUDY / "builder.py").read_text()
        self.assertIn('component.store("material_path", material_path)', builder)
        self.assertIn("drag", builder)

    def test_experiments_use_real_presets_and_previews(self):
        self.assertGreaterEqual(len(EXPERIMENTS), 8)
        for e in EXPERIMENTS:
            self.assertIn(e["parameters"].get("Preset"), PRESETS["presets"], e["id"])
            self.assertTrue((STUDY / e["preview"]).is_file(), e["preview"])
            self.assertTrue((STUDY / (e["preview"] + ".json")).is_file(), e["preview"] + ".json")
            self.assertIn("pending", e["observation"].lower(), e["id"])



class BackfaceReport(unittest.TestCase):
    """native.py backface_report() with a stand-in for TouchDesigner's td module."""

    def setUp(self):
        self.registry = {}
        td = ModuleType("td")
        td.op = lambda path: self.registry.get(path)
        sys.modules["td"] = td
        self.native = runpy.run_path(str(STUDY / "native.py"))
        self.comp = self.make("/project1/liquid_glass_prism")
        self.back = self.make(self.comp.path + "/render_back", width=1280, height=720)
        self.comp.op = lambda name: {"render_back": self.back}[name]
        self.demo_cam = self.make(self.comp.path + "/demo_cam")
        self.demo_geo = self.make(self.comp.path + "/demo_geo")
        self.demo_top = self.make(self.comp.path + "/demo_backdrop", width=1280, height=720)
        self.user_cam = self.make("/project1/cam1")
        self.user_geo = [self.make("/project1/glass1"), self.make("/project1/glass2")]
        self.user_top = self.make("/project1/scene_render", width=1280, height=720)

    def tearDown(self):
        sys.modules["td"] = ModuleType("td")  # back to the empty stand-in the other tests import

    def make(self, path, **attrs):
        node = SimpleNamespace(path=path, **attrs)
        self.registry[path] = node
        return node

    def wire(self, camera, geometry, refraction):
        self.comp.par = SimpleNamespace(
            Backface=SimpleNamespace(eval=lambda: True),
            Camera=SimpleNamespace(eval=lambda: camera),
            Glassgeo=SimpleNamespace(evalOPs=lambda: list(geometry)),
            Refractiontop=SimpleNamespace(eval=lambda: refraction))

    def test_demo_wiring_is_ready(self):
        self.wire(self.demo_cam, [self.demo_geo], self.demo_top)
        report = self.native["backface_report"](self.comp)
        self.assertTrue(report["ready"])
        self.assertEqual(report["warnings"], [])

    def test_warns_when_demo_references_meet_a_user_scene(self):
        self.wire(self.demo_cam, [self.demo_geo], self.user_top)
        report = self.native["backface_report"](self.comp)
        self.assertEqual(len(report["warnings"]), 2, report)
        self.wire(self.user_cam, self.user_geo, self.user_top)
        report = self.native["backface_report"](self.comp)
        self.assertEqual(report["warnings"], [])
        self.assertEqual(report["glass_objects"], ["/project1/glass1", "/project1/glass2"])

    def test_reports_missing_references_and_resolution(self):
        self.user_top.width = 1920
        self.wire(None, [], self.user_top)
        report = self.native["backface_report"](self.comp)
        self.assertFalse(report["ready"])
        self.assertEqual(len(report["problems"]), 3, report)

    def test_sampling_counts_glass_texels(self):
        try:
            import numpy
        except ImportError:
            self.skipTest("needs numpy (pip install numpy)")
        self.wire(self.user_cam, self.user_geo, self.user_top)
        empty = numpy.zeros((720, 1280, 4), numpy.float32)
        empty[..., 3] = 0.5      # a non-negative background is still empty
        self.back.numpyArray = lambda: empty
        report = self.native["backface_report"](self.comp, sample=True)
        self.assertEqual(report["glass_texels"], 0)
        self.assertEqual(len(report["warnings"]), 1)
        glass = empty.copy()
        glass[300:310, 600:610, 3] = -4.0
        self.back.numpyArray = lambda: glass
        report = self.native["backface_report"](self.comp, sample=True)
        self.assertEqual((report["glass_texels"], report["warnings"]), (100, []))


# ============================================================================ family sync
# What a user changes on the Inputs page and for their own scene; apply() must keep all of it.
SCENE = {"Refractiontop": "/project1/scene", "Reflectiontop": "/project1/photo",
         "Reflectmode": "screen", "Camera": "/project1/cam1", "Glassgeo": "/project1/geo1",
         "Culling": "none", "Flipv": True, "Colourspace": "raw", "Demo": False, "Objectsize": 3.5}


def scene_comp():
    """A component whose scene inputs and setup controls a user has changed."""
    values = defaults()
    values.update(SCENE)
    return FakeComp(values)


class Clock:
    """Stands in for TouchDesigner's absTime while a test runs."""

    def __init__(self, seconds):
        builtins.absTime = SimpleNamespace(seconds=seconds)

    def step(self, seconds):
        builtins.absTime = SimpleNamespace(seconds=builtins.absTime.seconds + seconds)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        if hasattr(builtins, "absTime"):
            del builtins.absTime


def wrapped_change(a, b, period):
    """Signed change from a to b on a circle of the given period (the wrap is seamless)."""
    return (b - a + period / 2) % period - period / 2


def expected_after(experiment_id, comp):
    """Defaults + preset + overrides, with the menu on 'custom' and setup untouched."""
    item = next(e for e in EXPERIMENTS if e["id"] == experiment_id)
    state = comp.state()
    state.update(NATIVE["look_defaults"](SPEC))
    params = dict(item["parameters"])
    state.update(PRESETS["presets"][params.pop("Preset")]["values"])
    state["Preset"] = "custom"
    state.update(params)
    return state


def shader(name):
    return (STUDY / name).read_text()


def code_only(source):
    """GLSL without // comments."""
    return re.sub(r"//.*", "", source)


def functions(source):
    """{name: body} of every top-level GLSL function (bodies end at a closing brace in column 0)."""
    return dict(re.findall(r"\n\w+ (\w+)\([^)]*\)\n\{(.*?)\n\}", source, re.S))


def call_arguments(code, name_pattern):
    """The argument text of every call whose name matches, with balanced parentheses."""
    found = []
    for match in re.finditer(name_pattern + r"\s*\(", code):
        depth, start = 1, match.end()
        for i in range(start, len(code)):
            depth += {"(": 1, ")": -1}.get(code[i], 0)
            if depth == 0:
                found.append(code[start:i])
                break
    return found


def uniform(node_id, name):
    return next(u for u in NODES[node_id]["uniforms"] if u["name"] == name)


class SyncR1DriftClock(unittest.TestCase):
    """R1: wobble and film drift integrated in Python doubles (presets.advance/phase/spin)."""

    def test_menu_follows_the_evaluated_value(self):
        comp = FakeComp(defaults())
        comp.par.Stage.val = "deviation"
        self.assertEqual(MODULE["menu"](comp.par.Stage), CONTROLS["Stage"]["names"].index("deviation"))

    def test_phase_is_wrapped_double_precision_and_holds_when_speed_is_zero(self):
        comp = FakeComp(defaults())
        comp.par.Pause.val = True
        comp.par.Time.val = 2.0
        speed = comp.par.Wobblespeed.val
        self.assertAlmostEqual(MODULE["phase"](comp, 0.6), 0.6 * speed * 2.0, 12)
        self.assertAlmostEqual(MODULE["phase"](comp, -0.3), (-0.3 * speed * 2.0) % 256.0, 12)
        comp = FakeComp(defaults())
        with Clock(30 * 24 * 3600 + 0.25) as clock:  # a month of uptime
            first = MODULE["phase"](comp, 0.4)
            self.assertTrue(0.0 <= first < 256.0)
            clock.step(1 / 60)
            moved = MODULE["phase"](comp, 0.4)
            self.assertAlmostEqual(wrapped_change(first, moved, 256.0), 0.4 * speed / 60, 9)
            comp.par.Wobblespeed.val = 0.0
            del builtins.absTime  # speed 0 must not even read the clock...
            self.assertEqual(MODULE["phase"](comp, 0.4), moved)  # ...and holds the ripples where they are

    def test_a_100_frame_morph_and_a_speed_drag_after_an_hour_stay_smooth(self):
        # One frame of an A/B morph used to jump by rate x change in speed x uptime;
        # now each frame moves by rate x speed x frame time.
        for rate in (0.6, 0.4, -0.3, 0.15):
            comp = FakeComp(defaults())
            MODULE["apply"](comp, "spectral_prism")
            comp.par.Morphtarget.val = "lavender_prism"  # speed 0.3 -> 0.2
            dt = 1 / 60
            with Clock(3600.0) as clock:
                last = MODULE["phase"](comp, rate)
                frames = [("Morph", i / 100) for i in range(1, 101)]               # a 100-frame morph
                frames += [("Wobblespeed", 0.3 + 0.27 * i) for i in range(1, 11)]  # a fast slider drag
                for name, value in frames:
                    getattr(comp.par, name).val = value
                    clock.step(dt)
                    speed = MODULE["u"](comp.par.Wobblespeed)
                    now = MODULE["phase"](comp, rate)
                    self.assertTrue(0.0 <= now < 256.0)
                    change = wrapped_change(last, now, 256.0)
                    self.assertAlmostEqual(change, rate * speed * dt, 9, (rate, name, value))
                    last = now

    def test_drift_is_the_same_within_a_frame_and_resumes_without_a_jump(self):
        comp = FakeComp(defaults())
        speed = comp.par.Wobblespeed.val
        with Clock(7200.0) as clock:
            a = MODULE["phase"](comp, 0.6)
            self.assertEqual(MODULE["phase"](comp, 0.6), a)  # material and material_back agree
            comp.par.Pause.val, comp.par.Time.val = True, 2.0
            paused = MODULE["phase"](comp, 0.6)
            self.assertAlmostEqual(paused, 0.6 * speed * 2.0, 12)  # repeatable experiments
            clock.step(5.0)
            comp.par.Pause.val = False
            self.assertEqual(MODULE["phase"](comp, 0.6), paused)  # unpausing continues from there
            clock.step(0.5)
            self.assertAlmostEqual(MODULE["phase"](comp, 0.6), paused + 0.6 * speed * 0.5, 9)

    def test_demo_spin_is_integrated(self):
        comp = FakeComp(defaults())
        with Clock(3600.0) as clock:
            last = MODULE["spin"](comp)
            for degrees_per_second in (12.0, 30.0, -45.0, 90.0):
                comp.par.Demospin.val = degrees_per_second
                clock.step(1 / 60)
                now = MODULE["spin"](comp)
                self.assertTrue(0.0 <= now < 360.0)
                self.assertAlmostEqual(wrapped_change(last, now, 360.0), degrees_per_second / 60, 9)
                last = now

    def test_no_node_expression_reads_absolute_time(self):
        # Anything that moves goes through presets.advance(), so changing its speed never jumps.
        self.assertNotIn("absTime", json.dumps(SPEC["nodes"]))
        self.assertEqual(NODES["demo_geo"]["expressions"]["ry"], "op('presets').module.spin(parent())")
        for node_id in ("material", "material_back"):
            self.assertEqual(uniform(node_id, "uPhase")["values"],
                             [f"op('presets').module.phase(parent(), {r})" for r in ("0.6", "0.4", "-0.3", "0.15")])
            self.assertEqual(uniform(node_id, "uWobble")["values"][3], 0)

    def test_shader_drifts_by_uphase_on_a_wrapped_lattice(self):
        code = code_only(FRAG)
        self.assertIn("uvec3 q = uvec3(c & 255);", code)  # lattice repeats every 256: the wrap is seamless
        self.assertNotIn("uWobble.w", code)
        self.assertIn("valueNoise(p + vec3(0.0, uPhase.x, 0.0))", code)
        self.assertIn("valueNoise(2.03 * p + vec3(uPhase.y, 0.0, uPhase.z))", code)
        self.assertIn("vec3(0.0, uPhase.w, 0.0)", functions(code)["filmThickness"])


class SyncR2R3Route(unittest.TestCase):
    """R2: Render Pass TOP route; R3: Inputs fields in constant mode, categorized build warnings."""

    def test_materials_reach_geometry_only_through_override_material(self):
        for ref in SPEC["references"]:
            if ref["target"] in ("material", "material_back"):
                self.assertEqual(ref["parameter"], "overridemat", ref)
        self.assertIn({"node": "render", "parameter": "overridemat", "target": "material", "previous_frame": False},
                      SPEC["references"])

    def test_readme_route_is_the_render_pass_top(self):
        readme = (STUDY / "README.md").read_text()
        steps = readme.split("## Use it on your own objects")[1].split("### Optional")[0]
        for phrase in ("Render Pass TOP", "Clear Depth Buffer", "Clear to Camera Color", "Override Material", "Dither"):
            self.assertIn(phrase, steps, phrase)
        self.assertNotIn("List those objects in the glass Render TOP", readme)  # the 6a58487 occluder workaround

    def test_inputs_fields_are_constant_paths_to_the_demo(self):
        for name, target in (("Refractiontop", "demo_backdrop"), ("Reflectiontop", "demo_env"),
                             ("Camera", "demo_cam"), ("Glassgeo", "demo_geo")):
            c = CONTROLS[name]
            self.assertNotIn("expression", c, name)
            self.assertEqual(c["demo_target"], target, name)
            self.assertTrue(c.get("setup"), name)
        builder = (STUDY / "builder.py").read_text()
        self.assertIn("def link_demo_inputs(", builder)
        self.assertIn("par.default = path", builder)  # right-click > Reset to Default brings the demo back

    def test_build_warnings_carry_a_category(self):
        builder = runpy.run_path(str(STUDY / "builder.py"))
        self.assertEqual(set(builder["WARNING_NOTES"]), {"material", "inputs", "optional", "dither", "setup", "demo"})
        warnings = []
        builder["attempt"](False, warnings, "demo", lambda: (_ for _ in ()).throw(RuntimeError("no such parameter")))
        self.assertEqual(warnings, ["demo: no such parameter"])


class SyncR4ExperimentReset(unittest.TestCase):
    """R4: look_defaults() resets every look control first, so experiment order never matters."""

    def test_each_experiment_alone_gives_defaults_preset_and_overrides(self):
        for item in EXPERIMENTS:
            comp = scene_comp()
            expected = expected_after(item["id"], comp)
            NATIVE["apply"](comp, item["id"])
            self.assertEqual(comp.state(), expected, item["id"])

    def test_order_does_not_matter(self):
        ids = [e["id"] for e in EXPERIMENTS]
        for first, second in itertools.product(ids, ids):
            comp = scene_comp()
            expected = expected_after(second, comp)
            NATIVE["apply"](comp, first)
            comp.par.Lightdirx.val = 0.9  # a user edit between experiments
            NATIVE["apply"](comp, second)
            self.assertEqual(comp.state(), expected, (first, second))

    def test_scene_inputs_and_setup_survive(self):
        for item in EXPERIMENTS:
            comp = scene_comp()
            NATIVE["apply"](comp, item["id"])
            self.assertEqual(SCENE, {k: comp.state()[k] for k in SCENE}, item["id"])

    def test_reset_controls_are_the_documented_ones(self):
        # README > Tutorial experiments and the tutorial name exactly these, besides the preset values.
        reset = set(NATIVE["look_defaults"](SPEC)) - set(SPEC["preset_keys"])
        self.assertEqual(reset, {"Morphtarget", "Morph", "Samples", "Conserve", "Envrotate", "Screenwarp",
                                 "Lightdirx", "Lightdiry", "Lightdirz", "Backface",
                                 "Pause", "Time", "Stage", "Demospin", "Backdrop"})


class SyncR5ShaderHygiene(unittest.TestCase):
    def test_smoothstep_edges_increase_in_every_shader(self):
        # smoothstep(e0, e1, x) is undefined in GLSL when e0 >= e1 (Metal is the target backend).
        for name in ("liquid_prism.frag", "env.frag", "backdrop.frag"):
            for args in call_arguments(code_only(shader(name)), r"\bsmoothstep"):
                e0, e1 = [a.strip() for a in args.split(",")[:2]]
                if e0 == "-px" and e1 == "px":
                    continue
                try:
                    self.assertLess(float(eval(e0, {"soft": 0.0})), float(eval(e1, {"soft": 0.0})), (name, args))  # noqa: S307
                except NameError:
                    # band(): halfWidth - soft < halfWidth + soft whenever soft > 0 (every call passes soft > 0)
                    self.assertEqual((e0, e1), ("halfWidth - soft", "halfWidth + soft"), (name, args))

    def test_zero_normal_is_decided_before_tddeformnorm(self):
        vert = code_only(VERT)
        self.assertIn("vWorldNormal = dot(objNormal, objNormal) > 1e-12 ? TDDeformNorm(objNormal) : vec3(0.0);", vert)

    def test_normals_face_the_camera_after_the_wobble(self):
        main = functions(code_only(FRAG))["main"]
        self.assertIn("vec3 n = faceCamera(wobbleNormal(facingNormal(eye, dPdx, dPdy)), eye);", main)
        self.assertIn("faceAway(wobbleNormal(outwardBackNormal(eye, dPdx, dPdy)), eye)", main)

    def test_wobble_scale_ignores_the_comp_scale_and_faceted_test_is_relative(self):
        # Since the family close (G1) the cube root lives in worldScale(), which wobbleNormal() calls.
        body = functions(code_only(FRAG))["wobbleNormal"]
        self.assertIn("pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0)",
                      functions(code_only(FRAG))["worldScale"])
        self.assertIn("float scale = worldScale();", body)
        self.assertIn("worldForNormals * slope * scale", body)
        facet = functions(code_only(FRAG))["facetedNormal"]
        self.assertIn("l2 > 1e-12 * dot(dPdx, dPdx) * dot(dPdy, dPdy)", facet)

    def test_atan_never_sees_zero_zero_and_vectors_are_guarded(self):
        for name in ("liquid_prism.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertEqual(set(call_arguments(code, r"\batan")) - {"length(cross(r.xyz, eye)), dot(r.xyz, eye)",
                                                                    "length(cross(g.xyz, eye)), dot(g.xyz, eye)",
                                                                    "length(cross(v.xyz, eye)), dot(v.xyz, eye)"},
                             {"d.z, d.x"}, name)  # only inside azimuth(), behind its dot(d.xz, d.xz) test
            self.assertIn("return dot(d.xz, d.xz) > 1e-12 ? atan(d.z, d.x) : 0.0;", code, name)
        code = code_only(FRAG)
        self.assertIn("vec3 lightDir = safeNormalize(uLight.xyz, vec3(0.0, 1.0, 0.0));", code)
        self.assertIn("vec3 h = safeNormalize(lightDir - eye, vec3(0.0));", code)
        self.assertIn("return max(uOptics.x + 0.3 * uOptics.z * curve, 1.0);", code)  # per-slice IOR >= 1
        self.assertIn("mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x)", code)
        self.assertNotIn("pow((uOptics.x - 1.0)", code)


class SyncR6R8R9Look(unittest.TestCase):
    def test_r6_frost_uses_the_r2_disc_and_flat_image_blur_widens(self):
        code = code_only(FRAG)
        self.assertIn("vec2 f = fract(0.5 + float(i) * vec2(0.7548776662, 0.5698402910));", functions(code)["discPoint"])
        trace = functions(code)["throughGlass"]
        self.assertIn("vec2 disc = discPoint(i) * uBody.y * 0.25;", trace)
        self.assertNotIn("2.39996", trace)  # the one-arm golden-angle spiral
        self.assertIn("float spread = mode == 1 ? max(1.0, 2.5 * uEnv.w) : 1.0;", functions(code)["environmentSample"])

    def test_r8_colour_parameters_menu_and_energy_conserving_toggle(self):
        self.assertEqual(CONTROLS["Colourspace"]["names"], ["auto", "raw", "srgb"])
        self.assertTrue(CONTROLS["Colourspace"]["setup"])
        self.assertIs(CONTROLS["Conserve"]["default"], False)
        self.assertEqual(uniform("material", "uInputs")["values"][3], "op('presets').module.decode_colours(parent())")
        self.assertEqual(uniform("material", "uSurface")["values"][3], "1 if parent().par.Conserve.eval() else 0")
        code = code_only(FRAG)
        # Every colour parameter reaches the maths through paramColour().
        for name in ("uGlass.rgb", "uLightColor.rgb", "uRim.rgb", "uReflect.rgb"):
            for m in re.finditer(re.escape(name), code):
                self.assertEqual(code[m.start() - len("paramColour("):m.start()], "paramColour(", name)
        self.assertIn("float keep = 1.0 - uSurface.w * clamp(reflectance, 0.0, 1.0);", code)

    def test_r8_decode_colours(self):
        comp = FakeComp(defaults())
        self.assertEqual(MODULE["decode_colours"](comp), 0.0)  # auto, no TouchDesigner project: pass-through
        for mode, expect in (("raw", 0.0), ("srgb", 1.0)):
            comp.par.Colourspace.val = mode
            self.assertEqual(MODULE["decode_colours"](comp), expect)
        comp.par.Colourspace.val = "auto"
        for space, expect in (("WorkingColorSpace.PASS_THROUGH", 0.0), ("WorkingColorSpace.SRGB_LINEAR", 1.0)):
            builtins.project = SimpleNamespace(workingColorSpace=space)
            try:
                self.assertEqual(MODULE["decode_colours"](comp), expect)
            finally:
                del builtins.project

    def test_r9_sampler_settings_menus_and_diagnostics(self):
        for node_id in ("material", "material_back"):
            settings = {u["name"]: (u["filter"], u["extendu"], u["extendv"])
                        for u in NODES[node_id]["uniforms"] if u.get("kind") == "sampler"}
            self.assertEqual(settings, {"sRefraction": ("mipmaplinear", "mirror", "mirror"),
                                        "sReflection": ("mipmaplinear", "repeat", "hold"),
                                        "sBackface": ("nearest", "hold", "hold")}, node_id)
            text = json.dumps(NODES[node_id]["uniforms"])
            self.assertNotIn("menuIndex", text)  # presets.menu() follows a menu driven by an expression too
            self.assertIn("op('presets').module.menu(parent().par.Reflectmode)", text)
            self.assertIn("op('presets').module.menu(parent().par.Stage)", text)
        native = (STUDY / "native.py").read_text().split("def inspect(")[1]
        for key in ('"script_errors"', '"blocking_errors"', '"render_diagnostics"', '"backface"'):
            self.assertIn(key, native)


class SyncMergeItems(unittest.TestCase):
    """C1 to C9 (C2 and C6 originate in this study; C3 is guarded, not merged)."""

    def test_c1_covered_alpha_composes_once(self):
        code = code_only(FRAG)
        trace = functions(code)["throughGlass"]
        self.assertIn("vec4 seen = textureLod(sRefraction, mirrorUV(unfolded), ", trace)
        self.assertIn("alphaSum += seen.a;", trace)
        self.assertIn("covered = alphaSum / float(count);", trace)
        main = functions(code)["main"]
        self.assertIn("float seeThrough = translucency * (1.0 - covered) * dot(tint, vec3(1.0 / 3.0));", main)
        self.assertIn("float alpha = 1.0 - seeThrough * keep;", main)
        self.assertNotIn("alpha = 1.0;\n    } else {", main)  # one formula, no refraction / no-refraction branches

    def test_c2_picking_and_extra_colour_buffers(self):
        vert = code_only(VERT)
        self.assertRegex(vert, r"#ifndef TD_PICKING_ACTIVE[\s\S]*#else\s+TDWritePickingValues\(\);\s+#endif")
        frag = code_only(FRAG)
        self.assertRegex(frag, r"#ifndef TD_NUM_COLOR_BUFFERS\s+#define TD_NUM_COLOR_BUFFERS 1\s+#endif")
        self.assertIn("layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];", frag)
        self.assertIsNone(re.search(r"\bfragColor\s*=", frag), "every write names a colour buffer")
        for k in range(1, 8):  # constant indices, each behind its own #if (a loop fails in WebGL2)
            self.assertRegex(frag, rf"#if TD_NUM_COLOR_BUFFERS > {k}\s+fragColor\[{k}\] = vec4\(0\.0\);\s+#endif")
        compile_check = (STUDY / "checks" / "compile_glsl.py").read_text()
        self.assertIn('"#define TD_NUM_COLOR_BUFFERS 3\\n"', compile_check)
        self.assertIn("MAT_VERTEX_PICKING", compile_check)

    def test_c3_lookup_level_is_frost_or_footprint_never_a_fan_gap(self):
        # C3 rejected here (decisions.json): no fan-gap level, neither the whole nor the blobs study's
        # quarter gap. Every Refraction TOP lookup reads max(frost level, footprint level - 2), and
        # neither term depends on the spread between colour slices. The preview test
        # dispersion_converges_with_samples guards the image; it cannot see the quarter gap
        # (2.154 against its 2.5/255 limit), so this test pins the level expressions themselves.
        funcs = functions(code_only(FRAG))
        trace = funcs["throughGlass"]
        # The frost level: as wide as the gap between the frost disc's points. Assigned once.
        self.assertIn("vec2 blurPixels = uBody.y * 0.25 * abs(toUV) * size;", trace)
        self.assertEqual(re.findall(r"\blod\s*=[^;]*;", trace),
                         ["lod = log2(max(2.0 * max(blurPixels.x, blurPixels.y) / sqrt(float(count)), 1.0));"])
        # Each lookup: its own footprint, at least the frost level. No other level enters.
        self.assertEqual(call_arguments(trace, r"\btextureLod"),
                         ["sRefraction, mirrorUV(unfolded), footprintLod(unfolded, lod, size)"])
        self.assertEqual(call_arguments(trace, r"\bfootprintLod"), ["unfolded, lod, size", "bounceAt, lod, size"])
        self.assertIn("bounceLight(bounced, eye, uv, bounceAt, cam, view, bounceLod)", trace)
        self.assertEqual(call_arguments(funcs["bounceLight"], r"\btextureLod"),
                         ["sRefraction, mirrorUV(unfolded), lod"])
        # The footprint level: 2 below the lookup's own screen footprint (decisions.json, footprint).
        foot = funcs["footprintLod"]
        self.assertIn("vec2 dx = dFdx(unfolded) * size;", foot)
        self.assertIn("vec2 dy = dFdy(unfolded) * size;", foot)
        self.assertIn("return max(base, 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1.0)) - 2.0);", foot)
        # One trace per slice: no extra red and violet traces to measure a fan.
        for call in ("sliceIor(", "enterGlass(", "leaveGlass(", "projectOffset("):
            self.assertEqual(trace.count(call), 2 if call == "projectOffset(" else 1, call)
        # The image guard, with the thresholds recorded in decisions.json.
        self.assertIn("check('dispersion_converges_with_samples', Object.values(dispersed).every("
                      "(r) => r.pixelsOver32 <= 50 && r.mean <= 2.5)",
                      (STUDY / "checks" / "preview_tests.cjs").read_text())

    def test_c4_renders_switch_dither_off(self):
        renders = [n for n in SPEC["nodes"] if n["type"] in ("renderTOP", "renderpassTOP")]
        self.assertEqual(sorted(n["id"] for n in renders), ["render", "render_back"])
        for n in renders:
            value = {**n.get("parameters", {}), **n.get("lenient_parameters", {})}.get("dither")
            self.assertIs(value, False, n["id"])

    def test_c4_shaders_never_dither(self):
        # No TDDither, no per-pixel random source in any shader: gl_FragCoord only places the pixel,
        # and the demo backdrop hashes whole rows, words and letters, never a pixel position.
        for name in ("liquid_prism.frag", "liquid_prism.vert", "backdrop.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertNotIn("TDDither", code, name)
            self.assertIsNone(re.search(r"\b(dither|random|blueNoise|interleavedGradient)", code, re.I), name)
        for name in ("backdrop.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertNotIn("gl_FragCoord", code, name)
            for args in re.findall(r"(?<!float )\bhash\w*\((vec2\([^;]*?\))\)", code):
                words = set(re.findall(r"[A-Za-z_]\w*", args)) - {"vec2", "float"}
                self.assertLessEqual(words, {"row", "slot", "index"}, (name, args))

    def test_c5_colour_is_capped_alpha_is_not(self):
        main = code_only(functions(FRAG)["main"])
        cap = main.index("colour = min(colour, vec3(1024.0));")
        self.assertLess(cap, main.index("writeColour(vec4(colour, alpha));"))
        self.assertNotRegex(main, r"alpha\s*=\s*min\(")
        self.assertIn("-surfaceDistance));", main)  # the back-face pass's distance is never capped

    def test_c5_normalize_never_sees_a_zero_vector(self):
        code = code_only(FRAG)
        allowed = {
            "n - eye * (away + 0.01)",      # faceCamera: the part along eye is -0.01
            "n",                            # facingNormal / outwardBackNormal: behind dot(n, n) > 1e-8
            "n - amount * 0.35 * slope",    # wobbleNormal: unit n plus a perpendicular tilt
            "leaving",                      # leaveGlass: Snell's law, a unit vector when not trapped
            "blend",                        # estimateExit: behind dot(blend, blend) > 1e-6
            "cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R)",
            "R + (t * cos(a) + b * sin(a)) * r",
        }
        self.assertEqual(set(call_arguments(code, r"(?<![A-Za-z])normalize")), allowed)
        for name in ("lightDir", "eye"):
            self.assertRegex(code, rf"vec3 {name} = [^;]*safeNormalize\(", name)
        self.assertIn("cam.forward = safeNormalize(", code)
        self.assertIn("safeNormalize(q - cam.position, cam.forward)", code)

    def test_c5_every_render_gets_an_info_dat_and_diagnostics(self):
        builder = runpy.run_path(str(STUDY / "builder.py"))
        self.assertLessEqual({"renderTOP", "renderpassTOP", "glslMAT", "glslTOP"}, set(builder["INFO_TYPES"]))

        def node(path, overridemat=None, geometry=(), errors="", warnings=""):
            par = SimpleNamespace(overridemat=SimpleNamespace(eval=lambda: overridemat),
                                  geometry=SimpleNamespace(evalOPs=lambda: list(geometry)))
            return SimpleNamespace(path=path, name=path.rsplit("/", 1)[1], par=par,
                                   errors=lambda: errors, warnings=lambda: warnings)
        material = object()
        comp = SimpleNamespace(path="/project1/liquid_glass_prism", op=lambda name: material,
                               par=SimpleNamespace(Backface=SimpleNamespace(eval=lambda: False)))
        glass_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: material)))
        renders = [
            node("/project1/liquid_glass_prism/render", overridemat=material),
            node("/project1/liquid_glass_prism/render_back"),               # Back-face pass off: skipped
            node("/project1/glass_pass", overridemat=material, errors="compile error"),
            node("/project1/render_glass", geometry=[glass_geo]),           # a Geometry COMP's Material
            node("/project1/render_scene", geometry=[]),                    # the scene without the glass
        ]
        report = NATIVE["render_diagnostics"](comp, renders)
        self.assertEqual(sorted(report), ["/project1/glass_pass", "/project1/liquid_glass_prism/render", "/project1/render_glass"])

    def test_c6_orientation_compares_positions_and_breaks_ties_with_derivatives(self):
        code = code_only(FRAG)
        sign = functions(code)["screenSign"]
        self.assertNotRegex(sign, r"dFd[xy]")  # derivatives come from the top of main(), in uniform flow
        self.assertIn("gl_FragCoord", sign)
        self.assertIn("abs(ndc.y + raster.y) < abs(ndc.y - raster.y)", sign)  # the position comparison
        # Only on a centre line (odd sizes), and only where the surface is not nearly edge-on, the
        # projected position's derivatives decide (V2: the tie rule alone got a flipped centre row wrong).
        self.assertIn("step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1))", sign)
        self.assertIn("if (uState.w > 0.5) runs.y = -runs.y;", sign)  # Flip V: base UV and offsets together
        main = functions(code)["main"]
        self.assertIn("cam.screenSign = screenSign(ndc, ndcStep, depthStep);", main)
        self.assertIn("* cam.screenSign;", functions(code)["projectOffset"])  # every bend offset
        # V1: offsets in camera space (the flat-image reflection) also take the projection's own sign.
        self.assertIn("cam.viewSign = cam.screenSign * vec2(proj[0][0] < 0.0 ? -1.0 : 1.0, "
                      "proj[1][1] < 0.0 ? -1.0 : 1.0);", main)
        self.assertIn("mirrorUV(uv + rv.xy * orient * uEnv.w * 0.5)", code)
        self.assertIn("environment(reflect(eye, n), uv, view, cam.viewSign)", main)
        self.assertIn("environmentSample(bounced, uv, view, cam.viewSign, uEnv.z)", functions(code)["bounceLight"])
        self.assertIsNone(re.search(r"environment(Sample)?\([^;]*cam\.screenSign", code))

    def test_c7_fog_on_the_front_pass_only(self):
        main = code_only(functions(FRAG)["main"])
        self.assertIn("vec3 fogAdded = TDFog(vec4(0.0, 0.0, 0.0, 1.0), vWorldPos, vCamIndex).rgb;", main)
        self.assertIn("colour = TDFog(vec4(colour, 1.0), vWorldPos, vCamIndex).rgb - fogAdded * (1.0 - alpha);", main)
        self.assertLess(main.index("return;"), main.index("TDFog("))  # the back-face pass returned before
        self.assertEqual(main.count("TDFog("), 2)

    def test_c8_object_size_is_setup_and_never_reset(self):
        size = CONTROLS["Objectsize"]
        self.assertTrue(size.get("setup"))
        # Family close G1: the default is the demo torus's own Object size under the family rule
        # (its radius over 1.45), so the demo looks right without pressing Fit (was 1.0).
        self.assertEqual(size["default"], float(f"{NATIVE['demo_radius'](SPEC) / NATIVE['REFERENCE_RADIUS']:.6g}"))
        self.assertEqual(size["default"], 0.872517)
        self.assertGreater(size["min"], 0.0)  # it divides
        self.assertNotIn("Objectsize", SPEC["preset_keys"])
        self.assertEqual(CONTROLS["Fitglass"]["type"], "pulse")
        for item in EXPERIMENTS:
            comp = scene_comp()
            comp.par.Objectsize.val = 7.5
            NATIVE["apply"](comp, item["id"])
            MODULE["apply"](comp, "lavender_prism")
            self.assertEqual(comp.par.Objectsize.val, 7.5, item["id"])

    def test_c8_object_size_scales_the_lengths_and_is_exact_at_1(self):
        reference = json.loads((STUDY / "checks" / "reference" / "study.json").read_text())

        def evaluate(spec, comp, name, count=4):
            node = next(n for n in spec["nodes"] if n["id"] == "material")
            values = next(u for u in node["uniforms"] if u["name"] == name)["values"][:count]
            env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=MODULE["u"])), "parent": lambda: comp}
            return [v if not isinstance(v, str) else eval(v, env) for v in values]  # noqa: S307 (study.json)

        for preset in PRESETS["order"]:
            comp = FakeComp(defaults())
            MODULE["apply"](comp, preset)
            comp.par.Objectsize.val = 1.0  # the default is the demo's 0.872517 since the family close (G1)
            for name in ("uGlass", "uBody", "uOptics", "uPrism"):  # Object size 1: the same numbers as before
                self.assertEqual(evaluate(SPEC, comp, name), evaluate(reference, comp, name), (preset, name))
            self.assertEqual(evaluate(SPEC, comp, "uWobble", 3), evaluate(reference, comp, "uWobble", 3), preset)
            self.assertEqual(evaluate(SPEC, comp, "uFilm")[3], 2.5)  # was the constant 2.5 in the shader
            comp.par.Objectsize.val = 10.0
            values = PRESETS["presets"][preset]["values"]
            self.assertAlmostEqual(evaluate(SPEC, comp, "uOptics")[1], values["Thickness"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uPrism")[0], values["Scenedepth"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uBody")[1], values["Frost"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uGlass")[3], values["Density"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uWobble")[1], values["Wobblescale"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uFilm")[3], 0.25, 12)

    def test_c8_fit_glass_sets_object_size_from_the_bounds(self):
        def bounds(x, y, z):
            return SimpleNamespace(size=SimpleNamespace(x=x, y=y, z=z))
        sop = SimpleNamespace(isSOP=True, render=True, path="/project1/geo1/sphere1", bounds=lambda: bounds(2.0, 1.0, 0.5))
        hidden = SimpleNamespace(isSOP=True, render=False, path="/project1/geo1/box1", bounds=lambda: bounds(50, 50, 50))
        geo1 = SimpleNamespace(path="/project1/geo1", children=[hidden, sop],
                               worldTransform=SimpleNamespace(determinant=lambda: 27.0))  # scaled 3 by the COMP
        geo2 = SimpleNamespace(path="/project1/geo2", children=[],  # no SOP (POPs): the COMP's own bounds
                               bounds=lambda render: bounds(0.2, 0.4, 0.1),
                               worldTransform=SimpleNamespace(determinant=lambda: 1.0))
        comp = scene_comp()
        comp.par.Glassgeo.evalOPs = lambda: [geo1, geo2]
        report = NATIVE["fit_glass"](comp)
        demo = NATIVE["demo_radius"](SPEC)
        self.assertAlmostEqual(demo, 1.5 * 0.6 ** (1.0 / 3.0), 12)  # the flattened demo torus
        # Family close G1: over the family's reference radius 1.45, no longer over the demo's 1.265.
        self.assertAlmostEqual(comp.par.Objectsize.val, 3.0 / 1.45, 5)  # half of 2.0, times 3
        self.assertEqual(report["reference_radius"], 1.45)
        self.assertEqual([m["source"] for m in report["measured"]],
                         ["/project1/geo1/sphere1", "/project1/geo2 (Geometry COMP bounds)"])
        # The demo torus fits to the control's default, so pressing Fit on the demo changes nothing.
        torus = NODES["demo_geo/torus"]["parameters"]
        demo_geo = SimpleNamespace(path="/project1/liquid_glass_prism/demo_geo",
                                   worldTransform=SimpleNamespace(determinant=lambda: 0.6 * (1 + 3e-16)),
                                   children=[SimpleNamespace(isSOP=True, render=True, path="/project1/liquid_glass_prism/demo_geo/torus",
                                                             bounds=lambda: bounds(3.0, 3.0, 2 * torus["rady"]))])
        self.assertEqual(NATIVE["fit_glass"](comp, demo_geo)["object_size"], CONTROLS["Objectsize"]["default"])
        comp.par.Glassgeo.evalOPs = lambda: []
        with self.assertRaises(ValueError):
            NATIVE["fit_glass"](comp)
        calls = []
        callbacks = runpy.run_path(str(STUDY / "preset_exec.py"), init_globals={"op": lambda name: SimpleNamespace(
            module=SimpleNamespace(fit_glass=lambda c: calls.append(c) or {}, apply=MODULE["apply"]))})
        callbacks["onPulse"](SimpleNamespace(name="Fitglass", owner=comp))
        self.assertEqual(calls, [comp])
        self.assertIn("Fitglass", NODES["preset_exec"]["parameters"]["pars"])

    def test_c9_backdrop_menu_is_the_family_one(self):
        menu = CONTROLS["Backdrop"]
        self.assertEqual((menu["type"], menu["page"], menu["names"]), ("menu", "Study", ["checker", "type"]))
        self.assertEqual(menu["default"], "type")  # this study's own scene stays its default
        self.assertFalse(menu.get("setup"))         # experiments reset it: their predictions describe the type
        self.assertEqual(NODES["demo_backdrop"]["uniforms"],
                         [{"name": "uBackdrop", "values": ["op('presets').module.menu(parent().par.Backdrop)", 0, 0, 0]}])
        core = (STUDY / "checks" / "reference" / "core_backdrop.frag").read_text()
        ours = code_only(shader("backdrop.frag"))
        # The checker branch is the core's 6a58487 checker line for line.
        for line in ("vec3 c = mix(vec3(0.80), vec3(0.58), mod(cell.x + cell.y, 2.0));",
                     "float d = roundBox(p, vec2(start + 0.5 * len, y), vec2(0.5 * len, 0.045), 0.012);",
                     "float ring = abs(length(p - vec2(0.0, -0.02)) - 0.33) - 0.006;"):
            self.assertIn(line, core)
            self.assertIn(line, ours)
        self.assertIn("capture_jobs.py", (STUDY / "checks" / "render_previews.sh").read_text())
        self.assertIn("presets-sheet-type", (STUDY / "checks" / "contact_sheet.py").read_text())


# ---------------------------------------------------------------- family names (review.md)
class FamilyNames(unittest.TestCase):
    """Family gap (verifier, low): one thing had several names across the five
    members. The Fit pulse was Fitglass, Fitflow or Fitsize, labelled 'Fit to
    Glass geometry' or 'Fit to glass objects'; the docs called the demo backdrop
    menu 'Backdrop' or 'Demo backdrop'; and Blobs alone kept that menu as a setup
    control that experiments never reset. The core README lists the mapping once
    (Names across the family). These tests pin this study to it."""

    BACKDROP = "Backdrop"  # the demo backdrop menu's parameter name here

    def test_fit_pulse_has_the_family_name_and_label(self):
        fits = [c for c in SPEC["controls"] if c["type"] == "pulse" and c["name"].startswith("Fit")]
        self.assertEqual([c["name"] for c in fits], ["Fitglass"])
        self.assertTrue(fits[0]["label"].startswith("Fit to Glass geometry ("), fits[0]["label"])
        self.assertIn("Fitglass", NODES["preset_exec"]["parameters"]["pars"].split())
        callback = (STUDY / "preset_exec.py").read_text()
        self.assertEqual(re.findall(r"par\.name == '(Fit\w*)'", callback), ["Fitglass"])

    def test_demo_backdrop_menu_has_the_family_label_and_experiments_reset_it(self):
        menus = [c for c in SPEC["controls"] if c["label"] == "Demo backdrop"]
        self.assertEqual([c["name"] for c in menus], [self.BACKDROP])
        c = menus[0]
        self.assertEqual((c["type"], c["page"], c["names"], c.get("setup")),
                         ("menu", "Study", ["checker", "type"], None))
        self.assertIn(c["name"], NATIVE["look_defaults"](SPEC))  # experiments reset it: their captures use the default

    def test_docs_use_the_family_names(self):
        for name in ("README.md", "article.source.md"):
            text = (STUDY / name).read_text()
            with self.subTest(name):
                self.assertEqual(re.findall(r"Fit to (?!Glass geometry)\w+ \w+", text), [])
                self.assertEqual(re.findall(r"\b(?:Fitflow|Fitsize)\b", text), [])
                # the menu is 'Demo backdrop' in prose; a bare Backdrop is only code or Blobs' Backdrop distance
                self.assertEqual(re.findall(r"(?<![`\w])Backdrop\b(?! distance)", text), [])
        self.assertTrue("../liquid-glass/README.md#names-across-the-family" in (STUDY / "README.md").read_text(), "README.md must link to the family table")



# ---------------------------------------------------------------- family close (review.md)
def preprocessed(source, defined):
    """The lines a GLSL preprocessor keeps when the names in `defined` are
    #defined. Handles #ifdef, #ifndef, #else and #endif only; any other
    conditional fails the test instead of being guessed. (Liquid Glass Blobs' helper.)"""
    kept, branches = [], []
    for line in source.splitlines():
        word = line.split()
        if word[:1] in (["#ifdef"], ["#ifndef"]):
            branches.append((word[1] in defined) == (word[0] == "#ifdef"))
        elif word[:1] == ["#else"]:
            branches[-1] = not branches[-1]
        elif word[:1] == ["#endif"]:
            branches.pop()
        elif word[:1] and re.match(r"#(if|elif)\b", word[0]):
            raise AssertionError("preprocessed() does not evaluate " + word[0])
        elif all(branches):
            kept.append(line)
    assert not branches, "unbalanced #if"
    return "\n".join(kept)


def main_statements(source):
    """The statements of main(), whitespace collapsed, without the ';'."""
    body = source[source.index("void main()"):]
    body = body[body.index("{") + 1:body.rindex("}")]
    return [" ".join(s.split()) for s in body.split(";") if s.strip()]


class FamilyClose(unittest.TestCase):
    """Family close (after commit c94e849): this study's share of the gaps a family
    critic found across the five Liquid Glass studies. G1: Object size has one
    meaning (the family rule in Liquid Glass Lit's decisions.json). G2: the
    centre-line tie-break is one form family-wide. G6: a pick render runs only
    the placement and the documented #else block. Each test fails on c94e849
    (review.md, Family close; checks/results/red-run-family-close.json)."""

    RULE_GLSL = "pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0)"

    def test_g1_object_size_follows_the_family_rule(self):
        # Object size is the object's world radius over 1.45, for the lengths (uniform expressions,
        # test_c8_*) and for the ripple and film lookups, which multiply the object-space position
        # by worldScale(), the cube root of |det(mat3(world))|.
        frag = code_only(FRAG)
        body = functions(frag)
        self.assertEqual(body["worldScale"].strip(), "return " + self.RULE_GLSL + ";")
        self.assertIn("vec3 p = vObjPos * uWobble.y * scale;", body["wobbleNormal"])
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0))", body["filmThickness"])
        self.assertEqual(len(re.findall(r"vObjPos \*", frag)), 2)  # no other pattern lookup
        self.assertEqual(NATIVE["REFERENCE_RADIUS"], 1.45)
        lit = STUDY.parent / "liquid-glass-lit" / "decisions.json"
        if lit.is_file():  # the rule itself, where the family is checked out together
            rules = [d["family_rule"] for d in json.loads(lit.read_text()) if "family_rule" in d]
            self.assertEqual(len(rules), 1)
            self.assertEqual(rules[0]["reference_radius"], NATIVE["REFERENCE_RADIUS"])
            self.assertEqual(rules[0]["world_scale_glsl"], self.RULE_GLSL)
            self.assertEqual(rules[0]["world_scale_python"], "abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)")
        self.assertIn("abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)", (STUDY / "native.py").read_text())
        # The family critic's case: the core's demo torus (radius 1 + 0.45) in a Geometry COMP scaled 3.
        # The rule gives 3.0; c94e849 gave 3.4383 (over this study's demo radius, 1.265).
        torus = SimpleNamespace(isSOP=True, render=True, path="/project1/geo1/torus1",
                                bounds=lambda: SimpleNamespace(size=SimpleNamespace(x=2.9, y=2.9, z=0.9)))
        geo = SimpleNamespace(path="/project1/geo1", children=[torus], worldTransform=SimpleNamespace(determinant=lambda: 27.0))
        self.assertEqual(NATIVE["fit_glass"](scene_comp(), geo)["object_size"], 3.0)
        doc = " ".join(NATIVE["fit_glass"].__doc__.split())
        self.assertIn("whether it was sized in its SOP or by its Geometry COMP's Scale", doc)
        self.assertIn("family rule", doc)
        self.assertIn("check('fit_size_carries_presets_over_comp_scale'", (STUDY / "checks" / "preview_tests.cjs").read_text())

    def test_g1_prism_looks_keep_their_look_on_the_demo(self):
        # The demo torus keeps its shape (Torus SOP 1 + 0.5, Geometry COMP sz 0.6) and fits to the
        # Object size default, 0.872517. The six core looks keep the core's values, so they mean the
        # same object size here as in the core. The six prism looks were tuned at Object size 1 on
        # this demo; mapped once, their uniforms on the demo equal the c94e849 ones within the
        # 3-decimal rounding: lengths x 1.146, Tint density / 1.146, and Wobble scale x 1.0345, which
        # keeps the ripples' count on the object (the lookup now also multiplies by the demo COMP's
        # cube-root scale, 0.6 ** (1/3)). Film swirl is the family's fixed 2.5 per Object size.
        old = json.loads((STUDY / "checks" / "reference" / "presets.json").read_text())["presets"]
        size = CONTROLS["Objectsize"]["default"]
        geo = NODES["demo_geo"]["parameters"]
        world_scale = (geo.get("sx", 1.0) * geo.get("sy", 1.0) * geo.get("sz", 1.0)) ** (1.0 / 3.0)
        self.assertEqual(size, float(f"{NATIVE['demo_radius'](SPEC) / 1.45:.6g}"))
        lengths, per_length = ("Thickness", "Frost", "Scenedepth"), ("Density",)
        mapped = 0
        for name, preset in PRESETS["presets"].items():
            new, was = preset["values"], old[name]["values"]
            if name in CORE_PRESETS["presets"]:
                self.assertEqual(new, was, name)
                continue
            for key in new:
                with self.subTest(preset=name, key=key):
                    if key in lengths:
                        self.assertAlmostEqual(new[key] * size, was[key], delta=1e-3)
                    elif key in per_length:
                        self.assertAlmostEqual(new[key] / size, was[key], delta=1e-3)
                    elif key == "Wobblescale":
                        self.assertAlmostEqual(new[key] / size * world_scale, was[key], delta=1e-3)
                    else:
                        self.assertEqual(new[key], was[key])
            mapped += any(new[k] != was[k] for k in new)
        self.assertEqual(mapped, 6)
        self.assertEqual(sorted(set(PRESETS["presets"]) - set(CORE_PRESETS["presets"])),
                         sorted(["spectral_prism", "type_lens", "diamond_fire", "trapped_light", "caustic_heart", "lavender_prism"]))

    def test_g2_centre_line_tie_break_is_the_familys(self):
        # On the centre line of an odd-sized render the projected and the raster position are both 0.
        # There the sign of the projected position's screen derivative decides, only where 1/w changes
        # by less than 10% to the next pixel. The form started here (verifier V2); the core and Lit now
        # run the same lines, and measured the same (review.md, Family close). Prism applies the
        # projection's own sign afterwards (cam.viewSign); the core and Lit multiply it inside.
        lines = ["vec2 raster = 2.0 * (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw - 1.0;",
                 "vec2 runs = vec2(abs(ndc.x + raster.x) < abs(ndc.x - raster.x) ? -1.0 : 1.0,",
                 "abs(ndc.y + raster.y) < abs(ndc.y - raster.y) ? -1.0 : 1.0);",
                 "vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));",
                 "runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);"]
        steps = ["vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));",
                 "vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);"]
        members = {"liquid-glass-prism": FRAG}
        for member, name in (("liquid-glass", "liquid_glass.frag"), ("liquid-glass-lit", "liquid_glass_lit.frag")):
            path = STUDY.parent / member / name
            if path.is_file():  # where the family is checked out together
                members[member] = path.read_text()
        for member, source in members.items():
            with self.subTest(member=member):
                code = code_only(source)
                sign = functions(code)["screenSign"]
                for line in lines:
                    self.assertIn(line, sign)
                for line in steps:
                    self.assertIn(line, functions(code)["main"])

    def test_g6_pick_render_runs_only_the_documented_picking_block(self):
        # Write a GLSL MAT, Picking: '#ifndef TD_PICKING_ACTIVE // All the typical shader code
        # #else TDWritePickingValues(); #endif'; while picking only the #else block runs. Every
        # render still places the point. c94e849 wrote vObjPos before the branch, so a pick render
        # wrote one pixel-stage output.
        vert = code_only(VERT)
        self.assertNotIn("#ifdef TD_PICKING_ACTIVE", vert)
        pick = main_statements(preprocessed(vert, {"TD_PICKING_ACTIVE"}))
        self.assertEqual(pick, ["vec3 objPos = TDPos()", "vec4 world = TDDeform(objPos)",
                                "gl_Position = TDWorldToProj(world)", "TDWritePickingValues()"])
        ordinary = main_statements(preprocessed(vert, set()))
        self.assertEqual(ordinary[:3], pick[:3])
        self.assertNotIn("TDWritePickingValues()", ordinary)
        outputs = re.findall(r"^\s*(?:flat\s+)?out\s+\w+\s+(\w+)\s*;", vert, re.M)
        self.assertEqual(sorted(outputs), ["vCamIndex", "vObjPos", "vWorldNormal", "vWorldPos"])
        for name in outputs:  # the ordinary render writes every output, the pick render none
            self.assertTrue(any(s.startswith(name + " = ") for s in ordinary), name)
            self.assertFalse(any(name in s for s in pick), name)
        header = " ".join(VERT.split("\nout ", 1)[0].replace("//", " ").split())
        self.assertIn("while picking, the point is still placed, and of the branch only the #else block runs", header)

    def test_preprocessed_helper_follows_ifdef_ifndef_and_else(self):
        source = "a\n#ifdef X\nb\n#else\nc\n#endif\n#ifndef X\nd\n#else\ne\n#endif\nf"
        self.assertEqual(preprocessed(source, {"X"}).split(), ["a", "b", "e", "f"])
        self.assertEqual(preprocessed(source, set()).split(), ["a", "c", "d", "f"])
        with self.assertRaises(AssertionError):
            preprocessed("#if X > 1\na\n#endif", set())

    def test_docs_say_what_object_size_means_now(self):
        # README and tutorial: the family rule's reference, the demo's own size and the COMP scale.
        readme = (STUDY / "README.md").read_text()
        article = (STUDY / "article.source.md").read_text()
        for name, text in (("README.md", readme), ("article.source.md", article)):
            with self.subTest(name):
                for stale in ("Fit measures the torus as about 1.27", "the demo torus measures exactly 1",
                              "s times larger", "Transform SOP", "Object size stays 1", "per object-space unit"):
                    self.assertNotIn(stale, text)
                self.assertIn("1.45", text)
        self.assertIn("0.872517", readme)
        self.assertIn("../liquid-glass-lit/decisions.json", readme)  # where the family rule is written


def family_close_section():
    review = (STUDY / "review.md").read_text()
    return review.split("\n## Family close\n", 1)[1].split("\n## ", 1)[0]


class FamilyCloseCritic(unittest.TestCase):
    """After the family close, a family critic's findings PV1 to PV4 for this
    study (review.md, Family close critic fixes). PV1: the docs say why the
    demo fits to 0.872517 (it is wider than the core's torus, but flattened, and
    Fit averages a non-uniform scale). PV2: validation.json counts the unit tests
    whose expectation changed as review.md lists them. PV3: the Not done note
    matches the core README and Lit's record today. PV4: labels say what Object
    size does, in the family's one wording. Each fails on the text before the
    fix (checks/results/red-run-family-close-critic.json)."""

    def test_pv1_docs_say_why_the_demo_fits_below_1(self):
        torus = NODES["demo_geo/torus"]["parameters"]
        radius = float(torus["radx"]) + float(torus["rady"])     # half the largest side of the SOP
        self.assertGreater(radius, NATIVE["REFERENCE_RADIUS"])    # wider than the core's torus (1.45)
        average = float(NODES["demo_geo"]["parameters"]["sz"]) ** (1.0 / 3.0)  # the flattening, averaged
        self.assertLess(radius * average, NATIVE["REFERENCE_RADIUS"])  # so Fit measures it below 1.45
        stale = re.compile(r"demo(?: torus)? is smaller|smaller and flattened|this smaller demo")
        for name in ("README.md", "article.source.md", "review.md", "decisions.json"):
            text = (STUDY / name).read_text()
            if "\n## Family close critic fixes\n" in text:  # that section quotes the old wording on purpose
                head, rest = text.split("\n## Family close critic fixes\n", 1)
                text = head + rest.split("\n## ", 1)[1]
            with self.subTest(name):
                self.assertIsNone(stale.search(text))
        for name in ("README.md", "article.source.md", "review.md"):
            with self.subTest(name):
                text = (STUDY / name).read_text()
                self.assertIn("Fit counts a non-uniform scale as its average", text)
                self.assertIn(f"{average:.3f}", text)              # 0.843
                self.assertIn(f"{radius * average:.3f}", text)     # 1.265

    def test_pv2_validation_counts_the_changed_unit_tests(self):
        table = family_close_section().split("**Existing tests whose expectation changed on purpose.**", 1)[1]
        table = table.strip().split("\n\n", 1)[0]
        unit = [name for row in table.splitlines() if row.startswith("| `") and "(unit)" in row.split("|")[1]
                for name in re.findall(r"`(test_\w+)`", row.split("|")[1])]
        source = Path(__file__).read_text()
        for name in unit:
            self.assertIn(f"    def {name}(self", source, name)
        red = json.loads((STUDY / "checks" / "results" / "red-run-family-close.json").read_text())
        failing = [t.split(".", 1)[1] for t in red["unit_tests_c94e849"]["failing"]
                   if not t.startswith("FamilyClose.")]
        self.assertLessEqual(set(failing), set(unit))   # every old test that fails there is listed
        scope = json.loads((STUDY / "validation.json").read_text())["unit_tests"]["scope"]
        stated = re.search(r"(\d+) expectations changed on purpose \((\d+) of them fail on c94e849\)", scope)
        self.assertIsNotNone(stated, "validation.json unit_tests must give both counts")
        self.assertEqual((int(stated.group(1)), int(stated.group(2))), (len(unit), len(failing)))
        self.assertIn(f"and {len(failing)} with changed expectations", family_close_section())

    def test_pv3_not_done_note_matches_the_family_records(self):
        note = family_close_section().split("**Not done here, and why.**", 1)[1].split("\n\n", 1)[0]
        lit = STUDY.parent / "liquid-glass-lit" / "decisions.json"
        if lit.is_file():  # every Lit record the note names must exist there today
            rule = next(d["family_rule"] for d in json.loads(lit.read_text()) if "family_rule" in d)
            for key in re.findall(r"\bmembers_\w+", note):
                self.assertIn(key, rule, key)
        core = STUDY.parent / "liquid-glass" / "README.md"
        if core.is_file():
            names = core.read_text().split("## Names across the family", 1)[1].split("\n## ", 1)[0]
            bullet = next(l for l in names.splitlines() if l.startswith("- **Object size**"))
            follow = next(s for s in re.split(r"(?<=[.;])\s+", bullet) if " follow it" in s)
            if "Prism" in follow.split(" follow it")[0]:
                self.assertNotIn("does not yet follow", note)
                self.assertNotIn("says Prism does not", note)

    def test_pv4_labels_say_what_object_size_does(self):
        # A control the uniforms multiply by Object size is in units of Object size, not scene units.
        scaled = set()
        for node in SPEC["nodes"]:
            for u in node.get("uniforms", []):
                for v in u.get("values", []):
                    m = re.fullmatch(r"op\('presets'\)\.module\.u\(parent\(\)\.par\.(\w+)\) \* "
                                     r"parent\(\)\.par\.Objectsize\.eval\(\)", str(v))
                    if m:
                        scaled.add(m.group(1))
        self.assertEqual(sorted(scaled), ["Frost", "Scenedepth", "Thickness"])
        for name in sorted(scaled):
            self.assertNotIn("scene units", CONTROLS[name]["label"], name)
        self.assertTrue(CONTROLS["Thickness"]["label"].startswith("Thickness (x Object size"))
        self.assertTrue(CONTROLS["Scenedepth"]["label"].startswith("Scene depth (x Object size"))
        # Object size: the family's one wording, with what this study's demo object fits to.
        size = CONTROLS["Objectsize"]
        m = re.fullmatch(r"Object size \(world radius / 1\.45; the demo (\w+) fits to ([0-9.]+)\)", size["label"])
        self.assertIsNotNone(m, size["label"])
        self.assertEqual(m.group(1), "torus")
        self.assertEqual(float(m.group(2)), round(size["default"], 2))
        self.assertEqual(NATIVE["REFERENCE_RADIUS"], 1.45)


class _CriticPar:
    def __init__(self, val=0.0):
        self.val = val

    def eval(self):
        return self.val


class _CriticPars(dict):
    """Parameters made on first use, so any member's Fit can write what it sets."""

    def __getattr__(self, name):
        return self.setdefault(name, _CriticPar())


def _critic_geo(radius, det, path):
    """A Geometry COMP whose rendered SOP has this radius and whose world matrix has this determinant."""
    size = SimpleNamespace(x=2 * radius, y=2 * radius, z=2 * radius)
    centre = SimpleNamespace(x=0.0, y=0.0, z=0.0)
    sop = SimpleNamespace(isSOP=True, render=True, path=path + "/sop",
                          bounds=lambda: SimpleNamespace(size=size, center=centre))
    return SimpleNamespace(path=path, children=[sop], worldTransform=SimpleNamespace(determinant=lambda: det))


def _critic_note(text, start="**One Object size per component.**"):
    """The README note that starts with `start`, up to its 'None of this has run' sentence, on one line."""
    i = text.index(start)
    return " ".join(text[i:text.index("None of this has run in TouchDesigner.", i)].split())


def _critic_native_run_test(case):
    """Family critic (high): nothing in the family close ran in TouchDesigner. validation.json
    keeps the critic's four native checks, and since the centre-line residual round a fifth
    (CentreLineResidual), with an empty record while they are pending; any other status needs
    the build, the OS, the GPU and the Info DAT text."""
    run = json.loads((STUDY / "validation.json").read_text())["family_close"]["native_run"]
    case.assertEqual([c["id"] for c in run["checks"]],
                     ["fit_comp_scaled", "odd_size_481x271", "occlusion", "render_pick", "centre_line_residual"])
    case.assertTrue(all(c["how"] for c in run["checks"]))
    case.assertIn("481 x 271", run["checks"][1]["how"])
    case.assertEqual(run["target"], "TouchDesigner 2025.x on macOS, Apple Silicon")
    case.assertEqual(sorted(run["record"]), ["build", "gpu", "info_dat", "os"])
    filled = sorted(k for k, v in run["record"].items() if v)
    case.assertEqual(filled, [] if run["status"] == "pending" else ["build", "gpu", "info_dat", "os"], run["status"])
    # inspect() returns what the record needs; the GPU is copied by hand (the App class has none).
    native = (STUDY / "native.py").read_text()
    for key in ('"build": str(app.build)', '"platform": platform.platform()', '"compile_reports"'):
        case.assertIn(key, native)
    case.assertIn("App_Class", run["how_to_record"])
    if run["status"] == "pending":
        case.assertIn("**Not yet run in TouchDesigner:**", (STUDY / "README.md").read_text())


class FamilyCritic(unittest.TestCase):
    """The family critic after the family close (review.md, Family critic: native runs and
    one Object size). Universality (medium): one Fit press sets one Object size for the
    whole component. This study's own Fit, its uniform expressions and the pattern lookups
    in its shader are measured on the three setups the critic named; the README must say
    what the measurement says. Native runs (high): see _critic_native_run_test. Both tests
    fail on c94e849, which had neither the README note nor the native list."""

    LOOKUPS = ("float scale = worldScale();", "vec3 p = vObjPos * uWobble.y * scale;",
               "valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0))")

    def setUp(self):
        self.fit_glass = NATIVE["fit_glass"]
        self.body = functions(code_only(shader("liquid_prism.frag")))
        self.uniforms = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}

    def fitted(self, geos):
        comp = SimpleNamespace(par=_CriticPars(Objectsize=_CriticPar(1.0), Thickness=_CriticPar(0.5),
                                               Wobblescale=_CriticPar(3.0), Frost=_CriticPar(0.2),
                                               Density=_CriticPar(1.5), Scenedepth=_CriticPar(2.0)),
                               op=lambda name: SimpleNamespace(text=json.dumps(SPEC)), path="/project1/glass_component")
        comp.par.Glassgeo = SimpleNamespace(evalOPs=lambda: list(geos))
        self.fit_glass(comp)
        return comp

    def look(self, comp, k_comp, k_inst):
        """World lengths and pattern periods, in scene units, on an object whose Geometry COMP
        scales by k_comp and whose own instance scales by k_inst. worldScale() reads the COMP's
        world matrix only (no instance), and vObjPos is the SOP position, before both."""
        env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=lambda p: p.eval())), "parent": lambda: comp}
        value = lambda name, i: eval(self.uniforms[name][i], env)  # noqa: E731,S307 (study.json; Morph 0)
        unit = k_comp * k_inst  # scene units per SOP unit
        return (value("uOptics", 1), value("uPrism", 0), value("uBody", 1), 1.0 / value("uGlass", 3),
                unit / (value("uWobble", 1) * k_comp), unit / (value("uFilm", 3) * k_comp))

    def ratios(self, got, wanted):
        return tuple(round(g / w, 9) for g, w in zip(got, wanted))

    def test_one_object_size_setups_are_measured_and_documented(self):
        body = self.body
        for line in self.LOOKUPS:
            self.assertIn(line, body["wobbleNormal"] + body["filmThickness"])
        self.assertEqual(body["worldScale"].strip(),
                         "return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);")
        self.assertIn("slope = uTDMats[vCamIndex].worldForNormals * slope * scale;", body["wobbleNormal"])
        self.assertNotIn("TDInstance", body["wobbleNormal"] + body["filmThickness"] + body["worldScale"])
        n = len(self.look(self.fitted([_critic_geo(1.45, 1.0, "/a")]), 1.0, 1.0))
        same, third = (1.0,) * n, (round(1 / 3, 9),) * n
        big, small = _critic_geo(1.45, 1.0, "/big"), _critic_geo(0.29, 1.0, "/small")
        truth = lambda det, k: self.look(self.fitted([_critic_geo(1.45, det, "/t")]), k, 1.0)  # noqa: E731 (Fit sees all)
        # Fit on the object as it is: every value follows the scale.
        self.assertEqual(self.ratios(self.look(self.fitted([_critic_geo(1.45, 27.0, "/a")]), 3.0, 1.0), truth(27.0, 3.0)), same)
        # 1. Objects of different sizes: Fit takes the largest, whatever the order.
        comp = self.fitted([big, small])
        self.assertEqual(self.ratios(self.look(comp, 1.0, 1.0), self.look(self.fitted([small]), 1.0, 1.0)), (5.0,) * n)
        self.assertEqual(self.fitted([small, big]).par.Objectsize.val, comp.par.Objectsize.val)
        # 2. The COMP's Scale animates from 1 to 3 after Fit: everything keeps Fit's world size ...
        comp = self.fitted([big])
        self.assertEqual(self.ratios(self.look(comp, 3.0, 1.0), truth(27.0, 3.0)), third)
        # ... and Object size animated by the same factor carries the look.
        comp.par.Objectsize.val *= 3.0
        self.assertEqual(self.ratios(self.look(comp, 3.0, 1.0), truth(27.0, 3.0)), same)
        # 3. An instance scaled 3: the patterns grow with it, the lengths do not.
        self.assertEqual(self.ratios(self.look(self.fitted([big]), 1.0, 3.0), truth(27.0, 3.0)),
                         (round(1 / 3, 9),) * (n - 2) + (1.0, 1.0))
        note = _critic_note((STUDY / "README.md").read_text())
        for phrase in (
                'Fit takes the largest',
                'Thickness, Scene depth, Frost, Tint density',
                'with ripples and film bands five times larger',
                'three times as many ripples and film bands',
                "Fit and the shader see the Geometry COMP's scale, not each instance's",
                'the ripples and film bands grow with it',
                'five times larger',
                'three times smaller',
                'Press Fit again after a scale change',
                'animate Object size by the same factor',
                "ignores each instance's rotation",
                'one Geometry COMP and one copy of the component per size',
                'waits for your decision',
        ):
            self.assertIn(phrase, note)

    def test_native_family_list_waits_for_a_recorded_run(self):
        _critic_native_run_test(self)


def check_look_decisions(test, in_code):
    """co-design.json's look_decisions_for_user, checked against the README's table: every
    decision has options, a recommended option (an inference, not an answer) and the option
    the code is in; while one waits for the user, the shader is not called accepted.
    Returns (co-design record, decisions by id)."""
    codesign = json.loads((STUDY / "co-design.json").read_text())
    block = codesign["look_decisions_for_user"]
    decisions = {d["id"]: d for d in block["decisions"]}
    test.assertEqual(set(decisions), set(in_code))
    readme = (STUDY / "README.md").read_text()
    section = readme.split("\n## Look decisions waiting for you\n", 1)[1].split("\n## ", 1)[0]
    rows = {cells[1].strip(): [c.strip() for c in cells[2:-1]]
            for cells in (line.split("|") for line in section.splitlines() if line.startswith("| LOOK-"))}
    waiting = []
    for did, d in decisions.items():
        with test.subTest(did):
            options = d["options"]
            test.assertGreaterEqual(len(options), 2)
            test.assertIn(d["recommended"], options)
            test.assertTrue(d["recommended_origin"].startswith("inference"), "a recommendation is not an answer")
            test.assertEqual(d["in_code"], in_code[did])
            test.assertEqual([k for k, text in options.items() if "(in the code now)" in text], [d["in_code"]])
            test.assertIn("No code change", options[d["in_code"]])
            for path in d["evidence"]:
                test.assertTrue((STUDY / path.split(" (")[0]).is_file(), path)
            test.assertEqual(rows[did][-1], f"**{d['recommended']}**")
            test.assertEqual(re.findall(r"\*\*([A-Z])\*\*", rows[did][-2]), sorted(options))
            if d["answer"] is None:
                test.assertEqual(d["status"], "waiting for the user")
                waiting.append(did)
            else:  # an answer is the user's own words, and the code then holds the chosen option
                test.assertEqual(d["answer"]["origin"], "user")
                test.assertTrue(d["answer"]["quote"].strip())
                test.assertEqual(d["answer"]["option"], d["in_code"])
    if waiting:
        test.assertEqual(block["status"], "waiting for the user")
        test.assertEqual(codesign["shader_acceptance"], "pending")
    return codesign, decisions


class LookDecisions(unittest.TestCase):
    """Look-acceptance round (review.md, Look decisions): the family close changed how the
    core looks and the film look on this demo, and the user has not accepted it.
    co-design.json asks the questions with options and a recommended answer, the README
    lists them, and until the user answers the option in the code stays there. Both tests
    fail on the records before this round (checks/results/red-run-look-decisions.json)."""

    # The option the code is in. Change it only together with the user's recorded answer,
    # and then encode that option's code below.
    IN_CODE = {"LOOK-P1": "A", "LOOK-P2": "A"}

    @staticmethod
    def demo_factors():
        # Lengths are value x Object size; the ripple and film lookups value / Object size x
        # worldScale(), the cube root of the demo COMP's scale. c94e849: Object size 1, no worldScale().
        size = CONTROLS["Objectsize"]["default"]
        geo = NODES["demo_geo"]["parameters"]
        count = (geo.get("sx", 1.0) * geo.get("sy", 1.0) * geo.get("sz", 1.0)) ** (1.0 / 3.0) / size
        return size, count

    def test_look_decisions_wait_for_the_user(self):
        codesign, decisions = check_look_decisions(self, self.IN_CODE)
        p1, p2 = decisions["LOOK-P1"], decisions["LOOK-P2"]
        receipt = json.loads((STUDY / "checks" / "results" / "look-decisions.json").read_text())
        rep = receipt["reproduced_from_files"]
        core_looks = [n for n in PRESETS["presets"] if n in CORE_PRESETS["presets"]]
        self.assertEqual(rep["core_looks"], core_looks)
        # P1: the core looks' change, from the captures, as the family close recorded it.
        core = rep["core_looks_checkerboard_and_type"]
        self.assertEqual(core["captures"], 12)
        self.assertIn(f"changed by {core['max_from']} to {core['max_to']}/255 against c94e849", p1["what_changed"])
        close = json.loads((STUDY / "checks" / "results" / "family-close-measurements.json").read_text())
        rows = close["captures_c94e849_vs_now"]["rows"]
        recorded = [rows[f"preset-{n}{s}"]["max"] for n in core_looks for s in ("", "-type")]
        self.assertEqual((min(recorded), max(recorded)), (core["max_from"], core["max_to"]))
        size, count = self.demo_factors()
        self.assertIn(f"{size:.4f} times as long", p1["what_changed"])
        self.assertIn(f"lengths x {1 / size:.3f}", (STUDY / "README.md").read_text())
        # P2: the film and ripple count on this demo, computed from the recipe; Spectral Prism's change.
        self.assertIn(f"{count:.4f} times as many as at c94e849: the bands are {(1 / count - 1) * 100:.1f}% wider", p2["what_changed"])
        for key, backdrop in (("spectral_prism", "checkerboard"), ("spectral_prism_type", "type")):
            r = rep[key]
            self.assertIn(f"{r['max']}/255 on {r['pixels_over_8']:,} pixels over 8/255" if backdrop == "checkerboard"
                          else f"{r['max']}/255 on {r['pixels_over_8']:,} ({backdrop})", p2["what_changed"])
        self.assertIn(f"2.5 x {1 / count:.4f} = {2.5 / count:.3f} per Object size", p2["options"]["B"])
        self.assertTrue([q for q in codesign["open_questions"] if q.startswith("LOOK-P1 and LOOK-P2 ")])
        self.assertFalse([q for q in codesign["open_questions"] if q.startswith("Family close: on this demo")])

    def test_code_stays_as_delivered_until_answered(self):
        check_look_decisions(self, self.IN_CODE)
        self.assertEqual(self.IN_CODE, {"LOOK-P1": "A", "LOOK-P2": "A"}, "encode the chosen options' code here")
        # P1 A: the six core looks carry the core's values, unchanged since c94e849.
        before = json.loads((STUDY / "checks" / "reference" / "presets.json").read_text())["presets"]
        core_looks = [n for n in PRESETS["presets"] if n in CORE_PRESETS["presets"]]
        self.assertEqual(len(core_looks), 6)
        for name in core_looks:
            values, core = PRESETS["presets"][name]["values"], CORE_PRESETS["presets"][name]["values"]
            self.assertEqual({k: values[k] for k in core}, core, name)
            self.assertEqual(values, before[name]["values"], name)
        # P2 A: the family's film count, 2.5 per Object size, looked up in world-sized steps.
        for node_id in ("material", "material_back"):
            self.assertEqual(uniform(node_id, "uFilm")["values"][3], "2.5 / parent().par.Objectsize.eval()", node_id)
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale()", FRAG)


class CentreLineResidual(unittest.TestCase):
    """Family critic (low): with antialiasing, a few silhouette pixels near a centre line of the
    render still take the wrong screen orientation (1 to 8 per row of twelve renders in the
    members' surveys). The critic's fix keeps it a family open question until a native check
    shows whether it is visible, and tries a centroid-sampled position in one member first only
    if it is. co-design.json carries the family's question word for word (as do the other
    members next to this study), validation.json's native run lists the check, the check's edit
    applies to this study's shader, no shader here has a centroid qualifier yet, and the records
    state what the preview measured. The preview test now holds 10 wrong multisampled pixels per
    row, not 20. Both tests fail on the files before this round."""

    MEMBERS = ("liquid-glass", "liquid-glass-flow", "liquid-glass-lit", "liquid-glass-prism")
    FRAG = "liquid_prism.frag"
    ORIENT_LINE = "cam.screenSign = screenSign(ndc, ndcStep, depthStep);"
    RIGHT_LINE = "cam.screenSign = vec2(1.0, 1.0);"
    ROWS = "evidence/family_survey"
    MATERIAL = "Override Material"  # where the native check swaps the material
    QUESTION = ('Family open question (centre-line residual): with antialiasing, a few silhouette pixels '
                "near the render's centre row or column still take the wrong screen orientation, so they "
                "bend the wrong way. In the WebGL preview each member's survey finds up to 8 of them per "
                'row of twelve renders; in the final image they change at most 7 pixels per row, by up to '
                "43/255 in an emulated flipped raster and up to 38/255 in TouchDesigner's usual one. Are "
                'they visible in TouchDesigner? The native check centre_line_residual (validation.json, '
                'family_close.native_run) answers it. If they are, try a centroid-qualified vertex output '
                "for the projected position in Liquid Glass Lit first (form (e) of Lit's survey), then "
                'bring it to the core and the other members. Until then no member changes its shader for '
                'it.')

    def native_check(self):
        run = json.loads((STUDY / "validation.json").read_text())["family_close"]["native_run"]
        return next(c for c in run["checks"] if c["id"] == "centre_line_residual")

    def test_residual_is_an_open_family_question_with_a_native_check(self):
        questions = json.loads((STUDY / "co-design.json").read_text())["open_questions"]
        self.assertEqual([q for q in questions if "centre-line residual" in q], [self.QUESTION])
        for member in self.MEMBERS:  # the same words in every member that sits next to this study
            codesign = STUDY.parent / member / "co-design.json"
            if codesign.is_file():
                self.assertIn(self.QUESTION, json.loads(codesign.read_text())["open_questions"], member)
        check = self.native_check()
        # The edit the native check asks for applies to this study's pixel shader, once.
        self.assertEqual((STUDY / self.FRAG).read_text().count(self.ORIENT_LINE), 1)
        for phrase in (self.ORIENT_LINE, self.RIGHT_LINE, self.MATERIAL, "481 x 271", "Anti-Alias", "4x",
                       "Composite TOP", "Difference", "Analyze TOP", "Maximum in RGB", "100% zoom"):
            self.assertIn(phrase, check["how"])
        self.assertIn("Liquid Glass Lit first", check["if_visible"])
        self.assertIn("centroid", check["if_visible"])
        # A centroid-sampled position waits for that answer: no shader here declares one yet.
        for source in sorted(STUDY.glob("*.vert")) + sorted(STUDY.glob("*.frag")):
            self.assertNotRegex(code_only(source.read_text()), r"\bcentroid\b", source.name)
        decision = [d for d in json.loads((STUDY / "decisions.json").read_text())
                    if d["goal"].startswith("Family critic (low): the antialiased centre-line residual")]
        self.assertEqual(len(decision), 1)
        self.assertIn("open family question", decision[0]["status"])
        readme = (STUDY / "README.md").read_text()
        self.assertIn("the antialiased centre-line residual", readme.split("**Not yet run in TouchDesigner:**", 1)[1])
        self.assertIn("open family question", readme)

    def test_records_match_the_preview_measurements(self):
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        check = tests.split("check('screen_orientation_has_no_wrong_pixels'", 1)[1].split("');", 1)[0]
        self.assertIn("r.multisampled.wrong_sign_pixels <= 10)", check)
        self.assertNotIn("wrong_sign_pixels <= 20", check)
        self.assertNotIn(" 20 per row", check)
        self.assertNotIn(" 20 wrong multisampled", check)
        self.assertRegex(check, r"at most 10 per row|10 wrong multisampled pixels per row")
        results = json.loads((STUDY / "checks" / "results" / "preview-tests.json").read_text())["results"]
        found = next(r for r in results if r["name"] == "screen_orientation_has_no_wrong_pixels")
        rows = found
        for key in self.ROWS.split("/"):
            rows = rows[key]
        self.assertEqual(len(rows), 12)
        self.assertTrue(all(r["renders"] == 12 for r in rows.values()))
        wrong = [r["multisampled"]["wrong_sign_pixels"] for r in rows.values()]
        preview = self.native_check()["preview"]
        self.assertEqual(preview["wrong_multisampled_pixels_per_row_max"], max(wrong))
        self.assertEqual(preview["wrong_multisampled_pixels_total"], sum(wrong))
        self.assertLessEqual(max(wrong), 8)  # the top of the family's range in the open question
        final = json.loads((STUDY / "checks" / "results" / "centre-line-residual.json").read_text())
        self.assertEqual(final["renders"], 144)
        self.assertFalse(final["errors"])
        for key in ("changed_pixels", "over_8", "max", "max_changed_per_row", "normal_raster_changed_pixels"):
            self.assertEqual(preview["final_image"][key], final[key], key)
        self.assertLessEqual(final["max"], 43)  # the top of the family's range in the open question


if __name__ == "__main__":
    unittest.main(verbosity=2)
