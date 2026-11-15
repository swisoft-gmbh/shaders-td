#!/usr/bin/env python3
"""Labelled contact sheets of the preview captures (PIL).

  python3 checks/contact_sheet.py

Writes captures/presets-sheet.png (the twelve presets on the Checker backdrop),
captures/presets-sheet-type.png (the same on the Type backdrop shared by the
liquid-glass family) and captures/timeline-sheet.png (Prism Clear at six
times). Every tile is a WebGL2 preview of the delivered GLSL, and each sheet
says so. Adapted from the liquid-glass-prism study's checks/contact_sheet.py
(commit 6a58487).
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

STUDY = Path(__file__).resolve().parent.parent
CAPTURES = STUDY / "captures"
TILE_W, TILE_H, LABEL_H, HEADER = 435, 245, 25, 36
NOTE = "WebGL2 preview of the delivered GLSL, not a TouchDesigner capture."


def font(size, bold=False):
    names = ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf") if bold else \
            ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def sheet(tiles, cols, title, out):
    rows = (len(tiles) + cols - 1) // cols
    image = Image.new("RGB", (cols * TILE_W, HEADER + rows * (TILE_H + LABEL_H)), (16, 17, 20))
    draw = ImageDraw.Draw(image)
    draw.text((10, 9), title, fill=(236, 236, 238), font=font(16, bold=True))
    for i, (file, label) in enumerate(tiles):
        x, y = (i % cols) * TILE_W, HEADER + (i // cols) * (TILE_H + LABEL_H)
        tile = Image.open(CAPTURES / file).convert("RGB").resize((TILE_W, TILE_H), Image.LANCZOS)
        image.paste(tile, (x, y))
        draw.text((x + 8, y + TILE_H + 5), label, fill=(220, 220, 224), font=font(14))
    image.save(out)
    print("wrote", out)


def main():
    presets = json.loads((STUDY / "presets.json").read_text())
    names = presets["order"]
    labels = [presets["presets"][n]["label"] for n in names]
    sheet([(f"preset-{n}.png", l) for n, l in zip(names, labels)], 4,
          f"The twelve presets at t = 3 s on the Checker backdrop. {NOTE}", CAPTURES / "presets-sheet.png")
    sheet([(f"preset-{n}-type.png", l) for n, l in zip(names, labels)], 4,
          f"The twelve presets at t = 3 s on the family's Type backdrop. {NOTE}", CAPTURES / "presets-sheet-type.png")
    sheet([(f"timeline-{t:g}.png", f"t = {t:g} s") for t in (1, 2.5, 4, 5.5, 7, 8.5)], 3,
          f"Prism Clear over time. {NOTE}", CAPTURES / "timeline-sheet.png")


if __name__ == "__main__":
    main()
