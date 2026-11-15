#!/usr/bin/env python3
"""Tests that need neither TouchDesigner nor a GPU.

  python3 checks/test_study.py

Covers the preset module (load and morph maths, menu, drift phase, demo spin
and colour helpers, with fake parameters and a fake clock), the preset
callback, native.apply() run in every order on a fake component, and the
recipe's internal consistency: every
preset value has a control, every control default matches the default preset,
every preset value reaches a morphed uniform, and both materials bind the same
uniforms and sampler settings.

The FamilySync class covers the merge from the family members (items C1 to C9
in review.md): source contracts in the GLSL (picking, extra colour buffers, no
dithering, the output cap, measured screen orientation, fog), the recipe (Dither
off, Info DATs, Object size, Backdrop) and the native helpers (Fit to Glass
geometry, render diagnostics) against fake TouchDesigner objects.

The VerifierFixes class covers fixes V1 to V3 from the independent check of
the family sync: the scene's alpha behind the back-face pass, Markdown tables
kept whole (the hand-wiring table lists every uniform), and the dispersion
claims matching their preview test.

The AuditGuards class pins the audit round 2 and 3 fixes that the family
labels R3 (Inputs fields, build warnings), R5 (shader hygiene) and R9 (sampler
settings, menu uniforms, inspect() diagnostics), ported from Liquid Glass
Flow's test_r3_*, test_r5_* and test_r9_*. The members copy these files from
this study, so a regression here would spread.

The FamilyNames class pins the family's names (Fit pulse, Demo backdrop) and
the README table of them. The FamilyClose class covers the family gaps G1 to G6
this study closes: Object size as the object's world size for the ripple and
film patterns (the family rule), the centre-line tie-break of the screen
orientation, the film swirl 0 wording, the occlusion claim's preview test, the
quarter-gap record in C3, and the documented picking form. The
FamilyCloseVerifier class pins the records a family critic corrected after the
family close (V1 to V5): which way the ripples change on a COMP-scaled object,
what a core-only merge does to Liquid Glass Flow's checks, who follows the
family rule for Object size, what a pick render runs, and like-for-like
dispersion numbers in C3. The TutorialPointers class checks that the
tutorial's pointers to other sections name the section that holds the code.
"""
import builtins
import contextlib
import io
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
EXPERIMENTS = json.loads((STUDY / "experiments.json").read_text())
MODULE = runpy.run_path(str(STUDY / "presets.py"))
CONTROLS = {c["name"]: c for c in SPEC["controls"]}
NODES = {n["id"]: n for n in SPEC["nodes"]}


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

    def __init__(self, values):
        FakeComp.count += 1  # a fresh path: presets.py keeps running drift per component path
        self.path = f"/project1/liquid_glass{FakeComp.count}"
        self.par = FakePars({k: FakePar(self, k, v, CONTROLS.get(k, {}).get("names"))
                             for k, v in values.items()})
        self._ops = {
            "presets_data": SimpleNamespace(text=(STUDY / "presets.json").read_text()),
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


# What a user changes on the Inputs page and for their own scene; apply() must keep all of it.
SCENE = {"Refractiontop": "/project1/scene", "Reflectiontop": "/project1/photo",
         "Reflectmode": "screen", "Camera": "/project1/cam1", "Glassgeo": "/project1/geo1",
         "Culling": "none", "Flipv": True, "Colourspace": "raw", "Demo": False}


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


class PresetModule(unittest.TestCase):
    def test_apply_writes_every_preset_value(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "violet_gel")
        for key, value in PRESETS["presets"]["violet_gel"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        before = comp.state()
        MODULE["apply"](comp, "custom")
        self.assertEqual(before, comp.state())

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


    def test_menu_follows_the_evaluated_value(self):
        comp = FakeComp(defaults())
        comp.par.Stage.val = "thickness"
        self.assertEqual(MODULE["menu"](comp.par.Stage), CONTROLS["Stage"]["names"].index("thickness"))

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
            self.assertAlmostEqual(first, (0.4 * speed * builtins.absTime.seconds) % 256.0, 9)
            clock.step(1 / 60)
            moved = MODULE["phase"](comp, 0.4)
            self.assertAlmostEqual(wrapped_change(first, moved, 256.0), 0.4 * speed / 60, 9)
            comp.par.Wobblespeed.val = 0.0
            del builtins.absTime  # speed 0 must not even read the clock...
            self.assertEqual(MODULE["phase"](comp, 0.4), moved)  # ...and holds the ripples where they are

    def test_drift_stays_smooth_through_morph_and_speed_changes_after_an_hour(self):
        # One frame of an A/B morph used to jump by rate x change in speed x uptime
        # (2.16 lattice units at 1 h); now each frame moves by rate x speed x frame time.
        for rate in (0.6, 0.4, -0.3, 0.15):
            comp = FakeComp(defaults())
            MODULE["apply"](comp, "prism_chrome")
            comp.par.Morphtarget.val = "aqua_jelly"  # speed 0.3 -> 0.6
            dt = 1 / 60
            with Clock(3600.0) as clock:
                last = MODULE["phase"](comp, rate)
                frames = [("Morph", i / 100) for i in range(1, 101)]          # a 100-frame morph
                frames += [("Wobblespeed", 0.3 + 0.27 * i) for i in range(1, 11)]  # a fast slider drag
                for name, value in frames:
                    getattr(comp.par, name).val = value
                    clock.step(dt)
                    speed = MODULE["u"](comp.par.Wobblespeed)
                    now = MODULE["phase"](comp, rate)
                    self.assertTrue(0.0 <= now < 256.0)
                    change = wrapped_change(last, now, 256.0)
                    self.assertLessEqual(abs(change), abs(rate) * speed * dt + 1e-9, (rate, name, value))
                    self.assertAlmostEqual(change, rate * speed * dt, 9)
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
            comp.par.Wobblespeed.val = 0.0
            held = MODULE["phase"](comp, 0.6)
            clock.step(100.0)
            comp.par.Wobblespeed.val = speed
            self.assertEqual(MODULE["phase"](comp, 0.6), held)  # moving again starts where it stopped

    def test_demo_spin_is_integrated(self):
        comp = FakeComp(defaults())
        comp.par.Pause.val, comp.par.Time.val = True, 2.0
        self.assertAlmostEqual(MODULE["spin"](comp), comp.par.Demospin.val * 2.0, 12)
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

    def test_decode_colours(self):
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


class PresetCallback(unittest.TestCase):
    def setUp(self):
        self.callbacks = runpy.run_path(str(STUDY / "preset_exec.py"),
                                        init_globals={"op": lambda name: SimpleNamespace(
                                            module=SimpleNamespace(apply=MODULE["apply"]))})

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        comp.par.Ior.val = 2.2
        comp.par.Preset.val = "custom"
        before = comp.state()
        self.callbacks["onValueChange"](comp.par.Preset, "prism_chrome")
        self.assertEqual(before, comp.state())

    def test_choosing_a_preset_loads_it(self):
        comp = FakeComp(defaults())
        comp.par.Preset.val = "amber_honey"
        self.callbacks["onValueChange"](comp.par.Preset, "prism_chrome")
        for key, value in PRESETS["presets"]["amber_honey"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)


class NativeApply(unittest.TestCase):
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
        # README and tutorial: scene inputs, Reflection map, Faces, Flip screen V,
        # Colour parameters and Demo render are left alone.
        for item in EXPERIMENTS:
            comp = scene_comp()
            NATIVE["apply"](comp, item["id"])
            self.assertEqual(SCENE, {k: comp.state()[k] for k in SCENE}, item["id"])

    def test_reset_controls_are_the_documented_ones(self):
        # README > Controls and the tutorial name exactly these, besides the preset values.
        # Family sync C9 added Backdrop (the experiments' predictions describe the checker).
        reset = set(NATIVE["look_defaults"](SPEC)) - set(SPEC["preset_keys"])
        self.assertEqual(reset, {"Morphtarget", "Morph", "Samples", "Conserve", "Envrotate", "Screenwarp",
                                 "Lightdirx", "Lightdiry", "Lightdirz", "Backface",
                                 "Pause", "Time", "Stage", "Demospin", "Backdrop"})


class Recipe(unittest.TestCase):
    def test_twelve_complete_presets(self):
        self.assertEqual(len(PRESETS["presets"]), 12)
        self.assertEqual(PRESETS["order"], list(PRESETS["presets"]))
        for name, preset in PRESETS["presets"].items():
            self.assertEqual(sorted(preset["values"]), sorted(SPEC["preset_keys"]), name)

    def test_preset_keys_are_controls(self):
        for key in SPEC["preset_keys"]:
            self.assertIn(key, CONTROLS)

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
            node = next(n for n in SPEC["nodes"] if n["id"] == node_id)
            text = json.dumps(node["uniforms"])
            morphed = re.findall(r"module\.u\(parent\(\)\.par\.(\w+)\)", text)
            self.assertEqual(sorted(morphed), sorted(SPEC["preset_keys"]), node_id)

    def test_both_materials_share_bindings_except_pass_and_back_sampler(self):
        nodes = {n["id"]: n for n in SPEC["nodes"]}
        front = {u["name"]: u["values"] for u in nodes["material"]["uniforms"]}
        back = {u["name"]: u["values"] for u in nodes["material_back"]["uniforms"]}
        settings = lambda node: {u["name"]: (u.get("filter"), u.get("extendu"), u.get("extendv"))
                                 for u in nodes[node]["uniforms"] if u.get("kind") == "sampler"}
        self.assertEqual(settings("material"), settings("material_back"))
        # texelFetch reads the back-face pass: no mipmaps, no filtering, 32-bit float distances.
        self.assertEqual(settings("material")["sBackface"][0], "nearest")
        self.assertEqual(nodes["render_back"]["parameters"]["format"], "rgba32float")
        self.assertEqual(sorted(front), sorted(back))
        differs = sorted(k for k in front if front[k] != back[k])
        self.assertEqual(differs, ["sBackface", "uState"])
        self.assertEqual(front["uState"][1], 0)
        self.assertEqual(back["uState"][1], 1)

    def test_no_expression_multiplies_absolute_time(self):
        # Anything that moves goes through presets.advance(), so changing its speed never jumps.
        self.assertNotIn("absTime", json.dumps(SPEC["nodes"]))
        geo = next(n for n in SPEC["nodes"] if n["id"] == "demo_geo")
        self.assertEqual(geo["expressions"]["ry"], "op('presets').module.spin(parent())")

    def test_no_geometry_comp_references_the_material(self):
        # Loop-free back-face pass: the materials reach geometry only through Override Material.
        for ref in SPEC["references"]:
            if ref["target"] in ("material", "material_back"):
                self.assertEqual(ref["parameter"], "overridemat", ref)

    def test_experiments_use_real_presets(self):
        for e in EXPERIMENTS:
            preset = e["parameters"].get("Preset")
            self.assertIn(preset, PRESETS["presets"], e["id"])
            self.assertTrue((STUDY / e["preview"]).is_file(), e["preview"])


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


class FamilySync(unittest.TestCase):
    def test_c2_vertex_shader_answers_picking(self):
        # Write a GLSL MAT, Picking: TouchDesigner defines TD_PICKING_ACTIVE for Render Pick DAT/CHOP passes.
        # Since family close G6 the documented form: '#ifndef TD_PICKING_ACTIVE ... #else
        # TDWritePickingValues(); #endif' (test_g6_pick_render_runs_only_the_documented_picking_block).
        vert = code_only(shader("liquid_glass.vert"))
        self.assertRegex(vert, r"\n#ifndef TD_PICKING_ACTIVE\n[\s\S]*\n#else\s+TDWritePickingValues\(\);\s+#endif\n")
        self.assertLess(vert.index("gl_Position = TDWorldToProj(world);"), vert.index("TDWritePickingValues();"))

    def test_c2_extra_colour_buffers_get_zeros(self):
        frag = code_only(shader("liquid_glass.frag"))
        self.assertRegex(frag, r"#ifndef TD_NUM_COLOR_BUFFERS\s+#define TD_NUM_COLOR_BUFFERS 1\s+#endif")
        self.assertIn("layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];", frag)
        self.assertIsNone(re.search(r"\bfragColor\s*=", frag), "every write names a colour buffer")
        self.assertIn("fragColor[0] = TDOutputSwizzle(", frag)
        for k in range(1, 8):  # constant indices, each behind its own #if (a loop fails in WebGL2)
            self.assertRegex(frag, rf"#if TD_NUM_COLOR_BUFFERS > {k}\s+fragColor\[{k}\] = vec4\(0\.0\);\s+#endif")

    def test_c4_renders_switch_dither_off(self):
        renders = [n for n in SPEC["nodes"] if n["type"] in ("renderTOP", "renderpassTOP")]
        self.assertTrue(renders)
        for n in renders:
            value = {**n.get("parameters", {}), **n.get("lenient_parameters", {})}.get("dither")
            self.assertIs(value, False, n["id"])

    def test_c4_shaders_never_dither(self):
        # The brief rules out dithering. Per-pixel noise needs a per-pixel seed: the material reads
        # gl_FragCoord only in screenUV() and screenSign() (where the pixel is, never a hash seed),
        # never calls TDDither, and its only hash feeds object-space value noise. The demo TOPs hash
        # whole rows, words and letters, never a pixel position.
        frag = shader("liquid_glass.frag")
        for name in ("liquid_glass.frag", "liquid_glass.vert", "backdrop.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertNotIn("TDDither", code, name)
            self.assertIsNone(re.search(r"\b(dither|random|blueNoise|interleavedGradient)", code, re.I), name)
        readers = {f for f, body in functions(code_only(frag)).items() if "gl_FragCoord" in body}
        self.assertEqual(readers, {"screenUV", "screenSign"})
        self.assertIsNone(re.search(r"fract\s*\(\s*sin", code_only(frag)))
        callers = {f for f, body in functions(frag).items() if "latticeHash(" in body}
        self.assertEqual(callers, {"valueNoise"})
        for name in ("backdrop.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertNotIn("gl_FragCoord", code, name)
            calls = re.findall(r"(?<!float )\bhash\w*\((vec2\([^;]*?\))\)", code)
            self.assertTrue(calls or "hash" not in code, name)
            for args in calls:
                words = set(re.findall(r"[A-Za-z_]\w*", args)) - {"vec2", "float"}
                self.assertLessEqual(words, {"row", "slot", "index"}, (name, args))

    def test_c5_colour_is_capped_before_output_alpha_is_not(self):
        main = code_only(functions(shader("liquid_glass.frag"))["main"])
        cap = main.index("colour = min(colour, vec3(1024.0));")
        self.assertLess(cap, main.index("fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));"))
        self.assertNotRegex(main, r"alpha\s*=\s*min\(")  # the back-face pass stores a distance in alpha
        self.assertEqual(main.count("min(colour, vec3(1024.0))"), 1)

    def test_c5_normalize_never_sees_a_zero_vector(self):
        # Directions that can be zero go through safeNormalize(); every other normalize() argument
        # is non-zero by construction (comments next to each in liquid_glass.frag).
        code = code_only(shader("liquid_glass.frag"))
        args = call_arguments(code, r"(?<![A-Za-z])normalize")
        allowed = {
            "n - eye * (away + 0.01)",   # faceCamera: the part along eye is -0.01
            "n",                         # facingNormal: inside dot(n, n) > 1e-8
            "n - amount * 0.35 * slope", # wobbleNormal: unit n plus a perpendicular tilt
            "cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R)",  # axis never parallel to R
            "R + (t * cos(a) + b * sin(a)) * r",  # unit R plus a perpendicular offset
        }
        self.assertEqual(set(args), allowed)
        for name in ("lightDir", "eye", "forward"):
            self.assertRegex(code, rf"vec3 {name} = [^;]*safeNormalize\(", name)
        self.assertIn("vec3 h = safeNormalize(lightDir - eye, vec3(0.0));", code)

    def test_c5_every_render_gets_an_info_dat(self):
        builder = runpy.run_path(str(STUDY / "builder.py"))
        renders = {n["type"] for n in SPEC["nodes"] if n["type"].startswith("render")}
        self.assertTrue(renders)
        self.assertLessEqual(renders | {"renderpassTOP", "glslMAT", "glslTOP"}, set(builder["INFO_TYPES"]))

    def test_c5_render_diagnostics_reports_the_renders_that_draw_the_glass(self):
        def node(path, overridemat=None, geometry=(), errors="", warnings=""):
            par = SimpleNamespace(overridemat=SimpleNamespace(eval=lambda: overridemat),
                                  geometry=SimpleNamespace(evalOPs=lambda: list(geometry)))
            return SimpleNamespace(path=path, name=path.rsplit("/", 1)[1], par=par,
                                   errors=lambda: errors, warnings=lambda: warnings)
        material = object()
        comp = SimpleNamespace(path="/project1/liquid_glass", op=lambda name: material,
                               par=SimpleNamespace(Backface=SimpleNamespace(eval=lambda: False)))
        glass_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: material)))
        other_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: None)))
        renders = [
            node("/project1/liquid_glass/render", overridemat=material, warnings="demo warning"),
            node("/project1/liquid_glass/render_back"),                       # Back-face pass off: skipped
            node("/project1/glass_pass", overridemat=material, errors="compile error"),
            node("/project1/render_glass", geometry=[other_geo, glass_geo]),  # a Geometry COMP's Material
            node("/project1/render_scene", geometry=[other_geo]),             # the scene without the glass
        ]
        report = NATIVE["render_diagnostics"](comp, renders)
        self.assertEqual(sorted(report), ["/project1/glass_pass", "/project1/liquid_glass/render", "/project1/render_glass"])
        self.assertEqual(report["/project1/glass_pass"], {"errors": "compile error", "warnings": ""})
        self.assertIn("render_diagnostics", (STUDY / "native.py").read_text().split("def inspect(")[1])

    def test_c6_offsets_follow_the_measured_screen_orientation(self):
        frag = code_only(shader("liquid_glass.frag"))
        sign = functions(frag)["screenSign"]
        self.assertNotRegex(sign, r"dFd[xy]")  # the pixel's own values only (derivatives misread grazing edges)
        self.assertIn("gl_FragCoord", sign)
        self.assertIn("if (uState.w > 0.5) orient.y = -orient.y;", sign)  # Flip V: base UV and offsets together
        main = functions(frag)["main"]
        self.assertIn("vec2 orient = screenSign(ndc, ndcStep, depthStep, proj);", main)  # family close G2
        self.assertIn("vec2 toUV = unitsToUV(proj, depth) * orient;", main)  # every bend and frost offset
        self.assertIn("mirrorUV(uv + rv.xy * orient * uEnv.w * 0.5)", frag)   # the flat-image reflection
        self.assertIn("environment(reflect(eye, n), uv, view, orient)", main)

    def test_c7_fog_on_the_front_pass_only(self):
        main = code_only(functions(shader("liquid_glass.frag"))["main"])
        front = main[main.index("if (!backPass) {\n        colour *= uBody.z;"):main.index("// @end compose") if "// @end compose" in main else None]
        self.assertIn("TDFog(vec4(0.0, 0.0, 0.0, 1.0), vWorldPos, vCamIndex)", front)
        self.assertIn("colour = TDFog(vec4(colour, 1.0), vWorldPos, vCamIndex).rgb - fogAdded * (1.0 - alpha);", front)
        self.assertEqual(main.count("TDFog("), 2)

    def test_c8_object_size_is_setup_and_never_reset(self):
        size = CONTROLS["Objectsize"]
        self.assertTrue(size.get("setup"))
        self.assertEqual(size["default"], 1.0)
        self.assertGreater(size["min"], 0.0)  # it divides
        self.assertNotIn("Objectsize", SPEC["preset_keys"])
        self.assertEqual(CONTROLS["Fitglass"]["type"], "pulse")
        for item in EXPERIMENTS:
            comp = scene_comp()
            comp.par.Objectsize.val = 7.5
            NATIVE["apply"](comp, item["id"])
            MODULE["apply"](comp, "aqua_jelly")
            self.assertEqual(comp.par.Objectsize.val, 7.5, item["id"])

    def test_c8_object_size_scales_the_lengths_and_is_exact_at_1(self):
        reference = json.loads((STUDY / "checks" / "reference" / "study.json").read_text())

        def evaluate(spec, comp, name):
            node = next(n for n in spec["nodes"] if n["id"] == "material")
            values = next(u for u in node["uniforms"] if u["name"] == name)["values"]
            env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=MODULE["u"])), "parent": lambda: comp}
            return [v if not isinstance(v, str) else eval(v, env) for v in values]  # noqa: S307 (study.json)

        for preset in PRESETS["order"]:
            comp = FakeComp(defaults())
            MODULE["apply"](comp, preset)
            for name in ("uGlass", "uBody", "uOptics", "uWobble"):  # Object size 1: the same numbers as before
                self.assertEqual(evaluate(SPEC, comp, name), evaluate(reference, comp, name), (preset, name))
            self.assertEqual(evaluate(SPEC, comp, "uFilm")[3], 2.5)  # was the constant 2.5 in the shader
            comp.par.Objectsize.val = 10.0
            values = PRESETS["presets"][preset]["values"]
            self.assertAlmostEqual(evaluate(SPEC, comp, "uOptics")[1], values["Thickness"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uBody")[1], values["Frost"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uGlass")[3], values["Density"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uWobble")[1], values["Wobblescale"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uFilm")[3], 0.25, 12)
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + ", shader("liquid_glass.frag"))  # family close G1

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
        torus = next(n for n in SPEC["nodes"] if n["id"] == "demo_geo/torus")["parameters"]
        demo = torus["radx"] + torus["rady"]  # 1.45: the size the presets were tuned on
        self.assertAlmostEqual(comp.par.Objectsize.val, 3.0 / demo, 12)  # half of 2.0, times 3
        self.assertEqual([m["source"] for m in report["measured"]],
                         ["/project1/geo1/sphere1", "/project1/geo2 (Geometry COMP bounds)"])
        self.assertAlmostEqual(report["measured"][1]["radius"], 0.2, 12)
        # The demo torus itself fits to exactly 1, so pressing Fit on the demo changes nothing.
        demo_geo = SimpleNamespace(path="/project1/liquid_glass/demo_geo", worldTransform=SimpleNamespace(determinant=lambda: 1.0),
                                   children=[SimpleNamespace(isSOP=True, render=True, path="/project1/liquid_glass/demo_geo/torus",
                                                             bounds=lambda: bounds(2 * demo, 2 * demo, 2 * torus["rady"]))])
        self.assertEqual(NATIVE["fit_glass"](comp, demo_geo)["object_size"], 1.0)
        comp.par.Glassgeo.evalOPs = lambda: []
        with self.assertRaises(ValueError):
            NATIVE["fit_glass"](comp)
        # The Parameter Execute callback runs it on the pulse.
        calls = []
        callbacks = runpy.run_path(str(STUDY / "preset_exec.py"), init_globals={"op": lambda name: SimpleNamespace(
            module=SimpleNamespace(fit_glass=lambda c: calls.append(c) or {}, apply=MODULE["apply"]))})
        callbacks["onPulse"](SimpleNamespace(name="Fitglass", owner=comp))
        self.assertEqual(calls, [comp])
        self.assertIn("Fitglass", next(n for n in SPEC["nodes"] if n["id"] == "preset_exec")["parameters"]["pars"])

    def test_c9_backdrop_menu_reaches_the_demo_backdrop(self):
        menu = CONTROLS["Backdrop"]
        self.assertEqual((menu["type"], menu["page"], menu["default"], menu["names"]),
                         ("menu", "Study", "checker", ["checker", "type"]))
        self.assertFalse(menu.get("setup"))  # experiments reset it: their predictions describe the checker
        node = next(n for n in SPEC["nodes"] if n["id"] == "demo_backdrop")
        self.assertTrue(node.get("demo"))
        self.assertEqual(node["uniforms"], [{"name": "uBackdrop",
                                             "values": ["op('presets').module.menu(parent().par.Backdrop)", 0, 0, 0]}])
        code = code_only(shader("backdrop.frag"))
        self.assertIn("uniform vec4 uBackdrop;", code)
        self.assertIn("if (uBackdrop.x > 0.5) {", code)
        # The ported type keeps this study's ordered smoothstep edges (the Prism copy reversed them).
        for args in call_arguments(code, r"\bsmoothstep"):
            self.assertTrue(args.startswith("-px, px,"), args)


