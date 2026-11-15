"""Liquid Glass Flow presets: load a look and its motion, or morph toward another.

Inside TouchDesigner this is the module of the 'presets' Text DAT. The values
live in the 'presets_data' Text DAT, a copy of presets.json. The uniform
expressions on the materials also call menu(), flow_time(), phase() and
decode_colours() from here, and the demo object's rotation calls spin(). Apart
from the TouchDesigner globals absTime and project, which are only touched
when needed, it uses the standard library, so it can be tested outside
TouchDesigner too.

This is the Liquid Glass presets module (examples/liquid-glass) plus
flow_time(), which moves the liquid with the same advance() as the ripples.

From a script, load a look with
    component.op('presets').module.apply(component, 'violet_gel')
and set any overrides after it: the values are written at once. Changing the
Preset menu instead runs the Parameter Execute callback, which may apply the
look later in the frame and overwrite overrides set in the same script.
"""
import json

_cache = {"text": None, "data": None}


def data(comp):
    """Parsed presets.json from the component's 'presets_data' DAT (cached)."""
    text = comp.op('presets_data').text
    if text != _cache["text"]:
        _cache["data"] = json.loads(text)
        _cache["text"] = text
    return _cache["data"]


def values(comp, name):
    """Parameter values of one preset, or {} for 'custom' or an unknown name."""
    preset = data(comp)["presets"].get(name)
    return {} if preset is None else preset["values"]


def apply(comp, name):
    """Write a preset's values into the component's parameters."""
    for key, value in values(comp, name).items():
        par = getattr(comp.par, key, None)
        if par is not None:
            par.val = value


def u(par):
    """Uniform value for one parameter, blended toward the Morph target preset.

    Morph = 0 gives the parameter as set; Morph = 1 gives preset B's value.
    The motion values (Amplitude to Drip) are morphed like the look values.
    For the lengths (Thickness, Frost, Tint density, Wobble scale) the
    material's uniform expressions then multiply or divide the result by
    Object size, and the motion is measured in Flow size: setup controls
    that presets and the morph never change.
    """
    comp = par.owner
    a = par.eval()
    m = comp.par.Morph.eval()
    if m <= 0.0:
        return a
    b = values(comp, comp.par.Morphtarget.eval()).get(par.name, a)
    return a + (b - a) * m


def menu(par):
    """Index of a menu's evaluated value.

    Unlike par.menuIndex, this also follows a menu driven by an expression,
    an export or a bind.
    """
    value = par.eval()
    names = list(par.menuNames)
    return names.index(value) if value in names else par.menuIndex


# Running values of advance(), per component: key -> [value, absTime.seconds
# of the last step, or None while paused or still]. Module state lasts until
# this DAT's text changes; after that the next call starts again from
# rate x absTime.seconds, as on the first frame.
_motion = {}


def advance(comp, name, rate, period):
    """A value that moves at `rate` units per second, wrapped to 0..period.

    Running, each frame adds rate x the seconds since the previous frame. So a
    rate that changes (an animated Morph, a dragged Wobble speed or Demo spin)
    only changes how fast the value moves; rate x absTime.seconds would instead
    jump by the change in rate x every second since TouchDesigner started.
    Paused, the value is rate x Fixed time, so experiments are repeatable;
    unpausing continues from there. With rate 0 the value holds and the clock
    is never read, so a still look does not recook every frame. Within a frame
    every call returns the same value, so both materials agree.
    """
    key = (comp.path, name)
    if comp.par.Pause.eval():
        value = (rate * comp.par.Time.eval()) % period
        _motion[key] = [value, None]
        return value
    state = _motion.get(key)
    if rate == 0.0:
        if state is None:
            state = _motion[key] = [0.0, None]
        state[1] = None
        return state[0]
    now = absTime.seconds  # noqa: F821 (TouchDesigner global; never decreases)
    if state is None:
        state = _motion[key] = [(rate * now) % period, now]
    elif state[1] is None or now < state[1]:
        state[1] = now  # resume after a pause or a still stretch, without a jump
    else:
        state[0] = (state[0] + rate * (now - state[1])) % period
        state[1] = now
    return state[0]


# Flow time wraps here. The vertex shader's noise repeats every 256 cells, and
# every drift rate in liquid_flow.vert is a multiple of 0.01 cells per second,
# so 25600 seconds of flow time bring every drift back to the same place.
FLOW_WRAP = 25600.0


def flow_time(comp):
    """Flow time for the vertex shader (uFlow.w): integral of Flow speed, 0..25600.

    Morphed Flow speed added up frame by frame (advance()), so an animated
    Morph or a dragged slider changes how fast the liquid moves, never where
    it is. The shader folds each noise drift into one 256-cell repeat, so this
    one number serves every drift rate (see FLOW_WRAP).
    """
    return advance(comp, "flow", u(comp.par.Flowspeed), FLOW_WRAP)


def phase(comp, rate):
    """Noise drift offset: integral of rate x Wobble speed over time, 0..256.

    Computed here in double precision. The shader's noise repeats every 256
    units, so the wrap is seamless, and the shader never adds a huge time value
    that float32 would round (days-long installations stay smooth). The speed
    is morphed, so it is integrated (advance()), not multiplied by absTime.
    """
    return advance(comp, ("phase", rate), rate * u(comp.par.Wobblespeed), 256.0)


def spin(comp):
    """Demo object's rotation in degrees: integral of Demo spin over time."""
    return advance(comp, "spin", comp.par.Demospin.eval(), 360.0)


def decode_colours(comp):
    """1 if colour parameters must be converted from sRGB to linear, else 0.

    'auto' follows the project's working colour space (TouchDesigner
    2025.30000 and later): pass-through keeps colours as typed, a linear working
    space converts them, as TouchDesigner does for its own colour parameters.
    Builds without colour management count as pass-through.
    """
    mode = comp.par.Colourspace.eval()
    if mode != 'auto':
        return 1.0 if mode == 'srgb' else 0.0
    try:
        space = str(project.workingColorSpace)  # noqa: F821 (TouchDesigner global)
    except Exception:
        return 0.0
    return 0.0 if 'PASS' in space.upper() else 1.0
