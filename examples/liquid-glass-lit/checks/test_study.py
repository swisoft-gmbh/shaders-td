#!/usr/bin/env python3
"""Tests that need neither TouchDesigner nor a GPU.

  python3 checks/test_study.py

Covers the preset module (load and morph maths, with fake parameters), the
recipe's internal consistency, and the lighting contract in the shader source:
every call that needs a Light COMP or an Environment Light COMP sits behind the
matching #if, the shader never dithers, and the material lights in world space.
Also: numerics in the GLSL source (ordered smoothstep edges, guarded divisions,
extra colour buffers zeroed), the demo's Render Pass TOP recipe, and the
in-TouchDesigner helpers in native.py run against a fake 'td' module.

The classes after NativeHelpers cover the family sync (items R1 to R9 and C1
to C9 in review.md): the integrated drift clock, the experiment reset contract
run in every order, constant-mode Inputs and grouped build warnings, the core's
shader hygiene, picking and colour buffers, no dithering, measured screen
orientation, fog, Object size with Fit to Glass geometry, the Refraction TOP's
alpha and the Demo backdrop menu. Each of them fails on the commit-6a58487
files (review.md, Family sync). FamilyObjectSizeRule pins this study to the
family's Object size rule (decisions.json, family_rule). DocumentedCounts reads
the test counts that review.md, README.md and validation.json state, and their
notes on the saved 6a58487 red runs, from the suites and the result files.
FamilyClose compares what this study shares with the core study; its G1 test
measures each side's pattern periods. FamilyCloseVerifierFixes checks the
tutorial's pointer to main() and the rule record's entry for Liquid Glass Blobs
(review.md, Verifier fixes after the family close).
"""
import builtins
import itertools
import json
from pathlib import Path
import re
import runpy
import sys
import types
from types import SimpleNamespace
import unittest

STUDY = Path(__file__).resolve().parent.parent
SPEC = json.loads((STUDY / "study.json").read_text())
PRESETS = json.loads((STUDY / "presets.json").read_text())
EXPERIMENTS = json.loads((STUDY / "experiments.json").read_text())
MODULE = runpy.run_path(str(STUDY / "presets.py"))
CONTROLS = {c["name"]: c for c in SPEC["controls"]}
NODES = {n["id"]: n for n in SPEC["nodes"]}
FRAG = (STUDY / "liquid_glass_lit.frag").read_text()
SHADERS = {p.name: p.read_text() for p in sorted(STUDY.glob("*.frag")) + sorted(STUDY.glob("*.vert"))}


class FakePar:
    def __init__(self, owner, name, value):
        self.owner, self.name, self.val = owner, name, value

    def eval(self):
        return self.val


class FakeComp:
    """Just enough of a TouchDesigner COMP for presets.py."""

    def __init__(self, values):
        self.par = SimpleNamespace(**{k: FakePar(self, k, v) for k, v in values.items()})
        self._data = SimpleNamespace(text=(STUDY / "presets.json").read_text())

    def op(self, name):
        assert name == "presets_data"
        return self._data


def defaults():
    return {c["name"]: c["default"] for c in SPEC["controls"] if c.get("default") is not None}


def guarded_lines(source, condition):
    """Line numbers inside '#if <condition>' ... matching '#endif' blocks."""
    inside, depth, lines = False, 0, set()
    for number, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#if"):
            if inside:
                depth += 1
            elif stripped == "#if " + condition:
                inside, depth = True, 0
        elif stripped.startswith("#endif") and inside:
            if depth == 0:
                inside = False
            else:
                depth -= 1
        elif inside:
            lines.add(number)
    return lines


def call_lines(source, name):
    return {i for i, line in enumerate(source.splitlines(), 1)
            if re.search(r"\b" + name + r"\s*\(", line.split("//")[0])}


