#!/usr/bin/env python3
"""
Build CC0 bark-edge (insidegrain) cut-face atlases per species.

Layout mirrors screen.toys insidegrain *roles* (logic only — never their pixels):
  U left→right: thin bark strip | longitudinal split grain | thin bark strip

Sources (all CC0 via Poly Haven, already in repo):
  - Middle grain: facegrain/sidegrain_{diff,nor}.jpg  (kitchen_wood, vertical)
  - Bark edges:   bark/{species}/{diff,nor}.jpg

Output pack layout (drop-in per species):
  facegrain/{species}/insidegrain_diff.jpg
  facegrain/{species}/insidegrain_nor.jpg

Also writes legacy shared paths facegrain/barkedge_{diff,nor}.jpg from `toona`
so older fallbacks keep working.

Do NOT download or remix screen.toys insidegrain.jpg.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps/h5/public/assets"
FACE = ASSETS / "facegrain"
BARK_ROOT = ASSETS / "bark"

# Species ids must match packages/content/data/species.json + bark/ folders.
SPECIES = [
    "pinus",
    "quercus-serrata",
    "cryptomeria",
    "platanus",
    "eucalyptus-globulus",
    "toona",
]

# ~3% bark strip each side — matches screen.toys insidegrain *layout* (~2–4%),
# not their pixels. Wider strips (e.g. 12%) read as thick dark columns on cut faces.
BARK_FRAC = 0.03
SIZE = 1024

# Mid-panel grade: drop over-bright wash; push contrast so vertical fibers read at game scale.
GRAIN_BRIGHTNESS = 1.0
GRAIN_CONTRAST = 1.38
GRAIN_BLUR = 0.0


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
    # Keep fibers sharp — ash_veneer + blur + ×1.18 wash read as flat peach at game scale.
    if GRAIN_BLUR > 0:
        g = g.filter(ImageFilter.GaussianBlur(radius=GRAIN_BLUR))
    if GRAIN_BRIGHTNESS != 1.0:
        g = ImageEnhance.Brightness(g).enhance(GRAIN_BRIGHTNESS)
    if GRAIN_CONTRAST != 1.0:
        g = ImageEnhance.Contrast(g).enhance(GRAIN_CONTRAST)
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


def write_pack(
    species: str,
    grain_diff: Image.Image,
    grain_nor: Image.Image | None,
    out_root: Path,
) -> tuple[Path, Path]:
    bark_dir = BARK_ROOT / species
    bark_diff = _load(bark_dir / "diff.jpg")
    bark_nor_path = bark_dir / "nor.jpg"
    bark_nor = _load(bark_nor_path) if bark_nor_path.exists() else None

    atlas = build_atlas(bark_diff, grain_diff)
    nor = build_normal(bark_nor, grain_nor)

    dest = out_root / species
    dest.mkdir(parents=True, exist_ok=True)
    diff_path = dest / "insidegrain_diff.jpg"
    nor_path = dest / "insidegrain_nor.jpg"
    atlas.save(diff_path, quality=88, optimize=True)
    nor.save(nor_path, quality=88, optimize=True)
    return diff_path, nor_path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=FACE,
        help="Output root (default: apps/h5/public/assets/facegrain)",
    )
    ap.add_argument(
        "--species",
        nargs="*",
        default=SPECIES,
        help="Species ids to build (default: all content packs)",
    )
    args = ap.parse_args()
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    grain_diff = _load(FACE / "sidegrain_diff.jpg")
    grain_nor = (
        _load(FACE / "sidegrain_nor.jpg") if (FACE / "sidegrain_nor.jpg").exists() else None
    )

    for sp in args.species:
        diff_path, nor_path = write_pack(sp, grain_diff, grain_nor, out_dir)
        print(f"wrote {diff_path} (bark_frac={BARK_FRAC})")
        print(f"wrote {nor_path}")

    # Legacy shared fallback = toona pack (kept for older code paths).
    if "toona" in args.species:
        legacy_diff = out_dir / "toona" / "insidegrain_diff.jpg"
        legacy_nor = out_dir / "toona" / "insidegrain_nor.jpg"
        if legacy_diff.exists():
            atlas = Image.open(legacy_diff)
            atlas.save(out_dir / "barkedge_diff.jpg", quality=88, optimize=True)
            print(f"wrote {out_dir / 'barkedge_diff.jpg'} (legacy shared)")
        if legacy_nor.exists():
            nor = Image.open(legacy_nor)
            nor.save(out_dir / "barkedge_nor.jpg", quality=88, optimize=True)
            print(f"wrote {out_dir / 'barkedge_nor.jpg'} (legacy shared)")


if __name__ == "__main__":
    main()
