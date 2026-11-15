#!/usr/bin/env python3
"""Compile the study's GLSL with glslangValidator against TouchDesigner stand-ins.

TouchDesigner injects its own declarations (uTDMats, TDDeform, vUV, ...) before
compiling. This script prepends minimal stand-ins with the documented
signatures (Write a GLSL MAT / Write a GLSL TOP), then compiles each shader twice:

  1. GLSL 4.60 semantic check (OpenGL rules)
  2. Vulkan SPIR-V generation with relaxed rules (-V -R), closer to TD's backend

Variants cover TouchDesigner defines that change the code: blobs.vert as the
pick render sees it (TD_PICKING_ACTIVE defined, TDWritePickingValues()
stubbed), and blobs.frag for a Render TOP with 3 and 8 colour buffers
(TD_NUM_COLOR_BUFFERS defined; without it the shader's own fallback of 1
applies). A deliberately broken copy of blobs.frag must fail on the line that
was broken (a negative test: it shows the check can fail at all).

A pass means the code is valid GLSL 4.60 given those declarations. It is not a
TouchDesigner compile: TD's real declarations, layouts and drivers can differ.
Requires glslangValidator on PATH (Ubuntu: apt-get install glslang-tools).
Adapted from the liquid-glass study's checks/compile_glsl.py (commit a6f95c6).
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
vec3 TDPos() { return P; }
vec4 TDDeform(vec4 p) { return uTDMats[0].world * p; }
int TDCameraIndex() { return 0; }
int TDInstanceID() { return 0; }
vec4 TDWorldToProj(vec4 v) { return uTDMats[0].camProj * v; }
"""

MAT_PIXEL = COMMON + """
void TDCheckDiscard() {}
vec4 TDOutputSwizzle(vec4 c) { return c; }
vec4 TDFog(vec4 c, vec3 worldSpacePos, int cameraIndex) { return c; }
"""

# The pick render: TouchDesigner defines TD_PICKING_ACTIVE and supplies TDWritePickingValues().
MAT_VERTEX_PICKING = "#define TD_PICKING_ACTIVE\n" + MAT_VERTEX + """
void TDWritePickingValues() {}
"""

TOP_PIXEL = """
in vec3 vUV;
struct TDTexInfo { vec4 res; vec4 depth; };
uniform TDTexInfo uTDOutputInfo;
vec4 TDOutputSwizzle(vec4 c) { return c; }
"""

# A Render TOP with several colour buffers: TouchDesigner sets the count.
MAT_PIXEL_3_BUFFERS = "#define TD_NUM_COLOR_BUFFERS 3\n" + MAT_PIXEL
MAT_PIXEL_8_BUFFERS = "#define TD_NUM_COLOR_BUFFERS 8\n" + MAT_PIXEL

SHADERS = [
    ("vert", "blobs.vert", MAT_VERTEX),
    ("vert", "blobs.vert", MAT_VERTEX_PICKING),
    ("frag", "blobs.frag", MAT_PIXEL),
    ("frag", "blobs.frag", MAT_PIXEL_3_BUFFERS),
    ("frag", "blobs.frag", MAT_PIXEL_8_BUFFERS),
    ("frag", "backdrop.frag", TOP_PIXEL),
    ("frag", "env.frag", TOP_PIXEL),
]

MODES = {
    "glsl460": [],
    "vulkan-relaxed": ["-V", "-R", "--aml", "--amb", "-o", "/dev/null"],
}

# The negative test: misspell one built-in call on a known line.
BREAK_FROM = "float chord = length(toWorld * (qObj - pObj));"
BREAK_TO = "float chord = lenght(toWorld * (qObj - pObj));"


def run(tool, stage, text, path, flags):
    path.write_text(text)
    proc = subprocess.run([tool, "-S", stage, *flags, str(path)], capture_output=True, text=True)
    return proc.returncode == 0, (proc.stdout + proc.stderr).strip()


def prepared(prelude, source):
    # "#line 1" makes reported line numbers match the study file.
    return "#version 460\n" + prelude + "\n#line 1\n" + source


def compile_all():
    tool = shutil.which("glslangValidator")
    if tool is None:
        raise SystemExit("glslangValidator not found on PATH")
    version = subprocess.run([tool, "--version"], capture_output=True, text=True).stdout.splitlines()[0]
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for stage, name, prelude in SHADERS:
            source = (STUDY / name).read_text()
            path = Path(tmp) / (Path(name).stem + "." + stage)
            label = name + (" (pick render)" if "TD_PICKING_ACTIVE" in prelude else "")
            buffers = re.match(r"#define TD_NUM_COLOR_BUFFERS (\d+)", prelude)
            if buffers:
                label += f" ({buffers.group(1)} colour buffers)"
            for mode, flags in MODES.items():
                ok, output = run(tool, stage, prepared(prelude, source), path, flags)
                results.append({"shader": label, "mode": mode, "ok": ok,
                                "output": output.replace(str(path), name)})

        source = (STUDY / "blobs.frag").read_text()
        if source.count(BREAK_FROM) != 1:
            raise SystemExit("negative test anchor not found exactly once in blobs.frag")
        broken_line = source[:source.index(BREAK_FROM)].count("\n") + 1
        path = Path(tmp) / "broken.frag"
        ok, output = run(tool, "frag", prepared(MAT_PIXEL, source.replace(BREAK_FROM, BREAK_TO)), path, [])
        reported = [int(x) for x in re.findall(r"ERROR: [^:]*:(\d+):", output)]
        negative = {
            "shader": "blobs.frag (broken copy: 'length' misspelled)",
            "expected": "compile error on line %d" % broken_line,
            "failed_as_expected": not ok,
            "error_lines": reported,
            "on_the_right_line": broken_line in reported,
            "output": output.replace(str(path), "broken.frag"),
        }
    passed = all(r["ok"] for r in results) and negative["failed_as_expected"] and negative["on_the_right_line"]
    return {"tool": version, "ok": passed, "results": results, "negative_test": negative,
            "scope": "Valid GLSL 4.60 against documented TD stand-ins; not a TouchDesigner compile."}


if __name__ == "__main__":
    report = compile_all()
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["ok"] else 1)