def table_blocks(text):
    """(first line number, lines) for each run of consecutive Markdown table lines outside code fences."""
    blocks, current, fenced = [], None, False
    for number, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("|"):
            if current is None:
                current = (number, [])
                blocks.append(current)
            current[1].append(line)
        else:
            current = None
    return blocks


def sentences_citing(text, test_name):
    return [s for s in re.split(r"(?<=[.!?])\s+", text) if test_name in s]


class VerifierFixes(unittest.TestCase):
    """Fixes V1 to V3 from the independent check of the family sync (review.md)."""

    def test_v1_back_face_branch_keeps_the_scene_alpha(self):
        # The back-face pass stores a distance in alpha, so coverage comes from the Refraction TOP.
        body = functions(code_only(shader("liquid_glass.frag")))["sampleBehind"]
        self.assertIn("vec4 scene = textureLod(sRefraction, uv, lod);", body)
        self.assertIn("return vec4(back.rgb, scene.a);", body)
        self.assertNotIn("1.0)", body.split("backfaceAt")[1])

    def test_v2_every_table_row_belongs_to_a_table(self):
        # A line between rows ends the table; the rows after it render as stray text.
        separator = re.compile(r"^\|(\s*:?-{3,}:?\s*\|)+\s*$")
        for name in ("README.md", "article.source.md", "review.md", "research.md", "brief.md"):
            for first, lines in table_blocks((STUDY / name).read_text()):
                self.assertTrue(len(lines) >= 2 and separator.match(lines[1]),
                                f"{name} line {first}: table row without a header and separator above it")

    def test_v2_hand_wiring_table_lists_every_uniform(self):
        declared = re.findall(r"^uniform vec4 (u\w+);", shader("liquid_glass.frag"), re.M)
        self.assertEqual(len(declared), 14)
        tables = [lines for _, lines in table_blocks((STUDY / "README.md").read_text())
                  if lines[0].startswith("| Uniform |")]
        self.assertEqual(len(tables), 1)
        listed = [re.match(r"\| `(u\w+)` \|", row).group(1) for row in tables[0][2:]]
        self.assertEqual(listed, declared)

    def test_v3_dispersion_claims_name_both_bounds(self):
        # dispersion_converges_with_samples allows a mean of 1/255 at the presets' Thickness and
        # 2.5/255 at Thickness 2.5 (measured 1.83); a doc that cites the 1/255 must say where it holds.
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        self.assertIn("r.mean <= (k.endsWith('2.5') ? 2.5 : 1.0)", tests)
        cited = 0
        for name in ("README.md", "article.source.md"):
            for sentence in re.split(r"(?<=[.!?])\s+", (STUDY / name).read_text()):
                if "64-sample" in sentence and "1/255" in sentence:
                    cited += 1
                    self.assertIn("presets' own Thickness", sentence, name)
                    self.assertIn("2/255 at Thickness 2.5", sentence, name)
        self.assertEqual(cited, 2)