class PresetModule(unittest.TestCase):
    def test_apply_writes_every_preset_value(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "violet_gel")
        for key, value in PRESETS["presets"]["violet_gel"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        before = {k: v.val for k, v in vars(comp.par).items()}
        MODULE["apply"](comp, "custom")
        self.assertEqual(before, {k: v.val for k, v in vars(comp.par).items()})

    def test_morph_endpoints_and_midpoint(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "prism_chrome")
        comp.par.Morphtarget.val = "amber_honey"
        a = PRESETS["presets"]["prism_chrome"]["values"]
        b = PRESETS["presets"]["amber_honey"]["values"]
        for m, expect in ((0.0, lambda k: a[k]), (1.0, lambda k: b[k]), (0.5, lambda k: (a[k] + b[k]) / 2)):
            comp.par.Morph.val = m
            for key in SPEC["preset_keys"]:
                self.assertAlmostEqual(MODULE["u"](getattr(comp.par, key)), expect(key), 9, key)


class Recipe(unittest.TestCase):
    def test_twelve_complete_presets(self):
        self.assertEqual(len(PRESETS["presets"]), 12)
        self.assertEqual(PRESETS["order"], list(PRESETS["presets"]))
        for name, preset in PRESETS["presets"].items():
            self.assertEqual(sorted(preset["values"]), sorted(SPEC["preset_keys"]), name)

    def test_preset_keys_are_controls_and_scene_settings_are_not(self):
        for key in SPEC["preset_keys"]:
            self.assertIn(key, CONTROLS)
        for scene_setting in ("Lightsource", "Envsource", "Envintensity", "Envmips", "Shadowstrength",
                              "Keydirx", "Keyintensity", "Keycolorr", "Studiorotate", "Samples"):
            self.assertNotIn(scene_setting, SPEC["preset_keys"])

    def test_control_defaults_are_the_default_preset(self):
        values = PRESETS["presets"][PRESETS["default"]]["values"]
        for key, value in values.items():
            self.assertEqual(CONTROLS[key]["default"], value, key)
        self.assertEqual(CONTROLS["Preset"]["default"], PRESETS["default"])

    def test_menus_offer_every_preset(self):
        self.assertEqual(CONTROLS["Preset"]["names"], ["custom"] + PRESETS["order"])
        self.assertEqual(CONTROLS["Morphtarget"]["names"], PRESETS["order"])

    def test_every_preset_value_reaches_a_morphed_uniform(self):
        text = json.dumps(NODES["material"]["uniforms"])
        morphed = re.findall(r"module\.u\(parent\(\)\.par\.(\w+)\)", text)
        self.assertEqual(sorted(morphed), sorted(SPEC["preset_keys"]))

    def test_source_menus_match_shader_modes(self):
        # The shader reads 0 auto, 1 scene, 2 built-in from uSources.x and .y.
        for name in ("Lightsource", "Envsource"):
            self.assertEqual(CONTROLS[name]["names"], ["auto", "scene", "builtin"], name)
        self.assertIn("0 auto, 1 scene, 2 built-in", FRAG)

    def test_stage_menu_matches_shader_stages(self):
        stages = CONTROLS["Stage"]["names"]
        self.assertEqual(stages[0], "final")
        highest = max(int(n) for n in re.findall(r"stage == (\d+)", FRAG))
        self.assertEqual(len(stages), highest + 2)  # final + numbered stages + the 'else' stage

    def test_experiments_use_real_presets_and_previews(self):
        self.assertGreaterEqual(len(EXPERIMENTS), 8)
        for e in EXPERIMENTS:
            self.assertIn(e["parameters"].get("Preset"), PRESETS["presets"], e["id"])
            self.assertTrue((STUDY / e["preview"]).is_file(), e["preview"])
            self.assertIn("pending", e["observation"].lower(), e["id"])

    def test_demo_render_lights_only_name_demo_lights(self):
        expression = NODES["render"]["expressions"]["lights"]
        for name in re.findall(r"'(demo_\w+)'", expression):
            self.assertIn(NODES[name]["type"], ("lightCOMP", "environmentlightCOMP"), name)

    def test_demo_draws_the_glass_into_the_scene_render(self):
        # The README recipe: the glass goes into the scene render through a Render
        # Pass TOP that keeps the scene's colour and depth, and the same scene
        # render is the Refraction TOP. The demo follows it.
        render, scene = NODES["render"], NODES["demo_scene"]
        self.assertEqual(render["type"], "renderpassTOP")
        self.assertIs(render["parameters"]["cleardepth"], False)
        self.assertIs(render["parameters"]["cleartocamcolor"], False)
        self.assertEqual(scene["type"], "renderTOP")
        self.assertIn({"from": "demo_scene", "to": "render", "input": 0}, SPEC["wires"])
        self.assertEqual(CONTROLS["Refractiontop"]["demo_target"], "demo_scene")  # family sync R3: constant mode
        refs = {(r["node"], r["parameter"]): r["target"] for r in SPEC["references"]}
        self.assertEqual(refs[("render", "geometry")], "demo_geo")
        self.assertEqual(refs[("render", "camera")], refs[("demo_scene", "camera")])
        self.assertNotIn("demo_geo", scene["expressions"]["geometry"])  # never the glass in its own Refraction TOP
        self.assertNotIn("overTOP", {n["type"] for n in SPEC["nodes"]})

    def test_demo_dimmer_drives_both_demo_lights(self):
        for light in ("demo_key", "demo_rim"):
            self.assertRegex(NODES[light]["expressions"]["dimmer"], r"^[\d.]+ \* parent\(\)\.par\.Demodimmer$")


class LightingContract(unittest.TestCase):
    def test_material_lights_in_world_space(self):
        self.assertEqual(NODES["material"]["parameters"]["lightingspace"], "worldspace")

    def test_env_light_calls_are_guarded(self):
        guarded = guarded_lines(FRAG, "TD_NUM_ENV_LIGHTS > 0")
        for name in ("TDEnvLightTextureLod", "TDEnvLightingPBR", "uTDEnvLights"):
            lines = call_lines(FRAG, name) if name.startswith("TD") else \
                {i for i, x in enumerate(FRAG.splitlines(), 1) if name in x.split("//")[0]}
            self.assertTrue(lines, name)
            self.assertLessEqual(lines, guarded, name)

    def test_light_calls_are_guarded(self):
        guarded = guarded_lines(FRAG, "TD_NUM_LIGHTS > 0")
        lines = call_lines(FRAG, "TDLightingPBR")
        self.assertTrue(lines)
        self.assertLessEqual(lines, guarded)

    def test_uses_documented_returning_forms(self):
        self.assertRegex(FRAG, r"TDPBRResult r = TDLightingPBR\(i, ")
        self.assertRegex(FRAG, r"TDPBRResult r = TDEnvLightingPBR\(i, ")

    def test_continuous_output(self):
        self.assertNotIn("TDDither", re.sub(r"//.*", "", FRAG))
        self.assertIn("TDOutputSwizzle", FRAG)
        self.assertIsNone(re.search(r"^\s*#version", FRAG, re.M))

    def test_extra_colour_buffers_are_zeroed(self):
        code = re.sub(r"//.*", "", FRAG)
        self.assertIn("out vec4 fragColor[TD_NUM_COLOR_BUFFERS]", code)
        for k in range(1, 8):  # family sync C2: constant indices behind #if (a loop failed in WebGL2 for Flow)
            self.assertRegex(code, rf"#if TD_NUM_COLOR_BUFFERS > {k}\s+fragColor\[{k}\] = vec4\(0\.0\);\s+#endif")
        self.assertIsNone(re.search(r"\bfragColor\s*=", code), "every write names a colour buffer")


def smoothstep_edges(source):
    """(edge0, edge1) text of every smoothstep() call, comments removed."""
    code = re.sub(r"//.*", "", source)
    calls = []
    for match in re.finditer(r"\bsmoothstep\s*\(", code):
        depth, args, current = 1, [], ""
        for ch in code[match.end():]:
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    break
            if ch == "," and depth == 1:
                args.append(current.strip()); current = ""
            else:
                current += ch
        calls.append((args[0], args[1]))
    return calls


def reversed_edges(edge0, edge1):
    """True when smoothstep's edges decrease (undefined in GLSL): two number
    literals with edge0 >= edge1, or the mirror pattern (x, -x)."""
    number = r"-?\d+(\.\d*)?"
    if re.fullmatch(number, edge0) and re.fullmatch(number, edge1):
        return float(edge0) >= float(edge1)
    return edge1.replace(" ", "") == "-" + edge0.replace(" ", "")


class Numerics(unittest.TestCase):
    def test_reversed_edge_detector_catches_the_old_forms(self):
        for old in ("smoothstep(0.0, -0.7, el)", "smoothstep(-0.2, -0.8, d.y)", "smoothstep(px, -px, d)"):
            self.assertTrue(reversed_edges(*smoothstep_edges(old)[0]), old)
        self.assertFalse(reversed_edges(*smoothstep_edges("smoothstep(-px, px, d)")[0]))

    def test_smoothstep_edges_increase_in_every_shader(self):
        # Khronos: undefined when edge0 >= edge1 (also on Metal via MoltenVK).
        found = 0
        for name, source in SHADERS.items():
            for edges in smoothstep_edges(source):
                found += 1
                self.assertFalse(reversed_edges(*edges), f"{name}: smoothstep{edges}")
        self.assertGreater(found, 10)

    def test_key_light_divides_safely(self):
        # normalize() of a zero vector is undefined; the GGX denominator must stay positive.
        start, end = FRAG.index("// @begin keylight"), FRAG.index("// @end keylight")
        region = re.sub(r"//.*", "", FRAG[start:end])
        self.assertNotIn("normalize(", region)
        self.assertIn("NdotH = min(NdotH, 1.0);", region)
        self.assertRegex(region, r"float d = max\(.*, 1e-8\);")

    def test_every_stage_is_capped(self):
        start = FRAG.index("// @begin stages")
        tail = FRAG[start:]
        self.assertLess(tail.index("colour = min(colour, vec3(1024.0));"), tail.index("fragColor[0] = TDOutputSwizzle"))


class FakeTDPar:
    def __init__(self, name, owner=None):
        self.name, self.val, self.expr, self.default = name, None, None, None
        self.owner = owner
        self.isMenu = name in FAKE_MENUS
        self.menuNames = FAKE_MENUS.get(name, [])

    def eval(self):
        """An operator parameter holding a relative path resolves to that child, as in TouchDesigner."""
        if isinstance(self.val, str) and self.owner is not None and self.owner.op(self.val) is not None:
            return self.owner.op(self.val)
        return self.val


FAKE_MENUS = {"lightingspace": ["worldspace", "cameraspace"], "glslversion": ["glsl460"],
              "srcblend": ["one"], "destblend": ["omsa"], "cullface": ["backfaces", "neither"]}


class FakeTDPars:
    def __init__(self, owner=None):
        object.__setattr__(self, "_p", {})
        object.__setattr__(self, "_owner", owner)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._p.setdefault(name, FakeTDPar(name, self._owner))

    def __setattr__(self, name, value):
        getattr(self, name).val = value


class FakeTDOp:
    """Just enough of a TouchDesigner OP for builder.py. Not TouchDesigner."""
    unavailable = set()

    def __init__(self, kind, name, parent=None):
        self.OPType, self.name = kind, name
        self.path = (parent.path if parent else "") + "/" + name
        self.par, self.children, self.stored = FakeTDPars(self), [], {}
        self.seq = SimpleNamespace(vec=SimpleNamespace(numBlocks=0), sampler=SimpleNamespace(numBlocks=0))
        self.inputConnectors = [SimpleNamespace(connect=lambda other: None) for _ in range(2)]
        self.created_with_initialize = []

    def create(self, kind, name, initialize=True):
        if kind in self.unavailable:
            raise RuntimeError("unavailable type " + kind)
        child = FakeTDOp(kind, name, self)
        self.created_with_initialize.append((name, initialize))
        self.children.append(child)
        return child

    def appendCustomPage(self, name):
        owner = self
        maker = lambda n, label=None: [getattr(owner.par, n)]
        page = SimpleNamespace(appendMenu=maker, appendToggle=maker, appendPulse=maker, appendFloat=maker,
                               appendInt=maker, appendTOP=maker, appendCOMP=maker, appendObject=maker)
        page.appendRGB = lambda n, label=None: [getattr(owner.par, n + c) for c in "rgb"]
        page.appendXYZ = lambda n, label=None: [getattr(owner.par, n + c) for c in "xyz"]
        return page

    def relativePath(self, other):
        return other.name

    def op(self, name):
        return next((c for c in self.children if c.name == name), None)

    def store(self, key, value):
        self.stored[key] = value

    def cook(self, force=False):
        pass


class BuilderSmoke(unittest.TestCase):
    """Runs builder.build() against a fake 'td' module: catches Python errors, not TouchDesigner ones."""

    def build(self, unavailable=()):
        root = FakeTDOp("root", "")
        FakeTDOp.unavailable = set(unavailable)
        td = types.ModuleType("td")
        td.op, td.app = (lambda path: root), SimpleNamespace(build="fake")
        td.baseCOMP, td.textDAT, td.infoDAT = "baseCOMP", "textDAT", "infoDAT"
        td.ParMode = SimpleNamespace(CONSTANT="CONSTANT", EXPRESSION="EXPRESSION")
        sys.modules["td"] = td
        try:
            return runpy.run_path(str(STUDY / "builder.py"))["build"](STUDY, "/")
        finally:
            del sys.modules["td"]

    def test_core_built_strictly_with_world_lighting(self):
        comp = self.build()
        material = next(c for c in comp.children if c.name == "material")
        self.assertEqual(material.par.lightingspace.val, "worldspace")
        self.assertEqual(material.seq.vec.numBlocks, 15)  # family sync: + uPhase (R1) and uOptions (R8)
        self.assertEqual(material.seq.sampler.numBlocks, 1)
        self.assertEqual(comp.stored["build_warnings"], [])
        spec_names = {n["id"] for n in SPEC["nodes"] if "/" not in n["id"]}
        created = dict(comp.created_with_initialize)
        self.assertEqual(spec_names, spec_names & set(created))
        self.assertTrue(all(created[name] is False for name in spec_names))

    def test_renders_and_shaders_get_info_dats(self):
        comp = self.build()
        names = {c.name for c in comp.children}
        for info in ("info_material", "info_render", "info_demo_scene", "info_demo_card_mat"):
            self.assertIn(info, names)

    def test_unavailable_demo_node_is_skipped_with_warning(self):
        comp = self.build(unavailable=("environmentlightCOMP",))
        self.assertNotIn("demo_envlight", [c.name for c in comp.children])
        self.assertTrue(any("demo_envlight" in w for w in comp.stored["build_warnings"]))

    def test_unavailable_core_node_stops_the_build(self):
        with self.assertRaises(RuntimeError):
            self.build(unavailable=("glslMAT",))


class NativeOP:
    """A named node for the native.py fakes. Not TouchDesigner."""

    def __init__(self, name, kind, text=""):
        self.name, self.OPType, self.text = name, kind, text
        self.path = "/project1/liquid_glass_lit/" + name
        self.width, self.height, self.cooks = 1280, 720, 0

    def cook(self, force=False):
        self.cooks += 1

    def errors(self, recurse=False):
        return ""

    def warnings(self, recurse=False):
        return ""


class LightsPar:
    """An operator parameter as documented on Par_Class: eval() gives one OP, a list or None."""

    def __init__(self, found, fail=False):
        self.found, self.fail, self.expr = found, fail, "' '.join(...)"

    def eval(self):
        return None if not self.found else self.found[0] if len(self.found) == 1 else list(self.found)

    def evalOPs(self):
        if self.fail:
            raise RuntimeError("cannot resolve")
        return list(self.found)


class NativePar:
    def __init__(self, control):
        self.name, self.default = control["name"], control.get("default")
        self.val = self.default
        self.isPulse = control["type"] == "pulse"
        self.mode = "EXPRESSION" if control.get("expression") else "CONSTANT"

    def eval(self):
        return self.val

    def evalOPs(self):
        """Operator parameters: the fakes hold a name or nothing; nothing outside the component."""
        return []


class NativePars:
    def __init__(self, pars):
        object.__setattr__(self, "_p", {p.name: p for p in pars})

    def __getattr__(self, name):
        return self._p[name]

    def __setattr__(self, name, value):  # component.par.X = v sets the value, as in TouchDesigner
        self._p[name].val = value


class NativeComp:
    def __init__(self, lights_found=(), fail=False):
        self.path = "/project1/liquid_glass_lit"
        self.customPars = [NativePar(c) for c in SPEC["controls"]]
        self.par = NativePars(self.customPars)
        self.ops = {n["id"]: NativeOP(n["id"], n["type"]) for n in SPEC["nodes"]}
        self.ops["render"].par = SimpleNamespace(lights=LightsPar(list(lights_found), fail))
        for name, file in (("study_spec", "study.json"), ("study_experiments", "experiments.json"),
                           ("presets_data", "presets.json")):
            self.ops[name] = NativeOP(name, "textDAT", (STUDY / file).read_text())
        self.ops["presets"] = SimpleNamespace(module=SimpleNamespace(apply=MODULE["apply"]))
        self.children = [self.ops["study_spec"], NativeOP("info_material", "infoDAT", "compiled")]

    def op(self, name):
        return self.ops.get(name)

    def errors(self, recurse=False):
        return ""

    def warnings(self, recurse=False):
        return ""

    def fetch(self, key, default=None):
        return default


def load_native(path=None):
    """native.py (or another study's, from `path`) run against a fake 'td' module."""
    td = types.ModuleType("td")
    td.app = SimpleNamespace(build="fake", version="fake")
    td.ParMode = SimpleNamespace(CONSTANT="CONSTANT", EXPRESSION="EXPRESSION", EXPORT="EXPORT", BIND="BIND")
    sys.modules["td"] = td
    try:
        return runpy.run_path(str(path or STUDY / "native.py"))
    finally:
        del sys.modules["td"]


class NativeHelpers(unittest.TestCase):
    """native.py against a fake 'td' module: catches Python errors, not TouchDesigner ones."""

    def setUp(self):
        self.native = load_native()

    def test_lights_and_inspect_for_every_eval_shape(self):
        key, rim = NativeOP("demo_key", "lightCOMP"), NativeOP("demo_rim", "lightCOMP")
        env = NativeOP("demo_envlight", "environmentlightCOMP")
        for found in ([key, rim, env], [key], []):
            comp = NativeComp(found)
            report = self.native["inspect"](comp)
            self.assertEqual(report["demo_lights"]["lights"], [n.name for n in found])
            self.assertIn("render", report["render_diagnostics"])
            self.assertIn("demo_scene", report["render_diagnostics"])
            self.assertGreater(comp.ops["render"].cooks, 0)

    def test_lights_never_blocks_inspect(self):
        report = self.native["inspect"](NativeComp([], fail=True))
        self.assertIn("error", report["demo_lights"])

    def test_apply_resets_what_the_previous_experiment_changed(self):
        comp = NativeComp()
        pairs = (("morph", "final", "Morph", 0.0), ("env_rotate", "env_roughness", "Demoenvrotate", 0.0),
                 ("fallback", "dispersion", "Demolights", "both"), ("occluder", "final", "Demooccluder", False),
                 ("blackout", "rim_only", "Demodimmer", 1.0), ("highlight_size", "scene_lights", "Highlightsize", 0.12))
        for first, second, name, expected in pairs:
            self.native["apply"](comp, first)
            self.native["apply"](comp, second)
            self.assertEqual(getattr(comp.par, name).val, expected, f"{first} -> {second}: {name}")

    def test_experiments_in_file_order_equal_fresh_runs(self):
        chained = NativeComp()
        for item in EXPERIMENTS:
            self.native["apply"](chained, item["id"])
            fresh = NativeComp()
            self.native["apply"](fresh, item["id"])
            self.assertEqual({p.name: p.val for p in chained.customPars},
                             {p.name: p.val for p in fresh.customPars}, item["id"])

    def test_apply_keeps_the_users_wiring_and_calibration(self):
        comp = NativeComp()
        comp.par.Flipv = True
        comp.par.Refractiontop.val = "user_scene_render"
        comp.par.Keyintensity.mode = "EXPRESSION"
        comp.par.Keyintensity.val = 3.0
        self.native["apply"](comp, "final")
        self.assertIs(comp.par.Flipv.val, True)
        self.assertEqual(comp.par.Refractiontop.val, "user_scene_render")
        self.assertEqual(comp.par.Keyintensity.val, 3.0)
        self.assertEqual(comp.par.Preset.val, "custom")


# ---------------------------------------------------------------- family sync (review.md)

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


VERT = (STUDY / "liquid_glass_lit.vert").read_text()
MAIN = functions(FRAG)["main"]
NATIVE_TEXT = (STUDY / "native.py").read_text()
REFERENCE_SPEC = json.loads((STUDY / "checks" / "reference" / "study.json").read_text())


class SyncPar:
    """A custom parameter of the fake component below (menuIndex, mode and evalOPs as in TouchDesigner)."""

    def __init__(self, owner, name, value, menu_names=None, mode="CONSTANT"):
        self.owner, self.name, self.val, self.mode = owner, name, value, mode
        self.menuNames = menu_names or []
        self.isPulse = False
        # Like a TouchDesigner custom parameter: its default is the study.json default,
        # or the value it was created with when study.json does not list it.
        self.default = CONTROLS[name]["default"] if CONTROLS.get(name, {}).get("default") is not None else value

    def eval(self):
        return self.val

    @property
    def menuIndex(self):
        return self.menuNames.index(self.val)

    def evalOPs(self):
        return []


class SyncComp:
    """Just enough of a TouchDesigner COMP for presets.py, preset_exec.py and native.py."""
    count = 0

    def __init__(self, values=None):
        SyncComp.count += 1  # a fresh path: presets.py keeps running drift per component path
        self.path = f"/project1/liquid_glass_lit{SyncComp.count}"
        values = dict(defaults()) if values is None else values
        self.par = NativePars([SyncPar(self, k, v, CONTROLS.get(k, {}).get("names")) for k, v in values.items()])
        self.customPars = list(self.par._p.values())
        self._ops = {
            "presets_data": SimpleNamespace(text=(STUDY / "presets.json").read_text()),
            "presets": SimpleNamespace(module=SimpleNamespace(apply=MODULE["apply"])),
            "study_spec": SimpleNamespace(text=(STUDY / "study.json").read_text()),
            "study_experiments": SimpleNamespace(text=(STUDY / "experiments.json").read_text()),
        }

    def op(self, name):
        return self._ops.get(name)

    def state(self):
        return {k: v.val for k, v in self.par._p.items()}


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


# What a user sets up for their own scene; apply() must keep all of it.
SCENE = {"Refractiontop": "/project1/scene_render", "Culling": "none", "Objectsize": 7.5,
         "Flipv": True, "Colourspace": "raw"}


def scene_comp():
    values = defaults()
    values.update(SCENE)
    return SyncComp(values)


def expected_after(experiment_id, comp):
    """Look defaults + preset + overrides, with the menu on 'custom' and setup untouched.
    Worked out from study.json alone (every control with a default, except pulses,
    Preset and the controls flagged setup), not from native.py, the module under test."""
    item = next(e for e in EXPERIMENTS if e["id"] == experiment_id)
    state = comp.state()
    state.update({c["name"]: c["default"] for c in SPEC["controls"]
                  if c.get("default") is not None and c["type"] != "pulse"
                  and not c.get("setup") and c["name"] != "Preset"})
    params = dict(item["parameters"])
    state.update(PRESETS["presets"][params.pop("Preset")]["values"])
    state["Preset"] = "custom"
    state.update(params)
    return state


class SyncR1DriftClock(unittest.TestCase):
    """R1: wobble and film drift integrated in Python doubles (presets.advance / phase / spin)."""

    def test_phase_is_wrapped_double_precision_and_holds_when_speed_is_zero(self):
        comp = SyncComp()
        comp.par.Pause.val, comp.par.Time.val = True, 2.0
        speed = comp.par.Wobblespeed.val
        self.assertAlmostEqual(MODULE["phase"](comp, 0.6), 0.6 * speed * 2.0, 12)
        self.assertAlmostEqual(MODULE["phase"](comp, -0.3), (-0.3 * speed * 2.0) % 256.0, 12)
        comp = SyncComp()
        with Clock(30 * 24 * 3600 + 0.25) as clock:  # a month of uptime
            first = MODULE["phase"](comp, 0.4)
            self.assertTrue(0.0 <= first < 256.0)
            clock.step(1 / 60)
            moved = MODULE["phase"](comp, 0.4)
            self.assertAlmostEqual(wrapped_change(first, moved, 256.0), 0.4 * speed / 60, 9)
            comp.par.Wobblespeed.val = 0.0
            del builtins.absTime  # speed 0 must not even read the clock...
            self.assertEqual(MODULE["phase"](comp, 0.4), moved)  # ...and holds the ripples where they are

    def test_drift_stays_smooth_through_a_100_frame_morph_and_a_speed_drag_after_an_hour(self):
        # With uWobble.w = absTime.seconds (6a58487) one morph frame moved the noise by
        # rate x change in speed x uptime; now each frame moves by rate x speed x frame time.
        for rate in (0.6, 0.4, -0.3, 0.15):
            comp = SyncComp()
            MODULE["apply"](comp, "amber_honey")   # Wobble speed 0.15
            comp.par.Morphtarget.val = "aqua_jelly"  # 0.6
            dt = 1 / 60
            with Clock(3600.0) as clock:
                last = MODULE["phase"](comp, rate)
                frames = [("Morph", i / 100) for i in range(1, 101)]
                frames += [("Wobblespeed", 0.15 + 0.28 * i) for i in range(1, 11)]
                for name, value in frames:
                    getattr(comp.par, name).val = value
                    clock.step(dt)
                    speed = MODULE["u"](comp.par.Wobblespeed)
                    now = MODULE["phase"](comp, rate)
                    self.assertTrue(0.0 <= now < 256.0)
                    change = wrapped_change(last, now, 256.0)
                    self.assertLessEqual(abs(change), abs(rate) * speed * dt + 1e-9, (rate, name, value))
                    last = now

    def test_drift_is_the_same_within_a_frame_and_resumes_without_a_jump(self):
        comp = SyncComp()
        speed = comp.par.Wobblespeed.val
        with Clock(7200.0) as clock:
            a = MODULE["phase"](comp, 0.6)
            self.assertEqual(MODULE["phase"](comp, 0.6), a)
            comp.par.Pause.val, comp.par.Time.val = True, 2.0
            paused = MODULE["phase"](comp, 0.6)
            self.assertAlmostEqual(paused, 0.6 * speed * 2.0, 12)
            clock.step(5.0)
            comp.par.Pause.val = False
            self.assertEqual(MODULE["phase"](comp, 0.6), paused)
            clock.step(0.5)
            self.assertAlmostEqual(MODULE["phase"](comp, 0.6), paused + 0.6 * speed * 0.5, 9)

    def test_demo_spin_is_integrated(self):
        comp = SyncComp()
        comp.par.Pause.val, comp.par.Time.val = True, 2.0
        self.assertAlmostEqual(MODULE["spin"](comp), comp.par.Demospin.val * 2.0, 12)
        comp = SyncComp()
        with Clock(3600.0) as clock:
            last = MODULE["spin"](comp)
            for degrees_per_second in (12.0, 30.0, -45.0, 90.0):
                comp.par.Demospin.val = degrees_per_second
                clock.step(1 / 60)
                now = MODULE["spin"](comp)
                self.assertAlmostEqual(wrapped_change(last, now, 360.0), degrees_per_second / 60, 9)
                last = now

    def test_no_node_expression_reads_absolute_time(self):
        self.assertNotIn("absTime", json.dumps(SPEC["nodes"]))
        self.assertEqual(NODES["demo_geo"]["expressions"]["ry"], "op('presets').module.spin(parent())")
        phase = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uPhase")["values"]
        self.assertEqual(phase, [f"op('presets').module.phase(parent(), {r})" for r in (0.6, 0.4, -0.3, 0.15)])

    def test_shader_drifts_by_uphase_on_a_lattice_that_repeats_every_256(self):
        code = code_only(FRAG)
        self.assertIn("uvec3 q = uvec3(c & 255);", code)
        self.assertNotIn("uWobble.w", code)
        self.assertIn("valueNoise(p + vec3(0.0, uPhase.x, 0.0))", code)
        self.assertIn("valueNoise(2.03 * p + vec3(uPhase.y, 0.0, uPhase.z))", code)
        # V1 added "* worldScale()" to the film frequency; the drift by uPhase.w is unchanged.
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0))", code)


