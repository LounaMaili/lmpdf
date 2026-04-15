"""
Field detection pipeline using OpenCV + Tesseract.

Two strategies:
  A) Line-based: detect H/V lines → reconstruct grid → extract cells
  B) Contour-based: find rectangular contours → classify

For scanned documents, strategy A works better after proper preprocessing.
The key is aggressive line detection with gap filling.
"""

import uuid
import logging
from typing import Any

import cv2
import numpy as np
import pytesseract
from PIL import Image

logger = logging.getLogger("vision.detector")

MIN_CELL_W = 15
MIN_CELL_H = 12
CHECKBOX_MAX = 55
DPI = 200  # higher DPI for scanned PDFs


def sensitivity_profile(options: dict[str, Any]) -> dict[str, Any]:
    """Return detection parameters based on sensitivity level.
    
    Sensitivity affects:
    - min_w/min_h: Minimum cell dimensions (smaller = more cells detected)
    - line_div: Divisor for line kernel sizing (larger = shorter lines detected)
    - close_iters: Morphological closing iterations (more = more gaps bridged)
    
    Lower sensitivity = fewer, larger cells with longer line requirements.
    Higher sensitivity = more, smaller cells with shorter line requirements.
    """
    level = (options or {}).get("sensitivity", "normal")
    logger.info(f"Computing sensitivity profile for level: {level}")
    
    if level == "low":
        # Low sensitivity: require longer lines, larger cells, fewer gaps closed
        # Good for clean documents with clear, well-formed tables
        profile = {"min_w": 25, "min_h": 20, "line_div": 18, "close_iters": 1}
    elif level == "high":
        # High sensitivity: detect shorter lines, smaller cells, more gaps closed
        # Good for degraded scans or small text fields
        profile = {"min_w": 8, "min_h": 6, "line_div": 40, "close_iters": 4}
    else:
        # Normal sensitivity: balanced settings
        profile = {"min_w": 15, "min_h": 12, "line_div": 25, "close_iters": 2}
    
    logger.info(f"Sensitivity profile: {profile}")
    return profile


def preprocess_dotted_lines(
    binary: np.ndarray,
    horizontal_gap: int = 15,
    vertical_gap: int = 15
) -> np.ndarray:
    """
    Preprocess binary image to convert dotted/dashed lines into continuous lines.
    
    Uses morphological closing with horizontal/vertical kernels to bridge gaps
    between dots, making them appear as solid lines for subsequent detection.
    
    Args:
        binary: Binary image (white lines on black background)
        horizontal_gap: Max horizontal gap to bridge (pixels). Default 15 works well
                       for typical scanned documents at 200 DPI (~2mm).
        vertical_gap: Max vertical gap to bridge (pixels).
    
    Returns:
        Preprocessed binary image with dotted lines converted to continuous lines.
    """
    result = binary.copy()
    
    # Close horizontal dotted lines: use wide horizontal kernel
    # Kernel width = gap to bridge, kernel height = 1 to stay horizontal
    if horizontal_gap > 0:
        h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horizontal_gap, 1))
        result = cv2.morphologyEx(result, cv2.MORPH_CLOSE, h_kernel, iterations=1)
    
    # Close vertical dotted lines: use tall vertical kernel
    if vertical_gap > 0:
        v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vertical_gap))
        result = cv2.morphologyEx(result, cv2.MORPH_CLOSE, v_kernel, iterations=1)
    
    return result