def top_level_args(text):
    """Split a call's argument text at the commas outside parentheses."""
    parts, depth, start = [], 0, 0
    for i, ch in enumerate(text):
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == "," and depth == 0:
            parts.append(text[start:i].strip())
            start = i + 1
    parts.append(text[start:].strip())
    return parts


class AuditGuards(unittest.TestCase):
    """Audit rounds 2 and 3, in the family's labels: R3 Inputs fields and build
    warnings (round-2 A3, A11), R5 shader hygiene (B1, B3, B4, B10, B13, B15)
    and R9 recipe and diagnostics (A9, A10/B6, A12, A15). Ported from Liquid
    Glass Flow. The preview suite measures some of the same behaviour
    (ior1_is_invisible_with_wobble, wobble_independent_of_object_scale,
    faceted_fallback_without_normals); these need no GPU and also cover the
    demo shaders, the builder and the native helpers."""

    SHADERS = ("liquid_glass.frag", "liquid_glass.vert", "backdrop.frag", "env.frag")

    # ---------------------------------------------------------------- R3 Inputs fields and build warnings
    def test_r3_inputs_are_constant_paths_to_the_demo(self):
        for name, target in (("Refractiontop", "demo_backdrop"), ("Reflectiontop", "demo_env"),
                             ("Camera", "demo_cam"), ("Glassgeo", "demo_geo")):
            c = CONTROLS[name]
            self.assertEqual((c.get("demo_target"), c.get("default"), c.get("setup")), (target, None, True), name)
            self.assertNotIn("expression", c, name)
            self.assertIn(target, NODES)
        builder = runpy.run_path(str(STUDY / "builder.py"))
        builder["link_demo_inputs"].__globals__["ParMode"] = SimpleNamespace(EXPRESSION="expression")  # td stand-in
        target = SimpleNamespace(path="/project1/liquid_glass/demo_backdrop")

        def link(relative, resolves=True):
            par = SimpleNamespace(val=None, default=None, expr=None)
            par.eval = lambda: target if resolves else None
            comp = SimpleNamespace(name="liquid_glass", par=SimpleNamespace(Refractiontop=par),
                                   op=lambda n: target, relativePath=lambda node: relative)
            warnings = []
            builder["link_demo_inputs"](comp, [CONTROLS["Refractiontop"]], warnings)
            return par, warnings

        par, warnings = link("demo_backdrop")  # constant mode; Reset to Default brings the demo back
        self.assertEqual((par.val, par.default, par.expr, warnings), ("demo_backdrop", "demo_backdrop", None, []))
        # A path that does not resolve, or that leaves the component (a renamed copy would point at
        # the original's demo): expression fallback, also as the default, reported under 'inputs'.
        for relative, resolves in (("demo_backdrop", False), ("../liquid_glass/demo_backdrop", True),
                                   ("/project1/liquid_glass/demo_backdrop", True)):
            par, warnings = link(relative, resolves)
            self.assertEqual((par.expr, par.defaultExpr, par.defaultMode),
                             ("me.op('demo_backdrop')", "me.op('demo_backdrop')", "expression"), relative)
            self.assertEqual(len(warnings), 1, relative)
            self.assertTrue(warnings[0].startswith("inputs: Refractiontop"), warnings)

    def test_r3_build_warnings_are_categorized(self):
        builder = runpy.run_path(str(STUDY / "builder.py"))
        notes = builder["WARNING_NOTES"]
        self.assertEqual(list(notes), ["material", "inputs", "optional", "dither", "setup", "demo"])
        warnings = []
        builder["attempt"](False, warnings, "material", lambda: 1 / 0)
        self.assertEqual(warnings, ["material: division by zero"])
        with self.assertRaises(ZeroDivisionError):  # strict: a core node stops the build
            builder["attempt"](True, warnings, "setup", lambda: 1 / 0)
        # build() prints the warnings grouped by WARNING_NOTES, so a category without a note would
        # be stored but never printed. Every category the builder writes has one.
        source = (STUDY / "builder.py").read_text()
        used = {"inputs"} if 'warnings.append(f"inputs: ' in source else set()
        for args in call_arguments(source, r"(?<!def )\battempt"):
            used |= set(re.findall(r'"(\w+)"', top_level_args(args)[2]))
        used |= set(re.search(r'category = "(\w+)" if item.get\("demo"\) else "(\w+)"', source).groups())
        self.assertEqual(used, set(notes))

    # ---------------------------------------------------------------- R5 shader hygiene
    def test_r5_smoothstep_edges_increase(self):
        # smoothstep(e0, e1, x) is undefined when e0 >= e1. Numeric edges must increase; symbolic
        # ones must be one of these increasing forms.
        symbolic = {("halfWidth - soft", "halfWidth + soft"),  # band(): soft > 0, checked below
                    ("-px", "px")}                             # backdrop.frag: px = 1.5 / height
        for name in self.SHADERS:
            for args in call_arguments(code_only(shader(name)), r"\bsmoothstep"):
                lo, hi = top_level_args(args)[:2]
                try:
                    edges = float(lo), float(hi)
                except ValueError:
                    self.assertIn((lo, hi), symbolic, (name, args))
                    continue
                self.assertLess(edges[0], edges[1], (name, args))
        for name in ("liquid_glass.frag", "env.frag"):
            code = code_only(shader(name))
            calls = [top_level_args(a) for a in call_arguments(code, r"\bband") if not a.startswith("float ")]
            self.assertTrue(calls, name)
            for args in calls:  # a positive constant, plus studio()'s soft, which is never negative
                found = re.fullmatch(r"(\d*\.\d+)( \+ soft)?", args[3])
                self.assertTrue(found and float(found.group(1)) > 0.0, (name, args))
            for args in call_arguments(code, r"\bstudio"):
                if not args.startswith("vec3 "):  # 0, or 0.15 x the reflection blur (control min 0)
                    self.assertIn(top_level_args(args)[1], ("0.0", "0.15 * blur"), (name, args))

    def test_r5_atan_only_through_azimuth(self):
        # atan(0, 0) is undefined: azimuth() returns 0 straight up and straight down.
        call = r"\batan\s*\("
        for name in self.SHADERS:
            code = code_only(shader(name))
            body = functions(code).get("azimuth", "")
            self.assertEqual(len(re.findall(call, code)), len(re.findall(call, body)), name)
        for name in ("liquid_glass.frag", "env.frag"):
            body = functions(code_only(shader(name)))["azimuth"]
            self.assertEqual(body.strip(), "return dot(d.xz, d.xz) > 1e-12 ? atan(d.z, d.x) : 0.0;", name)

    def test_r5_pixel_stage_hygiene(self):
        frag = code_only(shader("liquid_glass.frag"))
        body = functions(frag)
        main = body["main"]
        # Derivatives first, in uniform control flow: inside a branch or after a discard they are
        # undefined (B4). Only main() takes them: the faceted normal's two and, since family close
        # G2, the screen orientation's four (ndc and 1/w, for the centre-line tie-break).
        derivative = r"\b(dFdx|dFdy|fwidth)\w*\s*\("
        calls = [m.start() for m in re.finditer(derivative, main)]
        self.assertEqual(len(calls), 6)
        self.assertTrue(all(c < main.index("TDCheckDiscard();") for c in calls))
        self.assertEqual(len(re.findall(derivative, frag)), 6)
        self.assertIn("l2 > 1e-12 * dot(dPdx, dPdx) * dot(dPdy, dPdy)", body["facingNormal"])  # relative
        # The ripples tilt the normal again, so it is turned to the camera again (B1); their
        # strength follows the Geometry COMP's scale (B3). Family close G1 moved the cube root into
        # worldScale(), shared with the film: same maths.
        self.assertIn("vec3 n = faceCamera(wobbleNormal(facingNormal(eye, dPdx, dPdy)), eye);", main)
        self.assertEqual(body["worldScale"].strip(),
                         "return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);")
        self.assertIn("float scale = worldScale();", body["wobbleNormal"])
        self.assertIn("slope = uTDMats[vCamIndex].worldForNormals * slope * scale;", body["wobbleNormal"])

    def test_r5_sample_ior_at_least_1_and_f0_squared(self):
        # Below IOR 1 a sample's bend flips, then snaps to zero past the critical angle (B10).
        # r0 * r0 is defined for every IOR; pow() is undefined for a negative base (B13).
        self.assertGreaterEqual(CONTROLS["Ior"]["min"], 1.0)
        self.assertTrue(all(p["values"]["Ior"] >= 1.0 for p in PRESETS["presets"].values()))
        frag = code_only(shader("liquid_glass.frag"))
        self.assertIn("float ior = max(uOptics.x + spread * (w - 0.5), 1.0);", functions(frag)["transmitted"])
        main = functions(frag)["main"]
        self.assertIn("float r0 = (uOptics.x - 1.0) / (uOptics.x + 1.0);", main)
        self.assertIn("float reflectance = mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x);", main)
        self.assertNotRegex(frag, r"pow\(\s*\(?\s*(r0|uOptics\.x)\b")

    def test_r5_vertex_decides_a_zero_normal_before_transforming(self):
        # B15: a missing normal stays exactly zero instead of going through TDDeformNorm(0).
        vert = code_only(shader("liquid_glass.vert"))
        self.assertIn("vWorldNormal = dot(objNormal, objNormal) > 1e-12 ? TDDeformNorm(objNormal) : vec3(0.0);", vert)
        self.assertEqual(vert.count("TDDeformNorm("), 1)
        self.assertIn("if (dot(n, n) > 1e-8) {", functions(code_only(shader("liquid_glass.frag")))["facingNormal"])

    # ---------------------------------------------------------------- R9 recipe and diagnostics
    def test_r9_sampler_extend_modes_and_menu_uniforms(self):
        for node_id in ("material", "material_back"):
            samplers = {u["name"]: (u.get("filter"), u.get("extendu"), u.get("extendv"))
                        for u in NODES[node_id]["uniforms"] if u.get("kind") == "sampler"}
            self.assertEqual(samplers, {"sRefraction": ("mipmaplinear", "mirror", "mirror"),
                                        "sReflection": ("mipmaplinear", "repeat", "hold"),
                                        "sBackface": ("nearest", "hold", "hold")}, node_id)
        # A menu reaches a uniform only through presets.menu(), the index of the evaluated value
        # (A15), never Par.menuIndex.
        menus = {c["name"] for c in SPEC["controls"] if c["type"] == "menu"}
        found = set()
        for node in SPEC["nodes"]:
            text = json.dumps(node.get("uniforms", []))
            self.assertNotIn("menuIndex", text, node["id"])
            for name in menus:
                uses = text.count(f"parent().par.{name}")
                self.assertEqual(uses, text.count(f"op('presets').module.menu(parent().par.{name})"), (node["id"], name))
                if uses:
                    found.add(name)
        self.assertEqual(found, {"Reflectmode", "Stage", "Backdrop"})

    def test_r9_inspect_reports_script_and_blocking_errors(self):
        errors, script = {}, {"text": "Traceback: presets.py, line 1"}

        def node(name):
            return SimpleNamespace(name=name, cook=lambda force: None, errors=lambda: errors.get(name, ""),
                                   width=480, height=270)
        spec_dat = SimpleNamespace(text=(STUDY / "study.json").read_text())
        comp = SimpleNamespace(
            path="/project1/liquid_glass", op=lambda name: spec_dat if name == "study_spec" else node(name),
            par=SimpleNamespace(Backface=SimpleNamespace(eval=lambda: False)), customPars=[], children=[],
            errors=lambda recurse: "", warnings=lambda recurse: "", fetch=lambda key, default: default,
            scriptErrors=lambda recurse: script["text"])
        td_globals = NATIVE["inspect"].__globals__
        td_globals["app"] = SimpleNamespace(build="test", version="test")  # td stand-in
        try:
            report = NATIVE["inspect"](comp)
            # A Python exception in the preset callback is reported (A12), but does not stop capture.
            self.assertEqual((report["script_errors"], report["blocking_errors"]), (script["text"], {}))
            for key in ("inputs", "render_diagnostics", "build_warnings", "compile_reports"):
                self.assertIn(key, report)
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                NATIVE["_refuse_or_report"](report)
            self.assertIn(script["text"], printed.getvalue())
            # Errors in the material and output chain stop capture() and export() (A9); the
            # back-face pass counts only while it is on; demo nodes never do.
            errors.update({"material": "compile error", "material_back": "compile error", "demo_backdrop": "demo"})
            report = NATIVE["inspect"](comp)
            self.assertEqual(report["blocking_errors"], {"material": "compile error"})
            with self.assertRaises(RuntimeError):
                NATIVE["_refuse_or_report"](report)
            comp.par.Backface = SimpleNamespace(eval=lambda: True)
            self.assertEqual(sorted(NATIVE["blocking_errors"](comp)), ["material", "material_back"])
        finally:
            del td_globals["app"]


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
        self.assertTrue("(#names-across-the-family)" in (STUDY / "README.md").read_text(), "README.md must link to the family table")

    def test_family_table_matches_every_member(self):
        """README > Names across the family against each member's own recipe."""
        readme = (STUDY / "README.md").read_text()
        section = readme.split("## Names across the family", 1)[1].split("\n## ", 1)[0]
        rows = [r for r in section.splitlines() if r.startswith("| [")]
        members = [re.match(r"\| \[[^]]+\]\(([^)]+)\)", r).group(1) for r in rows]
        self.assertEqual(members, ["README.md", "../liquid-glass-flow/README.md", "../liquid-glass-blobs/README.md",
                                   "../liquid-glass-prism/README.md", "../liquid-glass-lit/README.md"])
        for row, link in zip(rows, members):
            cells = [c.strip() for c in row.strip("|").split("|")]
            folder = (STUDY / link).parent
            with self.subTest(folder.name):
                if not (folder / "study.json").is_file():
                    self.skipTest(folder.name + " is not next to this study")
                spec = json.loads((folder / "study.json").read_text())
                fit = next(c for c in spec["controls"] if c["type"] == "pulse" and c["name"].startswith("Fit"))
                menu = next(c for c in spec["controls"] if c["label"] == "Demo backdrop")
                default = dict(zip(menu["names"], menu["labels"]))[menu["default"]]
                self.assertEqual(cells[1:3], ["`%s`" % fit["name"], fit["page"]])
                # What Fit sets: the part of the member's label after 'sets', up to ';' or ' from'.
                sets = re.match(r"Fit to Glass geometry \(sets ([^;)]+?)(?: from [^;)]*)?(?:;[^)]*)?\)$", fit["label"]).group(1)
                self.assertEqual(cells[4], sets)
                counted = re.search(r"next to the (\w+) values? it sets", cells[8])
                if counted:
                    values = len(re.split(r", | and ", sets))
                    self.assertEqual(counted.group(1), ["one", "two", "three", "four", "five"][values - 1], cells[8])
                self.assertEqual(cells[6], {"checker": "Checker", "type": "Type"}[menu["default"]], default)
                self.assertEqual(cells[7], "no" if menu.get("setup") else "yes")
                backdrop = next(c for c in spec["controls"] if c["name"] == "Backdrop")
                self.assertEqual(backdrop is menu, "`Backdrop`" not in cells[8], cells[8])


