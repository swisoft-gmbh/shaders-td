#!/usr/bin/env python3
"""Compile the study's GLSL with glslangValidator against TouchDesigner stand-ins.

TouchDesigner injects its own declarations (uTDMats, uTDLights, TDLightingPBR,
...) before compiling, and recompiles a material for every light setup it is
rendered with. This script prepends stand-ins for those declarations and
compiles the material for every combination of

    TD_NUM_LIGHTS        = 0, 1, 3
    TD_NUM_ENV_LIGHTS    = 0, 1
    TD_NUM_COLOR_BUFFERS = not defined, 1, 3   (pixel stage; the Render TOP's '# of Color Buffers')

plus the vertex shader with TD_PICKING_ACTIVE (a Render Pick DAT/CHOP pass,
with the pick outputs listed on Derivative's "Write a GLSL MAT" page), in two
modes each:

  1. GLSL 4.60 semantic check (OpenGL rules)
  2. Vulkan SPIR-V generation with relaxed rules (-V -R), closer to TD's backend

The stand-ins follow the documented structs and signatures on
https://docs.derivative.ca/Write_a_GLSL_MAT and GLSL_Reference, and the layout
of a TouchDesigner pixel-shader preamble preserved in glslang's own test suite
(Test/vk.relaxed.stagelink.0.1.frag): arrays sized by TD_LIGHTS_ARRAY_SIZE and
TD_ENV_LIGHTS_ARRAY_SIZE (at least 1), both the returning and the legacy
overloads of TDLightingPBR and TDEnvLightingPBR. TDEnvLightTextureLod is only
declared when TD_NUM_ENV_LIGHTS > 0 (that preamble, for zero env lights, does
not declare it), so the material must guard env-light code with #if.

Four negative tests then show the check can fail:
  - a syntax error is reported at its own line;
  - without the TDWritePickingValues() stand-in, the picking variant fails and
    names it (so that variant really compiles the picking branch);
  - removing the #if guard around the env-light code fails with zero env lights;
  - the doc page's mixed TDEnvLightingPBR form (inout arguments AND a returned
    TDPBRResult) does not exist in the preamble and fails.

Then glslang's own preprocessor (-E) lists the statements of the vertex
shader's main() as an ordinary render and as a pick render see it. The pick
render must run only the placement and the '#else' block, TDWritePickingValues(),
the form printed on "Write a GLSL MAT" (family close G6).

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
LIGHT_COUNTS = (0, 1, 3)
ENV_COUNTS = (0, 1)
COLOR_BUFFERS = (None, 1, 3)  # None: the shader's own #ifndef fallback


def common(lights, envs, buffers=None):
    define = "" if buffers is None else f"#define TD_NUM_COLOR_BUFFERS {buffers}\n"
    return define + f"""
#define TD_NUM_LIGHTS {lights}
#define TD_NUM_SHADOWED_LIGHTS 0
#define TD_NUM_ENV_LIGHTS {envs}
#define TD_LIGHTS_ARRAY_SIZE {max(lights, 1)}
#define TD_ENV_LIGHTS_ARRAY_SIZE {max(envs, 1)}
#define TD_NUM_CAMERAS 1
struct TDLight {{
    vec4 position; vec3 direction; vec3 diffuse; vec4 nearFar; vec4 lightSize; vec4 misc;
    vec4 coneLookupScaleBias; vec4 attenScaleBiasRoll; mat4 shadowMapMatrix;
    mat4 shadowMapCamMatrix; vec4 shadowMapRes; mat4 projMapMatrix;
}};
struct TDEnvLight {{ vec3 color; mat3 rotate; }};
layout(std140) uniform TDLightBlock {{ TDLight uTDLights[TD_LIGHTS_ARRAY_SIZE]; }};
layout(std140) uniform TDEnvLightBlock {{ TDEnvLight uTDEnvLights[TD_ENV_LIGHTS_ARRAY_SIZE]; }};
layout(std430) readonly restrict buffer TDEnvLightBuffer {{ vec3 shCoeffs[9]; }} uTDEnvLightBuffers[TD_ENV_LIGHTS_ARRAY_SIZE];
struct TDPhongResult {{ vec3 diffuse; vec3 specular; vec3 specular2; float shadowStrength; }};
struct TDPBRResult {{ vec3 diffuse; vec3 specular; float shadowStrength; }};
struct TDMatrix {{
    mat4 world; mat4 worldInverse; mat4 worldCam; mat4 worldCamInverse;
    mat4 cam; mat4 camInverse; mat4 camProj; mat4 camProjInverse;
    mat4 proj; mat4 projInverse; mat4 worldCamProj; mat4 worldCamProjInverse;
    mat4 quadReproject; mat3 worldForNormals; mat3 camForNormals; mat3 worldCamForNormals;
}};
layout(std140) uniform TDMatricesBlock {{ TDMatrix uTDMats[TD_NUM_CAMERAS]; }};
struct TDGeneral {{ vec4 ambientColor; vec4 nearFar; vec4 viewport; vec4 viewportRes; vec4 fog; vec4 fogColor; }};
layout(std140) uniform TDGeneralBlock {{ TDGeneral uTDGeneral; }};
"""


def mat_vertex(lights, envs, picking=False, picking_stand_in=True):
    text = ("#define TD_PICKING_ACTIVE\n" if picking else "") + common(lights, envs) + """
