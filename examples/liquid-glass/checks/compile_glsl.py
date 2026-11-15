#!/usr/bin/env python3
"""Compile the study's GLSL with glslangValidator against TouchDesigner stand-ins.

TouchDesigner injects its own declarations (uTDMats, TDDeform, vUV, ...) before
compiling. This script prepends minimal stand-ins with the documented
signatures, then compiles each shader twice:

  1. GLSL 4.60 semantic check (OpenGL rules)
  2. Vulkan SPIR-V generation with relaxed rules (-V -R), closer to TD's backend

Two variants cover TouchDesigner defines that change the code: the vertex
shader with TD_PICKING_ACTIVE (a Render Pick DAT/CHOP pass, with the pick
outputs listed on Derivative's "Write a GLSL MAT" page) and the pixel shader
with TD_NUM_COLOR_BUFFERS 3 (a Render TOP with three colour buffers). The
plain pixel compile leaves TD_NUM_COLOR_BUFFERS undefined, so the shader's own
fallback (one buffer) is compiled too.

A negative test shows the picking variant really compiles the picking branch:
without the TDWritePickingValues() stand-in it must fail and name it.

A pass means the code is valid GLSL 4.60 given those declarations. It is not a
TouchDesigner compile: TD's real declarations, layouts and drivers can differ.
Requires glslangValidator on PATH (Ubuntu: apt-get install glslang-tools).
"""
from pathlib import Path
import json
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

# Render Pick pass: TouchDesigner defines TD_PICKING_ACTIVE and declares the
# pick outputs (members as listed on "Write a GLSL MAT", section Picking).
MAT_VERTEX_PICKING = "#define TD_PICKING_ACTIVE\n" + MAT_VERTEX + """
out TDPickVertex {
    vec3 sopSpacePosition; vec3 worldSpacePosition; vec3 camSpacePosition;
    vec3 sopSpaceNormal; vec3 worldSpaceNormal; vec3 camSpaceNormal;
    vec3 uv[1]; flat int instanceId; vec4 color;
} vTDPickVert;
void TDWritePickingValues() { vTDPickVert.color = vec4(1.0); }
"""

MAT_PIXEL_BODY = """
void TDCheckDiscard() {}
bool TDFrontFacing(vec3 position, vec3 normal) { return gl_FrontFacing; }
vec4 TDOutputSwizzle(vec4 c) { return c; }
vec4 TDFog(vec4 curColor, vec3 worldSpacePos, int cameraIndex) { return curColor; }
"""
MAT_PIXEL = COMMON + MAT_PIXEL_BODY
MAT_PIXEL_3_BUFFERS = "#define TD_NUM_COLOR_BUFFERS 3\n" + COMMON + MAT_PIXEL_BODY

TOP_PIXEL = """
in vec3 vUV;
struct TDTexInfo { vec4 res; vec4 depth; };
uniform TDTexInfo uTDOutputInfo;
vec4 TDOutputSwizzle(vec4 c) { return c; }
"""

SHADERS = [
    ("vert", "liquid_glass.vert", MAT_VERTEX, ""),
    ("vert", "liquid_glass.vert", MAT_VERTEX_PICKING, "TD_PICKING_ACTIVE"),
    ("frag", "liquid_glass.frag", MAT_PIXEL, ""),
    ("frag", "liquid_glass.frag", MAT_PIXEL_3_BUFFERS, "TD_NUM_COLOR_BUFFERS 3"),
    ("frag", "backdrop.frag", TOP_PIXEL, ""),
    ("frag", "env.frag", TOP_PIXEL, ""),
]

MODES = {
    "glsl460": [],
    "vulkan-relaxed": ["-V", "-R", "--aml", "--amb", "-o", "/dev/null"],
}


def compile_all():
    tool = shutil.which("glslangValidator")
    if tool is None:
        raise SystemExit("glslangValidator not found on PATH")
    version = subprocess.run([tool, "--version"], capture_output=True, text=True).stdout.splitlines()[0]
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for stage, name, prelude, variant in SHADERS:
            source = (STUDY / name).read_text()
            text = "#version 460\n" + prelude + "\n#line 1\n" + source
            path = Path(tmp) / (Path(name).stem + "." + stage)
            path.write_text(text)
            for mode, flags in MODES.items():
                run = subprocess.run([tool, "-S", stage, *flags, str(path)],
                                     capture_output=True, text=True)
                output = (run.stdout + run.stderr).replace(str(path), name).strip()
                row = {"shader": name, "mode": mode, "ok": run.returncode == 0, "output": output}
                if variant:
                    row["defines"] = variant
                results.append(row)
        # Negative test: the picking branch is compiled in the picking variant.
        prelude = MAT_VERTEX_PICKING.replace("void TDWritePickingValues() { vTDPickVert.color = vec4(1.0); }", "")
        path = Path(tmp) / "picking_without_stand_in.vert"
        path.write_text("#version 460\n" + prelude + "\n#line 1\n" + (STUDY / "liquid_glass.vert").read_text())
        run = subprocess.run([tool, "-S", "vert", str(path)], capture_output=True, text=True)
        output = (run.stdout + run.stderr).replace(str(path), "liquid_glass.vert").strip()
        negative = {"shader": "liquid_glass.vert, TD_PICKING_ACTIVE, TDWritePickingValues() stand-in removed",
                    "expect": "compile fails and the log names TDWritePickingValues",
                    "compiled": run.returncode == 0, "names_it": "TDWritePickingValues" in output,
                    "ok": run.returncode != 0 and "TDWritePickingValues" in output,
                    "output": "\n".join(output.splitlines()[:3])}
    return {"tool": version, "ok": all(r["ok"] for r in results) and negative["ok"], "results": results,
            "negative_test": negative,
            "scope": "Valid GLSL 4.60 against documented TD stand-ins; not a TouchDesigner compile."}


if __name__ == "__main__":
    report = compile_all()
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["ok"] else 1)