# ---------------------------------------------------------------- family close (review.md)
def preprocessed(source, defined):
    """The lines a GLSL preprocessor keeps when the names in `defined` are
    #defined. Handles #ifdef, #ifndef, #else and #endif only; any other
    conditional fails the test instead of being guessed (from Liquid Glass Blobs)."""
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
    """The family gaps G1 to G6 that a family critic found after the two-way
    sync (c94e849), in this study's share. The six gap tests fail on c94e849;
    test_preprocessed_helper_follows_ifdef_ifndef_and_else tests the helper only
    and passes there (checks/results/red-run-family-close.json)."""

    def test_g1_object_size_follows_the_family_rule(self):
        # The family rule (Liquid Glass Lit decisions.json, family_rule): Object size is the
        # object's world radius over 1.45, for the lengths (uniform expressions, test_c8_*) and
        # for the ripple and film lookups, which multiply the object-space position by
        # worldScale(), the cube root of |det(mat3(world))|.
        frag = code_only(shader("liquid_glass.frag"))
        body = functions(frag)
        self.assertEqual(body["worldScale"].strip(),
                         "return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);")
        self.assertIn("vec3 p = vObjPos * uWobble.y * scale;", body["wobbleNormal"])
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0))", body["filmThickness"])
        # No other pattern lookup on the object-space position.
        self.assertEqual(len(re.findall(r"vObjPos \*", frag)), 2)
        # The reference radius: the demo torus, 1.45 (the rule's number), so the demo fits to 1.
        self.assertEqual(NATIVE["demo_radius"](SPEC), 1.45)
        lit = STUDY.parent / "liquid-glass-lit" / "decisions.json"
        if lit.is_file():
            rules = [d["family_rule"] for d in json.loads(lit.read_text()) if "family_rule" in d]
            self.assertEqual(len(rules), 1)
            self.assertEqual(rules[0]["reference_radius"], 1.45)
            self.assertEqual(rules[0]["world_scale_glsl"],
                             "pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0)")
        self.assertIn("abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)", (STUDY / "native.py").read_text())
        # Fit's docstring and the docs say what Object size now means; the Transform SOP
        # workaround for a scaled Geometry COMP is gone.
        doc = " ".join(NATIVE["fit_glass"].__doc__.split())
        self.assertIn("whether it was sized in its SOP or by its Geometry COMP's Scale", doc)
        self.assertIn("family rule", doc)
        for name in ("README.md", "article.source.md"):
            text = (STUDY / name).read_text()
            self.assertNotIn("Transform SOP", text, name)
            self.assertNotIn("s times larger", text, name)
            self.assertNotIn("come out larger", text, name)
        self.assertIn("check('fit_size_carries_presets_over_comp_scale'", (STUDY / "checks" / "preview_tests.cjs").read_text())

    def test_g2_centre_line_ties_use_the_guarded_derivative(self):
        # On the centre line of an odd-sized render the projected and the raster position are
        # both 0. There the sign of the projected position's screen derivative decides, only
        # where 1/w changes by less than 10% to the next pixel (Liquid Glass Lit's port of the
        # Liquid Glass Prism form; measured equal to Prism's on this study, review.md).
        frag = code_only(shader("liquid_glass.frag"))
        sign = functions(frag)["screenSign"]
        self.assertIn("vec2 screenSign(vec2 ndc, vec2 ndcStep, vec2 depthStep, mat4 proj)", frag)
        self.assertIn("vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));", sign)
        self.assertIn("runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);", sign)
        self.assertLess(sign.index("runs = mix("), sign.index("vec2 orient = runs *"))
        main = functions(frag)["main"]
        self.assertIn("vec4 clip = proj * vec4(camPoint, 1.0);", main)
        self.assertIn("vec2 ndc = clip.xy / clip.w;", main)
        self.assertIn("vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));", main)
        self.assertIn("vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);", main)
        self.assertLess(main.index("vec2 depthStep"), main.index("TDCheckDiscard();"))
        self.assertIn("check('screen_orientation_has_no_wrong_pixels'", (STUDY / "checks" / "preview_tests.cjs").read_text())
        # The C6 record no longer claims bit-identical previews from a knot-only measurement.
        c6 = next(d for d in json.loads((STUDY / "decisions.json").read_text()) if d["goal"].startswith("Family sync C6"))
        self.assertNotIn("(bit-identical previews)", c6["consequence"])

    def test_g3_docs_say_what_film_swirl_0_does(self):
        # With uFilm.w = 0 the film is one thickness over the whole object that still drifts with
        # uPhase.w; nothing freezes. Liquid Glass Prism's wording.
        row = next(line for line in shader("README.md").splitlines() if line.startswith("| `uFilm` |"))
        self.assertIn("0 = one film thickness over the whole object, no swirl; Wobble speed 0 stops the drift", row)
        for name in ("README.md", "decisions.json", "article.source.md", "liquid_glass.frag"):
            self.assertIsNone(re.search(r"freez\w* the (swirl|film)", (STUDY / name).read_text()), name)
        self.assertIn("check('film_swirl_frequency_0_is_one_drifting_thickness'", (STUDY / "checks" / "preview_tests.cjs").read_text())

    def test_g4_occlusion_claim_has_a_preview_test(self):
        # README step 4 says objects in front of the glass still cover it (family sync R2).
        readme = shader("README.md")
        section = readme[readme.index("## Use it on your own objects"):readme.index("## Controls")]
        self.assertIn("anything in front of the glass still covers it", section)
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        self.assertIn("check('render_pass_keeps_foreground_in_front'", tests)
        self.assertIn("occluder: { renderPass: true }", tests)  # the README route
        self.assertIn("occluder: {} })", tests)                  # the Over TOP control
        self.assertIn("render_pass_keeps_foreground_in_front", section)  # the claim names its test

    def test_g5_c3_record_covers_the_quarter_gap(self):
        # Liquid Glass Blobs ships a quarter of the fan gap (blobs.frag, transmitted()); the C3
        # record here must say why only Blobs keeps it, with the members' measurements.
        c3 = next(d for d in json.loads((STUDY / "decisions.json").read_text()) if d["goal"].startswith("Family sync C3"))
        record = json.dumps(c3)
        self.assertIn("quarter", c3["alternatives"])
        for member in ("Liquid Glass Flow", "Liquid Glass Prism", "Liquid Glass Lit", "Liquid Glass Blobs", "blobs.frag"):
            self.assertIn(member, record, member)
        self.assertIn("quarter", c3["choice"])
        self.assertIn("only Liquid Glass Blobs", c3["consequence"])
        # And the lookup level is still the frost gap alone: a fan gap under any name, the quarter
        # gap included (which the preview guard cannot see at the presets' Thickness), fails here.
        body = functions(code_only(shader("liquid_glass.frag")))["transmitted"]
        self.assertEqual(re.findall(r"float lod = [^;]*;", body),
                         ["float lod = log2(max(2.0 * max(blurPixels.x, blurPixels.y) / sqrt(float(count)), 1.0));"])
        self.assertNotRegex(body, r"(?i)fan")
        self.assertEqual(body.count("bendOffset("), 1)

    def test_g6_pick_render_runs_only_the_documented_picking_block(self):
        # Write a GLSL MAT, Picking: '#ifndef TD_PICKING_ACTIVE // All the typical shader code
        # #else TDWritePickingValues(); #endif'; while picking only the #else block runs.
        vert = code_only(shader("liquid_glass.vert"))
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
        # The header comment says what a pick render runs: the placement lines before the
        # branch, then the #else block (verifier V4: not "only the #else block of main()").
        header = " ".join(shader("liquid_glass.vert").split("\nout ", 1)[0].replace("//", " ").split())
        self.assertIn("while picking, the point is still placed, and of the branch only the #else block runs", header)
        self.assertNotIn("only the #else block of main() runs", header)
        self.assertNotIn("answers Render Pick DAT and", header)

    def test_preprocessed_helper_follows_ifdef_ifndef_and_else(self):
        source = "a\n#ifdef X\nb\n#else\nc\n#endif\n#ifndef X\nd\n#else\ne\n#endif\nf"
        self.assertEqual(preprocessed(source, {"X"}).split(), ["a", "b", "e", "f"])
        self.assertEqual(preprocessed(source, set()).split(), ["a", "c", "d", "f"])
        with self.assertRaises(AssertionError):
            preprocessed("#if X > 1\na\n#endif", set())