class SyncR3R4R9Recipe(unittest.TestCase):
    """R3 constant-mode Inputs and grouped warnings, R4 reset contract, R9 menus, samplers, inspect."""

    def setUp(self):
        self.native = load_native()

    def test_r3_refraction_top_is_a_constant_setup_field_linked_to_the_demo(self):
        c = CONTROLS["Refractiontop"]
        self.assertNotIn("expression", c)
        self.assertEqual((c["demo_target"], c.get("setup"), c.get("default")), ("demo_scene", True, None))
        builder = (STUDY / "builder.py").read_text()
        self.assertIn("def link_demo_inputs(", builder)
        self.assertIn("par.default = path", builder)

    def test_r3_build_warnings_are_grouped_by_category(self):
        comp = BuilderSmoke().build(unavailable=("environmentlightCOMP",))
        warnings = comp.stored["build_warnings"]
        self.assertTrue(warnings)
        for w in warnings:
            self.assertRegex(w, r"^(material|inputs|dither|setup|demo): ", w)

    def test_r3_inputs_field_is_constant_and_resets_to_the_demo(self):
        comp = BuilderSmoke().build()
        par = comp.par.Refractiontop
        self.assertEqual((par.val, par.default, par.expr), ("demo_scene", "demo_scene", None))

    def test_r4_order_does_not_matter(self):
        ids = [e["id"] for e in EXPERIMENTS]
        for first, second in itertools.product(ids, ids):
            comp = scene_comp()
            expected = expected_after(second, comp)
            self.native["apply"](comp, first)
            comp.par.Keydirx.val = 0.9  # a user edit between experiments
            self.native["apply"](comp, second)
            self.assertEqual(comp.state(), expected, (first, second))
            alone = scene_comp()  # the same experiment on a fresh component
            self.native["apply"](alone, second)
            self.assertEqual(comp.state(), alone.state(), (first, second))

    def test_r4_scene_setup_survives_every_experiment(self):
        for item in EXPERIMENTS:
            comp = scene_comp()
            self.native["apply"](comp, item["id"])
            self.assertEqual(SCENE, {k: comp.state()[k] for k in SCENE}, item["id"])

    def test_r4_reset_controls_are_the_documented_ones(self):
        # README > Controls and the tutorial name these, besides the preset values.
        reset = set(self.native["look_defaults"](SPEC)) - set(SPEC["preset_keys"])
        self.assertEqual(reset, {
            "Morphtarget", "Morph", "Samples", "Conserve",
            "Lightsource", "Envsource", "Envintensity", "Envmips", "Shadowstrength",
            "Keydirx", "Keydiry", "Keydirz", "Keyintensity", "Keycolorr", "Keycolorg", "Keycolorb", "Studiorotate",
            "Pause", "Time", "Stage", "Demospin", "Demolights", "Demoenv", "Demoenvrotate", "Demooccluder",
            "Demodimmer", "Backdrop"})
        setup = {c["name"] for c in SPEC["controls"] if c.get("setup")}
        self.assertEqual(setup, {"Refractiontop", "Culling", "Objectsize", "Flipv", "Colourspace"})

    def test_r9_menu_uniforms_follow_the_evaluated_value(self):
        text = json.dumps(NODES["material"]["uniforms"])
        self.assertNotIn("menuIndex", text)
        for name in ("Stage", "Lightsource", "Envsource"):
            self.assertIn(f"op('presets').module.menu(parent().par.{name})", text)
        comp = SyncComp()
        comp.par.Stage.val = "sources"
        self.assertEqual(MODULE["menu"](comp.par.Stage), CONTROLS["Stage"]["names"].index("sources"))

    def test_r9_sampler_extend_modes_are_set(self):
        sampler = next(u for u in NODES["material"]["uniforms"] if u.get("kind") == "sampler")
        self.assertEqual((sampler["filter"], sampler["extendu"], sampler["extendv"]), ("mipmaplinear", "mirror", "mirror"))

    def test_r9_inspect_reports_script_and_blocking_errors(self):
        report = self.native["inspect"](NativeComp([]))
        self.assertIn("script_errors", report)
        self.assertEqual(report["blocking_errors"], {})
        self.assertIn("inputs", report)


