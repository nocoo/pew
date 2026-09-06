#!/usr/bin/env python3
"""Generate transparent UI marks and presentation assets from approved masters.

Run with: uv run --with pillow python scripts/resize-logos.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"
WEB_PUBLIC = ROOT / "packages" / "web" / "public"
WEB_APP = ROOT / "packages" / "web" / "src" / "app"
OG_BG_COLOR = (27, 28, 39)


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    foreground = Image.open(ROOT / "logo.png").convert("RGBA")
    square = Image.open(BRAND / "icon.png").convert("RGBA")
    rounded = Image.open(BRAND / "icon-rounded.png").convert("RGBA")
    if foreground.size != (2048, 2048) or square.size != foreground.size or rounded.size != foreground.size:
        raise ValueError("All approved masters must share their 2048-square framing")
    if foreground.getchannel("A").getextrema() != (0, 255):
        raise ValueError("The foreground must preserve transparent space and opaque artwork")
    if square.getchannel("A").getextrema() != (255, 255) or rounded.getpixel((0, 0))[3] != 0:
        raise ValueError("Square and rounded master roles are inconsistent")

    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    WEB_APP.mkdir(parents=True, exist_ok=True)
    for size in [24, 80]:
        resize(foreground, size).save(WEB_PUBLIC / f"logo-{size}.png", "PNG")
    resize(foreground, 32).save(WEB_APP / "icon.png", "PNG")
    resize(square, 180).convert("RGB").save(WEB_APP / "apple-icon.png", "PNG")

    ico_sizes = [(16, 16), (32, 32)]
    foreground.save(WEB_APP / "favicon.ico", format="ICO", sizes=ico_sizes)
    with Image.open(WEB_APP / "favicon.ico") as icon:
        if icon.ico.sizes() != set(ico_sizes):
            raise ValueError("Favicon is missing an expected resolution")

    og = Image.new("RGB", (1200, 630), OG_BG_COLOR)
    mark = resize(rounded, 252)
    og.paste(mark, ((1200 - 252) // 2, (630 - 252) // 2), mark)
    og.save(WEB_APP / "opengraph-image.png", "PNG")
    print("Generated transparent UI marks and 16/32 px favicon; square touch icon and rounded OG presentation.")


if __name__ == "__main__":
    main()
