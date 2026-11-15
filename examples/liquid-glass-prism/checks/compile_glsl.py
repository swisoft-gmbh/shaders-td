#!/usr/bin/env python3
"""Compile the study's GLSL with glslangValidator against TouchDesigner stand-ins.

TouchDesigner injects its own declarations (uTDMats, TDDeform, vUV, ...) before
compiling. This script prepends minimal stand-ins with the documented
signatures, then compiles each shader twice:

  1. GLSL 4.60 semantic check (OpenGL rules)
  2. Vulkan SPIR-V generation with relaxed rules (-V -R), closer to TD's backend

The vertex shader is also compiled as TouchDesigner compiles it for picking
(TD_PICKING_ACTIVE defined), and the pixel shader for a Render TOP with three
colour buffers (TD_NUM_COLOR_BUFFERS 3). Then two negative tests: a copy of the
pixel shader with one deliberate error must fail, and the error must point at
the broken line, which shows the harness can fail at all; and the picking
variant without the TDWritePickingValues() stand-in must fail, which shows the
picking branch is really compiled.

A pass means the code is valid GLSL 4.60 given those declarations. It is not a
TouchDesigner compile: TD's real declarations, layouts and drivers can differ.
Requires glslangValidator on PATH (Ubuntu: apt-get install glslang-tools).
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
STUDY = HERE.parent

COMMON = """
#define TD_NUM_CAMERAS 1
struct TDMatrix {
    mat4 world; mat4 worldInverse; mat4 worldCam; mat4 worldCamInverse;
    mat4 cam; mat4 camInverse; mat4 camProj; mat4 camProjInverse;
    mat4 proj; mat4 projInverse; mat4 worldCamProj; mat4 worldCamProjInverse;
    mat3 worldForNormals; mat3 camForNormals; mat3 worldCamForNormals;
};
uniform TDMatrix uTDMats[TD_NUM_CAMERAS];
struct TDGeneral { vec4 ambientColor; vec4 viewport; };
uniform TDGeneral uTDGeneral;
"""

MAT_VERTEX = COMMON + """
layout(location = 0) in vec3 P;
layout(location = 1) in vec3 N;
vec3 TDPos() { return P; }
vec3 TDNormal() { return N; }
vec4 TDDeform(vec3 p) { return uTDMats[0].world * vec4(p, 1.0); }
vec3 TDDeformNorm(vec3 n) { return uTDMats[0].worldForNormals * n; }
int TDCameraIndex() { return 0; }
vec4 TDWorldToProj(vec4 v) { return uTDMats[0].camProj * v; }
"""

MAT_PIXEL = COMMON + """
void TDCheckDiscard() {}
bool TDFrontFacing(vec3 position, vec3 normal) { return gl_FrontFacing; }
vec4 TDOutputSwizzle(vec4 c) { return c; }
vec4 TDFog(vec4 curColor, vec3 worldSpacePos, int cameraIndex) { return curColor; }
"""

# The pixel shader as TouchDesigner compiles it for a Render TOP with three colour buffers.
MAT_PIXEL_3_BUFFERS = "#define TD_NUM_COLOR_BUFFERS 3\n" + MAT_PIXEL

TOP_PIXEL = """
in vec3 vUV;
struct TDTexInfo { vec4 res; vec4 depth; };
uniform TDTexInfo uTDOutputInfo;
vec4 TDOutputSwizzle(vec4 c) { return c; }
"""

# The same vertex shader as TouchDesigner compiles it for a Render Pick DAT/CHOP.
MAT_VERTEX_PICKING = "#define TD_PICKING_ACTIVE\n" + MAT_VERTEX + """
void TDWritePickingValues() {}
"""

SHADERS = [
    ("vert", "liquid_prism.vert", MAT_VERTEX, ""),
    ("vert", "liquid_prism.vert", MAT_VERTEX_PICKING, " (picking)"),
    ("frag", "liquid_prism.frag", MAT_PIXEL, ""),
    ("frag", "liquid_prism.frag", MAT_PIXEL_3_BUFFERS, " (3 colour buffers)"),
    ("frag", "backdrop.frag", TOP_PIXEL, ""),
    ("frag", "env.frag", TOP_PIXEL, ""),
]

MODES = {
    "glsl460": [],
    "vulkan-relaxed": ["-V", "-R", "--aml", "--amb", "-o", "/dev/null"],
}

# The negative test: break the Snell's-law line in leaveGlass() by calling an
# undeclared function. The compiler must reject it and name that line.
BROKEN_FROM = "vec3 leaving = ior * inside + (cosT - ior * cosI) * outward;"
BROKEN_TO = "vec3 leaving = ior * inside + (cosT - ior * cosI) * outwardNormalOf(outward);"


def run(tool, stage, flags, path):
    result = subprocess.run([tool, "-S", stage, *flags, str(path)], capture_output=True, text=True)
    return result.returncode == 0, (result.stdout + result.stderr)


def compile_all():
    tool = shutil.which("glslangValidator")
    if tool is None:
        raise SystemExit("glslangValidator not found on PATH")
    version = subprocess.run([tool, "--version"], capture_output=True, text=True).stdout.splitlines()[0]
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, (stage, name, prelude, variant) in enumerate(SHADERS):
            source = (STUDY / name).read_text()
            text = "#version 460\n" + prelude + "\n#line 1\n" + source
            path = Path(tmp) / (Path(name).stem + str(i) + "." + stage)
            path.write_text(text)
            for mode, flags in MODES.items():
                ok, output = run(tool, stage, flags, path)
                results.append({"shader": name + variant, "mode": mode, "ok": ok,
                                "output": output.replace(str(path), name).strip()})

        # Negative test.
        source = (STUDY / "liquid_prism.frag").read_text()
        assert source.count(BROKEN_FROM) == 1, "negative-test anchor line not found exactly once"
        broken_line = source[:source.index(BROKEN_FROM)].count("\n") + 1
        path = Path(tmp) / "broken.frag"
        path.write_text("#version 460\n" + MAT_PIXEL + "\n#line 1\n" + source.replace(BROKEN_FROM, BROKEN_TO))
        ok, output = run(tool, "frag", [], path)
        lines = [int(m) for m in re.findall(r"ERROR: [^:]+:(\d+):", output)]
        negative = {"shader": "liquid_prism.frag (deliberately broken copy)", "mode": "glsl460",
                    "expected": "compile error on line %d" % broken_line,
                    "compiled": ok, "error_lines": lines,
                    "ok": (not ok) and broken_line in lines,
                    "output": output.replace(str(path), "broken.frag").strip()}

        # Negative test: the picking variant without TDWritePickingValues() must not compile.
        path = Path(tmp) / "picking-unresolved.vert"
        path.write_text("#version 460\n" + "#define TD_PICKING_ACTIVE\n" + MAT_VERTEX + "\n#line 1\n"
                        + (STUDY / "liquid_prism.vert").read_text())
        ok, output = run(tool, "vert", [], path)
        picking = {"shader": "liquid_prism.vert (TD_PICKING_ACTIVE, no TDWritePickingValues stand-in)", "mode": "glsl460",
                   "expected": "compile error: TDWritePickingValues undeclared (the picking branch is compiled)",
                   "compiled": ok, "ok": (not ok) and "TDWritePickingValues" in output,
                   "output": output.replace(str(path), "picking.vert").strip()}
    return {"tool": version, "ok": all(r["ok"] for r in results) and negative["ok"] and picking["ok"],
            "results": results, "negative_test": negative, "negative_test_picking": picking,
            "scope": "Valid GLSL 4.60 against documented TD stand-ins; not a TouchDesigner compile."}


if __name__ == "__main__":
    report = compile_all()
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["ok"] else 1)