def family_close_section(text):
    """review.md from '## Family close' to the next level-2 heading."""
    return text.split("## Family close", 1)[1].split("\n## ", 1)[0]


# The mesh members and the word the Names section uses for each.
FAMILY_MESH_MEMBERS = {"liquid-glass": "this study", "liquid-glass-lit": "Lit",
                       "liquid-glass-prism": "Prism", "liquid-glass-flow": "Flow"}
MEMBER_FIT = {"liquid-glass": ("fit_glass", "liquid_glass.frag", False),
              "liquid-glass-lit": ("fit_glass", "liquid_glass_lit.frag", True),   # Lit takes a list
              "liquid-glass-prism": ("fit_glass", "liquid_prism.frag", False),
              "liquid-glass-flow": ("fit_flow", "liquid_flow.frag", False)}


def follows_family_rule(folder):
    """True if a member's own Fit and pixel stage follow the family rule (Liquid Glass Lit
    decisions.json, family_rule) on this study's demo torus; None if the member is absent."""
    root = STUDY.parent / folder
    fn, frag, as_list = MEMBER_FIT[folder]
    if not (root / "native.py").is_file():
        return None
    native = NATIVE if root == STUDY else runpy.run_path(str(root / "native.py"))
    source = code_only((root / frag).read_text())
    if "vObjPos * uWobble.y * scale" not in source or "vObjPos * uFilm.w * worldScale()" not in source:
        return False
    torus = NODES["demo_geo/torus"]["parameters"]
    outer = torus["radx"] + torus["rady"]
    point = lambda x, y, z: SimpleNamespace(x=x, y=y, z=z)
    bounds = SimpleNamespace(center=point(0.0, 0.0, 0.0), size=point(2 * outer, 2 * outer, 2 * torus["rady"]))
    text = (root / "study.json").read_text()
    for s in (0.1, 3.0, 10.0):
        sop = SimpleNamespace(isSOP=True, render=True, path="torus", bounds=lambda: bounds)
        geo = SimpleNamespace(path="/project1/geo1", children=[sop],
                              worldTransform=SimpleNamespace(determinant=lambda s=s: s ** 3))
        pars = SimpleNamespace(**{k: SimpleNamespace(val=None) for k in
                                  ("Objectsize", "Flowsize", "Flowcentrex", "Flowcentrey", "Flowcentrez")})
        comp = SimpleNamespace(par=pars, op=lambda name: SimpleNamespace(text=text), path="/project1/glass")
        native[fn](comp, [geo] if as_list else geo)
        if abs(comp.par.Objectsize.val - s) > 1e-5 * s:
            return False
    return True