layout(location = 0) in vec3 P;
layout(location = 1) in vec3 N;
vec3 TDPos() { return P; }
vec3 TDNormal() { return N; }
vec4 TDDeform(vec3 p) { return uTDMats[0].world * vec4(p, 1.0); }
vec3 TDDeformNorm(vec3 n) { return uTDMats[0].worldForNormals * n; }
int TDCameraIndex() { return 0; }
vec4 TDWorldToProj(vec4 v) { return uTDMats[0].camProj * v; }
"""
    if picking:
        # Render Pick pass: TouchDesigner defines TD_PICKING_ACTIVE and declares the
        # pick outputs (members as listed on "Write a GLSL MAT", section Picking).
        text += """
out TDPickVertex {
    vec3 sopSpacePosition; vec3 worldSpacePosition; vec3 camSpacePosition;
    vec3 sopSpaceNormal; vec3 worldSpaceNormal; vec3 camSpaceNormal;
    vec3 uv[1]; flat int instanceId; vec4 color;
} vTDPickVert;
"""
        if picking_stand_in:
            text += "void TDWritePickingValues() { vTDPickVert.color = vec4(1.0); }\n"
    return text


def mat_pixel(lights, envs, buffers=None):
    text = common(lights, envs, buffers) + """
void TDCheckDiscard() {}
bool TDFrontFacing(vec3 position, vec3 normal) { return gl_FrontFacing; }
vec4 TDOutputSwizzle(vec4 c) { return c; }
vec4 TDFog(vec4 curColor, vec3 worldSpacePos, int cameraIndex) { return curColor; }
vec2 TDCubeMapToEquirectangular(vec3 d) {
    return vec2(fract(atan(d.z, d.x) / 6.2831853), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.14159265);
}
TDPBRResult TDLightingPBR(int index, vec3 diffuseColor, vec3 specularColor, vec3 worldSpacePos,
                          vec3 normal, float shadowStrength, vec3 shadowColor, vec3 camVector, float roughness) {
    TDPBRResult r; r.diffuse = diffuseColor * uTDLights[index].diffuse; r.specular = specularColor; r.shadowStrength = 0.0; return r;
}
void TDLightingPBR(inout vec3 diffuseContrib, inout vec3 specularContrib, int index, vec3 diffuseColor,
                   vec3 specularColor, vec3 worldSpacePos, vec3 normal, float shadowStrength,
                   vec3 shadowColor, vec3 camVector, float roughness) {
    TDPBRResult r = TDLightingPBR(index, diffuseColor, specularColor, worldSpacePos, normal, shadowStrength, shadowColor, camVector, roughness);
    diffuseContrib = r.diffuse; specularContrib = r.specular;
}
TDPBRResult TDEnvLightingPBR(int index, vec3 diffuseColor, vec3 specularColor, vec3 normal,
                             vec3 camVector, float roughness, float ambientOcclusion) {
    TDPBRResult r; r.diffuse = diffuseColor * uTDEnvLightBuffers[index].shCoeffs[0]; r.specular = specularColor; r.shadowStrength = 0.0; return r;
}
void TDEnvLightingPBR(inout vec3 diffuseContrib, inout vec3 specularContrib, int index, vec3 diffuseColor,
                      vec3 specularColor, vec3 normal, vec3 camVector, float roughness, float ambientOcclusion) {
    TDPBRResult r = TDEnvLightingPBR(index, diffuseColor, specularColor, normal, camVector, roughness, ambientOcclusion);
    diffuseContrib = r.diffuse; specularContrib = r.specular;
}
TDPhongResult TDLighting(int index, vec3 worldSpacePos, vec3 normal, float shadowStrength,
                         vec3 shadowColor, vec3 camVector, float shininess, float shininess2) {
    TDPhongResult r; r.diffuse = uTDLights[index].diffuse; r.specular = vec3(0.0); r.specular2 = vec3(0.0); r.shadowStrength = 0.0; return r;
}
"""
    if envs > 0:
        text += """
