"""Liquid Glass Blobs presets: load a look (and blob shape) into the parameters, or morph toward another.

Inside TouchDesigner this is the module of the 'presets' Text DAT. The values
live in the 'presets_data' Text DAT, a copy of presets.json. The uniform
expressions on the material also call menu(), phase(), sized() and
decode_colours() from here, and the demo ring's rotation calls spin(). Apart
from the TouchDesigner globals absTime and project, which are only touched when
needed, it uses the standard library, so it can be tested outside
TouchDesigner too.

Adapted from the liquid-glass study's presets.py (commit 6a58487); presets
here also carry blob-shape values (count, radius, spread, merge, ...), which
morph like any other value. A fractional blob count grows the last blob in, so
it morphs too.

From a script, load a look with
    component.op('presets').module.apply(component, 'lavender_gel')
and set any overrides after it: the values are written at once. Changing the
Preset menu instead runs the Parameter Execute callback, which may apply the
look later in the frame and overwrite overrides set in the same script.
"""
import json
import math

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
    """
    comp = par.owner
    a = par.eval()
    m = comp.par.Morph.eval()
    if m <= 0.0:
        return a
    b = values(comp, comp.par.Morphtarget.eval()).get(par.name, a)
    return a + (b - a) * m


def sized(par, power):
    """u(par) times Object size to the given power.

    Tint density is per scene unit (power -1); Backdrop distance and the Frost
    disc are in scene units (power 1). Object size is the box's radius over
    the family's reference radius 1.45 (the demo box: 1 / 1.45), so a preset
    keeps its look on blobs scaled to 0.1 or 10 scene units. At Object size 1
    the value is u(par) exactly.
    """
    size = par.owner.par.Objectsize.eval()
    value = u(par)
    return value if size == 1 else value * size ** power


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
    rate that changes (an animated Morph, a dragged Speed or Demo ring spin)
    only changes how fast the value moves; rate x absTime.seconds would instead
    jump by the change in rate x every second since TouchDesigner started.
    Paused, the value is rate x Fixed time, so experiments are repeatable;
    unpausing continues from there. With rate 0 the value holds and the clock
    is never read, so a still look does not recook every frame. Within a frame
    every call returns the same value.
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


# What each drift phase adds up per second, and where it wraps. blobs.frag
# rounds the layout's wave speeds to multiples of 1/128, so the layout repeats
# after 256 pi of phase; the ripple's 1.7, 1.3 and 1.1 turn whole after 20 pi;
# the film's noise lattice repeats every 256 units.
PHASES = {
    "layout": (lambda speed: speed, 256.0 * math.pi),
    "ripple": (lambda speed: 0.4 + speed, 20.0 * math.pi),
    "film": (lambda speed: 0.15 * (0.1 + 0.3 * speed), 256.0),
}


def phase(comp, which):
    """Drift phase 'layout', 'ripple' or 'film' for uPhase: the integral of a
    rate built from the morphed Speed, in double precision, wrapped where the
    shader's motion repeats. The speed is morphed, so it is integrated
    (advance()), not multiplied by absTime: morphing or dragging Speed after
    hours of uptime changes how fast the blobs move, never where they are."""
    rate, period = PHASES[which]
    return advance(comp, ("phase", which), rate(u(comp.par.Speed)), period)


def spin(comp):
    """Demo ring's rotation in degrees: integral of Demo ring spin over time."""
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
