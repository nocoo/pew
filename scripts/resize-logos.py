#!/usr/bin/env python3
"""
Generate all derived logo assets from the single-source logo.png at project root.

Outputs:
  packages/web/public/        — component <img> assets (logo-24.png, logo-80.png)
  packages/web/src/app/       — Next.js file-based metadata (icon.png, apple-icon.png,
                                 favicon.ico, opengraph-image.png)

Usage:
  python3 scripts/resize-logos.py
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "logo.png"
WEB_PUBLIC = ROOT / "packages" / "web" / "public"
WEB_APP = ROOT / "packages" / "web" / "src" / "app"

# Brand background for OG image (dark navy from logo's dominant dark pixels)
OG_BG_COLOR = (27, 28, 39)  # dark navy matching logo background


def resize_png(src: Image.Image, size: int, dest: Path) -> None:
    """Resize RGBA image to square and save."""
    resized = src.resize((size, size), Image.LANCZOS)
    resized.save(dest, "PNG")
    print(f"  {dest.relative_to(ROOT)}  ({size}x{size})")


def generate_favicon(src: Image.Image, dest: Path) -> None:
    """Generate multi-size .ico (16 + 32)."""
    img16 = src.resize((16, 16), Image.LANCZOS)
    img32 = src.resize((32, 32), Image.LANCZOS)
    img16.save(dest, format="ICO", append_images=[img32], sizes=[(16, 16), (32, 32)])
    print(f"  {dest.relative_to(ROOT)}  (16+32 multi-size)")


def generate_og_image(src: Image.Image, dest: Path) -> None:
    """Generate 1200x630 OG image with brand background, logo centered at ~40% height."""
    width, height = 1200, 630
    canvas = Image.new("RGB", (width, height), OG_BG_COLOR)

    # Scale logo to fit ~40% of canvas height
    logo_size = int(height * 0.40)
    logo_resized = src.resize((logo_size, logo_size), Image.LANCZOS)

    # Center horizontally, place at ~30% from top (visual center)
    x = (width - logo_size) // 2
    y = (height - logo_size) // 2
    canvas.paste(logo_resized, (x, y), logo_resized)  # use alpha as mask

    canvas.save(dest, "PNG")
    print(f"  {dest.relative_to(ROOT)}  ({width}x{height})")


def main() -> None:
    if not MASTER.exists():
        raise FileNotFoundError(f"Master logo not found: {MASTER}")

    master = Image.open(MASTER).convert("RGBA")
    print(f"Master: {MASTER.name} ({master.size[0]}x{master.size[1]} {master.mode})\n")

    # Ensure output directories exist
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    WEB_APP.mkdir(parents=True, exist_ok=True)

    # 1. Component assets → public/
    print("public/ (component <img> assets):")
    resize_png(master, 24, WEB_PUBLIC / "logo-24.png")
    resize_png(master, 80, WEB_PUBLIC / "logo-80.png")

    # 2. Next.js metadata assets → src/app/
    print("\nsrc/app/ (Next.js file-based metadata):")
    resize_png(master, 32, WEB_APP / "icon.png")
    resize_png(master, 180, WEB_APP / "apple-icon.png")
    generate_favicon(master, WEB_APP / "favicon.ico")
    generate_og_image(master, WEB_APP / "opengraph-image.png")

    print("\nDone!")


if __name__ == "__main__":
    main()
