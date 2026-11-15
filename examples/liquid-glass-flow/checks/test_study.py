#!/usr/bin/env python3
"""Tests that need neither TouchDesigner nor a GPU.

  python3 checks/test_study.py

Covers the preset module (load and morph maths, menu, flow time, drift phase,
demo spin and colour helpers, with fake parameters and a fake clock), the
preset callback, native.apply() run in every order on a fake component, Fit to
Glass geometry with a fake SOP, the recipe's internal consistency (every
preset value has a control, every control default matches the default preset,
every preset value reaches a morphed uniform, both materials bind the same
uniforms and sampler settings, the 12 core looks are unchanged from the core
study), the pixel shader differs from the current core's only by the
documented additions (every added and removed line), and a builder dry run.

The FamilyClose class covers this study's share of the family close (gaps
G1, G2, G3 and G6 in review.md, Family close): each gap has a test there that
fails on c94e849; the preprocessor helper's own test passes there. Which new
and changed tests are red on c94e849, and which stay green by design, is in
validation.json (family_close) and checks/results/red-run-family-close.json.
The FamilyCloseVerifier class covers the verifier's three record gaps (V1 to
V3) after the family close. The FitHelperName class covers the family critic's
one-name finding: the Fit helper is fit_glass() in every member, fit_flow is
its alias for one round, and decisions that made Object size the motion's
unit are marked superseded.

The FamilySync class covers the family sync (items R1 to R9 and C1 to C9 in
review.md): source contracts in the GLSL, the recipe, the README's scene
route and the native helpers against fake TouchDesigner objects.
"""
import builtins
import difflib
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import runpy
import sys
from types import ModuleType, SimpleNamespace
import unittest

STUDY = Path(__file__).resolve().parent.parent
CORE = STUDY / "checks" / "core_reference"   # the core working tree after the family-sync merge
REFERENCE = STUDY / "checks" / "reference"   # this study at commit 6a58487
SPEC = json.loads((STUDY / "study.json").read_text())
PRESETS = json.loads((STUDY / "presets.json").read_text())
CORE_SPEC = json.loads((CORE / "study.json").read_text())
CORE_PRESETS = json.loads((CORE / "presets.json").read_text())
EXPERIMENTS = json.loads((STUDY / "experiments.json").read_text())
MODULE = runpy.run_path(str(STUDY / "presets.py"))
CONTROLS = {c["name"]: c for c in SPEC["controls"]}
NODES = {n["id"]: n for n in SPEC["nodes"]}
FLOW_KEYS = ["Amplitude", "Flowspeed", "Swell", "Swellscale", "Ripples", "Ripplescale",
             "Waves", "Wavelength", "Sag", "Drip"]

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
        FakeComp.count += 1  # a fresh path: presets.py keeps running values per component path
        self.path = f"/project1/liquid_glass_flow{FakeComp.count}"
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


# What a user changes on the Inputs and Flow fit pages for their own scene; apply() must keep all of it.
SCENE = {"Refractiontop": "/project1/scene", "Reflectiontop": "/project1/photo",
         "Reflectmode": "screen", "Camera": "/project1/cam1", "Glassgeo": "/project1/geo1",
         "Flipv": True, "Colourspace": "raw", "Demo": False, "Objectsize": 7.5, "Flowsize": 2.5,
         "Flowcentrex": 0.5, "Flowcentrey": 3.0, "Flowcentrez": -1.0, "Gravityx": 0.2, "Gravityy": -0.9,
         "Gravityz": 0.1, "Wavedirx": 0.0, "Wavediry": 1.0, "Wavedirz": 0.4, "Instancevary": 0.6}


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


