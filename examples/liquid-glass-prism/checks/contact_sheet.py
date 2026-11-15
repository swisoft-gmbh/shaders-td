#!/usr/bin/env python3
"""Labelled contact sheet of the preset previews (PIL).

  python3 checks/contact_sheet.py [suffix]     suffix '', '-type' or '-backpass'

Writes captures/presets-sheet<suffix>.png: '' over the checkerboard (the core
study's demo scene, so the family's sheets compare), '-type' over bold type on
black (this study's default scene, as in captures/presets-sheet-type.png of the
core study), '-backpass' on the knot with the back-face pass. Every tile is a
WebGL preview of the delivered GLSL, and the sheet says so.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

STUDY = Path(__file__).resolve().parent.parent


def font(size):
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main(suffix=""):
    presets = json.loads((STUDY / "presets.json").read_text())
    tile_w, tile_h, label_h, cols = 480, 270, 30, 4
    names = presets["order"]
    rows = (len(names) + cols - 1) // cols
    header = 44
    sheet = Image.new("RGB", (cols * tile_w, header + rows * (tile_h + label_h)), (16, 17, 20))
    draw = ImageDraw.Draw(sheet)
    where = {"": "on the demo torus over the checkerboard (the core study's scene), no back-face pass",
             "-type": "on the demo torus over bold type (this study's default scene), no back-face pass",
             "-backpass": "on the preview's knot, back-face pass on (light looks over the checkerboard)"}[suffix]
    draw.text((12, 12), f"Liquid Glass Prism presets {where}. WebGL2 preview of the delivered GLSL, "
              "not a TouchDesigner capture.", fill=(232, 232, 234), font=font(18))
    for i, name in enumerate(names):
        x, y = (i % cols) * tile_w, header + (i // cols) * (tile_h + label_h)
        image = Image.open(STUDY / "captures" / f"preset-{name}{suffix}.png").convert("RGB").resize((tile_w, tile_h))
        sheet.paste(image, (x, y + label_h))
        draw.text((x + 10, y + 6), presets["presets"][name]["label"], fill=(232, 232, 234), font=font(17))
    out = STUDY / "captures" / f"presets-sheet{suffix}.png"
    sheet.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
