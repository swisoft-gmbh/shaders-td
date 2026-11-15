#!/usr/bin/env python3
"""Labelled contact sheets from the WebGL previews (needs Pillow).

  python3 checks/contact_sheet.py

captures/presets-sheet.png: the 12 presets at Time 2 (checker backdrop).
captures/presets-sheet-type.png: the same over the bold-type backdrop.
captures/flow-strip.png:    four presets at Time 0, 2, 4 and 6 seconds (motion).
Both are WebGL previews of the delivered GLSL, not TouchDesigner captures.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

STUDY = Path(__file__).resolve().parent.parent
CAP = STUDY / "captures"
NOTE = "WebGL2 preview of the delivered GLSL (SwiftShader), not a TouchDesigner capture."


def font(size):
    for name in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def sheet(cells, cols, out, title, cell=(400, 225)):
    rows = (len(cells) + cols - 1) // cols
    w, h = cell
    img = Image.new("RGB", (cols * w, 44 + rows * (h + 26) + 30), (18, 19, 23))
    d = ImageDraw.Draw(img)
    d.text((10, 10), title, fill=(238, 240, 243), font=font(20))
    for k, (label, path) in enumerate(cells):
        x, y = (k % cols) * w, 44 + (k // cols) * (h + 26)
        img.paste(Image.open(path).convert("RGB").resize((w - 4, h)), (x + 2, y + 24))
        d.text((x + 8, y + 3), label, fill=(220, 223, 228), font=font(15))
    d.text((10, img.height - 24), NOTE, fill=(160, 165, 172), font=font(14))
    img.save(out)


presets = json.loads((STUDY / "presets.json").read_text())
sheet([(presets["presets"][n]["label"], CAP / f"preset-{n}.png") for n in presets["order"]], 4,
      CAP / "presets-sheet.png", "Liquid Glass Flow: the 12 presets on the demo sphere (Time 2 s)")
sheet([(presets["presets"][n]["label"], CAP / "type" / f"preset-{n}.png") for n in presets["order"]], 4,
      CAP / "presets-sheet-type.png", "Liquid Glass Flow: the 12 presets over the type backdrop (Time 2 s)")
cells = []
for name in ("prism_chrome", "sapphire_drop", "chrome_type", "aqua_jelly"):
    for t in (0, 2, 4, 6):
        cells.append((f"{presets['presets'][name]['label']}, t = {t} s", CAP / "motion" / f"{name}-t{t}.png"))
sheet(cells, 4, CAP / "flow-strip.png", "Liquid Glass Flow: the outline moves (four presets, four moments, no spin)")
print("wrote presets-sheet.png, presets-sheet-type.png and flow-strip.png")
