#!/usr/bin/env python3
"""Tests that need neither TouchDesigner nor a GPU.

  python3 checks/test_study.py

Covers the preset module (load and morph maths, menu, drift phases, demo
spin, Object size and colour helpers, with fake parameters and a fake clock),
the preset callback, native.apply() run in every order on a fake component,
native.inspect(), render_diagnostics() (the user's own Render TOP included)
and fit_glass() against fake TouchDesigner objects, the builder's input
linking, and the recipe's internal consistency: every preset
value has a control, every control default matches the default preset, every
preset value reaches the shader, every uniform the shader declares is bound,
the example layout table fits inside the proxy box, every experiment names a
real preset and has a preview image, blobs_geo asks to be drawn last, the
layout CHOP to TOP does not clamp, no node expression reads absTime, and every
Render TOP has Dither off. It also reads the GLSL source for rules a compiler
does not enforce: increasing smoothstep edges, no per-pixel noise, guarded
atan, colour buffers zeroed with constant indices, the output cap, the
screen orientation compared per pixel, with its derivatives taken before
any branch, and the documented picking form (the pick render keeps only the
deform, the projection and TDWritePickingValues()). The family close tests pin
Object size to the family rule (radius over 1.45, the film lookup times
worldScale(), the shape in box units) and the family's centre-line tie-break;
where the sibling studies are checked out alongside, they compare with them.
CloseVerifyFixes ties the family close records to their evidence: what an
old component keeps, the measured film detail, the red and guard tests on
c94e849, and the keys of the family rule record that the docs name.
FitHelperName pins the Fit helper's one name across the family, fit_glass(),
with fit_object_size as its alias for one round.
Adapted from the liquid-glass study's checks/test_study.py (commits a6f95c6
and 6a58487) and the liquid-glass-lit study's source rules (commit 6a58487).
"""
import builtins
import csv
import itertools
import json
import math
from pathlib import Path
import re
import runpy
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest import mock

STUDY = Path(__file__).resolve().parent.parent
SPEC = json.loads((STUDY / "study.json").read_text())
PRESETS = json.loads((STUDY / "presets.json").read_text())
EXPERIMENTS = json.loads((STUDY / "experiments.json").read_text())
MODULE = runpy.run_path(str(STUDY / "presets.py"))
CONTROLS = {c["name"]: c for c in SPEC["controls"]}
NODES = {n["id"]: n for n in SPEC["nodes"]}
FRAG = (STUDY / "blobs.frag").read_text()
SHADERS = {p.name: p.read_text() for p in sorted(STUDY.glob("*.frag")) + sorted(STUDY.glob("*.vert"))}

# native.py and builder.py start with `from td import *`; outside TouchDesigner a
# small stand-in module supplies the few names they use.
TD = sys.modules.setdefault("td", ModuleType("td"))
TD.app = SimpleNamespace(build="test", version="test")
TD.ParMode = SimpleNamespace(EXPRESSION="EXPRESSION", CONSTANT="CONSTANT")
NATIVE = runpy.run_path(str(STUDY / "native.py"))
BUILDER = runpy.run_path(str(STUDY / "builder.py"))


def code(source):
    """GLSL without // comments."""
    return re.sub(r"//.*", "", source)


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
        self.path = f"/project1/liquid_glass_blobs{FakeComp.count}"
        self.par = FakePars({k: FakePar(self, k, v, CONTROLS.get(k, {}).get("names"))
                             for k, v in values.items()})
        self._ops = {
            "presets_data": SimpleNamespace(text=(STUDY / "presets.json").read_text()),
            "presets": SimpleNamespace(module=SimpleNamespace(apply=MODULE["apply"])),
            "study_spec": SimpleNamespace(text=(STUDY / "study.json").read_text()),
            "study_experiments": SimpleNamespace(text=(STUDY / "experiments.json").read_text()),
        }

    def op(self, name):
        return self._ops.get(name)

    def state(self):
        return {k: v.val for k, v in self.par._pars.items()}


def defaults():
    return {c["name"]: c["default"] for c in SPEC["controls"] if c.get("default") is not None}


# What a user changes for their own scene; apply() must keep all of it.
SCENE = {"Refractiontop": "/project1/scene", "Reflectiontop": "/project1/photo", "Layouttop": "/project1/layout",
         "Reflectmode": "screen", "Objectsize": 2.5, "Flipv": True, "Colourspace": "raw"}


def scene_comp():
    values = defaults()
    values.update(SCENE)
    values["Demobackdrop"] = "type"  # a look control since the family names fix: apply() resets it
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


PERIODS = {"layout": 256.0 * math.pi, "ripple": 20.0 * math.pi, "film": 256.0}


def rate(which, speed):
    return {"layout": speed, "ripple": 0.4 + speed, "film": 0.15 * (0.1 + 0.3 * speed)}[which]