def detect_fields(file_path: str, mime_type: str, options: dict) -> list[dict[str, Any]]:
    """Main entry: returns suggestedFields[]."""
    img = load_image(file_path, mime_type)
    if img is None:
        return []

    page_h, page_w = img.shape[:2]
    logger.info(f"Image loaded: {page_w}x{page_h}")

    profile = sensitivity_profile(options or {})

    # Normalize detection resolution for stable line extraction on very large scans
    proc_img = img
    proc_scale = 1.0
    max_proc_w = int((options or {}).get("maxDetectWidth", 1800))
    if page_w > max_proc_w > 0:
        proc_scale = max_proc_w / page_w
        proc_h = max(1, int(round(page_h * proc_scale)))
        proc_img = cv2.resize(img, (max_proc_w, proc_h), interpolation=cv2.INTER_AREA)
        logger.info(f"Detection downscale applied: {page_w}x{page_h} -> {max_proc_w}x{proc_h}")

    # Try line-based grid detection first
    cells = detect_grid_cells(proc_img, profile, options)
    method = "grid"
    logger.info(f"Grid detection found {len(cells)} cells with profile: min_w={profile['min_w']}, min_h={profile['min_h']}, line_div={profile['line_div']}, close_iters={profile['close_iters']}")

    # Fallback to contour-based if grid yields too few
    if len(cells) < 3:
        cells2 = detect_rect_contours(proc_img, profile)
        logger.info(f"Contour fallback found {len(cells2)} cells")
        if len(cells2) > len(cells):
            cells = cells2
            method = "contour"

    # Scale coordinates to match the front-end rendering space.
    # The front-end now sends targetWidth/targetHeight to avoid hardcoded assumptions.
    target_w = options.get("targetWidth") if isinstance(options, dict) else None
    target_h = options.get("targetHeight") if isinstance(options, dict) else None

    try:
        target_w = float(target_w) if target_w is not None else None
        target_h = float(target_h) if target_h is not None else None
    except Exception:
        target_w = None
        target_h = None

    scale_x = (target_w / page_w) if target_w and page_w > 0 else 1.0
    scale_y = (target_h / page_h) if target_h and page_h > 0 else scale_x
    map_x = scale_x / proc_scale
    map_y = scale_y / proc_scale

    fields = []
    for (x, y, w, h) in cells:
        if w < profile["min_w"] or h < profile["min_h"]:
            continue

        ft = classify_cell(img, x, y, w, h)
        label = ""
        if ft == "text":
            label = ocr_region(img, x, y, w, h)

        fields.append({
            "id": str(uuid.uuid4()),
            "label": label or f"Zone {len(fields) + 1}",
            "x": round(x * map_x),
            "y": round(y * map_y),
            "w": round(w * map_x),
            "h": round(h * map_y),
            "type": ft,
            "confidence": 0.6,
        })

    logger.info(f"Detected {len(fields)} fields via {method} (from {len(cells)} raw cells)")
    return fields


def load_image(file_path: str, mime_type: str) -> np.ndarray | None:
    if mime_type == "application/pdf":
        try:
            from pdf2image import convert_from_path
            pages = convert_from_path(file_path, dpi=DPI, first_page=1, last_page=1)
            if pages:
                return cv2.cvtColor(np.array(pages[0]), cv2.COLOR_RGB2BGR)
        except Exception as e:
            logger.error(f"PDF conversion failed: {e}")
            return None
    else:
        img = cv2.imread(file_path)
        if img is not None:
            return img
        try:
            pil_img = Image.open(file_path).convert("RGB")
            return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
        except Exception as e:
            logger.error(f"Image load failed: {e}")
            return None