class FamilyCloseVerifier(unittest.TestCase):
    """A family critic checked the family close and found five gaps in its
    records, V1 to V5 (review.md, Family close > Verifier fixes). Each of those
    tests fails on the family close as first delivered. A second pass after
    Flow's and Prism's family closes (CORE-V1, review.md, Second verifier pass)
    made test_v3 measure who follows the family rule and added test_v6; both
    fail on the text before that pass (red-run-family-close-verifier.json)."""

    def test_v1_docs_say_k_times_as_many_patterns(self):
        # worldScale() multiplies the pattern lookups by the COMP's scale k, so at Object size 1 a
        # COMP-scaled object shows k times as many ripples and film bands: finer for k > 1.
        readme = shader("README.md")
        note = next(l for l in readme.splitlines() if l.startswith("- **Ripples or film bands changed size"))
        self.assertIn("now shows k times as many ripples and film bands as before: finer if you scaled it up, "
                      "coarser if you scaled it down", note)
        g1 = next(d for d in json.loads((STUDY / "decisions.json").read_text()) if d["goal"].startswith("Family close G1"))
        self.assertIn("k times as many ripples and film bands per unit of the object", g1["consequence"])
        review = family_close_section((STUDY / "review.md").read_text())
        visible = review.split("**Visible changes.**", 1)[1].split("\n\n", 1)[0]
        risk = review.split("**Risk of merging today.**", 1)[1].split("\n\n", 1)[0]
        self.assertIn("k times as many as before: finer when the COMP scales the object up", visible)
        for name, text in (("README.md", readme), ("decisions.json", json.dumps(g1)),
                           ("review.md, Visible changes", visible), ("review.md, Risk of merging today", risk)):
            self.assertNotIn("fewer, larger", text, name)
            self.assertNotIn("1/k as many ripples per unit", text, name)
        # The merge risk is the hand-set Object size on a COMP-scaled object; the old Transform SOP
        # advice left the COMP unscaled, so those projects do not change.
        self.assertNotIn("Transform SOP advice, see", risk)
        self.assertIn("hand-set Object size", risk)
        self.assertIn("check('comp_scale_at_object_size_1_gives_k_times_the_patterns'",
                      (STUDY / "checks" / "preview_tests.cjs").read_text())

    def test_v2_merge_notes_name_flows_core_reference_test(self):
        # Liquid Glass Flow compares sha256 hashes of its checks/core_reference copies with this
        # study's shaders (test_core_reference_is_the_current_core). Merging the new shaders alone
        # turns Flow's suite red until Flow refreshes them; the records must say so.
        review = family_close_section((STUDY / "review.md").read_text())
        not_done = review.split("**Not done here, and why.**", 1)[1].split("\n\n", 1)[0]
        risk = review.split("**Risk of merging today.**", 1)[1].split("\n\n", 1)[0]
        close = json.loads((STUDY / "validation.json").read_text())["family_close"]
        for name, text in (("review.md, Not done here", not_done), ("review.md, Risk of merging today", risk),
                           ("validation.json family_close", json.dumps(close))):
            self.assertIn("test_core_reference_is_the_current_core", text, name)
            self.assertIn("amplitude0_matches_core", text, name)
            self.assertIn("checks/core_reference", text, name)
        flow = STUDY.parent / "liquid-glass-flow" / "checks" / "core_reference"
        if flow.is_dir():  # the note is true today: Flow's copies differ from this study's shaders
            differs = [n for n in ("liquid_glass.frag", "liquid_glass.vert")
                       if (flow / n).read_bytes() != (STUDY / n).read_bytes()]
            if differs:
                self.assertIn("fails until", risk)

    def test_v3_names_section_says_who_follows_the_family_rule(self):
        readme = shader("README.md")
        section = readme.split("## Names across the family", 1)[1].split("\n## ", 1)[0]
        bullet = next(l for l in section.splitlines() if l.startswith("- **Object size**"))
        self.assertIn("not yet one meaning", bullet)
        self.assertNotIn("has the same name everywhere and one meaning", bullet)
        # Who follows it is measured, not typed in: each mesh member's own Fit on this study's demo
        # torus in a Geometry COMP scaled s must give s (the rule: 1.45 s / 1.45), and its pixel
        # stage must count the COMP's scale in both pattern lookups (second verifier pass, CORE-V1).
        follow = next(p for p in re.split(r"(?<=[.;])\s+", bullet) if " follow it" in p).split(" follow it")[0]
        checked = 0
        for folder, word in FAMILY_MESH_MEMBERS.items():
            follows = follows_family_rule(folder)
            if follows is None:
                continue  # that member is not next to this study
            checked += 1
            with self.subTest(folder):
                self.assertEqual(re.search(rf"\b{word}\b", follow, re.I) is not None, follows, follow)
        self.assertGreaterEqual(checked, 1)
        # Blobs (raymarched blobs in a proxy box) keeps its own record; this bullet points to it.
        self.assertNotIn("Blobs", follow)
        self.assertIn("(../liquid-glass-blobs/README.md)", bullet)

    def test_v4_picking_records_match_what_a_pick_render_runs(self):
        g6 = next(d for d in json.loads((STUDY / "decisions.json").read_text()) if d["goal"].startswith("Family close G6"))
        self.assertIn("the same values in a different order", g6["consequence"])
        self.assertNotIn("the same values in the same order", g6["consequence"])
        self.assertNotIn("The header comment now says only the #else block runs", g6["choice"])
        readme = shader("README.md")
        self.assertIn("pass the point is still placed, and of the branch only the `#else` block runs", readme)
        self.assertNotIn("only its `#else` block runs", readme)
        self.assertNotIn("the pick render now runs only the `#else` block", readme)

    def test_v5_c3_record_compares_like_with_like(self):
        c3 = next(d for d in json.loads((STUDY / "decisions.json").read_text()) if d["goal"].startswith("Family sync C3"))
        evidence = c3["evidence"]
        self.assertNotIn("Liquid Glass Lit: the same numbers as here", evidence)
        self.assertIn("the same quarter-gap numbers as here", evidence)
        self.assertIn("3.967 with 290 pixels there, 3.966 with 286 here", evidence)
        self.assertIn("pixels the rainbow changes", evidence)          # Blobs' metric, named
        self.assertIn("6.44 to 8.63/255", evidence)                    # Blobs' numbers
        self.assertIn("0.62 to 0.68/255", evidence)                    # this study, same metric
        self.assertNotIn("here 0.3 to 1.8", evidence)                  # the unlike comparison
        measured = json.loads((STUDY / "checks" / "results" / "family-close-measurements.json").read_text())["v5_blobs_metric"]["results"]
        means = [r["mean_on_rainbow_pixels"] for k, r in measured.items() if k.endswith("thickness_preset")]
        self.assertEqual((min(means), max(means)), (0.62, 0.68))
        self.assertTrue(all(r["over32"] == 0 for r in measured.values()))

    def test_v6_red_claims_match_the_record(self):
        # Second verifier pass: the FamilyClose docstring said each of its tests fails on c94e849, but
        # the preprocessor helper's own test passes there (checks/results/red-run-family-close.json).
        record = json.loads((STUDY / "checks" / "results" / "red-run-family-close.json").read_text())["unit_tests_on_c94e849"]
        red = set(record["new_tests_failing"]) | set(record["changed_tests_failing"])
        helper = "test_preprocessed_helper_follows_ifdef_ifndef_and_else"
        for name in (n for n in dir(FamilyClose) if n.startswith("test_")):
            self.assertEqual(name in red, name != helper, name)
        self.assertIn(helper, record["note"])
        overclaim = re.compile(r"(?i)\b(?:every|each) (?:new or changed )?test fails on c94e849")
        self.assertIsNone(overclaim.search(" ".join(FamilyClose.__doc__.split())))
        self.assertIn(helper, " ".join(FamilyClose.__doc__.split()))