class PresetModule(unittest.TestCase):
    def test_apply_writes_every_preset_value(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "lavender_gel")
        for key, value in PRESETS["presets"]["lavender_gel"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        before = comp.state()
        MODULE["apply"](comp, "custom")
        self.assertEqual(before, comp.state())

    def test_presets_leave_seed_and_inputs_alone(self):
        comp = FakeComp(defaults())
        comp.par.Seed.val = 123
        MODULE["apply"](comp, "mercury_beads")
        self.assertEqual(comp.par.Seed.val, 123)
        self.assertEqual(comp.par.Steps.val, CONTROLS["Steps"]["default"])

    def test_morph_endpoints_and_midpoint(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "prism_clear")
        comp.par.Morphtarget.val = "amber_syrup"
        a = PRESETS["presets"]["prism_clear"]["values"]
        b = PRESETS["presets"]["amber_syrup"]["values"]
        for m, expect in ((0.0, lambda k: a[k]), (1.0, lambda k: b[k]), (0.5, lambda k: (a[k] + b[k]) / 2)):
            comp.par.Morph.val = m
            for key in SPEC["preset_keys"]:
                self.assertAlmostEqual(MODULE["u"](getattr(comp.par, key)), expect(key), 9, key)

    def test_menu_follows_the_evaluated_value(self):
        comp = FakeComp(defaults())
        comp.par.Stage.val = "thickness"
        self.assertEqual(MODULE["menu"](comp.par.Stage), CONTROLS["Stage"]["names"].index("thickness"))
        comp.par.Demobackdrop.val = "type"
        self.assertEqual(MODULE["menu"](comp.par.Demobackdrop), 1)

    # R1: integrated drift clock.
    def test_paused_phase_is_rate_times_fixed_time(self):
        comp = FakeComp(defaults())
        comp.par.Pause.val, comp.par.Time.val = True, 3.0
        speed = comp.par.Speed.val
        for which in PERIODS:
            self.assertAlmostEqual(MODULE["phase"](comp, which), (rate(which, speed) * 3.0) % PERIODS[which], 12, which)
        # The defaults give exactly what the shader multiplied out before (time x speed and so on).
        self.assertAlmostEqual(MODULE["phase"](comp, "layout"), 3.0 * 0.35, 12)
        self.assertAlmostEqual(MODULE["phase"](comp, "film"), 0.15 * 3.0 * (0.1 + 0.3 * 0.35), 12)

    def test_phase_is_wrapped_double_precision_and_holds_when_speed_is_zero(self):
        comp = FakeComp(defaults())
        speed = comp.par.Speed.val
        with Clock(30 * 24 * 3600 + 0.25) as clock:  # a month of uptime
            first = MODULE["phase"](comp, "layout")
            self.assertTrue(0.0 <= first < PERIODS["layout"])
            self.assertAlmostEqual(first, (speed * builtins.absTime.seconds) % PERIODS["layout"], 6)
            clock.step(1 / 60)
            moved = MODULE["phase"](comp, "layout")
            self.assertAlmostEqual(wrapped_change(first, moved, PERIODS["layout"]), speed / 60, 9)
            comp.par.Speed.val = 0.0
            del builtins.absTime  # speed 0 must not even read the clock...
            self.assertEqual(MODULE["phase"](comp, "layout"), moved)  # ...and holds the blobs where they are

    def test_drift_stays_smooth_through_morph_and_speed_changes_after_an_hour(self):
        # One frame of an A/B morph used to throw the layout by the change in Speed x the running time
        # (0.0005 x 3600 s = 1.8 at 1 h); now each frame moves by rate x speed x frame time.
        for which in PERIODS:
            comp = FakeComp(defaults())
            MODULE["apply"](comp, "prism_clear")
            comp.par.Morphtarget.val = "mercury_beads"  # Speed 0.35 -> 0.6
            dt = 1 / 60
            with Clock(3600.0) as clock:
                last = MODULE["phase"](comp, which)
                frames = [("Morph", i / 100) for i in range(1, 101)]               # a 100-frame morph
                frames += [("Speed", 0.35 + 0.27 * i) for i in range(1, 11)]      # a fast slider drag
                for name, value in frames:
                    getattr(comp.par, name).val = value
                    clock.step(dt)
                    speed = MODULE["u"](comp.par.Speed)
                    now = MODULE["phase"](comp, which)
                    self.assertTrue(0.0 <= now < PERIODS[which])
                    change = wrapped_change(last, now, PERIODS[which])
                    self.assertAlmostEqual(change, rate(which, speed) * dt, 9, (which, name, value))
                    last = now

    def test_drift_is_the_same_within_a_frame_and_resumes_without_a_jump(self):
        comp = FakeComp(defaults())
        speed = comp.par.Speed.val
        with Clock(7200.0) as clock:
            a = MODULE["phase"](comp, "ripple")
            self.assertEqual(MODULE["phase"](comp, "ripple"), a)  # every call in a frame agrees
            comp.par.Pause.val, comp.par.Time.val = True, 2.0
            paused = MODULE["phase"](comp, "ripple")
            self.assertAlmostEqual(paused, (0.4 + speed) * 2.0, 12)  # repeatable experiments
            clock.step(5.0)
            comp.par.Pause.val = False
            self.assertEqual(MODULE["phase"](comp, "ripple"), paused)  # unpausing continues from there
            clock.step(0.5)
            self.assertAlmostEqual(MODULE["phase"](comp, "ripple"), paused + (0.4 + speed) * 0.5, 9)

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

    def test_phase_periods_are_where_the_shader_repeats(self):
        # The shader rounds layout wave speeds to multiples of 1/128 (loopRate), so 256 pi of phase
        # is a whole number of turns for every wave; the ripple's 1.7, 1.3 and 1.1 turn whole after
        # 20 pi; the film noise lattice repeats every 256 (latticeHash wraps cells with & 255).
        self.assertEqual({k: v[1] for k, v in MODULE["PHASES"].items()}, PERIODS)
        self.assertIn("floor(r * 128.0 + 0.5) / 128.0", FRAG)
        for k in range(1, 128 * 3):
            turns = (k / 128) * PERIODS["layout"] / (2 * math.pi)
            self.assertAlmostEqual(turns, round(turns), 9)
        for factor in (1.7, 1.3, 1.1):
            turns = factor * PERIODS["ripple"] / (2 * math.pi)
            self.assertAlmostEqual(turns, round(turns), 9)
        self.assertIn("((c + 128) & 255) - 128", FRAG)
        layout = code(FRAG[FRAG.index("void buildLayout()"):FRAG.index("// @end layout")])
        self.assertIn("float t = uPhase.x;", layout)
        for call in re.findall(r"sin\(([^;]*?\* t\b)", layout):
            self.assertIn("loopRate(", call, call)

    # R8: colour parameters.
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

    # C8: Object size.
    def test_object_size_one_is_exactly_u_and_other_sizes_scale(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "sapphire_drops")
        comp.par.Morphtarget.val, comp.par.Morph.val = "frosted_milk", 0.37
        comp.par.Objectsize.val = 1.0  # the default is the demo box's fit, 1 / 1.45, since family close G1
        for name in ("Density", "Backdrop", "Frost"):
            par = getattr(comp.par, name)
            self.assertEqual(MODULE["sized"](par, -1), MODULE["u"](par))  # bit-identical at 1
            self.assertEqual(MODULE["sized"](par, 1), MODULE["u"](par))
        comp.par.Objectsize.val = 4.0
        self.assertAlmostEqual(MODULE["sized"](comp.par.Density, -1), MODULE["u"](comp.par.Density) / 4.0, 12)
        self.assertAlmostEqual(MODULE["sized"](comp.par.Backdrop, 1), MODULE["u"](comp.par.Backdrop) * 4.0, 12)


class PresetCallback(unittest.TestCase):
    def setUp(self):
        self.fits = []
        modules = {"presets": SimpleNamespace(module=SimpleNamespace(apply=MODULE["apply"])),
                   "study_tools": SimpleNamespace(module=SimpleNamespace(fit_glass=lambda c: self.fits.append(c) or {}))}
        self.callbacks = runpy.run_path(str(STUDY / "preset_exec.py"), init_globals={"op": modules.get})

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        comp.par.Ior.val = 2.2
        comp.par.Preset.val = "custom"
        before = comp.state()
        self.callbacks["onValueChange"](comp.par.Preset, "prism_clear")
        self.assertEqual(before, comp.state())

    def test_choosing_a_preset_loads_it(self):
        comp = FakeComp(defaults())
        comp.par.Preset.val = "amber_syrup"
        self.callbacks["onValueChange"](comp.par.Preset, "prism_clear")
        for key, value in PRESETS["presets"]["amber_syrup"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_fit_pulse_runs_the_fit(self):
        comp = FakeComp(defaults())
        self.callbacks["onPulse"](SimpleNamespace(name="Fitglass", owner=comp))
        self.assertEqual(self.fits, [comp])
        self.assertIn("Fitglass", NODES["preset_exec"]["parameters"]["pars"].split())


class NativeApply(unittest.TestCase):
    """R4: every experiment resets the look first, so order never matters."""

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
        self.assertEqual(reset, {"Morphtarget", "Morph", "Samples", "Steps", "Layout", "Seed", "Conserve",
                                 "Envrotate", "Screenwarp", "Lightdirx", "Lightdiry", "Lightdirz",
                                 "Pause", "Time", "Stage", "Demospin", "Demobackdrop"})

    def test_demo_backdrop_returns_to_the_checker(self):
        # Family names fix: the experiments' captures use the Checker, so a user's Type is reset.
        for item in EXPERIMENTS:
            comp = scene_comp()
            self.assertEqual(comp.par.Demobackdrop.val, "type")
            NATIVE["apply"](comp, item["id"])
            self.assertEqual(comp.par.Demobackdrop.val, "checker", item["id"])


class FakeNode:
    def __init__(self, name, optype="glslMAT", errors="", warnings=""):
        self.name, self.OPType, self._errors, self._warnings = name, optype, errors, warnings
        self.path, self.text, self.width, self.height, self.cooked = "/project1/c/" + name, "", 1280, 720, 0

    def errors(self, recurse=False):
        return self._errors

    def warnings(self, recurse=False):
        return self._warnings

    def cook(self, force=False):
        self.cooked += 1


class FakeComponent:
    """Enough of the built component for native.inspect() and fit_glass()."""

    def __init__(self, missing=()):
        self.path, self.name = "/project1/c", "c"
        self.nodes = {n["id"]: FakeNode(n["id"], n["type"]) for n in SPEC["nodes"] if n["id"] not in missing}
        self.nodes["render"]._errors = "render: compile error in the material copy"
        self.nodes["study_spec"] = SimpleNamespace(text=json.dumps(SPEC))
        self.children = [FakeNode("info_material", "infoDAT")]
        self.customPars = []
        self.par = SimpleNamespace(Refractiontop=SimpleNamespace(evalOPs=lambda: []),
                                   Reflectiontop=SimpleNamespace(evalOPs=lambda: []),
                                   Layouttop=SimpleNamespace(evalOPs=lambda: []),
                                   Objectsize=SimpleNamespace(val=1.0))

    def op(self, name):
        return self.nodes.get(name)

    def errors(self, recurse=False):
        return ""

    def warnings(self, recurse=False):
        return ""

    def scriptErrors(self, recurse=False):
        return "presets: Traceback ..."

    def fetch(self, key, default=None):
        return default


def fake_render(path, geometry=(), overridemat=None, errors="", warnings=""):
    """A Render TOP outside the component: its Geometry list and Override Material."""
    par = SimpleNamespace(geometry=SimpleNamespace(evalOPs=lambda: list(geometry)),
                          overridemat=SimpleNamespace(eval=lambda: overridemat))
    return SimpleNamespace(path=path, name=path.rsplit("/", 1)[1], par=par,
                           errors=lambda recurse=False: errors, warnings=lambda recurse=False: warnings)


def fake_geo(material=None):
    """A Geometry COMP in your scene with a Material parameter."""
    return SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: material)))


