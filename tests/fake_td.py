"""A small stand-in for TouchDesigner's `td` module, for tests that run without the host.

It models only what the bundled builder and helpers touch: operators with
parameters, parameter sequences, custom pages, wires, storage and diagnostics.
A parameter exists only if PARAMETERS lists it for that operator type, so a
wrong name fails here the way it fails in TouchDesigner.
"""
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

PLUGIN = Path(__file__).resolve().parents[1]

PARAMETERS = {
    "glslTOP": ["pixeldat", "outputresolution", "resolutionw", "resolutionh", "format"],
    "glslmultiTOP": ["pixeldat", "outputresolution", "resolutionw", "resolutionh", "format"],
    "glslMAT": ["pdat", "vdat"],
    "feedbackTOP": ["top", "resetpulse"],
    "constantCHOP": [],
    "noiseTOP": ["period"],
    "nullTOP": [],
    "infoDAT": ["op"],
    "textDAT": [],
    "baseCOMP": ["opviewer"],
}
SEQUENCES = {
    "vec": ["name", "valuex", "valuey", "valuez", "valuew"],
    "color": ["name", "rgbr", "rgbg", "rgbb", "alpha"],
    "sampler": ["name", "top"],
    "const": ["name", "value"],
}


class Par:
    def __init__(self, name, value=0, menu_names=None):
        self.name, self.val, self.default = name, value, value
        self.expr, self.mode, self.pulsed = None, "CONSTANT", 0
        self.menuNames, self.menuLabels = list(menu_names or []), []
        self.min = self.max = self.normMin = self.normMax = 0
        self.clampMin = self.clampMax = False

    @property
    def isMenu(self):
        return bool(self.menuNames)

    def __setattr__(self, key, value):
        object.__setattr__(self, key, value)
        if key == "expr" and value is not None:
            object.__setattr__(self, "mode", "EXPRESSION")

    def eval(self):
        return self.val

    def pulse(self):
        self.pulsed += 1


class Pars:
    def __init__(self):
        object.__setattr__(self, "_pars", {})

    def __getattr__(self, name):
        try:
            return self._pars[name]
        except KeyError:
            raise AttributeError(name) from None

    def __setattr__(self, name, value):
        self._pars[name].val = value


class Sequence:
    def __init__(self, node, name):
        object.__setattr__(self, "_node", node)
        object.__setattr__(self, "_name", name)
        object.__setattr__(self, "_blocks", 0)

    @property
    def numBlocks(self):
        return self._blocks

    @numBlocks.setter
    def numBlocks(self, count):
        object.__setattr__(self, "_blocks", count)
        for i in range(count):
            for field in SEQUENCES[self._name]:
                self._node.par._pars.setdefault(f"{self._name}{i}{field}", Par(f"{self._name}{i}{field}"))


class Sequences:
    def __init__(self, node):
        self._node, self._made = node, {}

    def __getattr__(self, name):
        if name.startswith("_") or name not in SEQUENCES:
            raise AttributeError(name)
        return self._made.setdefault(name, Sequence(self._node, name))


class Connector:
    def __init__(self):
        self.source = None

    def connect(self, node):
        self.source = node


class Page:
    def __init__(self, node):
        self.node = node

    def _add(self, name, value=0, menu_names=None):
        par = Par(name, value, menu_names)
        self.node.par._pars[name] = par
        self.node.customPars.append(par)
        return [par]

    def appendMenu(self, name, label=None):
        return self._add(name, "", ["_"])

    def appendToggle(self, name, label=None):
        return self._add(name, False)

    def appendFloat(self, name, label=None):
        return self._add(name, 0.0)

    def appendInt(self, name, label=None):
        return self._add(name, 0)

    def appendStr(self, name, label=None):
        return self._add(name, "")

    def appendPulse(self, name, label=None):
        return self._add(name, 0)

    def appendRGB(self, name, label=None):
        return [self._add(name + channel, 0.0)[0] for channel in "rgb"]

    def appendXYZ(self, name, label=None):
        return [self._add(name + channel, 0.0)[0] for channel in "xyz"]

    def appendTOP(self, name, label=None):
        return self._add(name, "")

    appendCOMP = appendObject = appendTOP


class Node:
    def __init__(self, op_type, name, parent=None):
        self.OPType, self.name, self.parent_node = op_type, name, parent
        self.par, self.seq = Pars(), Sequences(self)
        for p in PARAMETERS.get(op_type, []):
            self.par._pars[p] = Par(p)
        self.kids, self.customPars, self.storage = {}, [], {}
        self.inputConnectors = [Connector() for _ in range(4)]
        self.text = self.comment = ""
        self.nodeX = self.nodeY = 0
        self.viewer = False
        self.width, self.height = 640, 360
        self.error_text = self.warning_text = self.script_error_text = ""
        self.cooked = 0
        self.saved = []

    @property
    def path(self):
        return (self.parent_node.path if self.parent_node else "") + "/" + self.name

    @property
    def children(self):
        return list(self.kids.values())

    @property
    def module(self):
        return SimpleNamespace()

    def create(self, op_type, name, initialize=True):
        op_type = getattr(op_type, "OPType", op_type)
        if op_type not in PARAMETERS:
            raise RuntimeError("Unknown operator type: " + str(op_type))
        node = Node(op_type, name, self)
        self.kids[name] = node
        return node

    def op(self, name):
        node = self
        for part in name.split("/"):
            node = node.kids.get(part) if node else None
        return node

    def relativePath(self, other):
        return "rel:" + other.path

    def appendCustomPage(self, name):
        return Page(self)

    def store(self, key, value):
        self.storage[key] = value

    def fetch(self, key, default=None):
        return self.storage.get(key, default)

    def cook(self, force=False):
        self.cooked += 1

    def _collect(self, attr, recurse):
        found = [getattr(self, attr)] + ([k._collect(attr, True) for k in self.children] if recurse else [])
        return "\n".join(x for x in found if x)

    def errors(self, recurse=False):
        return self._collect("error_text", recurse)

    def warnings(self, recurse=False):
        return self._collect("warning_text", recurse)

    def scriptErrors(self, recurse=False):
        return self._collect("script_error_text", recurse)

    def save(self, path, asynchronous=False):
        self.saved.append(path)
        return path


def install():
    """Put a fresh fake `td` in sys.modules and return (module, root operator)."""
    root = Node("baseCOMP", "project1")
    root.parent_node = None
    td = ModuleType("td")
    td.app = SimpleNamespace(build="2025.33230", version="099")
    td.op = lambda path: root if path == "/project1" else None
    for name in ("baseCOMP", "textDAT", "infoDAT"):
        setattr(td, name, SimpleNamespace(OPType=name))
    td.__all__ = ["app", "op", "baseCOMP", "textDAT", "infoDAT"]
    sys.modules["td"] = td
    return td, root


def load(relative_path, name):
    """Import a plugin script by path, after install()."""
    spec = importlib.util.spec_from_file_location(name, PLUGIN / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