class SyncR5R6R8Shader(unittest.TestCase):
    """R5 shader hygiene, R6 R2 frost disc, R8 colour parameters and Energy conserving."""

    def test_r5_derivatives_first_with_a_relative_threshold(self):
        main = code_only(MAIN)
        self.assertLess(main.index("vec3 dPdx = dFdx(vWorldPos);"), main.index("TDCheckDiscard();"))
        # Every derivative is taken in main() before TDCheckDiscard(), in uniform control flow, and
        # none anywhere else: the faceted normal's two and, since the family gap round, the screen
        # orientation's four (ndc and 1/w, for the centre-line tie-break).
        derivative = r"\b(dFdx|dFdy|fwidth)\s*\("
        calls = [m.start() for m in re.finditer(derivative, main)]
        self.assertEqual(len(calls), 6)
        self.assertTrue(all(c < main.index("TDCheckDiscard();") for c in calls))
        self.assertEqual(len(re.findall(derivative, code_only(FRAG))), 6)
        body = functions(FRAG)["facingNormal"]
        self.assertIn("l2 > 1e-12 * dot(dPdx, dPdx) * dot(dPdy, dPdy)", body)
        self.assertNotIn("dFd", body)

    def test_r5_zero_normal_decided_before_TDDeformNorm(self):
        self.assertIn("vWorldNormal = dot(objNormal, objNormal) > 1e-12 ? TDDeformNorm(objNormal) : vec3(0.0);", VERT)

    def test_r5_normal_faces_the_camera_after_the_wobble(self):
        self.assertIn("vec3 n = faceCamera(wobbleNormal(facingNormal(eye, dPdx, dPdy)), eye);", MAIN)

    def test_r5_wobble_independent_of_comp_scale(self):
        # V1 moved the cube root into worldScale(), shared with the film; same maths.
        self.assertIn("pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0)", functions(FRAG)["worldScale"])
        body = functions(FRAG)["wobbleNormal"]
        self.assertIn("float scale = worldScale();", body)
        self.assertIn("worldForNormals * slope * scale", body)

    def test_v1_patterns_follow_object_size_in_the_world(self):
        # Object size is a world size (fit_glass() counts the Geometry COMP's scale), so the
        # ripple and film frequencies are multiplied by the same world scale as the lengths.
        self.assertIn("vec3 p = vObjPos * uWobble.y * scale;", functions(FRAG)["wobbleNormal"])
        self.assertIn("vObjPos * uFilm.w * worldScale()", functions(FRAG)["filmThickness"])
        self.assertEqual(code_only(FRAG).count("vObjPos *"), 2)  # no other object-space pattern
        native = (STUDY / "native.py").read_text()
        self.assertIn("abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)", native)  # the shader's cube root
        self.assertIn('"radius": half * scale', native)

    def test_r5_no_atan_of_zero_and_guarded_vectors(self):
        for name in ("liquid_glass_lit.frag", "envmap.frag"):
            code = code_only(SHADERS[name])
            for args in call_arguments(code, r"\batan"):
                self.assertEqual(args, "d.z, d.x", name)
            self.assertIn("dot(d.xz, d.xz) > 1e-12 ? atan(d.z, d.x) : 0.0", code, name)

    def test_r5_sample_ior_at_least_1_and_f0_squared(self):
        code = code_only(FRAG)
        self.assertIn("float ior = max(uOptics.x + spread * (w - 0.5), 1.0);", code)
        self.assertIn("mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x)", code)
        self.assertNotIn("pow((uOptics.x - 1.0)", code)

    def test_r6_frost_uses_the_r2_disc(self):
        body = functions(FRAG)["discPoint"]
        self.assertIn("vec2(0.7548776662, 0.5698402910)", body)
        self.assertIn("offset += discPoint(i) * uBody.y * 0.25 * toUV;", code_only(FRAG))
        self.assertNotIn("0.618034", code_only(FRAG))

    def test_r6_frost_disc_stays_centred(self):
        # discPoint() evaluated in Python with the shader's own constants: the centre of mass of
        # the N frost samples is the image shift Frost causes. For 8 to 32 samples the 6a58487
        # golden spiral sat 0.089 to 0.155 disc radii off centre; R2 stays within 0.064.
        body = functions(FRAG)["discPoint"]
        step = [float(x) for x in re.search(r"vec2\(([\d.]+), ([\d.]+)\)", body).groups()]
        import math
        for n in range(8, 33):
            xs, ys = [], []
            for i in range(n):
                fx, fy = (0.5 + i * step[0]) % 1.0, (0.5 + i * step[1]) % 1.0
                xs.append(math.cos(2 * math.pi * fx) * math.sqrt(fy))
                ys.append(math.sin(2 * math.pi * fx) * math.sqrt(fy))
            self.assertLess(math.hypot(sum(xs) / n, sum(ys) / n), 0.07, n)

    def test_r8_colour_parameters_and_energy_conserving(self):
        c = CONTROLS["Colourspace"]
        self.assertEqual((c["names"], c["default"], c.get("setup")), (["auto", "raw", "srgb"], "auto", True))
        self.assertEqual((CONTROLS["Conserve"]["type"], CONTROLS["Conserve"]["default"]), ("toggle", False))
        options = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uOptions")["values"]
        self.assertEqual(options[:2], ["1 if parent().par.Conserve.eval() else 0",
                                       "op('presets').module.decode_colours(parent())"])
        code = code_only(FRAG)
        for colour in ("uGlass.rgb", "uReflect.rgb", "uRim.rgb", "uKeyColor.rgb"):
            self.assertIn(f"paramColour({colour})", code, colour)
        self.assertIn("float keep = 1.0 - uOptions.x * clamp(reflectance, 0.0, 1.0);", code)
        comp = SyncComp()
        self.assertEqual(MODULE["decode_colours"](comp), 0.0)  # auto outside TouchDesigner: pass-through
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