class NativeDiagnostics(unittest.TestCase):
    def test_inspect_reports_scripts_blocking_errors_and_every_render(self):
        comp = FakeComponent(missing=("demo_ring",))
        # TouchDesigner's op('/').findChildren(type=renderTOP) finds the component's own renders
        # and yours. README step 1: your Render TOP draws blobs_geo; your scene render does not.
        user = fake_render("/project1/render1", geometry=[fake_geo(), comp.nodes["blobs_geo"]],
                           errors="render1: compile error in its copy of the material")
        scene = fake_render("/project1/render_scene_only", geometry=[fake_geo()])
        found = {"renderTOP": [comp.nodes["render"], comp.nodes["render_scene"], user, scene], "renderpassTOP": []}
        project = SimpleNamespace(findChildren=lambda type=None, **kw: found[type])
        with mock.patch.dict(NATIVE["inspect"].__globals__,
                             {"op": lambda path: project, "RENDER_TYPES": ("renderTOP", "renderpassTOP")}):
            report = NATIVE["inspect"](comp)
        self.assertEqual(report["script_errors"], "presets: Traceback ...")
        self.assertEqual(report["blocking_errors"], {"render": "render: compile error in the material copy"})
        self.assertEqual(sorted(report["render_diagnostics"]), ["/project1/render1", "render", "render_scene"])
        self.assertEqual(report["render_diagnostics"]["render"]["errors"], "render: compile error in the material copy")
        self.assertEqual(report["render_diagnostics"]["/project1/render1"],
                         {"errors": "render1: compile error in its copy of the material", "warnings": ""})
        self.assertEqual(report["missing_nodes"], [])  # demo_ring is not a shader or render
        self.assertGreater(comp.nodes["render"].cooked, 0)
        with self.assertRaises(RuntimeError):
            NATIVE["capture"](comp, "/nonexistent-dir-for-test/x.png")

    def test_render_diagnostics_reports_the_renders_that_draw_the_blobs(self):
        comp = FakeComponent()
        material, blobs_geo = comp.nodes["material"], comp.nodes["blobs_geo"]
        renders = [
            comp.nodes["render"], comp.nodes["render_scene"],                    # the component's own: by name
            fake_render("/project1/render1", geometry=[blobs_geo], warnings="w"),  # README step 1
            fake_render("/project1/copy_pass", geometry=[fake_geo(material)]),     # a copy of blobs_geo
            fake_render("/project1/override", overridemat=material, errors="e"),   # Override Material
            fake_render("/project1/scene", geometry=[fake_geo(), SimpleNamespace()]),  # no blobs: left out
            fake_render("/project1/empty"),
        ]
        report = NATIVE["render_diagnostics"](comp, renders)
        self.assertEqual(sorted(report), ["/project1/copy_pass", "/project1/override", "/project1/render1",
                                          "render", "render_scene"])
        self.assertEqual(report["/project1/render1"], {"errors": "", "warnings": "w"})
        self.assertEqual(report["/project1/override"], {"errors": "e", "warnings": ""})
        # Outside TouchDesigner there is no project to search: the component's own renders remain.
        self.assertEqual(sorted(NATIVE["render_diagnostics"](comp)), ["render", "render_scene"])
        self.assertIn('"render_diagnostics": render_diagnostics(component)',
                      (STUDY / "native.py").read_text().split("def inspect(")[1])

    def test_fit_object_size_reads_the_world_transform(self):
        comp = FakeComponent()
        geo = SimpleNamespace(path="/project1/c/blobs_geo", worldTransform=SimpleNamespace(determinant=lambda: 8.0))
        fit = NATIVE["fit_glass"](comp, geo)
        # Scale 2: the box's radius is 2 scene units, over the family's reference radius 1.45 (family close G1).
        self.assertEqual((fit["radius"], fit["reference_radius"]), (2.0, 1.45))
        self.assertAlmostEqual(fit["object_size"], 2.0 / 1.45, 12)
        self.assertAlmostEqual(comp.par.Objectsize.val, 2.0 / 1.45, 12)
        # Without a readable transform, half the largest side of the COMP's bounds stands in for the radius.
        bounds = SimpleNamespace(size=SimpleNamespace(x=0.2, y=0.6, z=0.4))
        geo = SimpleNamespace(path="/x", bounds=lambda: bounds)
        self.assertAlmostEqual(NATIVE["fit_glass"](comp, geo)["object_size"], 0.3 / 1.45, 12)


class BuilderInputs(unittest.TestCase):
    """R3: input fields in constant mode, pointing at the demo nodes, checked, with categorized warnings."""

    def make(self, resolves=True):
        target = SimpleNamespace(path="/project1/liquid_glass_blobs/scene")
        par = SimpleNamespace(val=None, default=None, expr=None)
        par.eval = lambda: target if resolves else None
        component = SimpleNamespace(name="liquid_glass_blobs", par=SimpleNamespace(Refractiontop=par),
                                    relativePath=lambda node: "scene")
        return component, par, {"scene": target}

    def test_demo_inputs_are_constant_paths_with_reset_to_default(self):
        for name, target in (("Refractiontop", "scene"), ("Reflectiontop", "demo_env"), ("Layouttop", "layout_top")):
            c = CONTROLS[name]
            self.assertEqual((c.get("demo_target"), c.get("default"), c.get("setup")), (target, None, True), name)
            self.assertNotIn("expression", c, name)
            self.assertIn(target, NODES)
        component, par, nodes = self.make()
        warnings = []
        BUILDER["link_demo_inputs"](component, [CONTROLS["Refractiontop"]], nodes, warnings)
        self.assertEqual((par.val, par.default, par.expr, warnings), ("scene", "scene", None, []))

    def test_unresolved_or_missing_demo_input_warns_under_inputs(self):
        component, par, nodes = self.make(resolves=False)
        warnings = []
        BUILDER["link_demo_inputs"](component, [CONTROLS["Refractiontop"]], nodes, warnings)
        self.assertEqual(par.expr, "me.op('scene')")
        self.assertTrue(warnings and warnings[0].startswith("inputs: Refractiontop"))
        warnings = []
        BUILDER["link_demo_inputs"](component, [CONTROLS["Refractiontop"]], {}, warnings)
        self.assertTrue(warnings[0].startswith("inputs: Refractiontop left empty"))

    def test_warning_categories(self):
        self.assertEqual(list(BUILDER["WARNING_NOTES"]), ["material", "inputs", "optional", "setup", "demo"])
        warnings = []
        BUILDER["attempt"](False, warnings, "material", lambda: 1 / 0)
        self.assertTrue(warnings[0].startswith("material: "))