class FamilyCloseCritic(unittest.TestCase):
    """After the family close, a family critic's findings (review.md, Family
    close critic fixes). This study's share is PV4: the labels say what Object
    size does, in the wording Flow, Prism and Blobs use. PV3 (the Names across
    the family note) was already fixed by the second verifier pass and is
    pinned by test_v3_names_section_says_who_follows_the_family_rule. The test
    fails on the labels before the fix (checks/results/red-run-family-close-critic.json)."""

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
        self.assertEqual(sorted(scaled), ["Frost", "Thickness"])
        for name in sorted(scaled):
            self.assertNotIn("scene units", CONTROLS[name]["label"], name)
        self.assertTrue(CONTROLS["Thickness"]["label"].startswith("Thickness (x Object size"))
        # Object size: the family's one wording, with what this study's demo object fits to.
        size = CONTROLS["Objectsize"]
        m = re.fullmatch(r"Object size \(world radius / 1\.45; the demo (\w+) fits to ([0-9.]+)\)", size["label"])
        self.assertIsNotNone(m, size["label"])
        self.assertEqual(m.group(1), "torus")
        self.assertEqual(float(m.group(2)), round(size["default"], 2))
        self.assertEqual(float(m.group(2)), round(NATIVE["demo_radius"](SPEC) / 1.45, 2))


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
        self.body = functions(code_only(shader("liquid_glass.frag")))
        self.uniforms = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}

    def fitted(self, geos):
        comp = SimpleNamespace(par=_CriticPars(Objectsize=_CriticPar(1.0), Thickness=_CriticPar(0.5),
                                               Wobblescale=_CriticPar(3.0), Frost=_CriticPar(0.2),
                                               Density=_CriticPar(1.5)),
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


def article_sections(text):
    """{heading: text} for each level-2 section of a Markdown file, in order, split as article.py splits them."""
    heads = list(re.finditer(r"^## (.+)$", text, re.M))
    return {m[1]: text[m.end():heads[i + 1].start() if i + 1 < len(heads) else len(text)]
            for i, m in enumerate(heads)}


def shader_region(name, region):
    """The lines between '// @begin region' and '// @end region' in a shader file."""
    text = shader(name)
    return text.split(f"// @begin {region}\n", 1)[1].split(f"// @end {region}", 1)[0]


class TutorialPointers(unittest.TestCase):
    """Family critic (low): the tutorial's vertex paragraph said main() 'comes back in
    the last section'. The excerpt that shows main() sits in 'Use it in your own scene',
    and Limits and Credits follow it. Liquid Glass Lit fixed the same defect as LIT-CV1.
    Reproducing it found two more pointers that read as Credits: 'The back-face pass
    (last section)' and 'the plain bend from the last section'. A pointer now names its
    section in quotes. The two pointers by position that remain ('the next section',
    'a later section') are checked against the section order. The test fails on the
    files before the fix (checks/results/red-run-family-critic-pointer.json)."""

    def setUp(self):
        self.article = shader("article.source.md")
        self.sections = article_sections(self.article)
        self.order = list(self.sections)

    def home(self, needle):
        """The one section whose text holds `needle`."""
        found = [heading for heading, text in self.sections.items() if needle in text]
        self.assertEqual(len(found), 1, needle)
        return found[0]

    def test_pointers_name_the_section_that_shows_the_code(self):
        # The excerpt that shows main(): the vertex region that begins inside main().
        vert = shader("liquid_glass.vert")
        self.assertEqual(re.findall(r"// @begin (\w+)", vert[vert.index("void main()"):]), ["picking"])
        main_home = self.home("{{code:liquid_glass.vert:picking}}")
        self.assertNotEqual(main_home, self.order[-1])  # 'the last section' could not be right
        self.assertEqual(re.findall(r"`main\(\)` comes back in ([^)]*)\)", self.article), [f'"{main_home}"'])
        # The back-face pass and the plain bend: each named, each the section that holds its code.
        backface = self.home("{{code:liquid_glass.frag:backface}}")
        self.assertIn(f'The back-face pass (see "{backface}")', self.article)
        self.assertIn(f'the plain bend from "{self.home("{{code:liquid_glass.frag:bend}}")}"', self.article)
        # A quoted pointer names a heading that exists.
        quoted = re.findall(r'(?:comes back in|see|from) "([^"]+)"', self.article)
        self.assertEqual(len(quoted), 3)
        for name in quoted:
            self.assertIn(name, self.sections)
        # No pointer by a place that can read as the end of the article.
        self.assertEqual(re.findall(r"\b(?:last|final|first|previous) section\b", self.article, re.I), [])
        # The two pointers by position that remain point the right way.
        self.assertEqual(len(re.findall(r"\b(?:next|later) section\b", self.article)), 2)
        here = self.order.index(self.home("a question we need in the next section"))
        self.assertEqual(self.order[here + 1], self.home("{{code:liquid_glass.frag:setup}}"))
        self.assertIn("unitsToUV(", shader_region("liquid_glass.frag", "setup"))
        here = self.order.index(self.home("after the liquid ripples (a later section)"))
        self.assertGreater(self.order.index(self.home("{{code:liquid_glass.frag:liquid}}")), here)
        # The rendered article says the same.
        rendered = shader("article.md")
        for phrase in (f'comes back in "{main_home}"', f'The back-face pass (see "{backface}")'):
            self.assertIn(phrase, rendered)


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
    FRAG = "liquid_glass.frag"
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