class SyncC(unittest.TestCase):
    """C1 to C9, the merge items shared across the family."""

    def setUp(self):
        self.native = load_native()

    def test_c1_transmitted_returns_the_scene_alpha_and_one_formula_composes(self):
        body = functions(FRAG)["transmitted"]
        self.assertIn("covered += seen.a;", body)
        self.assertIn("return vec4(sum / weightSum, covered / float(count));", body)
        main = code_only(MAIN)
        self.assertIn("float seeThrough = translucency * (1.0 - covered) * dot(tint, vec3(1.0 / 3.0));", main)
        self.assertIn("float alpha = 1.0 - seeThrough * keep;", main)
        self.assertNotIn("alpha = 1.0;\n    } else", main)  # no separate refracted branch

    def test_c2_vertex_shader_answers_picking(self):
        # Since family close G6 the documented form: '#ifndef TD_PICKING_ACTIVE ... #else
        # TDWritePickingValues(); #endif' (test_g6_pick_render_runs_only_the_documented_picking_block).
        vert = code_only(VERT)
        self.assertRegex(vert, r"\n#ifndef TD_PICKING_ACTIVE\n[\s\S]*\n#else\s+TDWritePickingValues\(\);\s+#endif\n")
        self.assertLess(vert.index("gl_Position = TDWorldToProj(world);"), vert.index("TDWritePickingValues();"))

    def test_c4_renders_switch_dither_off(self):
        renders = [n for n in SPEC["nodes"] if n["type"] in ("renderTOP", "renderpassTOP")]
        self.assertEqual(len(renders), 2)
        for n in renders:
            self.assertIs(n.get("lenient_parameters", {}).get("dither"), False, n["id"])
        builder = (STUDY / "builder.py").read_text()
        self.assertIn('"dither" if name == "dither" else category', builder)

    def test_c4_shaders_never_dither(self):
        # Per-pixel noise needs a per-pixel seed: gl_FragCoord is read only to find where the
        # pixel is (screenUV, screenSign), never fed to a hash; TDDither is never called.
        for name, source in SHADERS.items():
            code = code_only(source)
            self.assertNotIn("TDDither", code, name)
            self.assertIsNone(re.search(r"\b(dither|random|blueNoise|interleavedGradient)", code, re.I), name)
        readers = {f for f, body in functions(code_only(FRAG)).items() if "gl_FragCoord" in body}
        self.assertEqual(readers, {"screenUV", "screenSign"})
        self.assertIsNone(re.search(r"fract\s*\(\s*sin", code_only(FRAG)))
        callers = {f for f, body in functions(FRAG).items() if "latticeHash(" in body}
        self.assertEqual(callers, {"valueNoise"})
        for name in ("backdrop.frag", "envmap.frag", "card.frag"):
            code = code_only(SHADERS[name])
            self.assertNotIn("gl_FragCoord", code, name)
            for args in re.findall(r"(?<!float )\bhash\w*\((vec2\([^;]*?\))\)", code):
                words = set(re.findall(r"[A-Za-z_]\w*", args)) - {"vec2", "float"}
                self.assertLessEqual(words, {"row", "slot", "index"}, (name, args))

    def test_c4_readme_tells_users_to_switch_dither_off(self):
        steps = (STUDY / "README.md").read_text().split("## Use it in your own lit scene")[1].split("\n## ")[0]
        self.assertRegex(steps, r"\*\*Dither\*\*")
        # V2: a render only dithers a shader that calls TDDither (Write a GLSL MAT, "Dithering"),
        # so the reason to switch it off is the built-in materials bent through the glass.
        self.assertIn("never calls TDDither", steps)
        self.assertIn("bent through the glass", steps)
        self.assertNotIn("would add noise on top", steps)

    def test_c5_normalize_never_sees_a_zero_vector(self):
        code = code_only(FRAG)
        args = call_arguments(code, r"(?<![A-Za-z])normalize")
        allowed = {
            "n - eye * (away + 0.01)",   # faceCamera: the part along eye is -0.01
            "n",                         # facingNormal: inside dot(n, n) > 1e-8
            "n - amount * 0.35 * slope", # wobbleNormal: unit n plus a perpendicular tilt
            "cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R)",  # axis never parallel to R
            "R + (t * cos(a) + b * sin(a)) * r",  # unit R plus a perpendicular offset
        }
        self.assertEqual(set(args), allowed)
        for name in ("eye", "forward"):
            self.assertRegex(code, rf"vec3 {name} = [^;]*safeNormalize\(", name)

    def test_c5_render_diagnostics_reports_the_renders_that_draw_the_glass(self):
        material = object()

        def node(path, overridemat=None, geometry=(), errors="", warnings=""):
            par = SimpleNamespace(overridemat=SimpleNamespace(eval=lambda: overridemat),
                                  geometry=SimpleNamespace(evalOPs=lambda: list(geometry)))
            return SimpleNamespace(path=path, name=path.rsplit("/", 1)[1], par=par,
                                   errors=lambda: errors, warnings=lambda: warnings)
        comp = SimpleNamespace(path="/project1/liquid_glass_lit", op=lambda name: material)
        glass_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: material)))
        other_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: None)))
        renders = [
            node("/project1/liquid_glass_lit/render", geometry=[glass_geo], warnings="demo warning"),
            node("/project1/glass_pass", geometry=[other_geo, glass_geo], errors="compile error"),
            node("/project1/override_pass", overridemat=material),
            node("/project1/scene_render", geometry=[other_geo]),  # the scene without the glass
        ]
        report = self.native["render_diagnostics"](comp, renders)
        self.assertEqual(sorted(report), ["/project1/glass_pass", "/project1/override_pass", "render"])
        self.assertEqual(report["/project1/glass_pass"], {"errors": "compile error", "warnings": ""})

    def test_c6_offsets_follow_the_measured_screen_orientation(self):
        sign = functions(code_only(FRAG))["screenSign"]
        self.assertNotRegex(sign, r"dFd[xy]")
        self.assertIn("gl_FragCoord", sign)
        self.assertIn("if (uState.z > 0.5) orient.y = -orient.y;", sign)
        self.assertIn("vec2 orient = screenSign(ndc, ndcStep, depthStep, proj);", MAIN)
        self.assertIn("vec2 toUV = unitsToUV(proj, depth) * orient;", MAIN)
        main = code_only(MAIN)
        self.assertLess(main.index("vec2 orient"), main.index("if (hasRefraction)"))

    def test_c6_centre_line_ties_use_the_guarded_derivative(self):
        # Family gap round: on the centre line of an odd-sized render the projected and the raster
        # position are both 0. There the sign of the projected position's screen derivative decides,
        # only where 1/w changes by less than 10% to the next pixel (the Liquid Glass Prism form).
        sign = functions(code_only(FRAG))["screenSign"]
        self.assertIn("vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));", sign)
        self.assertIn("runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);", sign)
        self.assertLess(sign.index("runs = mix("), sign.index("vec2 orient = runs *"))
        main = code_only(MAIN)
        self.assertIn("vec2 ndc = clip.xy / clip.w;", main)
        self.assertIn("vec4 clip = proj * vec4(camPoint, 1.0);", main)
        self.assertIn("vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));", main)
        self.assertIn("vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);", main)
        self.assertLess(main.index("vec2 depthStep"), main.index("TDCheckDiscard();"))

    def test_c7_fog_on_the_premultiplied_output(self):
        main = code_only(MAIN)
        self.assertIn("vec3 fogAdded = TDFog(vec4(0.0, 0.0, 0.0, 1.0), vWorldPos, vCamIndex).rgb;", main)
        self.assertIn("colour = TDFog(vec4(colour, 1.0), vWorldPos, vCamIndex).rgb - fogAdded * (1.0 - alpha);", main)
        self.assertLess(main.index("alpha *= uBody.z;"), main.index("vec3 fogAdded"))
        self.assertEqual(main.count("TDFog("), 2)

    def test_c7_native_fog_check_matches_the_demo(self):
        # V3: the demo backdrop card is a GLSL MAT that never calls TDFog, so the demo scene
        # render stays unfogged; the native check must judge the glass by its formula instead.
        self.assertNotIn("TDFog", code_only(SHADERS["card.frag"]))
        fog = [h for h in json.loads((STUDY / "validation.json").read_text())["native_family_sync"]["how"]
               if h.startswith("Fog:")]
        self.assertEqual(len(fog), 1)
        self.assertNotIn("like the backdrop card", fog[0])
        self.assertIn("fog colour x alpha", fog[0])
        self.assertIn("unfogged", fog[0])

    def test_c8_object_size_is_setup_and_never_reset(self):
        size = CONTROLS["Objectsize"]
        self.assertEqual((size.get("setup"), size["default"]), (True, 1.0))
        self.assertGreater(size["min"], 0.0)
        self.assertNotIn("Objectsize", SPEC["preset_keys"])
        for item in EXPERIMENTS:
            comp = scene_comp()
            self.native["apply"](comp, item["id"])
            MODULE["apply"](comp, "aqua_jelly")
            self.assertEqual(comp.par.Objectsize.val, 7.5, item["id"])

    def test_c8_object_size_scales_the_lengths_and_is_exact_at_1(self):
        def evaluate(spec, comp, name, count=4):
            node = next(n for n in spec["nodes"] if n["id"] == "material")
            values = next(u for u in node["uniforms"] if u["name"] == name)["values"][:count]
            env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=MODULE["u"])), "parent": lambda: comp}
            return [v if not isinstance(v, str) else eval(v, env) for v in values]  # noqa: S307 (study.json)

        for preset in PRESETS["order"]:
            comp = SyncComp()
            MODULE["apply"](comp, preset)
            for name in ("uGlass", "uBody", "uOptics"):  # Object size 1: the same numbers as at 6a58487
                self.assertEqual(evaluate(SPEC, comp, name), evaluate(REFERENCE_SPEC, comp, name), (preset, name))
            # uWobble.w was absTime.seconds at 6a58487; it is unused now (uPhase carries the drift).
            self.assertEqual(evaluate(SPEC, comp, "uWobble", 3), evaluate(REFERENCE_SPEC, comp, "uWobble", 3))
            self.assertEqual(evaluate(SPEC, comp, "uFilm")[3], 2.5)  # was the constant 2.5 in the shader
            comp.par.Objectsize.val = 10.0
            values = PRESETS["presets"][preset]["values"]
            self.assertAlmostEqual(evaluate(SPEC, comp, "uOptics")[1], values["Thickness"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uBody")[1], values["Frost"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uGlass")[3], values["Density"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uWobble")[1], values["Wobblescale"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uFilm")[3], 0.25, 12)

    def test_c8_fit_finds_the_glass_objects_and_sets_object_size(self):
        material = object()

        def bounds(x, y, z):
            return SimpleNamespace(size=SimpleNamespace(x=x, y=y, z=z))

        def geo(path, material_value, children=(), det=1.0, own_bounds=None):
            return SimpleNamespace(path=path, children=list(children),
                                   par=SimpleNamespace(material=SimpleNamespace(eval=lambda: material_value)),
                                   bounds=lambda render: own_bounds, worldTransform=SimpleNamespace(determinant=lambda: det))
        sop = SimpleNamespace(isSOP=True, render=True, path="/project1/geo1/sphere1", bounds=lambda: bounds(2.0, 1.0, 0.5))
        hidden = SimpleNamespace(isSOP=True, render=False, path="/project1/geo1/box1", bounds=lambda: bounds(50, 50, 50))
        torus = next(n for n in SPEC["nodes"] if n["id"] == "demo_geo/torus")["parameters"]
        demo = torus["radx"] + torus["rady"]
        demo_sop = SimpleNamespace(isSOP=True, render=True, path="/project1/liquid_glass_lit/demo_geo/torus",
                                   bounds=lambda: bounds(2 * demo, 2 * demo, 2 * torus["rady"]))
        geo1 = geo("/project1/geo1", material, [hidden, sop], det=27.0)        # scaled 3 by the COMP
        geo2 = geo("/project1/geo2", None, own_bounds=bounds(9, 9, 9))         # wears another material
        geo3 = geo("/project1/geo3", None, own_bounds=bounds(0.2, 0.4, 0.1))   # drawn by an Override Material pass
        demo_geo = geo("/project1/liquid_glass_lit/demo_geo", material, [demo_sop])
        override = SimpleNamespace(par=SimpleNamespace(overridemat=SimpleNamespace(eval=lambda: material),
                                                       geometry=SimpleNamespace(evalOPs=lambda: [geo3])))
        comp = scene_comp()
        comp.path = "/project1/liquid_glass_lit"
        comp._ops["material"] = material
        found = self.native["glass_objects"](comp, geometry=[geo1, geo2, demo_geo], renders=[override])
        self.assertEqual([g.path for g in found], ["/project1/geo1", "/project1/geo3"])  # the demo only counts alone
        report = self.native["fit_glass"](comp, found)
        self.assertAlmostEqual(comp.par.Objectsize.val, 3.0 / demo, 12)  # half of 2.0, times 3
        self.assertEqual([m["source"] for m in report["measured"]],
                         ["/project1/geo1/sphere1", "/project1/geo3 (Geometry COMP bounds)"])
        alone = self.native["glass_objects"](comp, geometry=[demo_geo, geo2], renders=[])
        self.assertEqual(self.native["fit_glass"](comp, alone)["object_size"], 1.0)  # the demo fits to exactly 1
        with self.assertRaises(ValueError):
            self.native["fit_glass"](comp, [])
        calls = []
        callbacks = runpy.run_path(str(STUDY / "preset_exec.py"), init_globals={"op": lambda name: SimpleNamespace(
            module=SimpleNamespace(fit_glass=lambda c: calls.append(c) or {}, apply=MODULE["apply"]))})
        callbacks["onPulse"](SimpleNamespace(name="Fitglass", owner=comp))
        self.assertEqual(calls, [comp])
        self.assertIn("Fitglass", NODES["preset_exec"]["parameters"]["pars"])

    def test_c9_backdrop_menu_reaches_the_demo_backdrop(self):
        menu = CONTROLS["Backdrop"]
        self.assertEqual((menu["type"], menu["page"], menu["default"], menu["names"]),
                         ("menu", "Study", "checker", ["checker", "type"]))
        self.assertFalse(menu.get("setup"))  # experiments reset it: their predictions describe the checker
        self.assertEqual(NODES["demo_backdrop"]["uniforms"],
                         [{"name": "uBackdrop", "values": ["op('presets').module.menu(parent().par.Backdrop)", 0, 0, 0]}])
        code = code_only(SHADERS["backdrop.frag"])
        self.assertIn("uniform vec4 uBackdrop;", code)
        self.assertIn("if (uBackdrop.x > 0.5) {", code)
        for args in call_arguments(code, r"\bsmoothstep"):
            self.assertTrue(args.startswith("-px, px,"), args)
        self.assertIn("type_backdrop", [e["id"] for e in EXPERIMENTS])


class FamilyObjectSizeRule(unittest.TestCase):
    """Family gap after the verifier fixes: Object size meant three things across
    the family (core and Prism: world size with object-space patterns, Prism with
    reference radius 1.265; Flow: SOP units). The family rule is this study's,
    recorded once in decisions.json (family_rule). These tests pin lit to it, so
    the member the others port from cannot drift away from the record."""

    @classmethod
    def setUpClass(cls):
        cls.native = load_native()
        decisions = json.loads((STUDY / "decisions.json").read_text())
        rules = [d["family_rule"] for d in decisions if "family_rule" in d]
        cls.rule = rules[0] if len(rules) == 1 else None

    def setUp(self):
        self.assertIsNotNone(self.rule, "decisions.json must record exactly one family_rule")

    def test_rule_matches_the_demo_the_uniforms_and_the_shader(self):
        self.assertEqual((self.rule["name"], self.rule["reference_radius"]), ("Object size", 1.45))
        torus = NODES["demo_geo/torus"]["parameters"]
        self.assertEqual((torus["radx"], torus["rady"], torus["orient"]), (1.0, 0.45, "z"))
        self.assertAlmostEqual(self.native["demo_radius"](SPEC), self.rule["reference_radius"], 12)
        demo_transform = NODES["demo_geo"].get("parameters", {})
        self.assertEqual({k: v for k, v in demo_transform.items() if k in ("sx", "sy", "sz", "scale") and v != 1}, {})
        expressions = json.dumps(NODES["material"]["uniforms"])
        for name in self.rule["lengths_times_object_size"]:
            self.assertIn(f"u(parent().par.{name}) * parent().par.Objectsize.eval()", expressions, name)
        for name in self.rule["per_length_divided_by_object_size"]:
            self.assertIn(f"u(parent().par.{name}) / parent().par.Objectsize.eval()", expressions, name)
        self.assertIn(f"{self.rule['film_swirls_per_object_size']} / parent().par.Objectsize.eval()", expressions)
        self.assertIn(self.rule["world_scale_glsl"], functions(FRAG)["worldScale"])
        self.assertIn(self.rule["world_scale_python"], NATIVE_TEXT)

    def test_fit_carries_every_preset_over_a_comp_scale(self):
        """The demo torus scaled by its Geometry COMP: after Fit to Glass geometry,
        every world length and pattern period of every preset is the unscaled
        demo's times the scale. Fit runs for real (native.py on a fake td); the
        uniforms are study.json's expressions; the pattern lookups are read from
        the shader (a lookup without worldScale() leaves the period in object space)."""
        torus = NODES["demo_geo/torus"]["parameters"]
        half = torus["radx"] + torus["rady"]
        size = SimpleNamespace(x=2 * half, y=2 * half, z=2 * torus["rady"])
        sop = SimpleNamespace(isSOP=True, render=True, path="/project1/glass/torus",
                              bounds=lambda: SimpleNamespace(size=size))
        ripple_body, film_body = functions(FRAG)["wobbleNormal"], functions(FRAG)["filmThickness"]
        ripple = re.search(r"vec3 p = vObjPos \* uWobble\.y([^;]*);", ripple_body).group(1)
        film = re.search(r"valueNoise\(vObjPos \* uFilm\.w([^+]*)\+", film_body).group(1).strip()
        self.assertIn(ripple, ("", " * scale"))
        self.assertIn(film, ("", "* worldScale()"))
        ripple_in_world = ripple == " * scale" and "float scale = worldScale();" in ripple_body
        film_in_world = film == "* worldScale()"
        material = NODES["material"]["uniforms"]

        def uniform(comp, name, index):
            value = next(u for u in material if u["name"] == name)["values"][index]
            env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=MODULE["u"])), "parent": lambda: comp}
            return eval(value, env) if isinstance(value, str) else value  # noqa: S307 (study.json)

        def fitted(diagonal):
            det = diagonal[0] * diagonal[1] * diagonal[2]
            geo = SimpleNamespace(path="/project1/glass", children=[sop],
                                  worldTransform=SimpleNamespace(determinant=lambda: det))
            comp = SyncComp()
            self.native["fit_glass"](comp, [geo])
            k = abs(det) ** (1.0 / 3.0)  # worldScale() for this world matrix
            looks = {}
            for preset in PRESETS["order"]:
                MODULE["apply"](comp, preset)
                wobble, swirl, density = uniform(comp, "uWobble", 1), uniform(comp, "uFilm", 3), uniform(comp, "uGlass", 3)
                looks[preset] = {
                    "thickness": uniform(comp, "uOptics", 1), "frost": uniform(comp, "uBody", 1),
                    "tint_length": 1.0 / density if density > 0 else None,
                    # one noise cell in the lookup = k / (frequency x multiplier) scene units
                    "ripple_period": k / (wobble * (k if ripple_in_world else 1.0)),
                    "film_period": k / (swirl * (k if film_in_world else 1.0)),
                }
            return comp.par.Objectsize.val, looks

        size_1, base = fitted((1.0, 1.0, 1.0))
        self.assertEqual(size_1, 1.0)
        report = {}
        for diagonal, s in (((0.1,) * 3, 0.1), ((3.0,) * 3, 3.0), ((10.0,) * 3, 10.0), ((8.0, 1.0, 1.0), 2.0)):
            object_size, looks = fitted(diagonal)
            self.assertAlmostEqual(object_size / s, 1.0, 12, diagonal)
            for preset, values in looks.items():
                for key, value in values.items():
                    expected = None if value is None else base[preset][key] * s  # Frost 0 stays 0
                    if value is not None and abs(value - expected) > 1e-9 * max(abs(expected), 1e-12):
                        report[(diagonal, preset, key)] = round(value / expected, 4) if expected else value
        self.assertEqual(report, {}, "world length or period over (demo's x scale), where not 1")