class Recipe(unittest.TestCase):
    def test_twelve_complete_presets(self):
        # The brief asks for 12 presets (8 before verifier finding V1).
        self.assertEqual(len(PRESETS["presets"]), 12)
        self.assertEqual(PRESETS["order"], list(PRESETS["presets"]))
        for name, preset in PRESETS["presets"].items():
            self.assertEqual(sorted(preset["values"]), sorted(SPEC["preset_keys"]), name)

    def test_preset_values_inside_control_ranges(self):
        for name, preset in PRESETS["presets"].items():
            for key, value in preset["values"].items():
                c = CONTROLS[key]
                self.assertTrue(c["min"] <= value <= c["max"], f"{name}.{key}={value}")

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

    def test_every_preset_value_reaches_the_shader_morphed(self):
        # Directly through u(), through sized() (u() times Object size), or, for Speed, through
        # phase(), which integrates u(Speed) (presets.py).
        text = json.dumps(NODES["material"]["uniforms"])
        morphed = re.findall(r"module\.(?:u|sized)\(parent\(\)\.par\.(\w+)", text)
        self.assertIn("op('presets').module.phase(parent(), 'layout')", text)
        self.assertIn("u(comp.par.Speed)", (STUDY / "presets.py").read_text())
        self.assertEqual(sorted(morphed + ["Speed"]), sorted(SPEC["preset_keys"]))

    def test_shader_uniforms_and_bindings_agree(self):
        declared = set(re.findall(r"^uniform\s+\w+\s+(\w+);", FRAG, re.M))
        bound = {u["name"] for u in NODES["material"]["uniforms"]}
        self.assertEqual(declared, bound)
        for u in NODES["material"]["uniforms"]:
            if u["name"].startswith("s"):
                self.assertEqual(u.get("kind"), "sampler", u["name"])
                self.assertIn("op('blank')", u["values"][0], u["name"])

    def test_teaching_stages_match_the_shader(self):
        # blobs.frag numbers stages 0..12; the menu must list exactly that many, in order.
        self.assertEqual(len(CONTROLS["Stage"]["names"]), 13)
        self.assertEqual(CONTROLS["Stage"]["names"][:4], ["final", "proxy", "steps", "normal"])

    def test_material_draws_box_back_faces_with_depth(self):
        p = NODES["material"]["parameters"]
        self.assertEqual(p["cullface"], "frontfaces")
        self.assertTrue(p["depthtest"] and p["depthwriting"])
        self.assertEqual((p["srcblend"], p["destblend"], p["postmultalpha"]), ("one", "omsa", False))
        box = NODES["blobs_geo/box"]["parameters"]
        self.assertEqual((box["sizex"], box["sizey"], box["sizez"]), (2.0, 2.0, 2.0))

    def test_core_nodes_are_strict_and_demo_nodes_lenient(self):
        core = {"vertex", "pixel", "material", "blobs_geo", "blobs_geo/box", "presets_data", "presets", "preset_exec"}
        for node_id in core:
            self.assertFalse(NODES[node_id].get("demo") or NODES[node_id].get("lenient"), node_id)
        for node_id in ("render", "render_scene", "scene", "layout_top", "demo_ring", "demo_backdrop"):
            self.assertTrue(NODES[node_id].get("demo"), node_id)

    def test_layout_table_fits_the_box(self):
        # The shader keeps |centre| + radius x (1 + Stretch) + Merge / 4 + 0.01 inside the box
        # on every axis (keepInside in blobs.frag); with the layout_top experiment's settings
        # no row may need moving.
        e = next(x for x in EXPERIMENTS if x["id"] == "layout_top")["parameters"]
        with open(STUDY / "blob_layout.tsv", newline="") as f:
            rows = list(csv.DictReader(f, delimiter="\t"))
        self.assertGreaterEqual(len(rows), 1)
        for row in rows:
            x, y, z, r = (float(row[k]) for k in "xyzr")
            self.assertTrue(r > 0, row)
            margin = r * (1 + e["Stretch"]) + 0.25 * e["Merge"] + 0.01
            self.assertLessEqual(max(abs(x), abs(y), abs(z)) + margin, 1.0, row)

    def test_blobs_are_drawn_last(self):
        # Draw Priority: smaller values draw later (COMP Render page). Lenient: a hint, not a core parameter.
        self.assertLess(NODES["blobs_geo"]["lenient_parameters"]["drawpriority"], 0)
        self.assertNotIn("drawpriority", NODES["demo_ring"].get("parameters", {}))

    def test_no_expression_reads_absolute_time(self):
        # R1: anything that moves goes through presets.advance(), so changing its speed never jumps.
        self.assertNotIn("absTime", json.dumps(SPEC["nodes"]))
        self.assertNotIn("absTime", json.dumps(SPEC["controls"]))
        self.assertEqual(NODES["demo_ring"]["expressions"]["ry"], "op('presets').module.spin(parent())")
        phase = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uPhase")["values"]
        self.assertEqual(phase[:3], [f"op('presets').module.phase(parent(), '{k}')" for k in ("layout", "ripple", "film")])

    # Verifier V3 (core A9): zero-wiring mode empties Refraction TOP; the demo's Select TOP then shows
    # 'blank' instead of an empty path, which can error inside 'over', a node capture() and export() check.
    def test_behind_falls_back_to_blank_without_a_refraction_top(self):
        expr = NODES["behind"]["expressions"]["top"]
        blank, scene = SimpleNamespace(name="blank"), SimpleNamespace(name="scene")
        for given, expect in ((scene, scene), (None, blank)):
            par = SimpleNamespace(Refractiontop=SimpleNamespace(eval=lambda given=given: given))
            env = {"parent": lambda par=par: SimpleNamespace(par=par), "op": {"blank": blank}.get}
            self.assertIs(eval(expr, env), expect, given)
        self.assertEqual(NODES["blank"]["type"], "constantTOP")
        self.assertIn({"from": "behind", "to": "over", "input": 1}, SPEC["wires"])
        self.assertIn("over", NATIVE["CORE_NODES"])

    def test_layout_top_reads_channels_in_order_without_clamping(self):
        p = NODES["layout_top"]["parameters"]
        self.assertEqual((p["dataformat"], p["format"], p["clamp"]), ("rgba", "rgba32float", False))

    def test_experiments_use_real_presets_and_have_previews(self):
        self.assertGreaterEqual(len(EXPERIMENTS), 8)
        for e in EXPERIMENTS:
            preset = e["parameters"].get("Preset")
            self.assertIn(preset, PRESETS["presets"], e["id"])
            self.assertTrue((STUDY / e["preview"]).is_file(), e["preview"])
            self.assertTrue((STUDY / (e["preview"] + ".json")).is_file(), e["preview"] + ".json")
            self.assertIn("pending", e["observation"], e["id"])
            for name in e["parameters"]:
                self.assertFalse(CONTROLS[name].get("setup"), (e["id"], name))  # experiments never touch setup

    # R9
    def test_samplers_set_filter_and_extend_modes(self):
        samplers = {u["name"]: u for u in NODES["material"]["uniforms"] if u.get("kind") == "sampler"}
        self.assertEqual({k: (u["filter"], u["extendu"], u["extendv"]) for k, u in samplers.items()},
                         {"sRefraction": ("mipmaplinear", "mirror", "mirror"),
                          "sReflection": ("mipmaplinear", "repeat", "hold"),
                          "sLayout": ("nearest", "hold", "hold")})

    def test_menu_uniforms_follow_the_evaluated_menu(self):
        text = json.dumps([n.get("uniforms", []) for n in SPEC["nodes"]])
        self.assertNotIn("menuIndex", text)
        for name in ("Reflectmode", "Layout", "Stage", "Demobackdrop"):
            self.assertIn(f"op('presets').module.menu(parent().par.{name})", text, name)

    # R8
    def test_colour_mode_and_energy_toggle(self):
        self.assertEqual((CONTROLS["Colourspace"]["default"], CONTROLS["Colourspace"]["names"], CONTROLS["Colourspace"].get("setup")),
                         ("auto", ["auto", "raw", "srgb"], True))
        self.assertEqual((CONTROLS["Conserve"]["default"], CONTROLS["Conserve"].get("setup")), (False, None))
        state = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uState")["values"]
        surface = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uSurface")["values"]
        self.assertEqual(state[3], "op('presets').module.decode_colours(parent())")
        self.assertEqual(surface[3], "1 if parent().par.Conserve.eval() else 0")

    # C4
    def test_every_render_top_has_dither_off(self):
        renders = [n for n in SPEC["nodes"] if n["type"] in ("renderTOP", "renderpassTOP")]
        self.assertGreaterEqual(len(renders), 2)
        for n in renders:
            self.assertIs(n.get("parameters", {}).get("dither"), False, n["id"])

    # C5
    def test_info_dats_on_render_tops(self):
        builder = (STUDY / "builder.py").read_text()
        self.assertIn('n.OPType in ("glslTOP", "glslMAT", "renderTOP", "renderpassTOP")', builder)

    # C8
    def test_object_size_is_a_setup_control_feeding_scene_unit_uniforms(self):
        c = CONTROLS["Objectsize"]
        self.assertEqual((c["default"], c.get("setup")), (1.0 / 1.45, True))  # the demo box's fit (family close G1)
        self.assertEqual(CONTROLS["Fitglass"]["type"], "pulse")
        text = json.dumps(NODES["material"]["uniforms"])
        for name, power in (("Density", -1), ("Backdrop", 1), ("Frost", 1)):
            self.assertIn(f"op('presets').module.sized(parent().par.{name}, {power})", text)

    # C9
    def test_demo_backdrop_menu(self):
        c = CONTROLS["Demobackdrop"]
        self.assertEqual((c["default"], c["names"], c.get("setup")), ("checker", ["checker", "type"], None))
        self.assertEqual(NODES["demo_backdrop"]["uniforms"][0]["name"], "uBackdrop")
        self.assertIn("uniform vec4 uBackdrop;", (STUDY / "backdrop.frag").read_text())
        self.assertIn("float typeBlock(vec2 p, float px, float rowHeight, float rows, float top)",
                      (STUDY / "backdrop.frag").read_text())


def smoothstep_edges(source):
    """(edge0, edge1) text of every smoothstep() call, comments removed."""
    calls = []
    text = code(source)
    for match in re.finditer(r"\bsmoothstep\s*\(", text):
        depth, args, current = 1, [], ""
        for ch in text[match.end():]:
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


def preprocessed(source, defined):
    """The lines a GLSL preprocessor keeps when the names in `defined` are
    #defined. Handles #ifdef, #ifndef, #else and #endif only; any other
    conditional fails the test instead of being guessed."""
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