uniform sampler2D sTDEnvLight2DMaps[TD_ENV_LIGHTS_ARRAY_SIZE];
uniform samplerCube sTDEnvLightCubeMaps[TD_ENV_LIGHTS_ARRAY_SIZE];
vec4 TDEnvLightTextureLod(int lightIndex, vec2 coord, float mipLevel) { return textureLod(sTDEnvLight2DMaps[lightIndex], coord, mipLevel); }
vec4 TDEnvLightTextureLod(int lightIndex, vec3 coord, float mipLevel) { return textureLod(sTDEnvLightCubeMaps[lightIndex], coord, mipLevel); }
"""
    return text


TOP_PIXEL = """
in vec3 vUV;
struct TDTexInfo { vec4 res; vec4 depth; };
uniform TDTexInfo uTDOutputInfo;
vec4 TDOutputSwizzle(vec4 c) { return c; }
"""

MODES = {
    "glsl460": [],
    "vulkan-relaxed": ["-V", "-R", "--aml", "--amb", "-o", "/dev/null"],
}


def run(tool, stage, prelude, source, name, mode, tmp):
    text = "#version 460\n" + prelude + "\n#line 1\n" + source
    path = Path(tmp) / (Path(name).stem + "." + stage)
    path.write_text(text)
    done = subprocess.run([tool, "-S", stage, *MODES[mode], str(path)], capture_output=True, text=True)
    output = (done.stdout + done.stderr).replace(str(path), name).strip()
    return done.returncode == 0, output


# Family close G6: what main() runs, as glslang's preprocessor leaves it.
PICKING_STATEMENTS = {
    "ordinary render": ["vec3 objPos = TDPos()", "vec4 world = TDDeform(objPos)",
                        "gl_Position = TDWorldToProj(world)", "passToPixelStage(objPos, world)"],
    "pick render": ["vec3 objPos = TDPos()", "vec4 world = TDDeform(objPos)",
                    "gl_Position = TDWorldToProj(world)", "TDWritePickingValues()"],
}


def main_statements(tool, prelude, source, tmp):
    """The statements of main() after glslangValidator -E (comments and inactive branches gone)."""
    path = Path(tmp) / "preprocess.vert"
    path.write_text("#version 460\n" + prelude + "\n#line 1\n" + source)
    done = subprocess.run([tool, "-E", "-S", "vert", str(path)], capture_output=True, text=True)
    body = done.stdout[done.stdout.rindex("void main()"):]
    body = body[body.index("{") + 1:body.rindex("}")]
    return [" ".join(s.split()) for s in body.split(";") if s.strip()]


def compile_all():
    tool = shutil.which("glslangValidator")
    if tool is None:
        raise SystemExit("glslangValidator not found on PATH")
    version = subprocess.run([tool, "--version"], capture_output=True, text=True).stdout.splitlines()[0]
    vert = (STUDY / "liquid_glass_lit.vert").read_text()
    frag = (STUDY / "liquid_glass_lit.frag").read_text()
    results, negatives = [], []
    with tempfile.TemporaryDirectory() as tmp:
        for lights in LIGHT_COUNTS:
            for envs in ENV_COUNTS:
                for mode in MODES:
                    ok, output = run(tool, "vert", mat_vertex(lights, envs), vert, "liquid_glass_lit.vert", mode, tmp)
                    results.append({"shader": "liquid_glass_lit.vert", "TD_NUM_LIGHTS": lights,
                                    "TD_NUM_ENV_LIGHTS": envs, "mode": mode, "ok": ok, "output": output})
                    if lights == 1 and envs == 1:
                        ok, output = run(tool, "vert", mat_vertex(lights, envs, picking=True), vert,
                                         "liquid_glass_lit.vert", mode, tmp)
                        results.append({"shader": "liquid_glass_lit.vert", "TD_NUM_LIGHTS": lights,
                                        "TD_NUM_ENV_LIGHTS": envs, "defines": "TD_PICKING_ACTIVE",
                                        "mode": mode, "ok": ok, "output": output})
                    for buffers in COLOR_BUFFERS:
                        ok, output = run(tool, "frag", mat_pixel(lights, envs, buffers), frag,
                                         "liquid_glass_lit.frag", mode, tmp)
                        results.append({"shader": "liquid_glass_lit.frag", "TD_NUM_LIGHTS": lights,
                                        "TD_NUM_ENV_LIGHTS": envs, "TD_NUM_COLOR_BUFFERS": buffers,
                                        "mode": mode, "ok": ok, "output": output})
        # The demo backdrop card (a GLSL MAT in the demo scene render).
        for stage, name, prelude in (("vert", "card.vert", mat_vertex(0, 0)), ("frag", "card.frag", mat_pixel(0, 0, 1))):
            for mode in MODES:
                ok, output = run(tool, stage, prelude, (STUDY / name).read_text(), name, mode, tmp)
                results.append({"shader": name, "mode": mode, "ok": ok, "output": output})
        for name in ("backdrop.frag", "envmap.frag"):
            for mode in MODES:
                ok, output = run(tool, "frag", TOP_PIXEL, (STUDY / name).read_text(), name, mode, tmp)
                results.append({"shader": name, "mode": mode, "ok": ok, "output": output})

        # Negative 1: a syntax error must fail and be reported at its own line.
        lines = frag.splitlines()
        target = next(i for i, x in enumerate(lines) if x.strip() == "// @begin compose") + 1
        broken = "\n".join(lines[:target] + ["    vec3 broken = ;"] + lines[target:])
        ok, output = run(tool, "frag", mat_pixel(1, 1), broken, "broken_syntax.frag", "glsl460", tmp)
        reported = re.search(rf"\b{target + 1}\b", output) is not None
        negatives.append({"name": "syntax_error_fails_on_its_line", "line": target + 1,
                          "expected": "fail", "compiled": ok, "line_reported": reported,
                          "ok": (not ok) and reported, "output": output[:400]})

        # Negative 1b: the picking variant compiles the picking branch, so without the
        # TDWritePickingValues() stand-in it must fail and name the function.
        ok, output = run(tool, "vert", mat_vertex(1, 1, picking=True, picking_stand_in=False), vert,
                         "picking_without_stand_in.vert", "glsl460", tmp)
        negatives.append({"name": "picking_variant_calls_TDWritePickingValues", "expected": "fail",
                          "compiled": ok, "names_it": "TDWritePickingValues" in output,
                          "ok": (not ok) and "TDWritePickingValues" in output, "output": output[:400]})

        # Negative 2: without the #if guard, env-light code needs TDEnvLightTextureLod,
        # which the zero-env-light preamble does not declare.
        unguarded = frag.replace("#if TD_NUM_ENV_LIGHTS > 0", "#if 1")
        ok, output = run(tool, "frag", mat_pixel(1, 0), unguarded, "unguarded_env.frag", "glsl460", tmp)
        negatives.append({"name": "unguarded_env_code_fails_without_env_lights", "expected": "fail",
                          "compiled": ok, "ok": not ok, "output": output[:400]})

        # Negative 3: the doc page's mixed form (inout contributions + returned result).
        doc_form = frag.replace(
            "TDPBRResult r = TDEnvLightingPBR(i, vec3(1.0), vec3(0.0), n, toCam, 1.0, 1.0);",
            "vec3 dc = vec3(0.0), sc = vec3(0.0);\n"
            "            TDPBRResult r = TDEnvLightingPBR(dc, sc, i, vec3(1.0), vec3(0.0), n, toCam, 1.0, 1.0);")
        assert doc_form != frag, "negative test 3 could not find the TDEnvLightingPBR call"
        ok, output = run(tool, "frag", mat_pixel(1, 1), doc_form, "doc_form_env.frag", "glsl460", tmp)
        negatives.append({"name": "doc_mixed_TDEnvLightingPBR_form_fails", "expected": "fail",
                          "compiled": ok, "ok": not ok, "output": output[:400]})

        preprocess = []
        for label, picking in (("ordinary render", False), ("pick render", True)):
            statements = main_statements(tool, mat_vertex(1, 1, picking=picking), vert, tmp)
            preprocess.append({"shader": "liquid_glass_lit.vert", "variant": label,
                               "defines": "TD_PICKING_ACTIVE" if picking else "",
                               "main_statements": statements, "expected": PICKING_STATEMENTS[label],
                               "ok": statements == PICKING_STATEMENTS[label]})

    return {"tool": version,
            "ok": all(r["ok"] for r in results) and all(n["ok"] for n in negatives) and all(x["ok"] for x in preprocess),
            "matrix": {"TD_NUM_LIGHTS": list(LIGHT_COUNTS), "TD_NUM_ENV_LIGHTS": list(ENV_COUNTS),
                       "TD_NUM_COLOR_BUFFERS": list(COLOR_BUFFERS), "TD_PICKING_ACTIVE": "vertex, 1 light, 1 env light",
                       "modes": list(MODES)},
            "passed": sum(r["ok"] for r in results), "compiles": len(results),
            "results": results, "negative_tests": negatives, "picking_preprocessed": preprocess,
            "scope": "Valid GLSL 4.60 against documented TD stand-ins for each light setup; not a TouchDesigner compile."}


if __name__ == "__main__":
    report = compile_all()
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["ok"] else 1)