class DocumentedCounts(unittest.TestCase):
    """Family gap (verifier, low): review.md's checks table still said 34 of 34
    preview and 70 of 70 unit tests after both suites had grown, and its note on
    the saved red runs kept an older count after the file was made again. These
    tests read every current count the docs state from the suites themselves or
    from the result file the docs cite, so a new test without a doc update fails."""

    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls.review = (STUDY / "review.md").read_text()
        cls.readme = (STUDY / "README.md").read_text()
        cls.validation = json.loads((STUDY / "validation.json").read_text())
        cls.results = STUDY / "checks" / "results"

    def review_line(self, start):
        lines = [line for line in self.review.splitlines() if line.startswith(start)]
        self.assertEqual(len(lines), 1, f"review.md needs exactly one line starting {start!r}")
        return lines[0]

    def test_docs_state_the_suite_sizes(self):
        unit = str(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]).countTestCases())
        source = (STUDY / "checks" / "preview_tests.cjs").read_text()
        names = re.findall(r"\bcheck\('([A-Za-z0-9_]+)'", source)
        helper = re.findall(r"\bcheck\(name,", source)  # guard() reports a throwing test under its own name
        self.assertEqual(len(re.findall(r"\bcheck\(", source)), len(names) + len(helper), "a preview check without a literal name")
        self.assertEqual(len(set(names)), len(names), "two preview checks share a name")
        self.assertLessEqual(set(re.findall(r"\bguard\('([A-Za-z0-9_]+)'", source)), set(names), "a guard() name with no check")
        preview = str(len(names))
        compiled = json.loads((self.results / "compile.json").read_text())  # run_all.sh writes it first
        passed, compiles = str(compiled["passed"]), str(compiled["compiles"])
        negatives = compiled["negative_tests"]
        neg_ok, neg = str(sum(1 for n in negatives if n["ok"])), str(len(negatives))
        stated = {
            "review.md compile row": re.findall(r"Passed: (\d+) of (\d+) .*; (\d+) of (\d+) negative tests",
                                                self.review_line("| GLSL 4.60 compile")),
            "review.md preview row": re.findall(r"Passed, (\d+) of (\d+)", self.review_line("| Shader properties")),
            "review.md unit row": re.findall(r"Passed, (\d+) of (\d+)", self.review_line("| Unit tests")),
            "README compiles": re.findall(r"\((\d+) compiles, and (\d+) negative tests", self.readme),
            "README preview": re.findall(r"passes (\d+) property tests", self.readme),
            "README unit": re.findall(r"(\d+) unit tests cover", self.readme),
            "validation.json compile": re.findall(r": (\d+) of (\d+)\.", self.validation["glsl_compile_standins"]["scope"]),
            "validation.json preview": re.findall(r"^(\d+) property tests", self.validation["shader_properties_preview"]["scope"]),
            "validation.json unit": re.findall(r"^(\d+) tests:", self.validation["unit_tests"]["scope"]),
        }
        expected = {
            "review.md compile row": [(passed, compiles, neg_ok, neg)],
            "review.md preview row": [(preview, preview)],
            "review.md unit row": [(unit, unit)],
            "README compiles": [(compiles, neg)],
            "README preview": [preview],
            "README unit": [unit],
            "validation.json compile": [(passed, compiles)],
            "validation.json preview": [preview],
            "validation.json unit": [unit],
        }
        self.assertEqual(stated, expected)

    def test_docs_describe_the_saved_red_runs(self):
        text = (self.results / "unit-tests-6a58487.txt").read_text()
        ran = re.search(r"^Ran (\d+) tests? in", text, re.M).group(1)
        outcome = re.search(r"^FAILED \(([^)]*)\)", text, re.M)
        failed = str(sum(int(n) for n in re.findall(r"(?:failures|errors)=(\d+)", outcome.group(1) if outcome else "")))
        preview = json.loads((self.results / "preview-tests-6a58487.json").read_text())
        self.assertEqual(preview["passed"], sum(1 for r in preview["results"] if r["ok"]))
        preview_failed, preview_total = preview["total"] - preview["passed"], preview["total"]
        stated = {
            "review.md saved red runs": re.findall(r"(\d+) of (\d+) (?:unit tests )?fail", self.review_line("- **Saved red runs:**")),
            "validation.json unit": re.findall(r"Run on the 6a58487 files: (\d+) of (\d+) fail",
                                               self.validation["unit_tests"]["scope"]),
        }
        self.assertEqual(stated, {"review.md saved red runs": [(failed, ran)], "validation.json unit": [(failed, ran)]})
        new_and_earlier = re.findall(r"(\d+) of the (\d+) new tests fail there.*All (\d+) earlier tests pass on both",
                                     self.review_line("- **Preview:**"))
        self.assertEqual(len(new_and_earlier), 1, "review.md Preview red-run note")
        fail_new, new, earlier = map(int, new_and_earlier[0])
        self.assertEqual((fail_new, new + earlier), (preview_failed, preview_total), "review.md Preview red-run note")
        self.assertEqual(re.findall(r"6a58487 material, (\d+) of these (\d+) fail",
                                    self.validation["shader_properties_preview"]["scope"]), [(str(fail_new), str(new))])


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
        self.assertIn(c["name"], load_native()["look_defaults"](SPEC))  # experiments reset it: their captures use the default

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
CORE_REFERENCE = STUDY / "checks" / "core_reference"  # the core's files at its family close
CORE_STUDY = STUDY.parent / "liquid-glass"            # the core itself, when it sits next to this study


def core_copies():
    """[(label, folder)]: the pinned copies always, and the core study when it is next to this one."""
    copies = [("checks/core_reference", CORE_REFERENCE)]
    if (CORE_STUDY / "liquid_glass.frag").is_file():
        copies.append(("../liquid-glass", CORE_STUDY))
    return copies


def same_code(text):
    """GLSL without comments, whitespace collapsed: two texts are the same code when these match."""
    return " ".join(code_only(text).split())


def preprocessed(source, defined):
    """The lines a GLSL preprocessor keeps when the names in `defined` are
    #defined. Handles #ifdef, #ifndef, #else and #endif only; any other
    conditional fails the test instead of being guessed (from Liquid Glass
    Blobs, as in the core)."""
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


def setup_statements(main_body):
    """main()'s statements up to and including TDCheckDiscard(), comments removed."""
    head = code_only(main_body).split("TDCheckDiscard();", 1)[0]
    return [" ".join(s.split()) for s in head.split(";") if s.strip()] + ["TDCheckDiscard()"]


def family_rule():
    """decisions.json's one family_rule record."""
    rules = [d["family_rule"] for d in json.loads((STUDY / "decisions.json").read_text()) if "family_rule" in d]
    assert len(rules) == 1, "decisions.json must record exactly one family_rule"
    return rules[0]


def evaluate(expression, comp):
    """A study.json uniform value: a number, or its expression run with this study's u()
    (Morph 0 gives the parameter's own value) and `comp` as parent()."""
    if not isinstance(expression, str):
        return float(expression)
    env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=MODULE["u"])), "parent": lambda: comp}
    return float(eval(expression, env))  # noqa: S307 (study.json)


def lookup_factor(text, body, values, k, depth=0):
    """The product of the factors in `text` ('a * b * ...'). A factor is worldScale()
    (k), a uniform component in `values`, a number, or a local float that `body`
    defines from those. Any other factor fails the test instead of being guessed."""
    product = 1.0
    for token in (t.strip() for t in text.split("*")):
        if token == "worldScale()":
            product *= k
        elif token in values:
            product *= values[token]
        elif re.fullmatch(r"\d+(?:\.\d*)?", token):
            product *= float(token)
        else:
            local = re.search(rf"\bfloat {re.escape(token)} = ([^;]+);", body)
            assert local and depth < 4, f"lookup factor {token!r} is not worldScale(), a uniform or a number"
            product *= lookup_factor(local.group(1), body, values, k, depth + 1)
    return product


def lookup_period(body, position, values, k):
    """Scene units spanned by one noise cell of the lookup 'position * a * b ...' in a
    GLSL function body, on an object whose world matrix scales by k: an object-space
    cell is 1 / (a x b x ...) long, and the world matrix stretches it k times. k is the
    cube root of |det|, which worldScale() computes (FamilyObjectSizeRule pins its code)."""
    factor = r"(?:worldScale\(\)|[A-Za-z_]\w*(?:\.[xyzw])?|\d+(?:\.\d*)?)"
    match = re.search(rf"\b{position}((?:\s*\*\s*{factor})+)", body)
    assert match, f"no lookup of {position} in this function"
    return k / lookup_factor(match.group(1).strip().lstrip("*"), body, values, k)


def sections(markdown):
    """{heading: text} of every '## ' section."""
    parts = re.split(r"^## (.+)$", markdown, flags=re.M)
    return dict(zip(parts[1::2], parts[2::2]))