class ShaderSource(unittest.TestCase):
    # R5
    def test_reversed_edge_detector_catches_the_old_forms(self):
        for old in ("smoothstep(0.0, -0.7, el)", "smoothstep(px, -px, d)"):
            self.assertTrue(reversed_edges(*smoothstep_edges(old)[0]), old)
        self.assertFalse(reversed_edges(*smoothstep_edges("smoothstep(-px, px, d)")[0]))

    def test_smoothstep_edges_increase_in_every_shader(self):
        # Khronos: undefined when edge0 >= edge1 (also on Metal via MoltenVK).
        found = 0
        for name, source in SHADERS.items():
            for edges in smoothstep_edges(source):
                found += 1
                self.assertFalse(reversed_edges(*edges), f"{name}: smoothstep{edges}")
        self.assertGreaterEqual(found, 8)  # the parser found the calls: 3 in blobs.frag, 3 in env.frag, 2 in backdrop.frag

    def test_atan_only_through_azimuth(self):
        for name in ("blobs.frag", "env.frag"):
            text = code(SHADERS[name])
            self.assertEqual(text.count("atan("), 1, name)  # the one inside azimuth(), behind its guard
            self.assertIn("dot(d.xz, d.xz) > 1e-12 ? atan(d.z, d.x) : 0.0", text, name)

    def test_hit_normal_faces_the_camera_without_a_flip(self):
        text = code(FRAG)
        self.assertIn("vec3 n = faceCamera(", text)
        self.assertNotIn("n = -n;", text)
        self.assertIn("r0 * r0", text)
        self.assertNotIn("pow((ior - 1.0)", text)
        self.assertIn("hh > 1e-12 ? h * inversesqrt(hh) : vec3(0.0)", text)  # light straight behind: no highlight

    # R6
    def test_frost_uses_the_r2_disc_and_flat_blur_widens_with_warp(self):
        text = code(FRAG)
        self.assertIn("vec2(0.7548776662, 0.5698402910)", text)
        self.assertIn("offset += discPoint(i) * uBody.y * 0.25 * toUV;", text)
        self.assertNotIn("2.39996;\n        float radius", text)
        self.assertIn("mode == 1 ? max(1.0, 2.5 * uEnv.w) : 1.0", text)

    # R8
    def test_colours_go_through_param_colour(self):
        text = code(FRAG)
        for name in ("uGlass", "uLightColor", "uRim", "uReflect"):
            raw = re.findall(rf"(?<!paramColour\(){name}\.rgb", text)
            self.assertEqual(raw, [], name)
            self.assertIn(f"paramColour({name}.rgb)", text, name)
        self.assertIn("float keep = 1.0 - uSurface.w * clamp(reflectance, 0.0, 1.0);", text)

    # C2
    def test_extra_colour_buffers_are_zeroed_with_constant_indices(self):
        text = code(FRAG)
        self.assertIn("#ifndef TD_NUM_COLOR_BUFFERS\n#define TD_NUM_COLOR_BUFFERS 1\n#endif", text)
        self.assertIn("layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];", text)
        for k in range(1, 8):
            self.assertIn(f"#if TD_NUM_COLOR_BUFFERS > {k}\n    fragColor[{k}] = vec4(0.0);\n#endif", text)
        self.assertIsNone(re.search(r"\bfragColor\s*=", text), "every write names a colour buffer")
        self.assertIn("#ifndef TD_PICKING_ACTIVE", SHADERS["blobs.vert"])
        self.assertIn("TDWritePickingValues();", SHADERS["blobs.vert"])

    # Picking fix P1. Write a GLSL MAT, Picking (oldid 38399): "when picking is
    # occuring, the define TD_PICKING_ACTIVE is set and only the code inside the
    # #else block is executed", in the form '#ifndef TD_PICKING_ACTIVE ... #else
    # TDWritePickingValues(); #endif'. The projection stays outside the branch,
    # as in the exported MAT shader on docs.derivative.ca/Syntaxhighlight.
    def test_pick_render_runs_only_the_documented_picking_block(self):
        vert = code(SHADERS["blobs.vert"])
        pick = main_statements(preprocessed(vert, {"TD_PICKING_ACTIVE"}))
        self.assertEqual(pick, ["vec4 world = TDDeform(vec4(TDPos(), 1.0))",
                                "gl_Position = TDWorldToProj(world)",
                                "TDWritePickingValues()"])
        self.assertRegex(vert, r"\n#ifndef TD_PICKING_ACTIVE\n[\s\S]*\n#else\s+TDWritePickingValues\(\);\s+#endif\n")
        ordinary = main_statements(preprocessed(vert, set()))
        self.assertNotIn("TDWritePickingValues()", ordinary)
        self.assertIn("gl_Position = TDWorldToProj(world)", ordinary)
        outputs = re.findall(r"^\s*(?:flat\s+)?out\s+\w+\s+(\w+)\s*;", vert, re.M)
        self.assertEqual(len(outputs), 7, outputs)
        for name in outputs:  # the ordinary render still writes every output
            self.assertTrue(any(s.startswith(name + " = ") for s in ordinary), name)

    def test_preprocessed_helper_follows_ifdef_ifndef_and_else(self):
        source = "a\n#ifdef X\nb\n#else\nc\n#endif\n#ifndef X\nd\n#else\ne\n#endif\nf"
        self.assertEqual(preprocessed(source, {"X"}).split(), ["a", "b", "e", "f"])
        self.assertEqual(preprocessed(source, set()).split(), ["a", "c", "d", "f"])
        with self.assertRaises(AssertionError):
            preprocessed("#if X > 1\na\n#endif", set())

    # C4
    def test_no_dither_or_per_pixel_noise(self):
        for name, source in SHADERS.items():
            text = code(source)
            self.assertNotIn("TDDither", text, name)
            self.assertIsNone(re.search(r"\b\w*(hash|noise|rand|random)\w*\s*\(\s*(vUV|uv\b|p\b|gl_FragCoord)", text, re.I), name)
            self.assertIsNone(re.search(r"fract\s*\(\s*sin\s*\(\s*dot\s*\(\s*(gl_FragCoord|vUV|uv\b)", text), name)
            uses = [line.strip() for line in text.splitlines() if "gl_FragCoord" in line]
            allowed = {"vec2 uv = (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw;",
                       "vec2 raster = 2.0 * (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw - 1.0;",
                       "gl_FragDepth = gl_FragCoord.z;"}
            self.assertTrue(set(uses) <= allowed, (name, uses))

    # C5
    def test_output_is_capped_and_goes_through_one_place(self):
        text = code(FRAG)
        self.assertEqual(text.count("TDOutputSwizzle("), 1)
        self.assertIn("fragColor[0] = TDOutputSwizzle(vec4(min(c.rgb, vec3(1024.0)), c.a));", text)

    # C6
    def test_screen_sign_compares_positions_and_is_measured_before_any_branch(self):
        text = code(FRAG)
        start = text.index("vec2 screenSign(")
        sign = text[start:text.index("\n}\n", start)]
        # The pixel's projected position against its raster position (core and prism form) ...
        self.assertIn("vec2 screenSign(vec2 ndc, vec2 ndcStep, vec2 depthStep)", sign)
        self.assertIn("vec2 raster = 2.0 * (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw - 1.0;", sign)
        self.assertIn("abs(ndc.x + raster.x) < abs(ndc.x - raster.x) ? -1.0 : 1.0", sign)
        self.assertIn("abs(ndc.y + raster.y) < abs(ndc.y - raster.y) ? -1.0 : 1.0", sign)
        # ... the derivative only on a centre line, where both are 0, and only off edge-on faces ...
        self.assertIn("vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));", sign)
        self.assertIn("runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);", sign)
        # ... and no projection sign: toScreen() projects with camProj, which already carries it.
        self.assertNotIn("proj", sign)
        self.assertIn("if (uMarch.w > 0.5) runs.y = -runs.y;", sign)
        main = text[text.index("void main()"):]
        first_branch = min(i for i in (main.find("if ("), main.find("TDCheckDiscard();")) if i >= 0)
        for line in ("vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));",
                     "vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);",
                     "gScreenSign = screenSign(ndc, ndcStep, depthStep);"):
            self.assertLess(main.index(line), first_branch, line)
        self.assertEqual(text.count("dFdx("), 2)  # both in the two lines above
        self.assertEqual(text.count("dFdy("), 2)
        self.assertIn("return 0.5 * c.xy / max(c.w, 1e-4) * gScreenSign;", text)
        self.assertNotIn("sign(vec2(proj[0][0], proj[1][1]))", text)


