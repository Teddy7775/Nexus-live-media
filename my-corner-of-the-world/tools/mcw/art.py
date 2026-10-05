"""Artwork registry: resolve final files, apply technical fixes, report print fitness.

Lookup order for each register ID:  art/final/<stem>.*  (print masters)  ->  art/source/<stem>.*
Only *technical* fixes are applied automatically (format conversion, removal of the thin
"book fold" line that two panoramas carry). Anything creative (a wrong object, a baked-in
English word, a style mismatch) is reported, never silently repainted.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .core import BUILD, Book

EXTS = (".png", ".tif", ".tiff", ".jpg", ".jpeg", ".webp")
Image.MAX_IMAGE_PIXELS = None


@dataclass
class ArtFile:
    aid: str
    src: Path
    work: Path          # processed JPEG used by the print layout
    w: int
    h: int
    kind: str           # slot kind from the register
    notes: list
    web: Path = None    # processed JPEG for web/ebook (no print-only vignette)

    @property
    def aspect(self) -> float:
        return self.w / self.h


def _find(dirpath: Path, stem: str) -> Path | None:
    for ext in EXTS:
        p = dirpath / (stem + ext)
        if p.exists():
            return p
    return None


def remove_fold(bgr: np.ndarray, x: int, line_half: int = 3, shadow_span: int = 70) -> np.ndarray:
    """Remove a baked-in 'book fold': a soft gutter shadow plus a thin vertical line.

    1. Estimate the multiplicative shadow profile from smooth upper rows (sky), by comparing
       each column with a linear interpolation between columns just outside the shadow, then
       divide it out.
    2. Close the remaining thin line by per-row linear interpolation across a few columns
       (keeps outlines continuous, unlike area inpainting).
    """
    img = bgr.astype(np.float32)
    h, w = img.shape[:2]
    a, b = x - shadow_span, x + shadow_span
    if a > 4 and b < w - 5:
        left = img[:, a - 4:a - 1].mean(axis=1)    # (h,3)
        right = img[:, b + 1:b + 4].mean(axis=1)
        rows = slice(int(h * 0.02), int(h * 0.36))
        ratios = []
        for c in range(a, b + 1):
            t = (c - a) / float(b - a)
            ref = left * (1 - t) + right * t
            r = np.median(img[rows, c, :] / np.maximum(ref[rows], 1.0), axis=0)
            ratios.append(r)
        ratios = np.array(ratios)                       # (n,3)
        # smooth the profile and only ever brighten (a shadow only darkens)
        k = np.ones(9) / 9.0
        sm = np.stack([np.convolve(np.pad(ratios[:, i], 4, mode="edge"), k, mode="valid") for i in range(3)], axis=1)
        gain = np.clip(1.0 / np.maximum(sm, 0.55), 1.0, 1.7)
        # fade the correction out toward the span edges
        fade = np.minimum(1.0, np.minimum(np.arange(len(gain)), np.arange(len(gain))[::-1]) / 10.0)[:, None]
        gain = 1.0 + (gain - 1.0) * fade
        img[:, a:b + 1, :] *= gain[None, :, :]
    # thin line: interpolate per row between columns on either side
    l, r = x - line_half - 1, x + line_half + 1
    for c in range(l + 1, r):
        t = (c - l) / float(r - l)
        img[:, c, :] = img[:, l, :] * (1 - t) + img[:, r, :] * t
    return np.clip(img, 0, 255).astype(np.uint8)


def erase_marks(bgr: np.ndarray, boxes: list[dict]) -> np.ndarray:
    """Remove stray lettering (e.g. a baked-in asset id) from a flat-ish surface.

    Each box = {"box": [x, y, w, h] in source pixels, "polarity": "dark" | "light", "delta": 28, "grow": 3, "radius": 5}.
    Only pixels inside the box that differ from their local surroundings by more than `delta` are repainted
    (inpainting from the neighbouring surface), so the surface texture and anything not lettering stays untouched.
    """
    out = bgr.copy()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    local = cv2.GaussianBlur(gray, (0, 0), 9)
    for b in boxes:
        x, y, w, h = b["box"]
        diff = (local - gray) if b.get("polarity", "dark") == "dark" else (gray - local)
        mask = np.zeros(gray.shape, np.uint8)
        sub = (diff[y:y + h, x:x + w] > b.get("delta", 28)).astype(np.uint8) * 255
        mask[y:y + h, x:x + w] = sub
        g = int(b.get("grow", 3))
        if g:
            mask = cv2.dilate(mask, np.ones((2 * g + 1, 2 * g + 1), np.uint8))
        out = cv2.inpaint(out, mask, float(b.get("radius", 5)), cv2.INPAINT_TELEA)
    return out


def fade_bottom_to_white(bgr: np.ndarray, frac: float) -> np.ndarray:
    """Dissolve the bottom `frac` of the image into white paper (print vignette for letterboxed panoramas)."""
    img = bgr.astype(np.float32)
    h = img.shape[0]
    n = max(2, int(h * frac))
    t = np.linspace(0.0, 1.0, n)
    a = (t * t * (3 - 2 * t))[:, None, None]          # smoothstep 0 -> 1
    img[h - n:, :, :] = img[h - n:, :, :] * (1 - a) + 255.0 * a
    return np.clip(img, 0, 255).astype(np.uint8)


def paper_to_white(bgr: np.ndarray, paper_rgb, d0: float = 9.0, d1: float = 34.0) -> np.ndarray:
    """Print copy of a vignette painted on a tinted paper ground: pixels close to `paper_rgb` become pure white
    (so no ink prints in the margin and the picture floats on the page), pixels far from it are untouched, and the
    soft edge in between is blended (smoothstep of the colour distance from d0 to d1)."""
    img = bgr.astype(np.float32)
    p = np.array(paper_rgb[::-1], np.float32)                     # RGB -> BGR
    d = np.sqrt(((img - p) ** 2).sum(axis=2))
    a = np.clip((d - d0) / max(d1 - d0, 1e-6), 0.0, 1.0)
    a = (a * a * (3 - 2 * a))[..., None]
    return np.clip(255.0 - a * (255.0 - img), 0, 255).astype(np.uint8)


class Art:
    def __init__(self, book: Book):
        self.book = book
        self.dir = book.dir / "art"
        self.out = BUILD / book.slug / "art"
        self.out.mkdir(parents=True, exist_ok=True)
        ov = self.dir / "overrides.json"
        self.overrides = json.loads(ov.read_text()) if ov.exists() else {}
        self._cache: dict[str, ArtFile | None] = {}

    def slot(self, aid: str) -> dict:
        return self.book.register["slots"][aid]

    def get(self, aid: str) -> ArtFile | None:
        if aid in self._cache:
            return self._cache[aid]
        stem = self.slot(aid)["stem"]
        src = _find(self.dir / "final", stem) or _find(self.dir / "source", stem)
        if not src:
            self._cache[aid] = None
            return None
        notes = []
        im = Image.open(src)
        im.load()
        im = im.convert("RGB")
        arr = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR)
        ov = self.overrides.get(aid, {})
        if "remove_fold" in ov:
            cfg = ov["remove_fold"]
            arr = remove_fold(arr, cfg["x"], cfg.get("line_half", 3), cfg.get("shadow_span", 70))
            notes.append(f"removed baked-in book-fold shadow and line at x={cfg['x']}")
        if "erase" in ov:
            arr = erase_marks(arr, ov["erase"])
            notes.append("removed stray lettering (asset id) from the artwork")
        # web/ebook copy: all fixes except print-only vignettes
        web = self.out / f"{aid}.web.jpg"
        Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)).save(web, quality=93, subsampling=0, optimize=True)
        if ov.get("print_fade_bottom"):
            arr = fade_bottom_to_white(arr, float(ov["print_fade_bottom"]))
            notes.append("print copy: bottom edge fades to paper")
        if ov.get("print_paper_to_white"):
            cfg = ov["print_paper_to_white"]
            arr = paper_to_white(arr, cfg["paper"], cfg.get("d0", 9.0), cfg.get("d1", 34.0))
            notes.append("print copy: the tinted paper ground around the vignette prints as unprinted paper")
        work = self.out / f"{aid}.jpg"
        Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)).save(work, quality=95, subsampling=0, optimize=True)
        af = ArtFile(aid, src, work, im.width, im.height, self.slot(aid)["kind"], notes, web=web)
        self._cache[aid] = af
        return af

    def panel_fit(self, aid: str, panel_w_in: float, panel_h_in: float, anchor: str = "bottom",
                  crop: tuple[int, int] = (0, 0)) -> tuple[Path, int, int]:
        """Fit the image to the panel's width and make it exactly as tall as the panel.

        Too short: the missing rows are added at the side opposite `anchor` by mirroring the image's own edge
        (the paper / sky texture continues; nothing is invented). Too tall: the surplus is cropped there.
        `crop` removes (left, right) pixels first, e.g. a scan edge. Returns (file, width_px, height_px).
        """
        af = self.get(aid)
        im = Image.open(af.web).convert("RGB")
        w, h = im.size
        l, r = crop
        im = im.crop((l, 0, w - r, h))
        w = im.width
        need = round(w * panel_h_in / panel_w_in)
        arr = np.array(im)
        if need > h:
            add = need - h
            if anchor == "bottom":         # image sits at the bottom; extend the top
                ext = np.concatenate([arr[:min(add, h - 1)][::-1]] * (add // max(1, min(add, h - 1)) + 1), axis=0)[:add]
                arr = np.concatenate([ext, arr], axis=0)
            else:
                ext = np.concatenate([arr[-min(add, h - 1):][::-1]] * (add // max(1, min(add, h - 1)) + 1), axis=0)[:add]
                arr = np.concatenate([arr, ext], axis=0)
        elif need < h:
            arr = arr[h - need:] if anchor == "bottom" else arr[:need]
        out = self.out / f"{aid}.panel.jpg"
        Image.fromarray(arr).save(out, quality=94, subsampling=0, optimize=True)
        return out, arr.shape[1], arr.shape[0]

    def all_ids(self):
        return list(self.book.register["slots"].keys())
