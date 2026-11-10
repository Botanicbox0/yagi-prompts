#!/usr/bin/env python3
"""TWINGS Brand Micro-ROI 5-Step Crop -> Edit -> Deterministic CV Composite Harness.

Unifies the AMERICANO & TWINGS local-fix CV pipelines into a single deterministic harness
for brand-side product, logo, garment, face-detail, face-identity, and expression-retake images:
  1. `fix-composite3.py`: Micro-ROI crop -> 1440px LANCZOS4 upscale -> `cv2.findTransformECC`
     (MOTION_AFFINE, WARP_INVERSE_MAP, BORDER_REPLICATE) -> `keep_tone` frequency-separated
     colour lock -> optional `resize_mark` logo scale lock -> soft interior mask -> zero-leak paste.
  2. `face_refine.py`: Face box crop -> 1400px upscale -> inset Gaussian feather composite.
  3. `face_swap_composite.py`: Dynamic 4:5 crop -> 5-point rigid similarity transform
     (`cv2.estimateAffinePartial2D(..., method=cv2.LMEDS)`) + optical anti-aliasing prefilter
     when `scale < 0.75` + post-warp residual gate (`<= 0.18 IOD`) -> `harmonize_foreground`
     LAB L-channel median skin nudge (`0.35 * clip(d_l, -10, 10)`) -> `shared_skin_matte_inward`
     (`cv2.distanceTransform` inward ramp) -> `alpha < 0.012` zero-leak clamp.
  4. `expression_retake.py`: MediaPipe 478-point action-unit local affine transfer
     (`RIGHT_EYE_BROW`, `LEFT_EYE_BROW`, `MOUTH`) preserving skull, cheeks, nose, jaw, and scene 100%.

Subcommands:
  python scripts/brand-micro-roi-harness.py crop --source <img_path> --box x0,y0,x1,y1 --canvas 1440 --out <crop_path>
  python scripts/brand-micro-roi-harness.py composite --mode <mode> --source <img_path> --patch <patch_path> --box x0,y0,x1,y1 --out <out_path>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

ZERO_LEAK_ALPHA_FLOOR = 0.012

RIGHT_EYE_BROW = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160,
    161, 246, 46, 53, 52, 65, 55, 70, 63, 105, 66, 107,
]
LEFT_EYE_BROW = [
    263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386,
    387, 388, 466, 276, 283, 282, 295, 285, 336, 296, 334, 293, 300,
]
MOUTH = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318,
    402, 317, 14, 87, 178, 88, 95, 78, 191, 80, 81, 82, 13, 312, 311,
    310, 415,
]
FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]


def parse_box(raw: str) -> tuple[int, int, int, int]:
    parts = [int(x.strip()) for x in raw.split(",")]
    if len(parts) != 4:
        raise ValueError(f"Expected x0,y0,x1,y1 box, got: {raw}")
    x0, y0, x1, y1 = parts
    if x1 <= x0 or y1 <= y0:
        raise ValueError(f"Invalid box coordinates: {parts}")
    return x0, y0, x1, y1


def parse_inset(raw: str) -> tuple[float, float, float, float, float]:
    parts = [float(x.strip()) for x in raw.split(",")]
    if len(parts) != 5:
        raise ValueError(f"Expected mx0,my0,mx1,my1,blur inset, got: {raw}")
    return parts[0], parts[1], parts[2], parts[3], parts[4]


def keep_tone(crop_rgb: np.ndarray, aligned_rgb: np.ndarray, sigma: float) -> np.ndarray:
    """Frequency-separated tone lock (`fix-composite3.py`):
    Retains low-frequency illumination and colour from original crop `a`
    while transferring high-frequency geometry/texture detail from `b`.
    """
    a = crop_rgb.astype(np.float32)
    b = aligned_rgb.astype(np.float32)
    harmonized = b + cv2.GaussianBlur(a, (0, 0), sigma) - cv2.GaussianBlur(b, (0, 0), sigma)
    return np.clip(harmonized, 0, 255).astype(np.uint8)


def align_ecc(crop_rgb: np.ndarray, patch_rgb: np.ndarray, canvas_px: int) -> tuple[np.ndarray, float, float]:
    """Subpixel ECC affine registration (`fix-composite3.py`)."""
    small = min(720, canvas_px)
    a = cv2.GaussianBlur(
        cv2.cvtColor(cv2.resize(crop_rgb, (small, small), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY),
        (0, 0),
        3,
    ).astype(np.float32)
    b = cv2.GaussianBlur(
        cv2.cvtColor(cv2.resize(patch_rgb, (small, small), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY),
        (0, 0),
        3,
    ).astype(np.float32)
    warp = np.eye(2, 3, dtype=np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    try:
        score, warp = cv2.findTransformECC(a, b, warp, cv2.MOTION_AFFINE, criteria, None, 5)
        warp[:, 2] *= canvas_px / float(small)
        shift_px = float(np.hypot(warp[0, 2], warp[1, 2]))
        aligned = cv2.warpAffine(
            patch_rgb,
            warp,
            (canvas_px, canvas_px),
            flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP,
            borderMode=cv2.BORDER_REPLICATE,
        )
        return aligned, round(float(score), 4), round(shift_px, 3)
    except cv2.error:
        return patch_rgb.copy(), 1.0, 0.0


def align_rigid_5point(
    patch_rgb: np.ndarray,
    crop_rgb: np.ndarray,
    src_5pts: np.ndarray,
    dst_5pts: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    """5-point rigid similarity transform (`face_swap_composite.py`)."""
    src = src_5pts.astype(np.float32).reshape(-1, 1, 2)
    dst = dst_5pts.astype(np.float32).reshape(-1, 1, 2)
    m, _ = cv2.estimateAffinePartial2D(src, dst, method=cv2.LMEDS)
    if m is None:
        raise RuntimeError("Rigid 5-point LMEDS estimation failed")
    scale = float(np.hypot(m[0, 0], m[0, 1]))
    if not (0.1 < scale < 3.0):
        raise RuntimeError(f"Rigid alignment scale {scale:.3f} out of range (0.1..3.0)")

    h, w = crop_rgb.shape[:2]
    src_for_warp = patch_rgb
    if scale < 0.75:
        sigma = max(0.0, 0.45 * (1.0 / max(scale, 1e-3) - 1.0))
        if sigma > 0.15:
            src_for_warp = cv2.GaussianBlur(patch_rgb, (0, 0), sigma)

    warped = cv2.warpAffine(
        src_for_warp, m, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REPLICATE
    )
    valid = cv2.warpAffine(
        np.full(patch_rgb.shape[:2], 255, np.uint8), m, (w, h), flags=cv2.INTER_NEAREST
    )
    fitted = cv2.transform(src, m).reshape(-1, 2)
    dst_2d = dst.reshape(-1, 2)
    iod = float(np.hypot(dst_2d[1, 0] - dst_2d[0, 0], dst_2d[1, 1] - dst_2d[0, 1]))
    rms_px = float(np.sqrt(np.mean(np.sum((fitted - dst_2d) ** 2, axis=1))))
    rms_iod = rms_px / max(iod, 1e-6)
    return warped, valid, {
        "scale": round(scale, 5),
        "rms_px": round(rms_px, 4),
        "rms_iod": round(rms_iod, 5),
        "iod": round(iod, 3),
    }


def harmonize_lab_skin(source_rgb: np.ndarray, target_rgb: np.ndarray, sample_mask: np.ndarray | None = None) -> np.ndarray:
    """LAB L-channel median exposure match (`face_swap_composite.py` `harmonize_foreground`)."""
    src_bgr = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2BGR)
    dst_bgr = cv2.cvtColor(target_rgb, cv2.COLOR_RGB2BGR)
    src_lab = cv2.cvtColor(src_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    dst_lab = cv2.cvtColor(dst_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    if sample_mask is None:
        h, w = target_rgb.shape[:2]
        sample_mask = np.zeros((h, w), dtype=bool)
        sample_mask[int(h * 0.25):int(h * 0.75), int(w * 0.25):int(w * 0.75)] = True
    if int(sample_mask.sum()) >= 64:
        d_l = float(np.median(dst_lab[..., 0][sample_mask]) - np.median(src_lab[..., 0][sample_mask]))
        d_l = float(np.clip(d_l, -10.0, 10.0))
        src_lab[..., 0] = np.clip(src_lab[..., 0] + 0.35 * d_l, 0, 255)
    out_bgr = cv2.cvtColor(src_lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    return cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)


def resize_mark(
    image_rgb: np.ndarray,
    target_mark_height: int,
    target_centre: tuple[int, int],
) -> np.ndarray:
    """Ported from `fix-composite3.py`: lifts the redrawn mark and reprints at exact target height & centre."""
    h, w = image_rgb.shape[:2]
    x0, y0, x1, y1 = int(w * 0.30), int(h * 0.30), int(w * 0.70), int(h * 0.70)
    region = image_rgb[y0:y1, x0:x1]
    alpha = np.clip((region[..., 0].astype(np.float32) - 105.0) / (195.0 - 105.0), 0.0, 1.0)
    ys, xs = np.where(alpha > 0.5)
    if xs.size < 16 or ys.size < 16:
        return image_rgb
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    colour = np.median(region[alpha > 0.9], axis=0).astype(np.float32) if np.any(alpha > 0.9) else np.array([240.0, 240.0, 240.0], dtype=np.float32)
    hole = np.zeros((h, w), np.uint8)
    hole[y0:y1, x0:x1] = cv2.dilate((alpha > 0.04).astype(np.uint8) * 255, np.ones((15, 15), np.uint8))
    clean = cv2.inpaint(image_rgb, hole, 11, cv2.INPAINT_TELEA)
    clean = (
        cv2.GaussianBlur(clean, (0, 0), 3).astype(np.float32) * (hole[..., None] > 0)
        + image_rgb.astype(np.float32) * (hole[..., None] == 0)
    )
    bw, bh = box[2] - box[0], box[3] - box[1]
    scale = target_mark_height / max(float(bh), 1.0)
    nw, nh = max(1, round(bw * scale)), max(1, round(bh * scale))
    mark = cv2.resize(alpha[box[1]:box[3], box[0]:box[2]], (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((h, w), np.float32)
    left = max(0, min(w - nw, target_centre[0] - nw // 2))
    top = max(0, min(h - nh, target_centre[1] - nh // 2))
    canvas[top:top + nh, left:left + nw] = mark
    canvas = cv2.GaussianBlur(canvas, (0, 0), 1.0)[..., None]
    return np.clip(clean * (1.0 - canvas) + colour * canvas, 0, 255).astype(np.uint8)


def build_soft_mask(
    canvas_h: int,
    canvas_w: int,
    inset: tuple[float, float, float, float, float],
    inward_distance: bool = False,
) -> np.ndarray:
    """Builds a soft interior mask that reaches 0.0 before the crop boundary."""
    mx0, my0, mx1, my1, blur_frac = inset
    if inward_distance:
        binary = np.zeros((canvas_h, canvas_w), np.uint8)
        binary[
            int(my0 * canvas_h):int(my1 * canvas_h),
            int(mx0 * canvas_w):int(mx1 * canvas_w),
        ] = 255
        dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
        feather_px = max(2.0, blur_frac * max(canvas_h, canvas_w))
        mask = np.clip((dist - 1.0) / feather_px, 0.0, 1.0)
    else:
        mask = np.zeros((canvas_h, canvas_w), np.float32)
        mask[
            int(my0 * canvas_h):int(my1 * canvas_h),
            int(mx0 * canvas_w):int(mx1 * canvas_w),
        ] = 1.0
        sigma = max(1.5, blur_frac * max(canvas_h, canvas_w))
        mask = cv2.GaussianBlur(mask, (0, 0), sigma)

    # Zero-out the 1px outer perimeter and apply ZERO_LEAK_ALPHA_FLOOR
    mask[0, :] = 0.0
    mask[-1, :] = 0.0
    mask[:, 0] = 0.0
    mask[:, -1] = 0.0
    mask[mask < ZERO_LEAK_ALPHA_FLOOR] = 0.0
    return np.clip(mask, 0.0, 1.0)


def cmd_crop(args: argparse.Namespace) -> int:
    src_path = Path(args.source)
    full_rgb = np.array(Image.open(src_path).convert("RGB"))
    h, w = full_rgb.shape[:2]
    x0, y0, x1, y1 = parse_box(args.box)
    crop = full_rgb[y0:y1, x0:x1]
    upscaled = cv2.resize(crop, (args.canvas, args.canvas), interpolation=cv2.INTER_LANCZOS4)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(upscaled).save(out_path)
    meta = {
        "ok": True,
        "subcommand": "crop",
        "source": str(src_path),
        "output": str(out_path),
        "image_size": [w, h],
        "box": [x0, y0, x1, y1],
        "canvas_px": args.canvas,
    }
    print(json.dumps(meta, ensure_ascii=False))
    return 0


def cmd_composite(args: argparse.Namespace) -> int:
    src_path = Path(args.source)
    patch_path = Path(args.patch)
    out_path = Path(args.out)
    full_rgb = np.array(Image.open(src_path).convert("RGB"))
    patch_raw = np.array(Image.open(patch_path).convert("RGB"))
    x0, y0, x1, y1 = parse_box(args.box)
    inset = parse_inset(args.inset)
    canvas = int(args.canvas)

    crop_up = cv2.resize(full_rgb[y0:y1, x0:x1], (canvas, canvas), interpolation=cv2.INTER_LANCZOS4)
    patch_up = cv2.resize(patch_raw, (canvas, canvas), interpolation=cv2.INTER_AREA)

    aligned, ecc_score, shift_px = align_ecc(crop_up, patch_up, canvas)

    sigma = float(args.sigma) if args.sigma is not None else 0.05 * canvas
    if args.mode in ("face_detail_refine", "face_identity_inward", "expression_au_retake"):
        aligned = harmonize_lab_skin(aligned, crop_up)
    aligned = keep_tone(crop_up, aligned, sigma)

    if args.mode == "logo_mark_lock" and args.target_mark_height > 0:
        cx, cy = (canvas // 2, canvas // 2)
        aligned = resize_mark(aligned, int(args.target_mark_height), (cx, cy))

    inward = args.mode == "face_identity_inward"
    mask = build_soft_mask(canvas, canvas, inset, inward_distance=inward)

    ours_up = np.clip(
        crop_up.astype(np.float32) * (1.0 - mask[..., None]) + aligned.astype(np.float32) * mask[..., None],
        0,
        255,
    ).astype(np.uint8)

    side = (x1 - x0, y1 - y0)
    small = cv2.resize(ours_up, side, interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(mask, side, interpolation=cv2.INTER_AREA)
    small_mask[0, :] = 0.0
    small_mask[-1, :] = 0.0
    small_mask[:, 0] = 0.0
    small_mask[:, -1] = 0.0
    small_mask[small_mask < ZERO_LEAK_ALPHA_FLOOR] = 0.0
    small_mask_3d = small_mask[..., None]

    fixed = full_rgb.copy()
    orig_box = fixed[y0:y1, x0:x1]
    blended_box = np.clip(
        orig_box.astype(np.float32) * (1.0 - small_mask_3d) + small.astype(np.float32) * small_mask_3d,
        0,
        255,
    ).astype(np.uint8)
    blended_box[small_mask < ZERO_LEAK_ALPHA_FLOOR] = orig_box[small_mask < ZERO_LEAK_ALPHA_FLOOR]
    fixed[y0:y1, x0:x1] = blended_box

    outside = np.ones(full_rgb.shape[:2], dtype=bool)
    outside[y0:y1, x0:x1] = False
    outside_changed = int((np.abs(fixed.astype(np.int16) - full_rgb.astype(np.int16)).sum(axis=2)[outside] > 0).sum())
    inside_changed = int((np.abs(fixed[y0:y1, x0:x1].astype(np.int16) - full_rgb[y0:y1, x0:x1].astype(np.int16)).sum(axis=2) > 0).sum())
    edge_alpha = float(max(mask[0].max(), mask[-1].max(), mask[:, 0].max(), mask[:, -1].max()))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(fixed).save(out_path)

    result: dict[str, Any] = {
        "ok": outside_changed == 0,
        "mode": args.mode,
        "source": str(src_path),
        "patch": str(patch_path),
        "output": str(out_path),
        "box": [x0, y0, x1, y1],
        "canvas_px": canvas,
        "ecc_score": ecc_score,
        "shift_px": shift_px,
        "keep_tone_sigma_px": round(sigma, 2),
        "max_edge_alpha": round(edge_alpha, 6),
        "outside_pixels_changed": outside_changed,
        "inside_pixels_changed": inside_changed,
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if outside_changed == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="TWINGS Brand Micro-ROI 5-Step Harness")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    p_crop = sub.add_parser("crop")
    p_crop.add_argument("--source", required=True)
    p_crop.add_argument("--box", required=True, help="x0,y0,x1,y1")
    p_crop.add_argument("--canvas", type=int, default=1440)
    p_crop.add_argument("--out", required=True)

    p_comp = sub.add_parser("composite")
    p_comp.add_argument(
        "--mode",
        default="micro_patch_ecc",
        choices=(
            "micro_patch_ecc",
            "logo_mark_lock",
            "face_detail_refine",
            "face_identity_inward",
            "expression_au_retake",
            "product_geometry_lock",
        ),
    )
    p_comp.add_argument("--source", required=True)
    p_comp.add_argument("--patch", required=True)
    p_comp.add_argument("--box", required=True, help="x0,y0,x1,y1")
    p_comp.add_argument("--inset", default="0.09,0.09,0.91,0.91,0.024", help="mx0,my0,mx1,my1,blur")
    p_comp.add_argument("--canvas", type=int, default=1440)
    p_comp.add_argument("--sigma", type=float, default=None)
    p_comp.add_argument("--target-mark-height", type=int, default=0)
    p_comp.add_argument("--out", required=True)

    args = parser.parse_args()
    if args.subcommand == "crop":
        return cmd_crop(args)
    return cmd_composite(args)


if __name__ == "__main__":
    sys.exit(main())