# ---------------------------------------------------------------- family names (review.md)
class FamilyNames(unittest.TestCase):
    """Family gap (verifier, low): one thing had several names across the five
    members. The Fit pulse was Fitglass, Fitflow or Fitsize, labelled 'Fit to
    Glass geometry' or 'Fit to glass objects'; the docs called the demo backdrop
    menu 'Backdrop' or 'Demo backdrop'; and Blobs alone kept that menu as a setup
    control that experiments never reset. The core README lists the mapping once
    (Names across the family). These tests pin this study to it."""

    BACKDROP = "Demobackdrop"  # the demo backdrop menu's parameter name here

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
        # Here Backdrop is the Optics page's distance, a preset value; the core table says so.
        self.assertEqual((CONTROLS["Backdrop"]["type"], CONTROLS["Backdrop"]["page"]), ("float", "Optics"))
        self.assertIn("Backdrop", SPEC["preset_keys"])

    def test_docs_use_the_family_names(self):
        for name in ("README.md", "article.source.md"):
            text = (STUDY / name).read_text()
            with self.subTest(name):
                self.assertEqual(re.findall(r"Fit to (?!Glass geometry)\w+ \w+", text), [])
                self.assertEqual(re.findall(r"\b(?:Fitflow|Fitsize)\b", text), [])
                # the menu is 'Demo backdrop' in prose; a bare Backdrop is only code or Backdrop distance (Optics)
                self.assertEqual(re.findall(r"(?<![`\w])Backdrop\b(?! distance)", text), [])
        self.assertTrue("../liquid-glass/README.md#names-across-the-family" in (STUDY / "README.md").read_text(), "README.md must link to the family table")


FAMILY = ("liquid-glass", "liquid-glass-flow", "liquid-glass-blobs", "liquid-glass-prism", "liquid-glass-lit")


class FitHelperName(unittest.TestCase):
    """Family critic (low), one name per thing. The Fit helper was
    fit_object_size() here and fit_flow() in Flow, but fit_glass() in the core,
    Prism and Lit. It is fit_glass() now; fit_object_size stays one round as an
    alias of the same function, because Liquid Glass Lit's tests still call it
    (review.md, Family critic: one Fit name). These tests fail before the fix
    (checks/results/red-run-fit-name.json)."""

    OLD = "fit_object_size"

    def test_fit_helper_is_fit_glass_and_the_old_name_is_an_alias(self):
        source = (STUDY / "native.py").read_text()
        self.assertEqual(re.findall(r"^def (fit_\w+)\(", source, re.M), ["fit_glass"])
        self.assertRegex(source, rf"(?m)^{self.OLD} = fit_glass  # alias")
        self.assertIs(NATIVE[self.OLD], NATIVE["fit_glass"])
        self.assertEqual(re.findall(r"module\.(fit_\w+)\(", (STUDY / "preset_exec.py").read_text()), ["fit_glass"])
        self.assertIn("helpers.fit_glass(component)", source.split('"""')[1])  # the module's usage note
        # The README names the helper once, and the old name only as the alias.
        readme = (STUDY / "README.md").read_text()
        self.assertIn("module.fit_glass(component)", readme)
        for sentence in re.split(r"(?<=\.) ", readme):
            if self.OLD in sentence:
                self.assertIn("old name", sentence)

    def test_every_member_calls_its_fit_fit_glass(self):
        seen = []
        for folder in FAMILY:
            root = STUDY.parent / folder
            if not (root / "preset_exec.py").is_file():
                continue  # a member not checked out next to this one
            seen.append(folder)
            with self.subTest(folder):
                self.assertEqual(re.findall(r"module\.(fit_\w+)\(", (root / "preset_exec.py").read_text()), ["fit_glass"])
                self.assertEqual(re.findall(r"^def (fit_\w+)\(", (root / "native.py").read_text(), re.M), ["fit_glass"])
        self.assertIn(STUDY.name, seen)


# ---------------------------------------------------------------- family close (review.md)
def glsl_function(source, signature):
    """The text of one GLSL function, from its signature to its closing brace."""
    start = source.index(signature)
    return source[start:source.index("\n}\n", start) + 2]


def fit(det):
    """fit_glass() on a fake blobs_geo whose world transform has this determinant."""
    comp = FakeComponent()
    geo = SimpleNamespace(path="/project1/c/blobs_geo", worldTransform=SimpleNamespace(determinant=lambda: det))
    return NATIVE["fit_glass"](comp, geo)["object_size"]


class FamilyClose(unittest.TestCase):
    """Family close (2026-11-02). G1: Object size has one meaning across the
    family (Liquid Glass Lit decisions.json, family_rule): the object's world
    radius over 1.45, for the scene-unit lengths and for the colour patterns
    (film) through worldScale(). Here the shape (radius, merge, ripple) stays
    in box units and follows the box. G2: one centre-line tie-break for the
    family. G6 is pinned by test_pick_render_runs_only_the_documented_picking_block."""

    FAMILY = STUDY.parent
    # Backdrop distance, Frost and Tint density of each preset at c94e849, when the
    # demo box was Object size 1. The default Object size must reproduce them.
    C94E849 = {
        "prism_clear": (1.6, 0.0, 0.0),
        "lavender_gel": (0.6, 0.04, 0.6),
        "sapphire_drops": (2.2, 0.0, 0.9),
        "type_lens": (2.6, 0.0, 0.0),
        "mercury_beads": (1.0, 0.0, 0.8),
        "amber_syrup": (1.2, 0.0, 1.2),
        "frosted_milk": (1.0, 0.5, 0.8),
        "soap_bubbles": (0.8, 0.0, 0.0),
        "emerald_bottle": (1.6, 0.0, 1.5),
        "rose_quartz": (1.0, 0.5, 0.9),
        "oil_slick": (1.2, 0.0, 2.5),
        "aqua_jelly": (1.4, 0.15, 1.0),
    }

    def test_g1_fit_uses_the_family_reference_radius(self):
        self.assertEqual(NATIVE["REFERENCE_RADIUS"], 1.45)
        self.assertEqual(NATIVE["BOX_HALF_SIDE"], 1.0)
        # blobs_geo scaled 3: the box's radius is 3 scene units, so Object size 3 / 1.45 (c94e849: 3).
        self.assertAlmostEqual(fit(27.0), 3.0 / 1.45, 12)
        # The unscaled demo box fits to the control's default, so pressing Fit on the demo changes nothing.
        self.assertEqual(fit(1.0), CONTROLS["Objectsize"]["default"])
        rule = self.FAMILY / "liquid-glass-lit" / "decisions.json"
        if rule.is_file():  # the family rule's own record, where the family is checked out alongside
            record = next(d["family_rule"] for d in json.loads(rule.read_text()) if "family_rule" in d)
            self.assertEqual(record["reference_radius"], NATIVE["REFERENCE_RADIUS"])

    def test_g1_presets_keep_their_look_on_the_demo(self):
        size = CONTROLS["Objectsize"]["default"]
        for name, (backdrop, frost, density) in self.C94E849.items():
            comp = FakeComp(defaults())
            MODULE["apply"](comp, name)
            comp.par.Objectsize.val = size
            with self.subTest(name):
                self.assertAlmostEqual(MODULE["sized"](comp.par.Backdrop, 1), backdrop, 6)
                self.assertAlmostEqual(MODULE["sized"](comp.par.Frost, 1), frost, 6)
                self.assertAlmostEqual(MODULE["sized"](comp.par.Density, -1), density, 5)
        # The experiments that set a scene-unit value keep their pictures too.
        mapped = {e["id"]: e["parameters"] for e in EXPERIMENTS}
        for eid, key, old in (("lens", "Backdrop", 1.6), ("backdrop_far", "Backdrop", 3.2), ("frost", "Frost", 0.6)):
            self.assertAlmostEqual(mapped[eid][key] * size, old, 9, eid)

    def test_g1_film_follows_object_size_and_world_scale(self):
        text = code(FRAG)
        self.assertIn("float worldScale()\n{\n    return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);\n}", text)
        self.assertIn("valueNoise(pObj * uFilm.w * worldScale() + vec3(0.0, uPhase.z, 0.0))", text)
        film = next(u for u in NODES["material"]["uniforms"] if u["name"] == "uFilm")["values"][3]
        self.assertEqual(film, "2.5 / (1.45 * parent().par.Objectsize.eval())")
        # At the default Object size the film keeps c94e849's 2.5 swirls per box unit.
        self.assertAlmostEqual(2.5 / (1.45 * CONTROLS["Objectsize"]["default"]), 2.5, 12)
        rule = self.FAMILY / "liquid-glass-lit" / "decisions.json"
        if rule.is_file():
            record = next(d["family_rule"] for d in json.loads(rule.read_text()) if "family_rule" in d)
            self.assertIn(record["world_scale_glsl"], text)

    def test_g1_shape_stays_in_box_units(self):
        # The ripple moves the surface, so it belongs to the shape, which follows the box.
        text = code(FRAG)
        ripple = glsl_function(text, "float ripple(vec3 p)")
        self.assertIn("float s = uMotion.z;", ripple)
        self.assertIn("sin(s * p.x + 1.7 * t)", ripple)
        self.assertNotIn("worldScale", ripple)
        self.assertNotIn("worldScale", glsl_function(text, "float stepScale()"))
        self.assertNotIn("worldScale", glsl_function(text, "void buildLayout()"))
        for uniform in ("uBlobs", "uShape", "uMotion"):
            values = next(u for u in NODES["material"]["uniforms"] if u["name"] == uniform)["values"]
            self.assertFalse(any("Objectsize" in str(v) for v in values), uniform)

    def test_g1_core_has_the_same_world_scale(self):
        core = self.FAMILY / "liquid-glass" / "liquid_glass.frag"
        if not core.is_file():
            self.skipTest("the core study is not checked out alongside")
        self.assertEqual(glsl_function(code(core.read_text()), "float worldScale()"),
                         glsl_function(code(FRAG), "float worldScale()"))

    def test_g2_centre_line_tie_break_is_the_familys(self):
        lines = ("vec2 raster = 2.0 * (gl_FragCoord.xy - uTDGeneral.viewport.xy) * uTDGeneral.viewport.zw - 1.0;",
                 "vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));",
                 "runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);")
        mine = glsl_function(code(FRAG), "vec2 screenSign(")
        for line in lines:
            self.assertIn(line, mine)
        core = self.FAMILY / "liquid-glass" / "liquid_glass.frag"
        if not core.is_file():
            self.skipTest("the core study is not checked out alongside")
        theirs = glsl_function(code(core.read_text()), "vec2 screenSign(")
        for line in lines:
            self.assertIn(line, theirs, "the core's screenSign() lacks: " + line)