class FamilyClose(unittest.TestCase):
    """The family gaps after the two-way sync (c94e849), in this study's share:
    G6, the picking form Derivative documents; G2, the centre-line tie-break
    must be the core's; G1, Fit and the pattern lookups must give the core's
    Object size and pattern period on the same scaled object. Each compares
    with the core's files (checks/core_reference, and ../liquid-glass when it
    is there) and fails on c94e849 (review.md, Family close)."""

    maxDiff = None

    def test_g6_pick_render_runs_only_the_documented_picking_block(self):
        # Write a GLSL MAT, Picking: '#ifndef TD_PICKING_ACTIVE // All the typical shader code
        # #else TDWritePickingValues(); #endif'; while picking only the #else block runs.
        vert = code_only(VERT)
        self.assertNotIn("#ifdef TD_PICKING_ACTIVE", vert)
        pick = main_statements(preprocessed(vert, {"TD_PICKING_ACTIVE"}))
        self.assertEqual(pick, ["vec3 objPos = TDPos()", "vec4 world = TDDeform(objPos)",
                                "gl_Position = TDWorldToProj(world)", "TDWritePickingValues()"])
        ordinary = main_statements(preprocessed(vert, set()))
        self.assertEqual(ordinary, ["vec3 objPos = TDPos()", "vec4 world = TDDeform(objPos)",
                                    "gl_Position = TDWorldToProj(world)", "passToPixelStage(objPos, world)"])
        # The ordinary render still writes every output, in the helper it calls.
        outputs = re.findall(r"^\s*(?:flat\s+)?out\s+\w+\s+(\w+)\s*;", vert, re.M)
        self.assertEqual(sorted(outputs), ["vCamIndex", "vObjPos", "vWorldNormal", "vWorldPos"])
        helper = functions(vert)["passToPixelStage"]
        for name in outputs:
            self.assertRegex(helper, rf"\n\s*{name} = ", name)
        self.assertEqual(vert.count("passToPixelStage("), 2)  # its definition and the one call
        # The header and the docs say what a pick render runs: the placement, then the #else block.
        header = " ".join(VERT.split("\nout ", 1)[0].replace("//", " ").split())
        self.assertIn("while picking, the point is still placed, and of the branch only the #else block runs", header)
        self.assertNotIn("answers Render Pick DAT and", header)
        readme = (STUDY / "README.md").read_text()
        self.assertIn("pass the point is still placed, and of the branch only the `#else` block runs", readme)
        article = (STUDY / "article.source.md").read_text()
        section = article.split("## Use it in your own lit scene", 1)[1].split("\n## ", 1)[0]
        self.assertIn("of the branch only the `#else` block runs", section)
        self.assertIn("{{code:liquid_glass_lit.vert:picking}}", section)

    def test_g6_vertex_shader_is_the_cores(self):
        # The header says the vertex shader is the core's: the same code, line for line.
        header = " ".join(VERT.split("\nout ", 1)[0].replace("//", " ").split())
        self.assertIn("Same code as the core study's vertex shader", header)
        for label, core in core_copies():
            with self.subTest(label):
                self.assertEqual(same_code(VERT), same_code((core / "liquid_glass.vert").read_text()))

    def test_g2_screen_orientation_is_the_cores(self):
        # Lit's centre-line tie-break went to the core in its family close. The two must stay one
        # form: screenSign() differs only in the Flip V slot, and main() takes the same six
        # derivatives, in the same order, before TDCheckDiscard().
        mine_flip = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uState")["values"]
        self.assertIn("par.Flipv", mine_flip[2])  # uState.z here
        mine = functions(code_only(FRAG))
        for label, core in core_copies():
            with self.subTest(label):
                spec = json.loads((core / "study.json").read_text())
                core_material = next(n for n in spec["nodes"] if n["id"] == "material")["uniforms"]
                self.assertIn("par.Flipv", next(u for u in core_material if u["name"] == "uState")["values"][3])  # uState.w there
                theirs = functions(code_only((core / "liquid_glass.frag").read_text()))
                self.assertEqual(" ".join(mine["screenSign"].replace("uState.z", "uState.w").split()),
                                 " ".join(theirs["screenSign"].split()))
                self.assertEqual(" ".join(mine["screenUV"].replace("uState.z", "uState.w").split()),
                                 " ".join(theirs["screenUV"].split()))
                self.assertEqual(setup_statements(mine["main"]), setup_statements(theirs["main"]))
                call = "vec2 orient = screenSign(ndc, ndcStep, depthStep, proj);"
                self.assertIn(call, mine["main"])
                self.assertIn(call, theirs["main"])
        self.assertIn("check('screen_orientation_has_no_wrong_pixels'", (STUDY / "checks" / "preview_tests.cjs").read_text())

    def test_g1_fit_and_patterns_match_the_core(self):
        # The family rule: on the same object, scaled by its Geometry COMP, Fit gives the core's
        # Object size, and the uniforms and pattern lookups then give the core's lengths and
        # pattern periods. The object is the core's demo torus; both Fit functions run for real.
        # Each side's ripple and film periods are measured, not assumed (close verify LIT-CV2):
        # its own uWobble.y and uFilm.w expressions are evaluated at its own Fit, and its own
        # lookups are read from its shader by lookup_period(). The earlier form only matched
        # the lookup's text, so 'float scale = 1.0;' in both shaders still passed.
        mine = functions(code_only(FRAG))
        material = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        rule = {"uOptics": 1, "uBody": 1, "uGlass": 3, "uWobble": 1, "uFilm": 3}  # Thickness, Frost, Density, Wobble scale, film swirl
        swirls = family_rule()["film_swirls_per_object_size"]
        demo = (1.0,) * 3
        for label, core in core_copies():
            with self.subTest(label):
                spec = json.loads((core / "study.json").read_text())
                nodes = {n["id"]: n for n in spec["nodes"]}
                theirs = functions(code_only((core / "liquid_glass.frag").read_text()))
                for name in ("worldScale", "wobbleNormal", "filmThickness", "liquidField", "valueNoise", "latticeHash"):
                    self.assertIn(name, theirs, f"the core has no {name}()")
                    self.assertEqual(" ".join(mine[name].split()), " ".join(theirs[name].split()), name)
                for side in (mine, theirs):  # both lookups count in world-sized steps
                    self.assertIn("float scale = worldScale();", side["wobbleNormal"])
                    self.assertIn("vObjPos * uWobble.y * scale", side["wobbleNormal"])
                    self.assertIn("vObjPos * uFilm.w * worldScale()", side["filmThickness"])
                core_material = {u["name"]: u["values"] for u in nodes["material"]["uniforms"]}
                for name, index in rule.items():
                    self.assertEqual(material[name][index], core_material[name][index], name)
                core_native = load_native(core / "native.py")
                torus = nodes["demo_geo/torus"]["parameters"]
                half = float(torus["radx"]) + float(torus["rady"])
                size = SimpleNamespace(x=2 * half, y=2 * half, z=2 * float(torus["rady"]))
                sop = SimpleNamespace(isSOP=True, render=True, path="/project1/glass/torus",
                                      bounds=lambda: SimpleNamespace(size=size))
                periods = {}
                for diagonal in (demo, (0.1,) * 3, (3.0,) * 3, (10.0,) * 3, (8.0, 1.0, 1.0)):
                    det = diagonal[0] * diagonal[1] * diagonal[2]
                    geo = SimpleNamespace(path="/project1/glass", children=[sop],
                                          worldTransform=SimpleNamespace(determinant=lambda det=det: det))
                    here = SyncComp()
                    self.native["fit_glass"](here, [geo])
                    there = SimpleNamespace(par=SimpleNamespace(Objectsize=SimpleNamespace(val=None)),
                                            op=lambda name, text=json.dumps(spec): SimpleNamespace(text=text))
                    core_native["fit_glass"](there, geo)
                    self.assertEqual(here.par.Objectsize.val, there.par.Objectsize.val, diagonal)
                    k = abs(det) ** (1.0 / 3.0)
                    self.assertAlmostEqual(here.par.Objectsize.val, k, 12)  # the demo torus: Object size = scale
                    # The same typed Wobble scale on both; each side's Object size is its own Fit's.
                    core_comp = SimpleNamespace(par=SimpleNamespace(
                        Wobblescale=here.par.Wobblescale,
                        Objectsize=SimpleNamespace(eval=lambda there=there: there.par.Objectsize.val)))
                    for side, comp, uniforms, code in (("lit", here, material, mine), ("core", core_comp, core_material, theirs)):
                        values = {"uWobble.y": evaluate(uniforms["uWobble"][1], comp),
                                  "uFilm.w": evaluate(uniforms["uFilm"][3], comp)}
                        periods[side, diagonal] = (lookup_period(code["wobbleNormal"], "vObjPos", values, k),
                                                   lookup_period(code["filmThickness"], "vObjPos", values, k))
                    # The rule: one ripple cell spans Object size / Wobble scale scene units, one film
                    # cell Object size / 2.5; so k times the unscaled demo's, on both sides.
                    object_size = here.par.Objectsize.val
                    wanted = (object_size / here.par.Wobblescale.eval(), object_size / swirls)
                    for side in ("lit", "core"):
                        for name, got, want, unscaled in zip(("ripple", "film"), periods[side, diagonal], wanted, periods[side, demo]):
                            self.assertAlmostEqual(got / want, 1.0, 12, (label, side, name, diagonal))
                            self.assertAlmostEqual(got / (unscaled * k), 1.0, 12, (label, side, name, diagonal))

    def test_g1_readme_family_table_is_current(self):
        # The table said the core and Prism make the patterns s times larger and Prism and Flow
        # measure Object size their own way; in the family close all four mesh members follow
        # the rule (scratch family_fit.py: Fit 3.0 on the core's torus at COMP scale 3 in each).
        readme = (STUDY / "README.md").read_text()
        section = readme.split("### Object size across the family", 1)[1].split("\n## ", 1)[0]
        self.assertNotIn("Fit makes the ripples and film s times larger", section)
        self.assertNotIn("still measure it differently", section)
        self.assertIn("Liquid Glass Blobs", section)  # the member outside the table says why
        core = (CORE_REFERENCE / "liquid_glass.frag").read_text()
        self.assertIn("vec3 p = vObjPos * uWobble.y * scale;", core)  # what the table now states for the core

    def test_preprocessed_helper_follows_ifdef_ifndef_and_else(self):
        source = "a\n#ifdef X\nb\n#else\nc\n#endif\n#ifndef X\nd\n#else\ne\n#endif\nf"
        self.assertEqual(preprocessed(source, {"X"}).split(), ["a", "b", "e", "f"])
        self.assertEqual(preprocessed(source, set()).split(), ["a", "c", "d", "f"])
        with self.assertRaises(AssertionError):
            preprocessed("#if X > 1\na\n#endif", set())

    def setUp(self):
        self.native = load_native()


# ---------------------------------------------------------------- verifier fixes after the family close (review.md)
BLOBS_STUDY = STUDY.parent / "liquid-glass-blobs"  # Liquid Glass Blobs, when it sits next to this study


