#!/usr/bin/env python3
"""
Build a CC0 bark-edge cut-face atlas (screen.toys *style*, not their assets).

Layout (U left→right):
  A thin bark strip | B longitudinal split grain | C thin bark strip

Sources (all CC0 via Poly Haven, already in repo):
  - Middle grain: facegrain/sidegrain_{diff,nor}.jpg  (ash_veneer, rotated)
  - Bark edges:   bark/toona/{diff,nor}.jpg           (chinese_cedar_bark)

Do NOT download or remix screen.toys insidegrain.jpg.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps/h5/public/assets"
FACE = ASSETS / "facegrain"
BARK = ASSETS / "bark/toona"

# ~3% bark strip each side — matches screen.toys insidegrain *layout* (~2–4%),
# not their pixels. Wider strips (e.g. 12%) read as thick dark columns on cut faces.
BARK_FRAC = 0.03
SIZE = 1024


def _load(path: Path) -> Image.Image:
    if not path.exists():
        raise FileNotFoundError(path)
    return Image.open(path).convert("RGB")


def _bark_strip(bark: Image.Image, width: int, height: int, *, flip: bool) -> Image.Image:
    """Crop a vertical bark column and tone it down so it reads as rim, not mantle."""
    src = bark.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    # Take a mid-column so we avoid bark map seams at U=0.
    x0 = SIZE // 3
    col = src.crop((x0, 0, x0 + max(8, SIZE // 8), SIZE))
    col = col.resize((width, height), Image.Resampling.LANCZOS)
    if flip:
        col = col.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    # Slightly darker / less saturated than outer mantle bark.
    col = ImageEnhance.Brightness(col).enhance(0.88)
    col = ImageEnhance.Color(col).enhance(0.75)
    col = ImageEnhance.Contrast(col).enhance(1.05)
    return col


def _grain_panel(grain: Image.Image, width: int, height: int) -> Image.Image:
    g = grain.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    # Mild soften so the composite doesn't scream "veneer photo".
    g = g.filter(ImageFilter.GaussianBlur(radius=0.4))
    g = ImageEnhance.Brightness(g).enhance(1.18)
    return g.resize((width, height), Image.Resampling.LANCZOS)


def build_atlas(diff_bark: Image.Image, diff_grain: Image.Image) -> Image.Image:
    bark_w = max(8, int(round(SIZE * BARK_FRAC)))
    grain_w = SIZE - 2 * bark_w
    left = _bark_strip(diff_bark, bark_w, SIZE, flip=False)
    mid = _grain_panel(diff_grain, grain_w, SIZE)
    right = _bark_strip(diff_bark, bark_w, SIZE, flip=True)
    out = Image.new("RGB", (SIZE, SIZE))
    out.paste(left, (0, 0))
    out.paste(mid, (bark_w, 0))
    out.paste(right, (bark_w + grain_w, 0))
    return out


def build_normal(nor_bark: Image.Image | None, nor_grain: Image.Image | None) -> Image.Image:
    """Composite normals; flat fallback where a map is missing."""
    flat = Image.new("RGB", (SIZE, SIZE), (128, 128, 255))
    bark = nor_bark if nor_bark is not None else flat
    grain = nor_grain if nor_grain is not None else flat
    bark_w = max(8, int(round(SIZE * BARK_FRAC)))
    grain_w = SIZE - 2 * bark_w

    def strip(img: Image.Image, w: int, *, flip: bool) -> Image.Image:
        src = img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        x0 = SIZE // 3
        col = src.crop((x0, 0, x0 + max(8, SIZE // 8), SIZE))
        col = col.resize((w, SIZE), Image.Resampling.LANCZOS)
        if flip:
            col = col.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        return col

    left = strip(bark, bark_w, flip=False)
    mid = grain.resize((grain_w, SIZE), Image.Resampling.LANCZOS)
    right = strip(bark, bark_w, flip=True)
    out = Image.new("RGB", (SIZE, SIZE), (128, 128, 255))
    out.paste(left, (0, 0))
    out.paste(mid, (bark_w, 0))
    out.paste(right, (bark_w + grain_w, 0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=FACE,
        help="Output directory (default: apps/h5/public/assets/facegrain)",
    )
    args = ap.parse_args()
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    grain_diff = _load(FACE / "sidegrain_diff.jpg")
    bark_diff = _load(BARK / "diff.jpg")
    grain_nor = _load(FACE / "sidegrain_nor.jpg") if (FACE / "sidegrain_nor.jpg").exists() else None
    bark_nor = _load(BARK / "nor.jpg") if (BARK / "nor.jpg").exists() else None

    atlas = build_atlas(bark_diff, grain_diff)
    nor = build_normal(bark_nor, grain_nor)

    diff_path = out_dir / "barkedge_diff.jpg"
    nor_path = out_dir / "barkedge_nor.jpg"
    atlas.save(diff_path, quality=88, optimize=True)
    nor.save(nor_path, quality=88, optimize=True)
    print(f"wrote {diff_path} ({atlas.size[0]}x{atlas.size[1]}, bark_frac={BARK_FRAC})")
    print(f"wrote {nor_path}")


if __name__ == "__main__":
    main()