# ---------------------------------------------------------------- close verify (review.md)
def g1_decision():
    """decisions.json's 'Family close G1' record."""
    return next(d for d in json.loads((STUDY / "decisions.json").read_text()) if d.get("goal", "").startswith("Family close G1"))


def review_section(heading):
    """review.md from a '## ' heading to the next one."""
    return (STUDY / "review.md").read_text().split("\n## " + heading + "\n", 1)[1].split("\n## ", 1)[0]


class CloseVerifyFixes(unittest.TestCase):
    """A family critic's findings on this study's family close (review.md, Close
    verify fixes). CV1: the records said components built before the change keep
    Object size 1 and look 1.45 times deeper; they keep their own copies. CV2: the
    README listed 'ten times as many film bands' as verified; the test measured
    7.56 times and asks for 4. CV3 is a preview fix (normals_hold_at_any_object_scale
    runs on the demo's scene). CV4: decisions.json called every test_g1_* test red
    on c94e849; two are guards. CV5: the pointer to Liquid Glass Lit's rule record
    named a key that does not exist."""

    def test_cv1_old_components_keep_their_own_copies(self):
        # A built component holds copies, not links: the builder copies the shaders, the presets
        # and the callback into DATs and embeds native.py, whose Fit the pulse calls.
        self.assertIn(("study_tools", "native.py"), BUILDER["EMBEDDED"])
        copied = {n["source"] for n in SPEC["nodes"] if "source" in n}
        self.assertLessEqual({"blobs.vert", "blobs.frag", "presets.json", "presets.py", "preset_exec.py"}, copied)
        self.assertIn("op('study_tools').module.fit_glass(", (STUDY / "preset_exec.py").read_text())
        self.assertEqual(re.findall(r"syncfile|\.par\.file\b", (STUDY / "builder.py").read_text()), [])
        # So an old component looks as before; only a value typed for the old meaning, carried
        # into a new component, looks 1.45 times deeper and wider.
        right = ("Components built before this change keep their own copies of the old presets, shader and Fit, "
                 "so they look as before. Only a value typed for the old Object size meaning (1 = the 2-unit box) "
                 "and carried into a new component looks 1.45 times deeper and wider; press Fit to Glass geometry.")
        visible = [p for p in review_section("Family close").split("\n\n") if p.startswith("**Visible changes, before and after.**")]
        self.assertEqual(len(visible), 1)
        for name, text in (("decisions.json", g1_decision()["consequence"]), ("review.md", visible[0])):
            with self.subTest(name):
                self.assertNotIn("keep Object size 1 until Fit", text)
                self.assertIn(right, text)

    def test_cv2_verified_film_claim_is_what_the_test_measured(self):
        results = json.loads((STUDY / "checks" / "results" / "preview-tests.json").read_text())
        name = "comp_scale_at_default_object_size_gives_k_times_the_film_bands"
        film = next(r for r in results["results"] if r["name"] == name)["evidence"]["film"]
        measured = f"{film['ratio_comp_10_default_size']:.1f}"
        readme = (STUDY / "README.md").read_text()
        verified = readme.split("Verified here", 1)[1].split("**Not yet run", 1)[0]
        self.assertIn(f"left unfitted, a box scaled 10 shows about {measured} times the film band detail "
                      "(the swirl frequency is 10 times), and the same ripples", verified)
        for doc in ("README.md", "article.source.md"):
            self.assertNotIn("ten times as many film bands", (STUDY / doc).read_text(), doc)
        # The tutorial may say 'ten times' for the frequency; where it cites the test, it gives the measurement.
        article = (STUDY / "article.source.md").read_text()
        citing = [s for s in re.split(r"(?<=[.!?]) ", article) if name in s]
        self.assertTrue(citing)
        for sentence in citing:
            self.assertIn(f"about {measured} times", sentence)

    def test_cv4_g1_status_names_the_red_tests_and_the_guards(self):
        status = g1_decision()["status"]
        self.assertNotIn("test_g1_*", status)
        clauses = status.split("; ")
        red_clause = [c for c in clauses if c.startswith("unit tests that fail on c94e849")]
        guard_clause = [c for c in clauses if c.startswith("unit guards that pass on c94e849 too")]
        self.assertEqual((len(red_clause), len(guard_clause)), (1, 1), status)
        named_red = set(re.findall(r"\btest_\w+", red_clause[0]))
        named_guards = set(re.findall(r"\btest_\w+", guard_clause[0]))
        run = json.loads((STUDY / "checks" / "results" / "red-run-family-close.json").read_text())["unit_tests_on_c94e849"]
        red = {f["test"] for f in run["failing"]}
        guards = {g.split()[0] for g in run["pass_on_c94e849_too (guards, not red)"]}
        self.assertLessEqual(named_red, red)
        self.assertLessEqual(named_guards, guards)
        self.assertLessEqual({t for t in red if t.startswith("test_g1_")}, named_red)
        self.assertLessEqual({t for t in guards if t.startswith("test_g1_")}, named_guards)

    def test_cv5_pointers_to_the_family_rule_name_keys_that_exist(self):
        docs = {name: (STUDY / name).read_text() for name in
                ("README.md", "review.md", "decisions.json", "article.source.md", "co-design.json", "validation.json", "workflow.json")}
        named = {(name, key) for name, text in docs.items() for key in re.findall(r"family_rule\.(\w+)", text)}
        self.assertIn(("review.md", "members_family_close"), named)
        rule_file = STUDY.parent / "liquid-glass-lit" / "decisions.json"
        if not rule_file.is_file():
            self.skipTest("Liquid Glass Lit is not checked out alongside")
        rule = next(d["family_rule"] for d in json.loads(rule_file.read_text()) if "family_rule" in d)
        for name, key in sorted(named):
            with self.subTest(f"{name}: family_rule.{key}"):
                self.assertIn(key, rule)
        # Lit's record has measured this study since its close verify LIT-CV3; the note here says so.
        if "not measured" not in rule["members_family_close"]["liquid-glass-blobs"].lower():
            found = [p for p in docs["review.md"].split("\n\n") if p.startswith("**Found for the family")]
            self.assertTrue(found and all("LIT-CV3" in p for p in found))


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
    keeps the critic's four native checks with an empty record while they are pending; any
    other status needs the build, the OS, the GPU and the Info DAT text."""
    run = json.loads((STUDY / "validation.json").read_text())["family_close"]["native_run"]
    case.assertEqual([c["id"] for c in run["checks"]],
                     ["fit_comp_scaled", "odd_size_481x271", "occlusion", "render_pick"])
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
    whole component. This study's own Fit, its preset maths (sized()) and uniform
    expressions, and the film lookup in its shader are measured on the three setups the
    critic named; the README must say what the measurement says. Native runs (high): see
    _critic_native_run_test. Both tests fail on c94e849, which had neither the README
    note nor the native list."""

    def fitted(self, det):
        comp = FakeComp(defaults())
        comp.par.Frost.val, comp.par.Density.val = 0.2, 1.5  # both default to 0
        NATIVE["fit_glass"](comp, SimpleNamespace(path="/project1/blobs_geo",
                                                        worldTransform=SimpleNamespace(determinant=lambda: det)))
        return comp

    def look(self, comp, k_comp, k_inst):
        """Backdrop distance, Frost, tint length and film period, in scene units, on a box whose
        Geometry COMP scales by k_comp and whose own instance scales by k_inst. The film lookup
        is pObj (the hit in box units, instance included) x uFilm.w x worldScale() (COMP only)."""
        uniforms = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        swirl = eval(uniforms["uFilm"][3], {"parent": lambda: comp})  # noqa: S307 (study.json)
        unit = k_comp * k_inst  # scene units per box unit
        return (MODULE["sized"](comp.par.Backdrop, 1), MODULE["sized"](comp.par.Frost, 1),
                1.0 / MODULE["sized"](comp.par.Density, -1), unit / (swirl * k_comp))

    def ratios(self, got, wanted):
        return tuple(round(g / w, 9) for g, w in zip(got, wanted))

    def test_one_object_size_setups_are_measured_and_documented(self):
        body = dict(re.findall(r"\n\w+ (\w+)\([^)]*\)\n\{(.*?)\n\}", code(FRAG), re.S))
        self.assertIn("valueNoise(pObj * uFilm.w * worldScale() + vec3(0.0, uPhase.z, 0.0))", body["filmThickness"])
        self.assertEqual(body["worldScale"].strip(),
                         "return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);")
        self.assertNotIn("worldScale", body["ripple"])  # the shape stays in box units: it follows the box
        self.assertNotIn("TDInstance", body["filmThickness"] + body["worldScale"])
        self.assertIn('geo = geometry if geometry is not None else component.op("blobs_geo")',
                      (STUDY / "native.py").read_text())  # Fit reads blobs_geo only
        truth = lambda det, k: self.look(self.fitted(det), k, 1.0)  # noqa: E731 (a Fit that sees the true scale)
        same, third = (1.0,) * 4, (round(1 / 3, 9),) * 4
        # 1. A copy of blobs_geo at a fifth of its size keeps blobs_geo's Object size.
        self.assertEqual(self.ratios(self.look(self.fitted(1.0), 0.2, 1.0), truth(0.2 ** 3, 0.2)), (5.0,) * 4)
        # 2. The scale animates from 1 to 3 after Fit: lengths and film keep Fit's world size ...
        comp = self.fitted(1.0)
        self.assertEqual(self.ratios(self.look(comp, 3.0, 1.0), truth(27.0, 3.0)), third)
        # ... and Object size animated by the same factor carries the look.
        comp.par.Objectsize.val *= 3.0
        self.assertEqual(self.ratios(self.look(comp, 3.0, 1.0), truth(27.0, 3.0)), same)
        # 3. An instance scaled 3: the film grows with it (and the shape), the lengths do not.
        self.assertEqual(self.ratios(self.look(self.fitted(1.0), 1.0, 3.0), truth(27.0, 3.0)),
                         (round(1 / 3, 9),) * 3 + (1.0,))
        note = _critic_note((STUDY / "README.md").read_text())
        for phrase in ("Fit reads `blobs_geo` only", "The blob shape always follows its box",
                       "with film bands five times larger", "five times larger", "three times smaller",
                       "three times as many film bands", "Press Fit again after a scale change",
                       "animate Object size by the same factor",
                       "Fit and the shader see the Geometry COMP's scale, not each instance's",
                       "the blobs and the film bands grow with it",
                       "one Geometry COMP and one copy of the component per size", "waits for your decision"):
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
    """Look-acceptance round (review.md, Look decisions): the family close kept two rules
    that differ from the family's (the film count and the ripple's unit), and the user has
    not accepted them. co-design.json asks the questions with options and a recommended
    answer, the README lists them, and until the user answers the option in the code stays
    there. Both tests fail on the records before this round
    (checks/results/red-run-look-decisions.json)."""

    # The option the code is in. Change it only together with the user's recorded answer,
    # and then encode that option's code below.
    IN_CODE = {"LOOK-B1": "A", "LOOK-B2": "A"}
    FILM = re.compile(r"([\d.]+) / \(([\d.]+) \* parent\(\)\.par\.Objectsize\.eval\(\)\)")

    @staticmethod
    def material(name):
        return next(u for u in NODES["material"]["uniforms"] if u["name"] == name)["values"]

    def test_look_decisions_wait_for_the_user(self):
        codesign, decisions = check_look_decisions(self, self.IN_CODE)
        b1, b2 = decisions["LOOK-B1"], decisions["LOOK-B2"]
        receipt = json.loads((STUDY / "checks" / "results" / "look-decisions.json").read_text())
        presets = receipt["reproduced_from_files"]["presets"]
        self.assertEqual((presets["captures"], presets["max_to"] <= 2), (24, True))
        self.assertIn(f"the presets render as at c94e849 ({presets['max_from']} to {presets['max_to']}/255)", b1["what_changed"])
        # The film count against the family's 2.5 per Object size, read from the recipe.
        count, radius = map(float, self.FILM.fullmatch(self.material("uFilm")[3]).groups())
        per_size, wider = count / radius, 2.5 / (count / radius)
        self.assertIn(f"2.5 / {radius:g} = {per_size:.3f} per Object size", b1["what_changed"])
        self.assertIn(f"{wider:.2f} times as wide as the rule's", b1["what_changed"])
        readme = (STUDY / "README.md").read_text()
        self.assertIn(f"{per_size:.3f} per Object size, so the bands are {wider:.2f} times as wide", readme)
        # Option B's numbers: measured on the current tree, equal to the family close's c94e849 measurement.
        close = json.loads((STUDY / "checks" / "results" / "family-close-measurements.json").read_text())["g1_film_count_options"]["results"]
        results = receipt["option_family_film_count"]["results"]
        self.assertEqual(list(results), ["oil_slick", "soap_bubbles", "prism_clear", "type_lens"])
        for k, (name, r) in enumerate(results.items()):
            self.assertEqual((r["max"], r["pixelsOver8"]), (close[name]["final"]["max"], close[name]["final"]["pixelsOver8"]), name)
            label = PRESETS["presets"][name]["label"]
            unit = "/255" if k == 0 else ""
            self.assertIn(f"{label} {r['max']}{unit} on {r['pixelsOver8']:,}", b1["options"]["B"])
        # B2 states the code's facts.
        for phrase in ("blobField() adds ripple(p)", "uMotion.z is Ripple scale with no Object size or worldScale()"):
            self.assertIn(phrase, b2["what_changed"])
        self.assertTrue([q for q in codesign["open_questions_for_user"] if q.startswith("LOOK-B1 and LOOK-B2 ")])
        self.assertFalse([q for q in codesign["open_questions_for_user"] if q.startswith("Family close G1: the demo box's")])

    def test_code_stays_as_delivered_until_answered(self):
        check_look_decisions(self, self.IN_CODE)
        self.assertEqual(self.IN_CODE, {"LOOK-B1": "A", "LOOK-B2": "A"}, "encode the chosen options' code here")
        # B1 A: 2.5 swirls per box radius, looked up in world-sized steps.
        self.assertEqual(self.material("uFilm")[3], "2.5 / (1.45 * parent().par.Objectsize.eval())")
        self.assertIn("valueNoise(pObj * uFilm.w * worldScale()", FRAG)
        # B2 A: Ripple and Ripple scale reach the shader as they are, and ripple() works in box units.
        self.assertEqual(self.material("uMotion")[1:3], ["op('presets').module.u(parent().par.Ripple)",
                                                         "op('presets').module.u(parent().par.Ripplescale)"])
        body = glsl_function(code(FRAG), "float ripple(vec3 p)")
        self.assertNotIn("worldScale", body)
        self.assertIn("float s = uMotion.z;", body)
        self.assertIn("d += ripple(p);", glsl_function(code(FRAG), "float blobField(vec3 p)"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