class FamilyCloseVerifierFixes(unittest.TestCase):
    """A family critic's findings on this study's family close: LIT-CV1, the tutorial
    sent readers to 'the last section' for main(), which is Credits; LIT-CV3, the
    family rule record, README and co-design still called Liquid Glass Blobs not
    measured after Blobs' own family close took the Object size number with two
    recorded exceptions. LIT-CV2 tightened FamilyClose.test_g1_fit_and_patterns_match_the_core.
    Both tests here fail on the files before the fix (review.md, Verifier fixes after
    the family close). The Blobs measurement runs when liquid-glass-blobs sits next to
    this study, as FamilyClose reads ../liquid-glass; the record checks always run."""

    def test_cv1_main_pointer_names_the_section_that_shows_it(self):
        article = (STUDY / "article.source.md").read_text()
        # The excerpt that shows main(): the vertex region that begins inside main().
        self.assertEqual(re.findall(r"// @begin (\w+)", VERT[VERT.index("void main()"):]), ["picking"])
        holders = [heading for heading, text in sections(article).items()
                   if "{{code:liquid_glass_lit.vert:picking}}" in text]
        self.assertEqual(len(holders), 1)
        self.assertNotEqual(holders[0], list(sections(article))[-1])  # 'the last section' could not be right
        self.assertEqual(re.findall(r"`main\(\)` comes back in ([^)]*)\)", article), [f'"{holders[0]}"'])
        # A pointer names its section in quotes; none points by position.
        for name in re.findall(r"comes back in \"([^\"]+)\"", article):
            self.assertIn(name, sections(article))
        self.assertEqual(re.findall(r"comes back in (?!\")", article), [])
        self.assertEqual(re.findall(r"\bthe (?:last|next|first|previous|final) section\b", article, re.I), [])
        self.assertIn(f'comes back in "{holders[0]}"', (STUDY / "article.md").read_text())

    def test_cv3_rule_record_covers_blobs(self):
        rule = family_rule()
        record = rule["members_family_close"]["liquid-glass-blobs"]
        self.assertNotIn("not measured", record.lower())
        for phrase in ("decisions.json, 'Family close G1'", "2.5 per box radius", "box units", "REFERENCE_RADIUS"):
            self.assertIn(phrase, record)
        stated = re.search(r"Fit ((?:\d+\.\d{4}(?:, | and )?)+), the rule's values", record)
        self.assertIsNotNone(stated, "the record states the measured Fit values")
        stated_fit = re.findall(r"\d+\.\d{4}", stated.group(1))
        stated_film = re.findall(r"film period (\d+(?:\.\d+)?) times the rule's", record)
        self.assertEqual(len(stated_film), 1)
        # The other records and the docs no longer say Blobs was not measured.
        decisions = (STUDY / "decisions.json").read_text()
        self.assertNotIn("Blobs is not measured here", decisions)
        readme = (STUDY / "README.md").read_text()
        table = readme.split("### Object size across the family", 1)[1].split("\n## ", 1)[0]
        self.assertNotIn("did not measure", table)
        for phrase in ("Liquid Glass Blobs", "per box radius", "follows the box", "2.069"):
            self.assertIn(phrase, table)
        questions = json.loads((STUDY / "co-design.json").read_text())["open_questions"]
        self.assertFalse([q for q in questions if "its own study's question" in q])
        self.assertTrue([q for q in questions if "Liquid Glass Blobs" in q and "box radius" in q])
        review = (STUDY / "review.md").read_text()
        close = review.split("## Family close", 1)[1]
        self.assertIn("LIT-CV3", close)
        if not (BLOBS_STUDY / "native.py").is_file():
            return
        # Blobs' own Fit on its box in a Geometry COMP scaled k, its own uFilm.w and film lookup.
        native = load_native(BLOBS_STUDY / "native.py")
        self.assertEqual(native["REFERENCE_RADIUS"], rule["reference_radius"])
        blobs_spec = json.loads((BLOBS_STUDY / "study.json").read_text())
        blobs_material = {u["name"]: u["values"] for u in next(n for n in blobs_spec["nodes"] if n["id"] == "material")["uniforms"]}
        blobs_frag = functions(code_only((BLOBS_STUDY / "blobs.frag").read_text()))
        fits, film_ratios = [], set()
        for diagonal in ((0.1,) * 3, (1.0,) * 3, (3.0,) * 3, (10.0,) * 3, (8.0, 1.0, 1.0)):
            det = diagonal[0] * diagonal[1] * diagonal[2]
            k = abs(det) ** (1.0 / 3.0)
            comp = SimpleNamespace(par=SimpleNamespace(Objectsize=SimpleNamespace(val=None)))
            geo = SimpleNamespace(path="/project1/liquid_glass_blobs/blobs_geo",
                                  worldTransform=SimpleNamespace(determinant=lambda det=det: det))
            native["fit_object_size"](comp, geo)
            object_size = comp.par.Objectsize.val
            # The rule: world radius over 1.45; the radius is half the box's side times k.
            self.assertAlmostEqual(object_size, native["BOX_HALF_SIDE"] * k / rule["reference_radius"], 12, diagonal)
            fits.append(f"{object_size:.4f}")
            at_fit = SimpleNamespace(par=SimpleNamespace(Objectsize=SimpleNamespace(eval=lambda s=object_size: s)))
            film = lookup_period(blobs_frag["filmThickness"], "pObj",
                                 {"uFilm.w": evaluate(blobs_material["uFilm"][3], at_fit)}, k)
            film_ratios.add(round(film / (object_size / rule["film_swirls_per_object_size"]), 12))
        self.assertEqual(fits, stated_fit)
        self.assertEqual(film_ratios, {float(stated_film[0])})
        # The ripple follows the box: no world scale in its lookup, no Object size in its uniforms.
        self.assertNotIn("worldScale", blobs_frag["ripple"])
        self.assertIn("uMotion.z", blobs_frag["ripple"])
        self.assertFalse([v for v in blobs_material["uMotion"] if "Objectsize" in str(v)])
        blobs_decisions = json.loads((BLOBS_STUDY / "decisions.json").read_text())
        self.assertTrue([d for d in blobs_decisions if d.get("goal", "").startswith("Family close G1")])


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
        self.fit_glass = load_native()["fit_glass"]
        self.body = functions(code_only(FRAG))
        self.uniforms = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}

    def fitted(self, geos):
        comp = SimpleNamespace(par=_CriticPars(Objectsize=_CriticPar(1.0), Thickness=_CriticPar(0.5),
                                               Wobblescale=_CriticPar(3.0), Frost=_CriticPar(0.2),
                                               Density=_CriticPar(1.5)),
                               op=lambda name: SimpleNamespace(text=json.dumps(SPEC)), path="/project1/glass_component")
        comp.par.Glassgeo = SimpleNamespace(evalOPs=lambda: list(geos))
        self.fit_glass(comp, geos)
        return comp

    def look(self, comp, k_comp, k_inst):
        """World lengths and pattern periods, in scene units, on an object whose Geometry COMP
        scales by k_comp and whose own instance scales by k_inst. worldScale() reads the COMP's
        world matrix only (no instance), and vObjPos is the SOP position, before both."""
        env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=lambda p: p.eval())), "parent": lambda: comp}
        value = lambda name, i: eval(self.uniforms[name][i], env)  # noqa: E731,S307 (study.json; Morph 0)
        unit = k_comp * k_inst  # scene units per SOP unit
        return (value("uOptics", 1), value("uBody", 1), 1.0 / value("uGlass", 3),
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
        # 1. Objects of different sizes: Fit takes the largest object that wears the material, whatever the order.
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
                'with ripples and film bands five times larger',
                'three times as many ripples and film bands',
                "Fit and the shader see the Geometry COMP's scale, not each instance's",
                'the ripples and film bands grow with it',
                "set each object's Material to its own copy",
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


class FamilyCriticRouted(unittest.TestCase):
    """Two findings the core's rounds routed to this study (review.md, Family critic:
    routed fixes). V1 record: decisions.json's Verifier V1 said a COMP-scaled object at
    Object size 1 shows 1/k as many ripples; the lookups give k times as many. PV4 labels:
    Thickness said 'scene units' and Object size '1 = the demo torus', not the family
    wording, and checks/core_reference/study.json was an older copy of the core's.
    All three tests fail on the files before the fix, and the V1 test also fails on
    the pre-V1 lookups (checks/results/red-run-family-critic-routed.json)."""

    def test_v1_record_says_k_times_as_many_patterns(self):
        # The lookups multiply by worldScale(), the Geometry COMP's scale k; uWobble.y and
        # uFilm.w divide by Object size only. Measured from this study's own uniform
        # expressions and lookups: at a hand-set Object size, a COMP scale k gives k times as
        # many ripple and film cells per unit of the object; Object size = k (what Fit sets
        # on the demo torus) gives the unscaled demo's count back.
        body = functions(code_only(FRAG))
        material = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}

        def cells_per_object_unit(k, object_size):
            comp = SyncComp()
            comp.par.Objectsize.val = object_size
            values = {"uWobble.y": evaluate(material["uWobble"][1], comp),
                      "uFilm.w": evaluate(material["uFilm"][3], comp)}
            # lookup_period() is in scene units; one unit of the object is k scene units.
            return tuple(k / lookup_period(body[name], "vObjPos", values, k) for name in ("wobbleNormal", "filmThickness"))

        for size in (1.0, 2.0):  # hand-set Object size
            demo = cells_per_object_unit(1.0, size)
            for k in (0.1, 3.0, 10.0):
                for got, want in zip(cells_per_object_unit(k, size), demo):
                    self.assertAlmostEqual(got / want, k, 12, (size, k))
        demo = cells_per_object_unit(1.0, 1.0)
        for k in (0.1, 3.0, 10.0):  # Fit
            for got, want in zip(cells_per_object_unit(k, k), demo):
                self.assertAlmostEqual(got / want, 1.0, 12, k)
        # The V1 record says what the measurement says.
        v1 = [d for d in json.loads((STUDY / "decisions.json").read_text()) if d["goal"].startswith("Verifier V1:")]
        self.assertEqual(len(v1), 1)
        self.assertIn("an object scaled k times by its COMP at a hand-set Object size shows k times as many "
                      "ripples and film bands", v1[0]["consequence"])
        self.assertIn("Fit fixes it", v1[0]["consequence"])
        for name, text in (("decisions.json, Verifier V1", json.dumps(v1[0])),
                           ("README.md", (STUDY / "README.md").read_text()),
                           ("article.source.md", (STUDY / "article.source.md").read_text()),
                           ("validation.json", (STUDY / "validation.json").read_text())):
            self.assertNotIn("1/k as many", text, name)
            self.assertNotIn("coarser ripples", text, name)

    def test_pv4_labels_say_what_object_size_does(self):
        # A control the uniforms multiply by Object size is in units of Object size, not scene
        # units (the core's and Prism's test of the same name).
        scaled = set()
        for node in SPEC["nodes"]:
            for u in node.get("uniforms", []):
                for v in u.get("values", []):
                    m = re.fullmatch(r"op\('presets'\)\.module\.u\(parent\(\)\.par\.(\w+)\) \* "
                                     r"parent\(\)\.par\.Objectsize\.eval\(\)", str(v))
                    if m:
                        scaled.add(m.group(1))
        self.assertEqual(sorted(scaled), ["Frost", "Thickness"])
        for name in sorted(scaled):
            self.assertNotIn("scene units", CONTROLS[name]["label"], name)
        self.assertTrue(CONTROLS["Thickness"]["label"].startswith("Thickness (x Object size"))
        # Object size: the family's one wording, with what this study's demo object fits to.
        size = CONTROLS["Objectsize"]
        m = re.fullmatch(r"Object size \(world radius / 1\.45; the demo (\w+) fits to ([0-9.]+)\)", size["label"])
        self.assertIsNotNone(m, size["label"])
        self.assertEqual(m.group(1), "torus")
        self.assertEqual(family_rule()["reference_radius"], 1.45)
        self.assertEqual(float(m.group(2)), round(size["default"], 2))
        self.assertEqual(float(m.group(2)), round(load_native()["demo_radius"](SPEC) / 1.45, 2))
        # The same words as the core's labels (checks/core_reference, and ../liquid-glass when present).
        for label, core in core_copies():
            theirs = {c["name"]: c["label"] for c in json.loads((core / "study.json").read_text())["controls"]}
            for name in ("Thickness", "Objectsize"):
                self.assertEqual(CONTROLS[name]["label"], theirs[name], (label, name))
        # The README's control list describes the labels as they are.
        readme = (STUDY / "README.md").read_text()
        self.assertNotIn("Thickness (scene units)", readme)
        self.assertNotIn("1 = the demo torus", readme)
        self.assertIn("Thickness (in units of Object size: scene units while Object size is 1)", readme)
        self.assertIn("world radius over 1.45, Geometry COMP scale included; the demo torus fits to 1", readme)

    def test_core_reference_is_the_current_core(self):
        # checks/core_reference holds the core's files byte for byte, with the sha256 that
        # sources.json records; when the core sits next to this study, they are its current
        # files (Liquid Glass Flow pins its two shader copies the same way).
        import hashlib
        records = [s for s in json.loads((STUDY / "sources.json").read_text())
                   if str(s.get("source_id", "")).startswith("studies/liquid-glass (")]
        self.assertEqual(len(records), 1)
        recorded = records[0]["sha256"]
        names = sorted(p.name for p in CORE_REFERENCE.iterdir() if p.name != "README.md")
        self.assertEqual(names, sorted(recorded))
        for name in names:
            digest = hashlib.sha256((CORE_REFERENCE / name).read_bytes()).hexdigest()
            self.assertEqual(digest, recorded[name], f"{name}: sources.json records another sha256")
            if (CORE_STUDY / name).is_file():
                self.assertEqual(digest, hashlib.sha256((CORE_STUDY / name).read_bytes()).hexdigest(),
                                 f"{name}: checks/core_reference is older than ../liquid-glass")


# ---------------------------------------------------------------- fit threshold (review.md)
FIT_SIZE_PREDICATE = ("Object.values(comp).every((r) => Object.values(r).every((x) => x.max <= 2"
                      " && x.pixelsOver8 <= 50))")


def fit_size_check(folder):
    """The pass condition and the claim of the preview check fit_size_carries_presets_over_comp_scale."""
    source = (folder / "checks" / "preview_tests.cjs").read_text()
    found = re.findall(r"check\('fit_size_carries_presets_over_comp_scale', (.*?), comp,\s*'((?:[^'\\]|\\.)*)'",
                       source, re.S)
    return [(" ".join(condition.split()), claim) for condition, claim in found]


class FitThreshold(unittest.TestCase):
    """Family critic (low): fit_size_carries_presets_over_comp_scale accepted up to 50 pixels over
    8/255, while the core, Flow and Lit measure at most 1/255 in every case. A worldScale() exponent
    of 0.3333 instead of 1/3 passed it in all three (4 to 23/255, at most 4 pixels over 8). The test
    now also holds 2/255 at every pixel. Prism and Blobs keep their own recorded bounds."""

    def test_fit_size_test_holds_2_255_at_every_pixel(self):
        found = fit_size_check(STUDY)
        self.assertEqual([condition for condition, _ in found], [FIT_SIZE_PREDICATE])
        self.assertIn("within 2/255 at every pixel (measured: 1/255)", found[0][1])
        self.assertIn("at most 50 pixels", found[0][1])
        # The core, Flow and Lit hold the same bound, where they sit next to this study.
        for member in ("liquid-glass", "liquid-glass-flow", "liquid-glass-lit"):
            folder = STUDY.parent / member
            if (folder / "checks" / "preview_tests.cjs").is_file():
                self.assertEqual([condition for condition, _ in fit_size_check(folder)], [FIT_SIZE_PREDICATE], member)


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
    FRAG = "liquid_glass_lit.frag"
    ORIENT_LINE = "vec2 orient = screenSign(ndc, ndcStep, depthStep, proj);"
    RIGHT_LINE = "vec2 orient = vec2(1.0, 1.0);"
    ROWS = "evidence"
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
