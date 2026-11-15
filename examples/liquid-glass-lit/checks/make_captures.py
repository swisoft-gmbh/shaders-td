#!/usr/bin/env python3
"""Write preview capture jobs, or assemble the labelled preset contact sheet.

  python3 checks/make_captures.py jobs  OUT.json   # experiments + presets -> capture.cjs jobs
  python3 checks/make_captures.py sheet            # captures/preset-*.png -> captures/presets-sheet.png,
                                                   # captures/type-*.png -> captures/presets-sheet-type.png
  python3 checks/make_captures.py strip            # captures/setup-*.png -> captures/light-setups.png

Every job is a WebGL2 preview of the delivered GLSL (see checks/capture.cjs),
not a TouchDesigner capture. Experiments render on the demo torus with their
own parameters; presets render on a knot with the demo lights and environment,
once over the checkerboard backdrop and once over the Type backdrop (Study >
Backdrop), the family's shared backdrop, so contact sheets of the family compare.
"""
import json
from pathlib import Path
import sys

STUDY = Path(__file__).resolve().parent.parent
SKIP = {"Preset", "Pause", "Time"}


def jobs():
    experiments = json.loads((STUDY / "experiments.json").read_text())
    presets = json.loads((STUDY / "presets.json").read_text())
    out = []
    for e in experiments:
        p = e["parameters"]
        out.append({"name": Path(e["preview"]).stem,
                    "draw": {"preset": p["Preset"], "time": p.get("Time", 2.0),
                             "overrides": {k: v for k, v in p.items() if k not in SKIP}}})
    for name in presets["order"]:
        out.append({"name": "preset-" + name,
                    "draw": {"preset": name, "time": 2.0, "mesh": "knot", "spin": 0, "tilt": 25}})
    for name in presets["order"]:
        out.append({"name": "type-" + name,
                    "draw": {"preset": name, "time": 2.0, "mesh": "knot", "spin": 0, "tilt": 25,
                             "overrides": {"Backdrop": "type"}}})
    for name, demo_lights, env in SETUPS:
        out.append({"name": "setup-" + name,
                    "draw": {"preset": "sapphire_drop", "time": 2.0, "mesh": "blob", "spin": 0, "tilt": 10,
                             "overrides": {"Demolights": demo_lights, "Demoenv": env}}})
    return out


# The same glass in three scenes: nothing to light it, Light COMPs, Light COMPs plus an Environment Light.
SETUPS = [("fallback", "none", False), ("lights", "both", False), ("lights_env", "both", True)]
SETUP_LABELS = ["No lights: built-in key light and studio", "Key + rim Light COMPs, built-in studio",
                "Key + rim Light COMPs + Environment Light"]


def font(size):
    from PIL import ImageFont
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def strip():
    from PIL import Image, ImageDraw
    images = [Image.open(STUDY / "captures" / f"setup-{name}.png").convert("RGB").crop((200, 0, 760, 540))
              for name, _, _ in SETUPS]
    w, h = images[0].size
    title, band = 34, 28
    canvas = Image.new("RGB", (w * len(images), title + h + band), (16, 17, 20))
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 8), "Sapphire Drop in three light setups. WebGL2 preview with stand-in light functions, "
              "not a TouchDesigner capture.", fill=(235, 235, 235), font=font(16))
    for i, (image, label) in enumerate(zip(images, SETUP_LABELS)):
        canvas.paste(image, (i * w, title))
        draw.text((i * w + 8, title + h + 5), label, fill=(235, 235, 235), font=font(16))
    out = STUDY / "captures" / "light-setups.png"
    canvas.save(out)
    print("wrote", out)


def sheet():
    for prefix, out, backdrop in (("preset", "presets-sheet.png", "checkerboard backdrop"),
                                  ("type", "presets-sheet-type.png", "Type backdrop")):
        one_sheet(prefix, out, backdrop)


def one_sheet(prefix, out_name, backdrop):
    from PIL import Image, ImageDraw
    presets = json.loads((STUDY / "presets.json").read_text())
    files = [STUDY / "captures" / f"{prefix}-{n}.png" for n in presets["order"]]
    images = [Image.open(f).convert("RGB") for f in files]
    w, h = images[0].size
    tw, th, cols, band = 480, int(480 * h / w), 4, 26
    rows = (len(images) + cols - 1) // cols
    title = 34
    canvas = Image.new("RGB", (cols * tw, title + rows * (th + band)), (16, 17, 20))
    draw = ImageDraw.Draw(canvas)
    draw.text((10, 8), f"Liquid Glass Lit: 12 presets, {backdrop}, demo key + rim Light COMPs and Environment Light. "
              "WebGL2 preview with stand-in light functions, not a TouchDesigner capture.",
              fill=(235, 235, 235), font=font(16))
    for i, (image, name) in enumerate(zip(images, presets["order"])):
        x, y = (i % cols) * tw, title + (i // cols) * (th + band)
        canvas.paste(image.resize((tw, th), Image.LANCZOS), (x, y))
        draw.text((x + 8, y + th + 4), presets["presets"][name]["label"], fill=(235, 235, 235), font=font(16))
    out = STUDY / "captures" / out_name
    canvas.save(out)
    print("wrote", out)


if __name__ == "__main__":
    if sys.argv[1:2] == ["jobs"]:
        Path(sys.argv[2]).write_text(json.dumps(jobs(), indent=2) + "\n")
        print("wrote", sys.argv[2])
    elif sys.argv[1:2] == ["sheet"]:
        sheet()
    elif sys.argv[1:2] == ["strip"]:
        strip()
    else:
        raise SystemExit(__doc__)