class PresetModule(unittest.TestCase):
    def test_apply_writes_every_preset_value(self):
        comp = FakeComp(defaults())
        MODULE["apply"](comp, "sapphire_drop")
        for key, value in PRESETS["presets"]["sapphire_drop"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        before = comp.state()
        MODULE["apply"](comp, "custom")
        self.assertEqual(before, comp.state())

    def test_morph_endpoints_and_midpoint_include_motion(self):
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
        comp.par.Stage.val = "displacement"
        self.assertEqual(MODULE["menu"](comp.par.Stage), CONTROLS["Stage"]["names"].index("displacement"))
        comp.par.Displacealong.val = "normal"
        self.assertEqual(MODULE["menu"](comp.par.Displacealong), 0)

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

    def test_flow_time_is_flow_speed_added_up_and_wrapped(self):
        comp = FakeComp(defaults())
        comp.par.Pause.val, comp.par.Time.val = True, 2.0
        self.assertAlmostEqual(MODULE["flow_time"](comp), 0.45 * 2.0, 12)  # Fixed time x Flow speed
        comp = FakeComp(defaults())
        with Clock(10 * 86400.0) as clock:
            value = MODULE["flow_time"](comp)
            self.assertTrue(0.0 <= value < MODULE["FLOW_WRAP"])
            self.assertAlmostEqual(value, (10 * 86400.0 * 0.45) % MODULE["FLOW_WRAP"], 6)
            clock.step(1.5)
            self.assertAlmostEqual(wrapped_change(value, MODULE["flow_time"](comp), MODULE["FLOW_WRAP"]), 0.675, 9)

    def test_flow_wrap_is_a_whole_number_of_every_drift(self):
        """Every drift rate in liquid_flow.vert times the wrap is a whole number of noise repeats (256 cells)."""
        vert = shader("liquid_flow.vert")
        rates = [float(x) for x in re.findall(r"(\d+\.\d+) \* t\b", vert)]
        self.assertEqual(sorted(set(rates)), [0.08, 0.21, 0.27, 0.35, 0.5, 0.6, 0.8])
        self.assertIn("mod(drift, 256.0)", vert)
        for rate in rates:
            repeats = rate * MODULE["FLOW_WRAP"] / 256.0
            self.assertAlmostEqual(repeats, round(repeats), 9, rate)
        self.assertEqual(NODES["material"]["uniforms"][[u["name"] for u in NODES["material"]["uniforms"]].index("uFlow")]["values"][3],
                         "op('presets').module.flow_time(parent())")

    def test_motion_stays_smooth_through_morph_and_speed_changes_after_an_hour(self):
        # A 100-frame A/B morph and a fast slider drag, an hour into a session: each frame moves the
        # flow time and every drift phase by speed x frame time, never by change in speed x uptime.
        cases = [(("phase", r), 256.0, "Wobblespeed") for r in (0.6, 0.4, -0.3, 0.15)]
        cases.append((("flow",), MODULE["FLOW_WRAP"], "Flowspeed"))
        for which, period, speed_name in cases:
            comp = FakeComp(defaults())
            MODULE["apply"](comp, "prism_chrome")
            comp.par.Morphtarget.val = "aqua_jelly"  # Wobble speed 0.3 -> 0.6, Flow speed 0.45 -> 0.9
            rate = which[1] if which[0] == "phase" else 1.0
            value = (lambda: MODULE["phase"](comp, rate)) if which[0] == "phase" else (lambda: MODULE["flow_time"](comp))
            dt = 1 / 60
            with Clock(3600.0) as clock:
                last = value()
                frames = [("Morph", i / 100) for i in range(1, 101)]
                frames += [(speed_name, 0.3 + 0.27 * i) for i in range(1, 11)]
                for name, v in frames:
                    getattr(comp.par, name).val = v
                    clock.step(dt)
                    speed = MODULE["u"](getattr(comp.par, speed_name))
                    now = value()
                    self.assertTrue(0.0 <= now < period)
                    change = wrapped_change(last, now, period)
                    self.assertLessEqual(abs(change), abs(rate) * speed * dt + 1e-9, (which, name, v))
                    self.assertAlmostEqual(change, rate * speed * dt, 9)
                    last = now

    def test_drift_is_the_same_within_a_frame_and_resumes_without_a_jump(self):
        comp = FakeComp(defaults())
        speed = comp.par.Flowspeed.val
        with Clock(7200.0) as clock:
            a = MODULE["flow_time"](comp)
            self.assertEqual(MODULE["flow_time"](comp), a)  # material and material_back agree
            comp.par.Pause.val, comp.par.Time.val = True, 2.0
            paused = MODULE["flow_time"](comp)
            self.assertAlmostEqual(paused, speed * 2.0, 12)  # repeatable experiments
            clock.step(5.0)
            comp.par.Pause.val = False
            self.assertEqual(MODULE["flow_time"](comp), paused)  # unpausing continues from there
            clock.step(0.5)
            self.assertAlmostEqual(MODULE["flow_time"](comp), paused + speed * 0.5, 9)
            comp.par.Flowspeed.val = 0.0
            held = MODULE["flow_time"](comp)
            clock.step(100.0)
            comp.par.Flowspeed.val = speed
            self.assertEqual(MODULE["flow_time"](comp), held)  # moving again starts where it stopped

    def test_two_components_keep_their_own_motion(self):
        # The 6a58487 clock() kept one running value per parameter name, so a second component
        # in the same frame took the first one's flow time. advance() keys by component path.
        slow, fast = FakeComp(defaults()), FakeComp(defaults())
        fast.par.Flowspeed.val = 0.9
        with Clock(100.0) as clock:
            MODULE["flow_time"](slow), MODULE["flow_time"](fast)
            clock.step(1.0)
            self.assertAlmostEqual(MODULE["flow_time"](slow), 45.45, 9)
            self.assertAlmostEqual(MODULE["flow_time"](fast), 90.9, 9)

    def test_a_still_look_never_reads_the_clock(self):
        comp = FakeComp(defaults())
        comp.par.Flowspeed.val = comp.par.Wobblespeed.val = comp.par.Demospin.val = 0.0
        self.assertFalse(hasattr(builtins, "absTime"))
        for f in (lambda: MODULE["flow_time"](comp), lambda: MODULE["phase"](comp, 0.6), lambda: MODULE["spin"](comp)):
            self.assertEqual(f(), 0.0)  # would raise NameError if it read absTime

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
        self.fits = []
        self.callbacks = runpy.run_path(str(STUDY / "preset_exec.py"), init_globals={"op": lambda name: SimpleNamespace(
            module=SimpleNamespace(apply=MODULE["apply"], fit_glass=lambda c: self.fits.append(c) or {}))})

    def test_custom_changes_nothing(self):
        comp = FakeComp(defaults())
        comp.par.Ior.val = 2.2
        comp.par.Preset.val = "custom"
        before = comp.state()
        self.callbacks["onValueChange"](comp.par.Preset, "prism_chrome")
        self.assertEqual(before, comp.state())

    def test_choosing_a_preset_loads_look_and_motion(self):
        comp = FakeComp(defaults())
        comp.par.Preset.val = "amber_honey"
        self.callbacks["onValueChange"](comp.par.Preset, "prism_chrome")
        for key, value in PRESETS["presets"]["amber_honey"]["values"].items():
            self.assertEqual(getattr(comp.par, key).val, value, key)

    def test_fit_pulse_runs_fit_glass(self):
        comp = FakeComp(defaults())
        self.callbacks["onPulse"](SimpleNamespace(name="Fitglass", owner=comp))
        self.assertEqual(self.fits, [comp])
        self.assertIn("Fitglass", NODES["preset_exec"]["parameters"]["pars"].split())
        self.assertEqual(CONTROLS["Fitglass"]["type"], "pulse")


class NativeApply(unittest.TestCase):
    """Family sync R4: experiments reset every look control first, so their order never matters."""

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
            comp.par.Amplitude.val = 0.33
            NATIVE["apply"](comp, second)
            self.assertEqual(comp.state(), expected, (first, second))

    def test_scene_inputs_and_flow_fit_survive(self):
        for item in EXPERIMENTS:
            comp = scene_comp()
            NATIVE["apply"](comp, item["id"])
            self.assertEqual(SCENE, {k: comp.state()[k] for k in SCENE}, item["id"])

    def test_no_experiment_sets_a_setup_control(self):
        setup = {c["name"] for c in SPEC["controls"] if c.get("setup")}
        for item in EXPERIMENTS:
            self.assertFalse(setup & set(item["parameters"]), item["id"])

    def test_reset_controls_are_the_documented_ones(self):
        # README > Tutorial experiments names exactly these, besides the preset values.
        reset = set(NATIVE["look_defaults"](SPEC)) - set(SPEC["preset_keys"])
        self.assertEqual(reset, {"Morphtarget", "Morph", "Samples", "Conserve", "Envrotate", "Screenwarp",
                                 "Lightdirx", "Lightdiry", "Lightdirz", "Backface", "Culling", "Displacealong",
                                 "Correctnormals", "Pause", "Time", "Stage", "Demospin", "Demoobject",
                                 "Demodetail", "Backdrop"})


class FitFlow(unittest.TestCase):
    """native.fit_glass() (fit_flow() until the one-name fix): Flow centre and Flow size from the
    rendered SOP's bounds (SOP units), and Object size by the family rule (family sync C8; family close G1)."""

    P = staticmethod(lambda x, y, z: SimpleNamespace(x=x, y=y, z=z))

    def geo(self, children, det=1.0, path="/project1/geo1", bounds=None):
        g = SimpleNamespace(path=path, children=children, worldTransform=SimpleNamespace(determinant=lambda: det))
        if bounds is not None:
            g.bounds = lambda render=True, recurse=False: bounds
        return g

    def test_uses_the_rendered_sop_bounds(self):
        bounds = SimpleNamespace(center=self.P(0.0, 40.0, 5.0), size=self.P(60.0, 80.0, 20.0))
        hidden = SimpleNamespace(isSOP=True, render=False, path="a", bounds=lambda: None)
        shown = SimpleNamespace(isSOP=True, render=True, path="/project1/geo1/model", bounds=lambda: bounds)
        comp = scene_comp()
        comp.par.Glassgeo.evalOPs = lambda: [self.geo([hidden, shown])]
        report = NATIVE["fit_glass"](comp)
        self.assertEqual(report["source"], "/project1/geo1/model")
        self.assertEqual([comp.par.Flowcentrex.val, comp.par.Flowcentrey.val, comp.par.Flowcentrez.val], [0.0, 40.0, 5.0])
        self.assertEqual(comp.par.Flowsize.val, 40.0)
        self.assertAlmostEqual(comp.par.Objectsize.val, 40.0 / 1.45, 12)
        self.assertEqual(report["notes"], [])

    def test_demo_sphere_fits_to_the_defaults(self):
        # The defaults fit the default demo object, so pressing Fit on the demo changes nothing:
        # Flow size 1 (radius 1, SOP units) and Object size 1 / 1.45 (the family rule).
        bounds = SimpleNamespace(center=self.P(0.0, 0.0, 0.0), size=self.P(2.0, 2.0, 2.0))
        sphere = NODES["demo_geo/sphere"]["parameters"]
        self.assertEqual((sphere["radx"], sphere["rady"], sphere["radz"]), (1.0, 1.0, 1.0))
        self.assertEqual(CONTROLS["Demoobject"]["default"], "sphere")
        comp = scene_comp()
        sop = SimpleNamespace(isSOP=True, render=True, path="sphere", bounds=lambda: bounds)
        report = NATIVE["fit_glass"](comp, self.geo([sop]))
        self.assertEqual(report["flow_size"], CONTROLS["Flowsize"]["default"])
        self.assertEqual(report["object_size"], CONTROLS["Objectsize"]["default"])
        self.assertEqual(CONTROLS["Objectsize"]["default"], 1.0 / 1.45)

    def test_comp_bounds_fallback_and_notes(self):
        bounds = SimpleNamespace(center=self.P(1.0, 0.0, 0.0), size=self.P(0.2, 0.6, 0.4))
        comp = scene_comp()
        first = self.geo([], det=27.0, path="/project1/geo2", bounds=bounds)
        second = self.geo([], path="/project1/geo3", bounds=bounds)
        comp.par.Glassgeo.evalOPs = lambda: [first, second]
        report = NATIVE["fit_glass"](comp)
        self.assertEqual(report["source"], "/project1/geo2 (Geometry COMP bounds)")
        self.assertAlmostEqual(comp.par.Flowsize.val, 0.3, 12)
        self.assertAlmostEqual(comp.par.Objectsize.val, 0.3 * 3.0 / 1.45, 9)
        self.assertAlmostEqual(report["world_scale"], 3.0, 9)
        self.assertEqual(len(report["notes"]), 2)  # fitted to the first object only; scaled 3x
        comp.par.Glassgeo.evalOPs = lambda: []
        with self.assertRaises(ValueError):
            NATIVE["fit_glass"](comp)


class Recipe(unittest.TestCase):
    def test_twelve_complete_presets(self):
        self.assertEqual(len(PRESETS["presets"]), 12)
        self.assertEqual(PRESETS["order"], list(PRESETS["presets"]))
        for name, preset in PRESETS["presets"].items():
            self.assertEqual(sorted(preset["values"]), sorted(SPEC["preset_keys"]), name)

    def test_core_looks_unchanged(self):
        """The 12 core presets keep working: same names, order and look values."""
        self.assertEqual(PRESETS["order"], CORE_PRESETS["order"])
        self.assertEqual(PRESETS["default"], CORE_PRESETS["default"])
        for name, core in CORE_PRESETS["presets"].items():
            for key, value in core["values"].items():
                self.assertEqual(PRESETS["presets"][name]["values"][key], value, (name, key))
        self.assertEqual(SPEC["preset_keys"], CORE_SPEC["preset_keys"] + FLOW_KEYS)

    def test_core_controls_kept(self):
        """Every core control still exists with the same name, type, range and default (Fitglass too, since the family names fix)."""
        for core in CORE_SPEC["controls"]:
            mine = CONTROLS[core["name"]]
            for field in ("type", "min", "max", "default"):
                if (core["name"], field) == ("Objectsize", "default"):
                    # Family close G1: the same meaning (world radius / the core's demo torus), so the
                    # default is what Fit sets on this study's default demo object, the radius-1 sphere.
                    self.assertEqual(mine["default"], 1.0 / NATIVE["torus_radius"](CORE_SPEC))
                    continue
                self.assertEqual(mine.get(field), core.get(field), (core["name"], field))
        stage = CONTROLS["Stage"]["names"]
        core_stage = next(c for c in CORE_SPEC["controls"] if c["name"] == "Stage")["names"]
        self.assertEqual(stage[:len(core_stage)], core_stage)  # old stage indices unchanged

    def test_core_reference_is_the_current_core(self):
        core_dir = STUDY.parent / "liquid-glass"
        if not core_dir.is_dir():
            self.skipTest("the core study is not next to this folder")
        for name in ("liquid_glass.frag", "liquid_glass.vert"):
            self.assertEqual(hashlib.sha256((CORE / name).read_bytes()).hexdigest(),
                             hashlib.sha256((core_dir / name).read_bytes()).hexdigest(), name)

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
        """Through u() directly, or Flow speed through flow_time(), which integrates u(Flowspeed)."""
        self.assertIn("u(comp.par.Flowspeed)", shader("presets.py"))
        for node_id in ("material", "material_back"):
            text = json.dumps(NODES[node_id]["uniforms"])
            morphed = re.findall(r"module\.u\(parent\(\)\.par\.(\w+)\)", text)
            self.assertIn("op('presets').module.flow_time(parent())", text)
            self.assertEqual(sorted(morphed + ["Flowspeed"]), sorted(SPEC["preset_keys"]), node_id)

    def test_both_materials_share_bindings_except_pass_and_back_sampler(self):
        front = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        back = {u["name"]: u["values"] for u in NODES["material_back"]["uniforms"]}
        settings = lambda node: {u["name"]: (u.get("filter"), u.get("extendu"), u.get("extendv"))
                                 for u in NODES[node]["uniforms"] if u.get("kind") == "sampler"}
        self.assertEqual(settings("material"), settings("material_back"))
        self.assertEqual(sorted(front), sorted(back))
        differs = sorted(k for k in front if front[k] != back[k])
        self.assertEqual(differs, ["sBackface", "uState"])
        self.assertEqual(front["uState"][1], 0)
        self.assertEqual(back["uState"][1], 1)

    def test_shader_direction_menu_matches_shader(self):
        # liquid_flow.vert reads uFlow.z > 0.5 as "away from centre".
        self.assertEqual(CONTROLS["Displacealong"]["names"], ["normal", "centre"])
        self.assertIn("uFlow.z > 0.5", shader("liquid_flow.vert"))

    def test_pixel_shader_is_current_core_plus_documented_additions(self):
        """Every removed and every added line, compared with the documented list."""
        core = (CORE / "liquid_glass.frag").read_text().splitlines()
        mine = shader("liquid_flow.frag").splitlines()
        changed = [l for l in difflib.unified_diff(core, mine, lineterm="", n=0)
                   if l[:1] in "+-" and not l.startswith(("+++", "---"))]
        self.assertEqual(changed, EXPECTED_PIXEL_DIFF)

    def test_no_version_directive_and_swizzle(self):
        for name in ("liquid_flow.vert", "liquid_flow.frag", "backdrop.frag", "env.frag"):
            text = shader(name)
            self.assertIsNone(re.search(r"^\s*#version", text, re.M), name)
            if name.endswith(".frag"):
                self.assertIn("TDOutputSwizzle", text, name)

    def test_experiments_use_real_presets_and_previews(self):
        self.assertGreaterEqual(len(EXPERIMENTS), 8)
        for e in EXPERIMENTS:
            self.assertIn(e["parameters"].get("Preset"), PRESETS["presets"], e["id"])
            self.assertTrue((STUDY / e["preview"]).is_file(), e["preview"])
            self.assertIn("pending", e["observation"])


class FamilySync(unittest.TestCase):
    # ---------------------------------------------------------------- R1 drift clock
    def test_r1_no_node_expression_reads_absolute_time(self):
        self.assertNotIn("absTime", json.dumps(SPEC["nodes"]))
        self.assertEqual(NODES["demo_geo"]["expressions"]["ry"], "op('presets').module.spin(parent())")
        front = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        self.assertEqual(front["uPhase"], [f"op('presets').module.phase(parent(), {r})" for r in ("0.6", "0.4", "-0.3", "0.15")])
        self.assertEqual(front["uWobble"][3], 0)
        self.assertNotIn("def clock(", shader("presets.py"))  # one integrator: advance()

    def test_r1_pixel_noise_lattice_repeats_every_256(self):
        frag = code_only(shader("liquid_flow.frag"))
        self.assertIn("uvec3 q = uvec3(c & 255);", functions(frag)["latticeHash"])
        self.assertIn("uPhase", functions(frag)["liquidField"])
        self.assertIn("uPhase.w", functions(frag)["filmThickness"])

    # ---------------------------------------------------------------- R2 scene route
    def test_r2_readme_draws_the_glass_with_a_render_pass_top(self):
        readme = shader("README.md")
        section = readme[readme.index("## Use it on your own objects"):readme.index("## Controls")]
        for phrase in ("Render Pass TOP", "Clear Depth Buffer", "Clear to Camera Color", "Override Material"):
            self.assertTrue(phrase in section, phrase)
        self.assertTrue("Over TOP" in section, "the Over TOP stays, as the fallback")
        self.assertIn("fallback", section[section.index("Over TOP") - 300:section.index("Over TOP") + 300])
        refs = [r for r in SPEC["references"] if r["target"] in ("material", "material_back")]
        self.assertTrue(all(r["parameter"] == "overridemat" for r in refs), refs)
        self.assertNotIn("material", NODES["demo_geo"].get("parameters", {}))

    def test_r2_occlusion_claim_has_a_preview_test(self):
        # Verifier gap round G2: README step 3 says objects in front of the glass still cover it.
        readme = shader("README.md")
        section = readme[readme.index("## Use it on your own objects"):readme.index("## Controls")]
        self.assertIn("anything in front of the glass still covers it", section)
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        self.assertIn("check('render_pass_keeps_foreground_in_front'", tests)
        self.assertIn("occluder: { renderPass: true }", tests)  # the README route
        self.assertIn("occluder: {} })", tests)                  # the Over TOP control

    def test_g1_readme_says_what_film_swirl_0_does(self):
        # Verifier gap round G1: with uFilm.w = 0 the film is one thickness that still drifts with uPhase.w.
        row = next(line for line in shader("README.md").splitlines() if line.startswith("| `uFilm` |"))
        self.assertNotIn("freez", row)
        self.assertIn("0 = one film thickness over the whole object, no swirl; Wobble speed 0 stops the drift", row)
        film = functions(code_only(shader("liquid_flow.frag")))["filmThickness"]
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0))", film)  # family close G1

    # ---------------------------------------------------------------- R3 inputs and warnings
    def test_r3_inputs_are_constant_paths_to_the_demo(self):
        for name, target in (("Refractiontop", "demo_backdrop"), ("Reflectiontop", "demo_env"),
                             ("Camera", "demo_cam"), ("Glassgeo", "demo_geo")):
            c = CONTROLS[name]
            self.assertEqual((c.get("demo_target"), c.get("default"), c.get("setup")), (target, None, True), name)
            self.assertNotIn("expression", c, name)
            self.assertIn(target, NODES)
        builder = runpy.run_path(str(STUDY / "builder.py"))
        target = SimpleNamespace(path="/project1/liquid_glass_flow/demo_backdrop")
        par = SimpleNamespace(val=None, default=None, expr=None)
        par.eval = lambda: target
        comp = SimpleNamespace(name="liquid_glass_flow", par=SimpleNamespace(Refractiontop=par),
                               op=lambda n: target, relativePath=lambda node: "demo_backdrop")
        warnings = []
        builder["link_demo_inputs"](comp, [CONTROLS["Refractiontop"]], warnings)
        self.assertEqual((par.val, par.default, par.expr, warnings), ("demo_backdrop", "demo_backdrop", None, []))
        par.eval = lambda: None  # a path that does not resolve: expression fallback, reported
        builder["link_demo_inputs"](comp, [CONTROLS["Refractiontop"]], warnings)
        self.assertEqual(par.expr, "me.op('demo_backdrop')")
        self.assertTrue(warnings and warnings[0].startswith("inputs: Refractiontop"))

    def test_r3_build_warnings_are_categorized(self):
        builder = runpy.run_path(str(STUDY / "builder.py"))
        self.assertEqual(list(builder["WARNING_NOTES"]), ["material", "inputs", "optional", "dither", "setup", "demo"])
        warnings = []
        builder["attempt"](False, warnings, "material", lambda: 1 / 0)
        self.assertTrue(warnings[0].startswith("material: "))

    # ---------------------------------------------------------------- R5 shader hygiene
    def test_r5_smoothstep_edges_increase(self):
        for name in ("liquid_flow.frag", "liquid_flow.vert", "backdrop.frag", "env.frag"):
            for args in call_arguments(code_only(shader(name)), r"\bsmoothstep"):
                parts = [a.strip() for a in args.split(",")]
                try:
                    lo, hi = float(parts[0]), float(parts[1])
                except ValueError:
                    continue  # symbolic edges: checked by hand (halfWidth -/+ soft, -px/px)
                self.assertLess(lo, hi, (name, args))

    def test_r5_atan_only_through_azimuth(self):
        for name in ("liquid_flow.frag", "env.frag"):
            code = code_only(shader(name))
            body = functions(code)["azimuth"]
            self.assertEqual(code.count("atan("), body.count("atan("), name)
            self.assertIn("dot(d.xz, d.xz) > 1e-12", body)

    def test_r5_pixel_stage_hygiene(self):
        frag = code_only(shader("liquid_flow.frag"))
        main = functions(frag)["main"]
        self.assertLess(main.index("dFdx(vWorldPos)"), main.index("TDCheckDiscard()"))  # uniform control flow
        # Only main() takes derivatives: the faceted normal's two and, since the family close (G2),
        # the screen orientation's four, all before TDCheckDiscard().
        derivative = r"\b(dFdx|dFdy|fwidth)\w*\s*\("
        calls = [m.start() for m in re.finditer(derivative, main)]
        self.assertEqual(len(calls), 6)
        self.assertTrue(all(c < main.index("TDCheckDiscard();") for c in calls))
        self.assertEqual(len(re.findall(derivative, frag)), 6)
        self.assertNotIn("dFdx", functions(frag)["facingNormal"])
        self.assertIn("1e-12 * dot(dPdx, dPdx) * dot(dPdy, dPdy)", functions(frag)["facingNormal"])  # relative threshold
        self.assertIn("faceCamera(wobbleNormal(facingNormal(eye, dPdx, dPdy)), eye)", main)
        # Family close G1 moved the cube root into worldScale(), shared with the film: same maths.
        self.assertEqual(functions(frag)["worldScale"].strip(),
                         "return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);")
        self.assertIn("float scale = worldScale();", functions(frag)["wobbleNormal"])
        self.assertIn("slope = uTDMats[vCamIndex].worldForNormals * slope * scale;", functions(frag)["wobbleNormal"])
        self.assertIn("max(uOptics.x + spread * (w - 0.5), 1.0)", functions(frag)["transmitted"])
        self.assertIn("mix(mix(r0 * r0, 1.0, fresnel), 1.0, uSurface.x)", main)
        self.assertIn("vec3 h = safeNormalize(lightDir - eye, vec3(0.0));", frag)

    def test_r5_vertex_decides_a_zero_normal_before_transforming(self):
        vert = code_only(shader("liquid_flow.vert"))
        # Since the family close (G6) the world normal is computed once before the picking branch:
        # the pixel stage and the pick both read it.
        self.assertIn("vec3 worldNormal = dot(normal, normal) > 1e-12 ? TDDeformNorm(normal) : vec3(0.0);", vert)
        self.assertIn("vWorldNormal = worldNormal;", vert)
        self.assertEqual(vert.count("TDDeformNorm("), 1)
        # Verifier finding V1: the fallback to the rest normal is relative to the nudge's rest area
        # (2e)^2, not an absolute 1e-12 that also caught squeezed, unfolded surfaces (the preview case
        # squeezed_chrome_type_amplitude_0_5 in normals_match_finite_differences measures it).
        body = functions(vert)["flowNormal"]
        self.assertIn("const float restArea = 4.0 * e * e;", body)
        self.assertIn("if (!(area2 > 1e-6 * restArea * restArea)) return n;", body)
        self.assertNotIn("1e-12", body)
        self.assertIn("normal = flowNormal(q, unitNormal, down, seed, t);", functions(vert)["main"])

    # ---------------------------------------------------------------- R6 frost disc, flat-image blur
    def test_r6_frost_disc_centre_stays_near_the_middle(self):
        body = functions(code_only(shader("liquid_flow.frag")))["discPoint"]
        steps = [float(x) for x in re.search(r"vec2\(([\d.]+), ([\d.]+)\)", body).groups()]
        self.assertEqual(steps, [0.7548776662, 0.5698402910])  # Martin Roberts' R2 sequence
        for n in range(8, 33):
            pts = []
            for i in range(n):
                fx, fy = (0.5 + i * steps[0]) % 1.0, (0.5 + i * steps[1]) % 1.0
                pts.append((math.sqrt(fy) * math.cos(2 * math.pi * fx), math.sqrt(fy) * math.sin(2 * math.pi * fx)))
            mean = math.hypot(sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n)
            self.assertLess(mean, 0.07, n)  # R2: at most 0.064; the 6a58487 golden-angle disc: 0.089 to 0.155

    def test_r6_flat_image_blur_widens_with_the_warp(self):
        body = functions(code_only(shader("liquid_flow.frag")))["environmentSample"]
        self.assertIn("float spread = mode == 1 ? max(1.0, 2.5 * uEnv.w) : 1.0;", body)

    # ---------------------------------------------------------------- R7 back-face pass
    def test_r7_back_face_pass_is_32_bit_and_read_texel_by_texel(self):
        self.assertEqual(NODES["render_back"]["parameters"]["format"], "rgba32float")
        backface = next(u for u in NODES["material"]["uniforms"] if u["name"] == "sBackface")
        self.assertEqual(backface["filter"], "nearest")
        frag = code_only(shader("liquid_flow.frag"))
        self.assertIn("texelFetch(sBackface", functions(frag)["backfaceAt"])
        self.assertNotIn("texture(sBackface", frag)
        self.assertNotIn("textureLod(sBackface", frag)
        self.assertIn("float surfaceDistance = perspective ? length(vWorldPos - camPos) : depth;", functions(frag)["main"])

    # ---------------------------------------------------------------- R8 colours and energy
    def test_r8_colour_parameters_and_energy_conserving(self):
        self.assertEqual((CONTROLS["Colourspace"]["names"], CONTROLS["Colourspace"]["default"], CONTROLS["Colourspace"].get("setup")),
                         (["auto", "raw", "srgb"], "auto", True))
        self.assertEqual((CONTROLS["Conserve"]["type"], CONTROLS["Conserve"]["default"]), ("toggle", False))
        front = {u["name"]: u["values"] for u in NODES["material"]["uniforms"]}
        self.assertEqual(front["uInputs"][3], "op('presets').module.decode_colours(parent())")
        self.assertEqual(front["uSurface"][3], "1 if parent().par.Conserve.eval() else 0")
        frag = code_only(shader("liquid_flow.frag"))
        self.assertIn("float keep = 1.0 - uSurface.w * clamp(reflectance, 0.0, 1.0);", frag)
        for colour in ("uGlass.rgb", "uLightColor.rgb", "uRim.rgb", "uReflect.rgb"):
            self.assertIn(f"paramColour({colour})", frag, colour)

    # ---------------------------------------------------------------- R9 recipe and diagnostics
    def test_r9_sampler_extend_modes_and_menu_uniforms(self):
        samplers = {u["name"]: (u.get("filter"), u.get("extendu"), u.get("extendv"))
                    for u in NODES["material"]["uniforms"] if u.get("kind") == "sampler"}
        self.assertEqual(samplers, {"sRefraction": ("mipmaplinear", "mirror", "mirror"),
                                    "sReflection": ("mipmaplinear", "repeat", "hold"),
                                    "sBackface": ("nearest", "hold", "hold")})
        text = json.dumps([NODES[n]["uniforms"] for n in ("material", "material_back", "demo_backdrop")])
        self.assertNotIn("menuIndex", text)
        for name in ("Reflectmode", "Stage", "Displacealong", "Backdrop"):
            self.assertIn(f"op('presets').module.menu(parent().par.{name})", text, name)

    def test_r9_inspect_reports_script_and_blocking_errors(self):
        source = shader("native.py").split("def inspect(")[1]
        for key in ('"script_errors"', '"blocking_errors"', '"render_diagnostics"', '"inputs"'):
            self.assertIn(key, source.split("def _refuse_or_report")[0], key)
        broken = SimpleNamespace(errors=lambda: "compile error")
        fine = SimpleNamespace(errors=lambda: "")
        nodes = {"material": broken, "render": fine, "over": fine, "out": fine, "material_back": broken, "render_back": fine}
        comp = SimpleNamespace(op=nodes.get, par=SimpleNamespace(Backface=SimpleNamespace(eval=lambda: False)))
        self.assertEqual(NATIVE["blocking_errors"](comp), {"material": "compile error"})
        comp.par.Backface = SimpleNamespace(eval=lambda: True)
        self.assertEqual(sorted(NATIVE["blocking_errors"](comp)), ["material", "material_back"])

    # ---------------------------------------------------------------- C1 the Refraction TOP's alpha
    def test_c1_transmitted_returns_the_scene_alpha(self):
        frag = code_only(shader("liquid_flow.frag"))
        self.assertIn("return vec4(sum / weightSum, covered / float(count));", functions(frag)["transmitted"])
        self.assertIn("return vec4(back.rgb, scene.a);", functions(frag)["sampleBehind"])
        main = functions(frag)["main"]
        self.assertIn("float seeThrough = translucency * (1.0 - covered) * dot(tint, vec3(1.0 / 3.0));", main)
        self.assertIn("alpha = 1.0 - seeThrough * keep;", main)

    # ---------------------------------------------------------------- C2 pipeline safety
    def test_c2_vertex_shader_answers_picking_with_the_moved_surface(self):
        # Since the family close (G6) the documented form '#ifndef TD_PICKING_ACTIVE ... #else
        # TDWritePickingValues(); #endif'; the moved surface's values follow the call in the #else block
        # (test_g6_pick_render_runs_only_the_documented_picking_block).
        vert = code_only(shader("liquid_flow.vert"))
        self.assertRegex(vert, r"\n#ifndef TD_PICKING_ACTIVE\n[\s\S]*\n#else\s+TDWritePickingValues\(\);[\s\S]*\n#endif\n")
        block = vert[vert.index("#else"):vert.index("#endif")]
        self.assertLess(block.index("TDWritePickingValues();"), block.index("vTDPickVert.sopSpacePosition = moved;"))
        self.assertLess(vert.index("gl_Position = TDWorldToProj(world);"), vert.index("#ifndef TD_PICKING_ACTIVE"))

    def test_c2_extra_colour_buffers_get_zeros(self):
        frag = code_only(shader("liquid_flow.frag"))
        self.assertRegex(frag, r"#ifndef TD_NUM_COLOR_BUFFERS\s+#define TD_NUM_COLOR_BUFFERS 1\s+#endif")
        self.assertIn("layout(location = 0) out vec4 fragColor[TD_NUM_COLOR_BUFFERS];", frag)
        self.assertIsNone(re.search(r"\bfragColor\s*=", frag), "every write names a colour buffer")
        for k in range(1, 8):  # constant indices, each behind its own #if (a loop fails in WebGL2)
            self.assertRegex(frag, rf"#if TD_NUM_COLOR_BUFFERS > {k}\s+fragColor\[{k}\] = vec4\(0\.0\);\s+#endif")

    # ---------------------------------------------------------------- C4 no dithering
    def test_c4_renders_switch_dither_off(self):
        renders = [n for n in SPEC["nodes"] if n["type"] in ("renderTOP", "renderpassTOP")]
        self.assertEqual(len(renders), 2)
        for n in renders:
            value = {**n.get("parameters", {}), **n.get("lenient_parameters", {})}.get("dither")
            self.assertIs(value, False, n["id"])
        self.assertTrue("Dither" in shader("README.md"), "README asks users to turn Dither off")

    def test_c4_shaders_never_dither(self):
        # Per-pixel noise needs a per-pixel seed: gl_FragCoord is read only to place the pixel,
        # the material's hashes feed object-space lattice noise, the demo TOPs hash rows and letters.
        frag = shader("liquid_flow.frag")
        for name in ("liquid_flow.frag", "liquid_flow.vert", "backdrop.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertNotIn("TDDither", code, name)
            self.assertIsNone(re.search(r"\b(dither|random|blueNoise|interleavedGradient)", code, re.I), name)
            if name.startswith("liquid_flow"):
                self.assertIsNone(re.search(r"fract\s*\(\s*sin", code), name)
        self.assertEqual({f for f, body in functions(code_only(frag)).items() if "gl_FragCoord" in body}, {"screenUV", "screenSign"})
        self.assertEqual({f for f, body in functions(frag).items() if "latticeHash(" in body}, {"valueNoise"})
        vert = shader("liquid_flow.vert")
        self.assertEqual({f for f, body in functions(vert).items() if "latticeHash(" in body}, {"latticeSlope"})
        for name in ("backdrop.frag", "env.frag"):
            code = code_only(shader(name))
            self.assertNotIn("gl_FragCoord", code, name)
            for args in re.findall(r"(?<!float )\bhash\w*\((vec2\([^;]*?\))\)", code):
                words = set(re.findall(r"[A-Za-z_]\w*", args)) - {"vec2", "float"}
                self.assertLessEqual(words, {"row", "slot", "index"}, (name, args))

    # ---------------------------------------------------------------- C5 numeric and diagnostics
    def test_c5_colour_is_capped_before_output_alpha_is_not(self):
        main = code_only(functions(shader("liquid_flow.frag"))["main"])
        self.assertLess(main.index("colour = min(colour, vec3(1024.0));"),
                        main.index("fragColor[0] = TDOutputSwizzle(vec4(colour, alpha));"))
        self.assertNotRegex(main, r"alpha\s*=\s*min\(")
        self.assertEqual(main.count("min(colour, vec3(1024.0))"), 1)

    def test_c5_normalize_never_sees_a_zero_vector(self):
        frag = code_only(shader("liquid_flow.frag"))
        self.assertEqual(set(call_arguments(frag, r"(?<![A-Za-z])normalize")), {
            "n - eye * (away + 0.01)", "n", "n - amount * 0.35 * slope",
            "cross(abs(R.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), R)",
            "R + (t * cos(a) + b * sin(a)) * r"})
        vert = code_only(shader("liquid_flow.vert"))
        self.assertEqual(set(call_arguments(vert, r"(?<![A-Za-z])normalize")), {
            "abs(v.x) > abs(v.z) ? vec3(-v.y, v.x, 0.0) : vec3(0.0, -v.z, v.y)",  # orthogonal(): v is a unit normal
            "n", "down"})                                                            # both behind dot() > 1e-12
        self.assertIn("hasNormal ? normalize(n)", vert)
        self.assertIn("dot(down, down) > 1e-12 ? normalize(down)", vert)

    def test_c5_every_render_gets_an_info_dat(self):
        builder = runpy.run_path(str(STUDY / "builder.py"))
        self.assertLessEqual({"renderTOP", "renderpassTOP", "glslMAT", "glslTOP"}, set(builder["INFO_TYPES"]))

    def test_c5_render_diagnostics_reports_the_renders_that_draw_the_glass(self):
        def node(path, overridemat=None, geometry=(), errors="", warnings=""):
            par = SimpleNamespace(overridemat=SimpleNamespace(eval=lambda: overridemat),
                                  geometry=SimpleNamespace(evalOPs=lambda: list(geometry)))
            return SimpleNamespace(path=path, name=path.rsplit("/", 1)[1], par=par,
                                   errors=lambda: errors, warnings=lambda: warnings)
        material = object()
        comp = SimpleNamespace(path="/project1/liquid_glass_flow", op=lambda name: material,
                               par=SimpleNamespace(Backface=SimpleNamespace(eval=lambda: False)))
        glass_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: material)))
        other_geo = SimpleNamespace(par=SimpleNamespace(material=SimpleNamespace(eval=lambda: None)))
        renders = [node("/project1/liquid_glass_flow/render", overridemat=material),
                   node("/project1/liquid_glass_flow/render_back"),
                   node("/project1/glass_pass", overridemat=material, errors="compile error"),
                   node("/project1/render_glass", geometry=[other_geo, glass_geo]),
                   node("/project1/render_scene", geometry=[other_geo])]
        report = NATIVE["render_diagnostics"](comp, renders)
        self.assertEqual(sorted(report), ["/project1/glass_pass", "/project1/liquid_glass_flow/render", "/project1/render_glass"])

    # ---------------------------------------------------------------- C6 screen orientation
    def test_c6_offsets_follow_the_measured_screen_orientation(self):
        frag = code_only(shader("liquid_flow.frag"))
        sign = functions(frag)["screenSign"]
        self.assertIn("gl_FragCoord", sign)
        self.assertIn("if (uState.w > 0.5) orient.y = -orient.y;", sign)
        main = functions(frag)["main"]
        self.assertIn("vec2 orient = screenSign(ndc, ndcStep, depthStep, proj);", main)  # family close G2
        self.assertIn("vec2 toUV = unitsToUV(proj, depth) * orient;", main)
        self.assertIn("mirrorUV(uv + rv.xy * orient * uEnv.w * 0.5)", frag)

    # ---------------------------------------------------------------- C7 fog
    def test_c7_fog_on_the_front_pass_only(self):
        main = code_only(functions(shader("liquid_flow.frag"))["main"])
        self.assertIn("vec3 fogAdded = TDFog(vec4(0.0, 0.0, 0.0, 1.0), vWorldPos, vCamIndex).rgb;", main)
        self.assertIn("colour = TDFog(vec4(colour, 1.0), vWorldPos, vCamIndex).rgb - fogAdded * (1.0 - alpha);", main)
        self.assertEqual(main.count("TDFog("), 2)
        self.assertLess(main.index("if (!backPass) {\n        colour *= uBody.z;"), main.index("TDFog("))

    # ---------------------------------------------------------------- C8 Object size
    def test_c8_object_size_is_setup_and_never_reset(self):
        # Family close G1: two sizes, one job each. Object size (the family's world size, default =
        # what Fit sets on the demo sphere) and Flow size (the motion's, SOP units, default 1).
        for name, default in (("Objectsize", 1.0 / 1.45), ("Flowsize", 1.0)):
            size = CONTROLS[name]
            self.assertTrue(size.get("setup"), name)
            self.assertEqual((size["default"], size["page"]), (default, "Flow fit"), name)
            self.assertGreater(size["min"], 0.0, name)
            self.assertNotIn(name, SPEC["preset_keys"])
        for item in EXPERIMENTS:
            comp = scene_comp()
            NATIVE["apply"](comp, item["id"])
            MODULE["apply"](comp, "aqua_jelly")
            self.assertEqual((comp.par.Objectsize.val, comp.par.Flowsize.val), (7.5, 2.5), item["id"])

    def test_c8_object_size_scales_the_lengths_and_is_exact_at_1(self):
        reference = json.loads((REFERENCE / "study.json").read_text())

        def evaluate(spec, comp, name):
            node = next(n for n in spec["nodes"] if n["id"] == "material")
            values = next(u for u in node["uniforms"] if u["name"] == name)["values"]
            env = {"op": lambda _: SimpleNamespace(module=SimpleNamespace(u=MODULE["u"], clock=lambda *a: 0.0)),
                   "parent": lambda: comp, "absTime": SimpleNamespace(seconds=0.0)}
            out = [v if not isinstance(v, str) else eval(v, env) for v in values]  # noqa: S307 (study.json)
            return [v.eval() if hasattr(v, "eval") else v for v in out]  # a bare Par evaluates, as in TouchDesigner

        for preset in PRESETS["order"]:
            comp = FakeComp(defaults())
            MODULE["apply"](comp, preset)
            comp.par.Objectsize.val = 1.0  # the family's reference size (the core's default, the demo torus)
            for name in ("uGlass", "uBody", "uOptics"):  # Object size 1: the same numbers as at 6a58487
                self.assertEqual(evaluate(SPEC, comp, name), evaluate(reference, comp, name), (preset, name))
            self.assertEqual(evaluate(SPEC, comp, "uWobble")[:2], evaluate(reference, comp, "uWobble")[:2], preset)
            self.assertEqual(evaluate(SPEC, comp, "uFilm")[3], 2.5)  # the constant 2.5 in the 6a58487 shader
            self.assertEqual(evaluate(SPEC, comp, "uFlowSpace")[3], 1.0)  # Flow size, as the 6a58487 Flowsize
            self.assertEqual(evaluate(SPEC, comp, "uFlowSpace"), evaluate(reference, comp, "uFlowSpace"))
            comp.par.Objectsize.val = 10.0
            values = PRESETS["presets"][preset]["values"]
            self.assertAlmostEqual(evaluate(SPEC, comp, "uOptics")[1], values["Thickness"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uBody")[1], values["Frost"] * 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uGlass")[3], values["Density"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uWobble")[1], values["Wobblescale"] / 10.0, 12)
            self.assertAlmostEqual(evaluate(SPEC, comp, "uFilm")[3], 0.25, 12)
            self.assertEqual(evaluate(SPEC, comp, "uFlowSpace")[3], 1.0)  # Object size leaves the motion alone
            comp.par.Flowsize.val = 4.0
            self.assertEqual(evaluate(SPEC, comp, "uFlowSpace")[3], 4.0)  # Flow size moves it, in SOP units
            self.assertAlmostEqual(evaluate(SPEC, comp, "uOptics")[1], values["Thickness"] * 10.0, 12)  # and not the glass
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + ", shader("liquid_flow.frag"))

    # ---------------------------------------------------------------- C9 demo backdrops
    def test_c9_backdrop_menu_reaches_the_demo_backdrop(self):
        menu = CONTROLS["Backdrop"]
        self.assertEqual((menu["type"], menu["page"], menu["default"], menu["names"]), ("menu", "Study", "checker", ["checker", "type"]))
        self.assertFalse(menu.get("setup"))
        node = NODES["demo_backdrop"]
        self.assertTrue(node.get("demo"))
        self.assertEqual(node["uniforms"], [{"name": "uBackdrop", "values": ["op('presets').module.menu(parent().par.Backdrop)", 0, 0, 0]}])
        code = code_only(shader("backdrop.frag"))
        self.assertIn("if (uBackdrop.x > 0.5) {", code)
        self.assertTrue((STUDY / "captures" / "presets-sheet-type.png").is_file())


# The documented additions to the current core pixel shader (README, tutorial, decisions.json).
EXPECTED_PIXEL_DIFF = [
    "-// Liquid Glass: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).",
    "+// Liquid Glass Flow: GLSL MAT pixel shader for TouchDesigner (GLSL 4.60).",
    "+//",
    "+// This is the Liquid Glass pixel shader (examples/liquid-glass) after the",
    "+// family close, with two additions: the vFlow input and the \"displacement\"",
    "+// teaching stage. It was rebuilt from the core's working tree on commit",
    "+// c94e849; that core is in commit 9e58e25, then at studies/liquid-glass.",
    "+// The vertex shader liquid_flow.vert moves the surface; everything here works",
    "+// on the moved surface without knowing it moved.",
    "+in float vFlow;   // outward motion in units of Amplitude (displacement stage)",
    "+// @begin flowstage",
    "+// Teaching stage \"displacement\": orange where the surface moved out, blue",
    "+// where it moved in, dark grey where it stayed (like the archived blob demo,",
    "+// which colours the sphere by its displacement).",
    "+vec3 flowColour(float flow)",
    "+{",
    "+    vec3 out_ = vec3(1.0, 0.55, 0.12);",
    "+    vec3 in_ = vec3(0.15, 0.4, 1.0);",
    "+    return mix(vec3(0.12), flow > 0.0 ? out_ : in_, clamp(abs(flow), 0.0, 1.0));",
    "+}",
    "+// @end flowstage",
    "+",
    "-        else colour = vec3(uv, 0.0);",
    "+        else if (stage == 8) colour = vec3(uv, 0.0);",
    "+        else colour = flowColour(vFlow);",
]


# ---------------------------------------------------------------- builder dry run
class _Par:
    def __init__(self, owner, name):
        self.owner, self.name, self.val, self.expr, self.default = owner, name, None, None, None
        self.isMenu, self.menuNames, self.menuLabels = False, [], []

    def eval(self):  # a reference parameter holding a relative path resolves to that node
        return self.owner.op(self.val) if isinstance(self.val, str) and self.val else self.val


class _Pars:
    def __init__(self, owner):
        object.__setattr__(self, "_owner", owner)

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        par = _Par(self._owner, name)
        object.__setattr__(self, name, par)
        return par


class _Page:
    def __init__(self, owner):
        self.owner = owner

    def __getattr__(self, method):
        if not method.startswith("append"):
            raise AttributeError(method)
        def add(name, label=None):
            if method in ("appendRGB", "appendXYZ"):
                suffixes = "rgb" if method == "appendRGB" else "xyz"
                return [getattr(self.owner.par, name + a) for a in suffixes]
            return [getattr(self.owner.par, name)]
        return add


class _Connector:
    def __init__(self, owner):
        self.owner, self.source = owner, None

    def connect(self, source):
        self.source = source
        if self is self.owner.inputConnectors[-1]:
            self.owner.inputConnectors.append(_Connector(self.owner))  # like a multi-input operator


class _Op:
    def __init__(self, op_type, name, parent=None):
        self.OPType, self.name, self.parent = op_type, name, parent
        self.path = (parent.path if parent else "") + "/" + name
        self.par, self.children, self.storage = _Pars(self), [], {}
        self.seq = SimpleNamespace(vec=SimpleNamespace(numBlocks=0), sampler=SimpleNamespace(numBlocks=0))
        self.inputConnectors = [_Connector(self)]
        self.text, self.nodeX, self.nodeY, self.comment, self.viewer = "", 0, 0, "", False

    def create(self, op_type, name, initialize=True):
        child = _Op(op_type if isinstance(op_type, str) else op_type.__name__, name, self)
        self.children.append(child)
        return child

    def op(self, path):
        node = self
        for part in path.split("/"):
            node = next((c for c in node.children if c.name == part), None)
            if node is None:
                return None
        return node

    def appendCustomPage(self, name):
        return _Page(self)

    def relativePath(self, other):
        return other.path[len(self.path) + 1:] if other.path.startswith(self.path + "/") else other.path

    def cook(self, force=False):
        pass

    def store(self, key, value):
        self.storage[key] = value

    def fetch(self, key, default=None):
        return self.storage.get(key, default)


class BuilderDryRun(unittest.TestCase):
    """Runs builder.build() against a permissive stand-in for TouchDesigner.

    The stand-in accepts any parameter name, so this checks the builder's
    control flow and the recipe's structure, not TouchDesigner's names.
    """

    def test_build_runs_and_wires_everything(self):
        root = _Op("baseCOMP", "project1")
        td = ModuleType("td")
        td.op = lambda path: root if path == "/project1" else None
        td.app = SimpleNamespace(build="test")
        td.ParMode = SimpleNamespace(EXPRESSION="EXPRESSION")
        for name in ("baseCOMP", "textDAT", "infoDAT"):
            setattr(td, name, type(name, (), {}))
        saved = sys.modules.get("td")
        sys.modules["td"] = td
        try:
            builder = runpy.run_path(str(STUDY / "builder.py"))
            comp = builder["build"](STUDY, "/project1")
        finally:
            sys.modules["td"] = saved
        self.assertEqual(comp.fetch("build_warnings"), [])
        names = {c.name for c in comp.children}
        for node in SPEC["nodes"]:
            if "/" not in node["id"]:
                self.assertIn(node["id"], names)
        for render in ("render", "render_back", "material", "material_back"):
            self.assertIn("info_" + render, names)  # C5: every render gets an Info DAT
        self.assertEqual(comp.par.Refractiontop.val, "demo_backdrop")  # R3: constant relative path
        self.assertEqual(comp.par.Refractiontop.default, "demo_backdrop")
        self.assertIsNone(comp.par.Refractiontop.expr)
        material = comp.op("material")
        vectors = [u for u in NODES["material"]["uniforms"] if u.get("kind") != "sampler"]
        self.assertEqual(material.seq.vec.numBlocks, len(vectors))
        self.assertEqual(material.par.vec0name.val, "uGlass")
        self.assertTrue(comp.op("render").par.overridemat.val.endswith("material"))  # R2: Override Material
        geo = comp.op("demo_geo")
        pick = geo.op("pick")
        self.assertEqual([c.source.name for c in pick.inputConnectors if c.source], ["sphere", "torus", "box", "grid"])
        box = geo.op("box")
        self.assertEqual(box.OPType, "mergeSOP")  # six faces; a divided Box SOP renders nothing
        self.assertEqual([c.source.name for c in box.inputConnectors if c.source],
                         ["box_front", "box_back", "box_right", "box_left", "box_top", "box_bottom"])
        self.assertTrue(pick.display and pick.render)
        self.assertFalse(geo.op("sphere").display)


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


FAMILY = ("liquid-glass", "liquid-glass-flow", "liquid-glass-blobs", "liquid-glass-prism", "liquid-glass-lit")
# What a decision says when it makes Object size the motion's unit (c94e849 and before).
MOTION_IN_OBJECT_SIZE = re.compile(r"Flow centre and Object size|scales the motion|q = \(P - centre\) / size")


class FitHelperName(unittest.TestCase):
    """Family critic (low), one name per thing. The Fit helper was fit_flow() here
    and fit_object_size() in Blobs, but fit_glass() in the core, Prism and Lit.
    It is fit_glass() now; fit_flow stays one round as an alias of the same
    function, because the core's tests still call it (review.md, Family critic:
    one Fit name). decisions.json's 'Presets that transfer' entry still made
    Object size the motion's unit; since Family close G1 that is Flow size. These
    tests fail before the fix (checks/results/red-run-fit-name.json)."""

    OLD = "fit_flow"

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

    def test_decisions_that_size_the_motion_by_object_size_are_superseded(self):
        decisions = json.loads((STUDY / "decisions.json").read_text())
        self.assertEqual(len([d for d in decisions if d["goal"].startswith("Family close G1:")]), 1)
        transfer = next(d for d in decisions if d["goal"] == "Presets that transfer across object sizes and positions.")
        self.assertTrue(transfer["status"].startswith("superseded by Family close G1"), transfer["status"])
        old = [d["goal"] for d in decisions if MOTION_IN_OBJECT_SIZE.search(d["choice"])]
        self.assertGreaterEqual(len(old), 2)  # 'Presets that transfer' and family sync C8
        for d in decisions:
            if MOTION_IN_OBJECT_SIZE.search(d["choice"]):
                self.assertIn("superseded", d["status"], d["goal"])



# ---------------------------------------------------------------- family close (review.md)
def preprocessed(source, defined):
    """The lines a GLSL preprocessor keeps when the names in `defined` are
    #defined. Handles #ifdef, #ifndef, #else and #endif only; any other
    conditional fails the test instead of being guessed (from Liquid Glass Blobs,
    as the core uses it)."""
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


def main_body(source):
    """The text of main() between its braces."""
    body = source[source.index("void main()"):]
    return body[body.index("{") + 1:body.rindex("}")]


def core_native():
    """The core study's native.py, when the core sits next to this folder."""
    path = STUDY.parent / "liquid-glass" / "native.py"
    return runpy.run_path(str(path)) if path.is_file() else None


class FamilyClose(unittest.TestCase):
    """This study's share of the family close: the gaps G1, G2, G3 and G6 that a
    family critic found after the two-way sync (c94e849). The four gap tests fail
    on c94e849; test_preprocessed_helper_follows_ifdef_ifndef_and_else tests the
    helper only and passes there (checks/results/red-run-family-close.json)."""

    P = staticmethod(lambda x, y, z: SimpleNamespace(x=x, y=y, z=z))

    def test_g1_object_size_follows_the_family_rule(self):
        # The family rule (Liquid Glass Lit decisions.json, family_rule): Object size is the object's
        # world radius over 1.45 (the core's demo torus), for the glass lengths and for the ripple and
        # film lookups. The motion keeps its own size in SOP units under its own name, Flow size.
        lit = STUDY.parent / "liquid-glass-lit" / "decisions.json"
        if lit.is_file():
            rules = [d["family_rule"] for d in json.loads(lit.read_text()) if "family_rule" in d]
            self.assertEqual([r["reference_radius"] for r in rules], [1.45])
            self.assertEqual(rules[0]["world_scale_glsl"], "pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0)")
        self.assertEqual(NATIVE["torus_radius"](SPEC), 1.45)
        self.assertIn("abs(geo.worldTransform.determinant()) ** (1.0 / 3.0)", shader("native.py"))
        # Fit on the core's demo torus (radx 1 + rady 0.45, orient Z), unscaled and in Geometry COMPs
        # scaled 2 and 3. The critic measured 1.45 here on c94e849 for the COMP scaled 3; the rule gives 3.
        torus = SimpleNamespace(center=self.P(0.0, 0.0, 0.0), size=self.P(2.9, 2.9, 0.9))
        core = core_native()
        for det, expected in ((1.0, 1.0), (8.0, 2.0), (27.0, 3.0)):
            sop = SimpleNamespace(isSOP=True, render=True, path="torus", bounds=lambda: torus)
            geo = SimpleNamespace(path="/project1/geo1", children=[sop], worldTransform=SimpleNamespace(determinant=lambda d=det: d))
            comp = scene_comp()
            report = NATIVE["fit_glass"](comp, geo)
            self.assertAlmostEqual(report["object_size"], expected, 9)
            self.assertAlmostEqual(comp.par.Objectsize.val, expected, 9)
            self.assertAlmostEqual(comp.par.Flowsize.val, 1.45, 12)  # SOP units: the COMP scales the moved surface
            if core is not None:  # the core's own Fit on the same object sets the same Object size
                core_comp = SimpleNamespace(par=SimpleNamespace(Objectsize=SimpleNamespace(val=None)),
                                            op=lambda name: SimpleNamespace(text=(CORE / "study.json").read_text()))
                core["fit_glass"](core_comp, geo)
                self.assertAlmostEqual(core_comp.par.Objectsize.val, report["object_size"], 12)
        self.assertNotIn("liquid_glass_object_size", shader("native.py"))  # one size, one name: no conversion left
        # One name per thing in the bindings: Flow size reaches only the motion, Object size only the glass.
        lengths = {("uGlass", 3), ("uBody", 1), ("uOptics", 1), ("uFilm", 3), ("uWobble", 1)}
        for node_id in ("material", "material_back"):
            for u in NODES[node_id]["uniforms"]:
                for k, v in enumerate(u.get("values", [])):
                    if isinstance(v, str):
                        self.assertEqual("par.Flowsize" in v, (u["name"], k) == ("uFlowSpace", 3), (node_id, u["name"], k))
                        self.assertEqual("par.Objectsize" in v, (u["name"], k) in lengths, (node_id, u["name"], k))
        for name in ("Amplitude", "Swellscale", "Ripplescale", "Wavelength"):
            self.assertIn("flow size", CONTROLS[name]["label"], name)
        self.assertEqual(CONTROLS["Fitglass"]["label"], "Fit to Glass geometry (sets Flow centre, Flow size and Object size)")
        # The pattern lookups come through the core's pixel stage: object-space position x worldScale().
        frag = code_only(shader("liquid_flow.frag"))
        body = functions(frag)
        self.assertEqual(body["worldScale"].strip(), "return pow(abs(determinant(mat3(uTDMats[vCamIndex].world))), 1.0 / 3.0);")
        self.assertIn("vec3 p = vObjPos * uWobble.y * scale;", body["wobbleNormal"])
        self.assertIn("valueNoise(vObjPos * uFilm.w * worldScale() + vec3(0.0, uPhase.w, 0.0))", body["filmThickness"])
        self.assertEqual(len(re.findall(r"vObjPos \*", frag)), 2)
        # The docs no longer describe two meanings or the Transform SOP workaround.
        for name in ("README.md", "article.source.md"):
            text = (STUDY / name).read_text()
            for phrase in ("liquid_glass_object_size", "Transform SOP) instead", "1.45 times larger",
                           "Glass lengths ignore the Geometry COMP's scale", "is not Liquid Glass's Object size"):
                self.assertNotIn(phrase, text, (name, phrase))
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        self.assertIn("check('fit_size_carries_presets_over_comp_scale'", tests)

    def test_g2_centre_line_tie_break_comes_through_the_pixel_stage(self):
        # The core's tie-break (from Liquid Glass Lit): on the centre line of an odd-sized render the
        # projected position's screen derivative decides, only where 1/w changes by under 10%.
        frag = code_only(shader("liquid_flow.frag"))
        sign = functions(frag)["screenSign"]
        self.assertIn("vec2 screenSign(vec2 ndc, vec2 ndcStep, vec2 depthStep, mat4 proj)", frag)
        self.assertIn("vec2 useStep = step(abs(raster), 0.5 * uTDGeneral.viewport.zw) * step(depthStep, vec2(0.1));", sign)
        self.assertIn("runs = mix(runs, vec2(ndcStep.x < 0.0 ? -1.0 : 1.0, ndcStep.y < 0.0 ? -1.0 : 1.0), useStep);", sign)
        main = functions(frag)["main"]
        self.assertIn("vec2 ndcStep = vec2(dFdx(ndc.x), dFdy(ndc.y));", main)
        self.assertIn("vec2 depthStep = abs(vec2(dFdx(invW), dFdy(invW)) / invW);", main)
        self.assertLess(main.index("vec2 depthStep"), main.index("TDCheckDiscard();"))
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        self.assertIn("check('screen_orientation_has_no_wrong_pixels'", tests)
        self.assertIn("odd_size_flipped_raster", tests)  # amplitude0_matches_core compares the centre row too
        # This study's C6 finding is closed by the core's fix, not left open.
        c6 = next(d for d in json.loads(shader("decisions.json")) if d["goal"].startswith("Family sync C6 finding"))
        self.assertNotEqual(c6["status"], "open for the core")

    def test_g3_film_swirl_0_wording_everywhere(self):
        # uFilm.w = 0 gives one film thickness over the whole object that still drifts; nothing freezes.
        row = next(line for line in shader("README.md").splitlines() if line.startswith("| `uFilm` |"))
        self.assertIn("0 = one film thickness over the whole object, no swirl; Wobble speed 0 stops the drift", row)
        for name in ("README.md", "article.source.md", "liquid_flow.frag"):
            self.assertIsNone(re.search(r"freez\w* the (swirl|film)", shader(name)), name)
        # The shader says it too, since the pixel stage follows the core's family close.
        self.assertIn("// uFilm.w = 0 gives one film thickness over the whole object, which still", shader("liquid_flow.frag"))

    def test_g6_pick_render_runs_only_the_documented_picking_block(self):
        # Write a GLSL MAT, Picking: '#ifndef TD_PICKING_ACTIVE // All the typical shader code #else
        # TDWritePickingValues(); #endif'; while picking only the #else block runs. This study moves its
        # points, so the #else block then writes the moved positions and normals (after the call).
        vert = code_only(shader("liquid_flow.vert"))
        self.assertNotIn("#ifdef TD_PICKING_ACTIVE", vert)
        outputs = sorted(re.findall(r"^\s*(?:flat\s+)?out\s+\w+\s+(\w+)\s*;", vert, re.M))
        self.assertEqual(outputs, ["vCamIndex", "vFlow", "vObjPos", "vWorldNormal", "vWorldPos"])
        pick = main_body(preprocessed(vert, {"TD_PICKING_ACTIVE"}))
        ordinary = main_body(preprocessed(vert, set()))
        for name in outputs:
            self.assertIsNone(re.search(rf"\b{name}\s*=", pick), name)          # a pick render writes no output
            self.assertEqual(len(re.findall(rf"\b{name}\s*=", ordinary)), 1, name)  # an ordinary one writes each once
        self.assertNotIn("TDWritePickingValues", ordinary)
        self.assertNotIn("vTDPickVert", ordinary)
        writes = re.findall(r"vTDPickVert\.(\w+) = ([^;]+);", pick)
        self.assertEqual(writes, [("sopSpacePosition", "moved"), ("worldSpacePosition", "world.xyz"),
                                  ("camSpacePosition", "(uTDMats[TDCameraIndex()].cam * world).xyz"),
                                  ("sopSpaceNormal", "normal"), ("worldSpaceNormal", "worldNormal"),
                                  ("camSpaceNormal", "uTDMats[TDCameraIndex()].camForNormals * worldNormal")])
        self.assertLess(pick.index("TDWritePickingValues();"), pick.index("vTDPickVert."))
        # Both renders move and place the point the same way before the branch.
        shared = main_body(vert)[:main_body(vert).index("#ifndef TD_PICKING_ACTIVE")]
        self.assertTrue(pick.startswith(shared) and ordinary.startswith(shared))
        for statement in ("moved = p + size * offset;", "vec4 world = TDDeform(moved);", "gl_Position = TDWorldToProj(world);"):
            self.assertIn(statement, shared)
        header = " ".join(shader("liquid_flow.vert").split("\n// @begin", 1)[0].replace("//", " ").split())
        self.assertIn("while picking, the point is still moved and placed, and of the branch only the #else block runs", header)

    def test_preprocessed_helper_follows_ifdef_ifndef_and_else(self):
        source = "a\n#ifdef X\nb\n#else\nc\n#endif\n#ifndef X\nd\n#else\ne\n#endif\nf"
        self.assertEqual(preprocessed(source, {"X"}).split(), ["a", "b", "e", "f"])
        self.assertEqual(preprocessed(source, set()).split(), ["a", "c", "d", "f"])
        with self.assertRaises(AssertionError):
            preprocessed("#if X > 1\na\n#endif", set())


def family_close_paragraph(head):
    """The paragraph of review.md's Family close section that starts with **head**."""
    section = shader("review.md").split("\n## Family close\n", 1)[1].split("\n## ", 1)[0]
    return section.split(f"**{head}**", 1)[1].split("\n\n", 1)[0]


class FamilyCloseVerifier(unittest.TestCase):
    """A family critic checked this study's family close and found three gaps in its
    records, V1 to V3 (review.md, Family close > Verifier fixes after the family
    close). Each test fails on the family close as first delivered."""

    P = staticmethod(lambda x, y, z: SimpleNamespace(x=x, y=y, z=z))

    def fit(self, size, det=1.0):
        bounds = SimpleNamespace(center=self.P(0.0, 0.0, 0.0), size=self.P(*size))
        sop = SimpleNamespace(isSOP=True, render=True, path="sop", bounds=lambda: bounds)
        geo = SimpleNamespace(path="/project1/geo1", children=[sop], worldTransform=SimpleNamespace(determinant=lambda: det))
        return NATIVE["fit_glass"](scene_comp(), geo)

    def test_v1_fit_checklists_match_what_fit_flow_returns(self):
        # The first native tester reads these two checklists. Their numbers and report keys must be
        # what fit_glass() gives on the same objects: the demo sphere, the demo torus (the core's) and
        # that torus in a Geometry COMP scaled 3.
        sphere, torus = NODES["demo_geo/sphere"]["parameters"], NODES["demo_geo/torus"]["parameters"]
        self.assertEqual(torus["orient"], "z")
        outer = torus["radx"] + torus["rady"]
        reports = [self.fit((2 * sphere["radx"], 2 * sphere["rady"], 2 * sphere["radz"])),
                   self.fit((2 * outer, 2 * outer, 2 * torus["rady"])),
                   self.fit((2 * outer, 2 * outer, 2 * torus["rady"]), det=27.0)]
        expected = [(r["flow_size"], r["object_size"]) for r in reports]
        self.assertAlmostEqual(expected[2][1], 3.0 * expected[1][1], 12)  # Object size x3, Flow size unchanged
        self.assertEqual(expected[2][0], expected[1][0])
        keys = set(reports[0])
        row = next(l for l in shader("review.md").splitlines() if l.startswith("| Fit to Glass geometry"))
        how = json.loads(shader("validation.json"))["fit_native"]["how"]
        for name, text, named in (("review.md, Open risks", row, re.findall(r"`([a-z]+(?:_[a-z]+)+)`", row)),
                                  ("validation.json fit_native", how, re.findall(r"\b[a-z]+(?:_[a-z]+)+\b", how))):
            with self.subTest(name):
                self.assertEqual(sorted(set(named) - keys), [])         # no report key fit_glass() lacks
                self.assertIn("flow_size", named)
                self.assertIn("object_size", named)
                found = [(float(a), float(b)) for a, b in
                         re.findall(r"Flow size (\d+(?:\.\d+)?), Object size (\d+(?:\.\d+)?)", text)]
                self.assertEqual(len(found), 3, found)
                for (fa, oa), (fe, oe) in zip(found, expected):
                    self.assertAlmostEqual(fa, fe, delta=0.005)
                    self.assertAlmostEqual(oa, oe, delta=0.005)

    def test_v2_red_run_claims_match_the_record(self):
        # Each family-close gap has tests that fail on c94e849. The preview tests changed only to pin
        # Object size 1 pass there by design, and the preprocessor helper's own test is not a red test.
        record = json.loads((STUDY / "checks" / "results" / "red-run-family-close.json").read_text())
        unit_red = set(record["unit_tests_on_c94e849"]["failing"])
        preview = {}
        for part in ("preview_tests_on_c94e849", "changed_preview_tests_on_c94e849"):
            preview.update({r["name"]: r["ok"] for r in record[part]["results"]})
        helper = "test_preprocessed_helper_follows_ifdef_ifndef_and_else"
        for name in (n for n in dir(FamilyClose) if n.startswith("test_")):
            self.assertEqual(name in unit_red, name != helper, name)
        close = json.loads(shader("validation.json"))["family_close"]
        for name in close["red_on_c94e849"]["unit"]:
            self.assertIn(name, unit_red)
        for name in close["red_on_c94e849"]["preview"]:
            self.assertIs(preview[name], False, name)
        for name in close["green_on_c94e849_by_design"]["preview"]:
            self.assertIs(preview[name], True, name)
        self.assertEqual(close["green_on_c94e849_by_design"]["unit"], [helper])
        self.assertIn(helper, record["unit_tests_on_c94e849"]["note"])
        # The pinned tests are the preview tests that set Object size 1 to keep their old measurement.
        tests = (STUDY / "checks" / "preview_tests.cjs").read_text()
        for name in close["green_on_c94e849_by_design"]["preview"]:
            block = tests.split(f"want('{name}')", 1)[1].split("\n  if (want(", 1)[0]
            self.assertTrue("...AT_REFERENCE_SIZE" in block or "Objectsize: 1," in block, name)
        # No record claims that every new or changed test is red.
        overclaim = re.compile(r"(?i)\b(?:every|each) (?:new or changed )?test fails on c94e849")
        module_doc = (STUDY / "checks" / "test_study.py").read_text().split('"""', 2)[1]
        for name, text in (("validation.json family_close.scope", close["scope"]), ("test_study.py module docstring", module_doc),
                           ("FamilyClose docstring", FamilyClose.__doc__),
                           ("review.md, Family close intro", shader("review.md").split("\n## Family close\n", 1)[1].strip().split("\n\n", 1)[0])):
            self.assertIsNone(overclaim.search(text), name)

    def test_v3_not_done_paragraph_matches_the_family_records(self):
        # The paragraph routes out-of-date family records to their owners. It must name only records
        # that exist, and the core README lines it calls corrected must be right today.
        para = family_close_paragraph("Not done here, and why.")
        lit = STUDY.parent / "liquid-glass-lit" / "decisions.json"
        if lit.is_file():
            rule = next(d["family_rule"] for d in json.loads(lit.read_text()) if "family_rule" in d)
            for key in re.findall(r"\bmembers_\w+", para):
                self.assertIn(key, sorted(rule), key)                      # no renamed or missing key
            self.assertTrue(rule["members_family_close"]["liquid-glass-flow"].startswith("Follows the rule"))
            self.assertIn("members_family_close", para)                    # says what Lit's record holds now
        core = STUDY.parent / "liquid-glass" / "README.md"
        if core.is_file():
            names = core.read_text().split("## Names across the family", 1)[1].split("\n## ", 1)[0]
            row = next(l for l in names.splitlines() if l.startswith("| [Liquid Glass Flow]"))
            label = CONTROLS["Fitglass"]["label"]
            sets = re.match(r"Fit to Glass geometry \(sets ([^;)]+)\)", label).group(1)
            self.assertEqual([c.strip() for c in row.strip("|").split("|")][4], sets)
            bullet = next(l for l in names.splitlines() if l.startswith("- **Object size**"))
            follow = re.split(r"(?<=[.;])\s+", bullet)
            follow = next(s for s in follow if " follow it" in s).split(" follow it")[0]
            self.assertIn("Flow", follow)


class FamilyCloseCritic(unittest.TestCase):
    """After the family close, a family critic's findings (review.md, Family
    close critic fixes). This study's share is PV4: Thickness is multiplied by
    Object size, whose default here is 1 / 1.45, so its label must not say
    scene units. The test fails on the label before the fix
    (checks/results/red-run-family-close-critic.json)."""

    def test_pv4_labels_say_what_object_size_does(self):
        # A control the uniforms multiply by Object size is in units of Object size, not scene units.
        for node_id in ("material", "material_back"):
            scaled = set()
            for u in NODES[node_id]["uniforms"]:
                for v in u.get("values", []):
                    m = re.fullmatch(r"op\('presets'\)\.module\.u\(parent\(\)\.par\.(\w+)\) \* "
                                     r"parent\(\)\.par\.Objectsize\.eval\(\)", str(v))
                    if m:
                        scaled.add(m.group(1))
            self.assertEqual(sorted(scaled), ["Frost", "Thickness"], node_id)
        for name in sorted(scaled):
            self.assertNotIn("scene units", CONTROLS[name]["label"], name)
        self.assertTrue(CONTROLS["Thickness"]["label"].startswith("Thickness (x Object size"))
        self.assertNotEqual(CONTROLS["Objectsize"]["default"], 1.0)  # why the label matters at the default
        # Object size: the family's one wording, with what this study's demo object fits to.
        size = CONTROLS["Objectsize"]
        m = re.fullmatch(r"Object size \(world radius / 1\.45; the demo (\w+) fits to ([0-9.]+)\)", size["label"])
        self.assertIsNotNone(m, size["label"])
        self.assertEqual(m.group(1), "sphere")
        self.assertEqual(float(m.group(2)), round(size["default"], 2))
        # The core uses the same Thickness and Object size wording (its demo torus fits to 1).
        core = {c["name"]: c["label"] for c in CORE_SPEC["controls"]}
        self.assertEqual(core["Thickness"], CONTROLS["Thickness"]["label"])
        self.assertEqual(core["Objectsize"], "Object size (world radius / 1.45; the demo torus fits to 1)")


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
        self.body = functions(code_only(shader("liquid_flow.frag")))
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
        # 1. Objects of different sizes: Fit reads only the first object, so the order matters.
        comp = self.fitted([big, small])
        self.assertEqual(self.ratios(self.look(comp, 1.0, 1.0), self.look(self.fitted([small]), 1.0, 1.0)), (5.0,) * n)
        comp = self.fitted([small, big])
        self.assertEqual(self.ratios(self.look(comp, 1.0, 1.0), self.look(self.fitted([big]), 1.0, 1.0)), (0.2,) * n)
        self.assertEqual(comp.par.Flowsize.val, 0.29)  # the motion is sized for the first object too
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
                'Fit reads only the first object in Glass geometry',
                'with Wobble ripples and film bands five times larger',
                'its motion is sized for the first object too',
                'The motion scales with the object',
                'three times as many Wobble ripples and film bands',
                "The motion, the Wobble ripples and the film bands grow with each instance's own scale",
                'Flow size and Object size become one value again',
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
    """Look-acceptance round (review.md, Look decisions): the family close changed the
    demo's look and the user has not accepted it. co-design.json asks the question with
    options and a recommended answer, the README lists it, and until the user answers the
    option in the code stays there. Both tests fail on the records before this round
    (checks/results/red-run-look-decisions.json)."""

    # The option the code is in. Change it only together with the user's recorded answer,
    # and then encode that option's code below.
    IN_CODE = {"LOOK-F1": "A"}

    def test_look_decisions_wait_for_the_user(self):
        codesign, decisions = check_look_decisions(self, self.IN_CODE)
        f1 = decisions["LOOK-F1"]
        # The numbers in the question are the measured ones, and agree with the family close's record.
        receipt = json.loads((STUDY / "checks" / "results" / "look-decisions.json").read_text())
        presets = receipt["reproduced_from_files"]["presets_checkerboard"]
        motion = receipt["reproduced_from_files"]["motion_frames"]
        self.assertEqual((presets["captures"], motion["captures"]), (12, 16))
        self.assertIn(f"12 preset captures changed by {presets['max_from']} to {presets['max_to']}/255", f1["what_changed"])
        self.assertIn(f"16 motion frames by {motion['max_from']} to {motion['max_to']}/255", f1["what_changed"])
        close = json.loads((STUDY / "checks" / "results" / "family-close-measurements.json").read_text())
        recorded = [v["max"] for k, v in close["at_the_new_default_object_size"]["per_capture"].items() if k.startswith("preset-")]
        self.assertEqual((len(recorded), min(recorded), max(recorded)), (12, presets["max_from"], presets["max_to"]))
        # A radius-1.45 sphere at Object size 1 renders today's look, not c94e849's, so no record
        # offers it as a way back to the old look.
        rows = receipt["option_radius_1_45"]["results"].values()
        to_now = max(r["big_vs_now"]["max"] for r in rows)
        to_old = sorted(r["big_vs_old"]["max"] for r in rows)
        self.assertLessEqual(to_now, 8)
        self.assertEqual(sum(r["big_vs_now"]["pixelsOver8"] for r in rows), 0)
        self.assertGreater(to_old[0], 100)
        self.assertIn(f"at most {to_now}/255 from it", f1["not_an_option"])
        self.assertIn(f"({to_old[0]} to {to_old[-1]}/255 from it)", f1["not_an_option"])
        self.assertIn(f"at most {to_now}/255 apart", (STUDY / "README.md").read_text())
        self.assertFalse([q for q in codesign["open_questions"] if "keep the old look by scaling" in q])
        self.assertTrue([q for q in codesign["open_questions"] if q.startswith("LOOK-F1 ")])

    def test_code_stays_as_delivered_until_answered(self):
        _, decisions = check_look_decisions(self, self.IN_CODE)
        self.assertEqual(self.IN_CODE["LOOK-F1"], "A", "encode the chosen option's code here")
        # A: the default Object size is what Fit sets on the radius-1 demo sphere ...
        self.assertAlmostEqual(CONTROLS["Objectsize"]["default"], 1 / 1.45, 12)
        sphere = NODES["demo_geo/sphere"]["parameters"]
        self.assertEqual((sphere["radx"], sphere["rady"], sphere["radz"]), (1.0, 1.0, 1.0))
        # ... the presets are the core's ...
        for name, preset in CORE_PRESETS["presets"].items():
            values = PRESETS["presets"][name]["values"]
            self.assertEqual({k: values[k] for k in preset["values"]}, preset["values"], name)
        # ... and the film keeps the family's count.
        for node_id in ("material", "material_back"):
            film = next(u for u in NODES[node_id]["uniforms"] if u["name"] == "uFilm")["values"][3]
            self.assertEqual(film, "2.5 / parent().par.Objectsize.eval()", node_id)


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
    FRAG = "liquid_flow.frag"
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