def detect_grid_cells(img: np.ndarray, profile: dict[str, Any], options: dict[str, Any] | None = None) -> list[tuple[int, int, int, int]]:
    """Detect cells by finding horizontal and vertical lines, then computing the grid."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Binary threshold — works well for scanned documents
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    # Preprocess dotted lines if enabled (converts dots/dashes to continuous lines)
    dotted_as_line = (options or {}).get("dottedAsLine", False)
    if dotted_as_line == True or dotted_as_line == "true" or dotted_as_line == 1:
        # Scan resolution is typically 200 DPI; default gap of 15px bridges ~2mm gaps
        h_gap = int((options or {}).get("dottedLineHGap", 15))
        v_gap = int((options or {}).get("dottedLineVGap", 15))
        logger.info(f"Preprocessing dotted lines: h_gap={h_gap}, v_gap={v_gap}")
        binary = preprocess_dotted_lines(binary, h_gap, v_gap)

    # === Horizontal lines ===
    h_len = max(w // int(profile["line_div"]), 24)
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (h_len, 1))
    h_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, h_kernel, iterations=1)
    # Thicken lines to bridge small gaps
    h_lines = cv2.dilate(h_lines, cv2.getStructuringElement(cv2.MORPH_RECT, (h_len // 2, 3)), iterations=1)

    # === Vertical lines ===
    v_len = max(h // int(profile["line_div"]), 24)
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, v_len))
    v_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, v_kernel, iterations=1)
    v_lines = cv2.dilate(v_lines, cv2.getStructuringElement(cv2.MORPH_RECT, (3, v_len // 2)), iterations=1)

    # Combine
    grid = cv2.add(h_lines, v_lines)

    # Close small gaps (sensitivity-dependent)
    # Use a horizontally-biased kernel to avoid connecting lines that are
    # vertically close (which would create excessively tall merged cells)
    # Kernel format: (height, width) - smaller height = less vertical connection
    close_iters = int(profile["close_iters"])
    grid = cv2.dilate(grid, np.ones((3, 5), np.uint8), iterations=close_iters)
    grid = cv2.erode(grid, np.ones((3, 3), np.uint8), iterations=max(1, close_iters - 1))

    # Invert: we want the white (empty) regions inside cells
    grid_inv = cv2.bitwise_not(grid)

    # Find connected components (cells are the white regions)
    contours, _ = cv2.findContours(grid_inv, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

    cells = []
    for cnt in contours:
        x, y, cw, ch = cv2.boundingRect(cnt)
        area_ratio = (cw * ch) / (w * h)
        if area_ratio > 0.8:
            continue
        if cw >= profile["min_w"] and ch >= profile["min_h"]:
            cells.append((x, y, cw, ch))

    cells = merge_overlapping(cells)
    return cells


def detect_rect_contours(img: np.ndarray, profile: dict[str, Any]) -> list[tuple[int, int, int, int]]:
    """Fallback: detect rectangular shapes via edge detection.
    
    Uses profile parameters:
    - min_w/min_h: Filter cells smaller than these dimensions
    
    Note: Currently uses fixed Canny thresholds (30, 100). Future improvement
    could make these sensitivity-dependent for more/less aggressive edge detection.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape

    # Use slightly adaptive Canny thresholds based on sensitivity
    # Higher sensitivity = lower thresholds = more edges detected
    base_low = 30
    base_high = 100
    sensitivity_factor = 1.0
    
    # Adjust thresholds based on close_iters as a proxy for sensitivity
    close_iters = profile.get("close_iters", 2)
    if close_iters >= 4:  # high sensitivity
        sensitivity_factor = 0.7  # Lower thresholds = more edges
    elif close_iters <= 1:  # low sensitivity
        sensitivity_factor = 1.5 # Higher thresholds = fewer edges
    
    low_thresh = int(base_low * sensitivity_factor)
    high_thresh = int(base_high * sensitivity_factor)
    
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blurred, low_thresh, high_thresh, apertureSize=3)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    edges = cv2.dilate(edges, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    cells = []
    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)

        if 4 <= len(approx) <= 8:
            x, y, cw, ch = cv2.boundingRect(approx)
            area_ratio = (cw * ch) / (w * h)
            if area_ratio >0.8:
                continue
            if cw >= profile["min_w"] and ch >= profile["min_h"]:
                cells.append((x, y, cw, ch))

    cells = merge_overlapping(cells)
    return cells


def classify_cell(img: np.ndarray, x: int, y: int, w: int, h: int) -> str:
    if w <= CHECKBOX_MAX and h <= CHECKBOX_MAX and 0.5 < w / h < 2.0:
        return "checkbox"
    return "text"


def ocr_region(img: np.ndarray, x: int, y: int, w: int, h: int) -> str:
    try:
        roi = img[y:y + h, x:x + w]
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        if w < 120 or h < 40:
            gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        text = pytesseract.image_to_string(gray, lang="fra+eng", config="--psm 7").strip()
        text = " ".join(text.split())[:50]
        return text
    except Exception:
        return ""


def merge_overlapping(boxes: list[tuple[int, int, int, int]], iou_thresh: float = 0.5) -> list[tuple[int, int, int, int]]:
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda b: b[2] * b[3], reverse=True)
    result = []
    for box in boxes:
        bx, by, bw, bh = box
        keep = True
        for rx, ry, rw, rh in result:
            ix = max(bx, rx)
            iy = max(by, ry)
            ix2 = min(bx + bw, rx + rw)
            iy2 = min(by + bh, ry + rh)
            if ix < ix2 and iy < iy2:
                inter = (ix2 - ix) * (iy2 - iy)
                area_b = bw * bh
                if inter / area_b > iou_thresh:
                    keep = False
                    break
        if keep:
            result.append(box)
    return result
