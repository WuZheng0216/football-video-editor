#!/usr/bin/env python3
"""
Football analysis CLI for Electron integration.

Supported operations:
- detect-players
- track-players
- magnifier-effect
- player-pov
- player-highlight
- auto-highlight
"""

from __future__ import annotations

import argparse
from bisect import bisect_left
import json
import math
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from player_detector import FrameResult, PlayerDetection, PlayerDetector
from player_tracker import PlayerTracker


def _json_print(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _clamp(value: int, min_v: int, max_v: int) -> int:
    return max(min_v, min(max_v, value))


def _clamp_float(value: float, min_v: float, max_v: float) -> float:
    return max(min_v, min(max_v, float(value)))


def _normalize_bbox(bbox: List[float], width: int, height: int) -> List[float]:
    x1, y1, x2, y2 = bbox
    x1 = float(_clamp(int(x1), 0, width - 1))
    y1 = float(_clamp(int(y1), 0, height - 1))
    x2 = float(_clamp(int(x2), 0, width - 1))
    y2 = float(_clamp(int(y2), 0, height - 1))
    return [x1, y1, x2, y2]


def _output_path(video_path: str, output_dir: str, suffix: str) -> str:
    video_stem = Path(video_path).stem
    return str(Path(output_dir) / f"{video_stem}_{suffix}.mp4")


def _window_bounds(args: argparse.Namespace, duration_hint: Optional[float] = None) -> Tuple[float, Optional[float], List[str]]:
    warnings: List[str] = []
    start = max(0.0, float(getattr(args, "start_time", 0.0) or 0.0))
    end_raw = getattr(args, "end_time", None)
    end = max(0.0, float(end_raw)) if end_raw is not None else None

    if end is not None and end < start:
        start, end = end, start
        warnings.append("start_time > end_time; swapped automatically.")

    if duration_hint is not None and duration_hint > 0:
        if start > duration_hint:
            start = duration_hint
            warnings.append("start_time exceeded duration and was clamped to video end.")
        if end is not None and end > duration_hint:
            end = duration_hint
            warnings.append("end_time exceeded duration and was clamped to video end.")

    return start, end, warnings


def _timestamp_in_window(timestamp: float, start: float, end: Optional[float]) -> bool:
    if timestamp < start:
        return False
    if end is not None and timestamp > end:
        return False
    return True


def _summary_payload(
    args: argparse.Namespace,
    operation: str,
    title: str,
    frames_processed: int,
    generated_items: int,
    warnings: Optional[List[str]] = None,
    output_path: Optional[str] = None,
    message: Optional[str] = None,
) -> Dict[str, Any]:
    scope = getattr(args, "scope", None) or ("selection" if getattr(args, "start_time", None) is not None or getattr(args, "end_time", None) is not None else "full")
    return {
        "operation": operation,
        "scope": scope,
        "title": title,
        "success": True,
        "framesProcessed": frames_processed,
        "generatedItems": generated_items,
        "warnings": list(warnings or []),
        "outputPath": output_path,
        "modelResolved": getattr(args, "model_path", None),
        "rangeStart": float(getattr(args, "start_time", 0.0) or 0.0),
        "rangeEnd": float(getattr(args, "end_time", 0.0) or 0.0) if getattr(args, "end_time", None) is not None else None,
        "message": message or f"{title} completed.",
    }


def _result_ok(operation: str, data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success": True,
        "operation": operation,
        **data,
    }


def _result_error(operation: str, message: str, details: Optional[str] = None) -> Dict[str, Any]:
    payload = {
        "success": False,
        "operation": operation,
        "error": message,
    }
    if details:
        payload["details"] = details
    return payload


def _pick_focus_detection(
    detections: List[PlayerDetection],
    focus_mode: str,
    preferred_player_id: Optional[int] = None,
) -> Optional[PlayerDetection]:
    if not detections:
        return None

    if focus_mode == "ball":
        balls = [d for d in detections if d.class_name == "sports ball"]
        if balls:
            return max(balls, key=lambda d: d.confidence)

    players = [d for d in detections if d.class_name == "person"]
    if not players:
        return None

    if preferred_player_id is not None:
        for det in players:
            if det.player_id == preferred_player_id:
                return det

    return max(players, key=lambda d: d.confidence)


def _bbox_center(bbox: List[float]) -> Tuple[int, int]:
    x1, y1, x2, y2 = bbox
    return int((x1 + x2) / 2), int((y1 + y2) / 2)


def _parse_manual_anchor(raw: Optional[str]) -> Optional[Tuple[float, float]]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    if text.startswith("["):
        try:
            arr = json.loads(text)
            if isinstance(arr, list) and len(arr) >= 2:
                return float(arr[0]), float(arr[1])
        except Exception:
            return None

    parts = [p.strip() for p in text.replace(";", ",").split(",")]
    if len(parts) < 2:
        return None
    try:
        return float(parts[0]), float(parts[1])
    except ValueError:
        return None


def _normalize_manual_anchor(
    anchor: Optional[Tuple[float, float]],
    width: int,
    height: int,
    warnings: List[str],
) -> Optional[Tuple[int, int]]:
    if anchor is None:
        return None

    x, y = anchor
    cx = _clamp(int(round(x)), 0, width - 1)
    cy = _clamp(int(round(y)), 0, height - 1)

    if abs(cx - x) > 1e-6 or abs(cy - y) > 1e-6:
        warnings.append("manualAnchor format invalid; ignored.")

    return cx, cy


def _parse_keyframes_json(raw: Optional[str], warnings: List[str]) -> List[Dict[str, Any]]:
    if raw is None:
        return []

    text = str(raw).strip()
    if not text:
        return []

    try:
        payload = json.loads(text)
    except Exception:
        warnings.append("keyframesJson is not valid JSON; ignored.")
        return []

    if not isinstance(payload, list):
        warnings.append("keyframesJson must be a JSON array; ignored.")
        return []

    keyframes: List[Dict[str, Any]] = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            warnings.append(f"keyframesJson[{index}] is not an object; skipped.")
            continue

        try:
            time_value = float(item["time"])
            x_value = float(item["x"])
            y_value = float(item["y"])
        except Exception:
            warnings.append(f"keyframesJson[{index}] missing time/x/y; skipped.")
            continue

        direction_raw = item.get("directionDeg")
        direction_deg = None
        if direction_raw is not None:
            try:
                direction_candidate = float(direction_raw)
                if math.isfinite(direction_candidate):
                    direction_deg = direction_candidate
            except Exception:
                direction_deg = None
        source = str(item.get("source") or "manual")

        keyframes.append(
            {
                "time": max(0.0, time_value),
                "x": x_value,
                "y": y_value,
                "directionDeg": direction_deg,
                "source": source,
            }
        )

    keyframes.sort(key=lambda item: item["time"])
    return keyframes


def _interpolate_keyframe(keyframes: List[Dict[str, Any]], timestamp: float) -> Optional[Dict[str, Any]]:
    if not keyframes:
        return None

    if timestamp <= keyframes[0]["time"]:
        return dict(keyframes[0])
    if timestamp >= keyframes[-1]["time"]:
        return dict(keyframes[-1])

    for idx in range(len(keyframes) - 1):
        current = keyframes[idx]
        next_item = keyframes[idx + 1]
        if timestamp < current["time"] or timestamp > next_item["time"]:
            continue

        ratio = (timestamp - current["time"]) / max(1e-6, next_item["time"] - current["time"])
        direction_deg = None
        if current.get("directionDeg") is not None and next_item.get("directionDeg") is not None:
            direction_deg = float(current["directionDeg"]) + (float(next_item["directionDeg"]) - float(current["directionDeg"])) * ratio
        elif current.get("directionDeg") is not None:
            direction_deg = float(current["directionDeg"])
        elif next_item.get("directionDeg") is not None:
            direction_deg = float(next_item["directionDeg"])

        return {
            "time": float(timestamp),
            "x": float(current["x"]) + (float(next_item["x"]) - float(current["x"])) * ratio,
            "y": float(current["y"]) + (float(next_item["y"]) - float(current["y"])) * ratio,
            "directionDeg": direction_deg,
            "source": current.get("source") or next_item.get("source") or "manual",
        }

    return dict(keyframes[-1])


def _anchor_from_keyframe(
    keyframe: Optional[Dict[str, Any]],
    width: int,
    height: int,
) -> Optional[Tuple[int, int]]:
    if not keyframe:
        return None
    return (
        _clamp(int(round(float(keyframe["x"]))), 0, width - 1),
        _clamp(int(round(float(keyframe["y"]))), 0, height - 1),
    )


def _direction_from_keyframe(keyframe: Optional[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    if not keyframe or keyframe.get("directionDeg") is None:
        return None
    return _angle_to_vector(float(keyframe["directionDeg"]))


def _angle_to_vector(angle_deg: float) -> Tuple[float, float]:
    rad = math.radians(angle_deg)
    return math.cos(rad), math.sin(rad)


def _vector_to_angle(direction: Tuple[float, float]) -> float:
    return math.degrees(math.atan2(direction[1], direction[0]))


def _resolve_control_value(
    control_mode: str,
    auto_value: Optional[Any],
    manual_value: Optional[Any],
) -> Tuple[Optional[Any], str]:
    if control_mode == "manual":
        if manual_value is not None:
            return manual_value, "manual"
        if auto_value is not None:
            return auto_value, "ai"
        return None, "none"

    if control_mode == "auto":
        if auto_value is not None:
            return auto_value, "ai"
        return None, "none"

    # hybrid: manual priority, then ai
    if manual_value is not None:
        return manual_value, "manual"
    if auto_value is not None:
        return auto_value, "ai"
    return None, "none"


def _build_magnifier_mask(radius: int, feather: float) -> np.ndarray:
    diameter = radius * 2
    mask = np.zeros((diameter, diameter), dtype=np.float32)
    inner_radius = max(4, int(radius - max(0.0, feather) * 1.6))
    cv2.circle(mask, (radius, radius), inner_radius, 1.0, -1, cv2.LINE_AA)

    sigma = max(0.0, float(feather))
    if sigma > 0.01:
        mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=sigma, sigmaY=sigma)
    return np.clip(mask, 0.0, 1.0)[..., None]


def _draw_magnifier(
    frame: np.ndarray,
    center: Tuple[int, int],
    radius: int,
    zoom: float,
    feather: float,
) -> np.ndarray:
    h, w = frame.shape[:2]
    cx, cy = center
    radius = max(20, int(radius))
    zoom = max(1.0, float(zoom))
    feather = _clamp_float(feather, 0.0, 64.0)

    source_radius = max(10, int(radius / zoom))
    x1 = _clamp(cx - source_radius, 0, w - 1)
    y1 = _clamp(cy - source_radius, 0, h - 1)
    x2 = _clamp(cx + source_radius, 0, w - 1)
    y2 = _clamp(cy + source_radius, 0, h - 1)

    if x2 <= x1 or y2 <= y1:
        return frame

    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return frame

    magnified = cv2.resize(roi, (radius * 2, radius * 2), interpolation=cv2.INTER_CUBIC)

    overlay = frame.copy()
    dx1 = _clamp(cx - radius, 0, w)
    dy1 = _clamp(cy - radius, 0, h)
    dx2 = _clamp(cx + radius, 0, w)
    dy2 = _clamp(cy + radius, 0, h)

    if dx2 <= dx1 or dy2 <= dy1:
        return frame

    zx1 = dx1 - (cx - radius)
    zy1 = dy1 - (cy - radius)
    zx2 = zx1 + (dx2 - dx1)
    zy2 = zy1 + (dy2 - dy1)

    zoom_crop = magnified[zy1:zy2, zx1:zx2]
    mask = _build_magnifier_mask(radius, feather)[zy1:zy2, zx1:zx2]
    base = overlay[dy1:dy2, dx1:dx2].astype(np.float32)
    mixed = (zoom_crop.astype(np.float32) * mask + base * (1.0 - mask)).astype(np.uint8)
    overlay[dy1:dy2, dx1:dx2] = mixed

    cv2.circle(overlay, (cx, cy), radius, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(
        overlay,
        f"x{zoom:.1f}",
        (_clamp(cx + radius + 10, 0, w - 80), _clamp(cy - radius - 10, 20, h - 20)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return overlay


def _draw_pov(
    frame: np.ndarray,
    center: Tuple[int, int],
    direction: Tuple[float, float],
    aperture_deg: float,
    length: float,
    dim: float,
) -> np.ndarray:
    h, w = frame.shape[:2]
    cx, cy = center
    vx, vy = direction
    norm = max(1e-5, math.hypot(vx, vy))
    ux, uy = vx / norm, vy / norm

    aperture_deg = _clamp_float(aperture_deg, 10.0, 170.0)
    length = _clamp_float(length, 40.0, float(max(w, h) * 2.0))
    dim = _clamp_float(dim, 0.0, 0.95)

    direction_deg = _vector_to_angle((ux, uy))
    half = aperture_deg / 2.0

    points = [(cx, cy)]
    for delta in np.linspace(-half, half, 48):
        rad = math.radians(direction_deg + float(delta))
        px = _clamp(int(round(cx + length * math.cos(rad))), 0, w - 1)
        py = _clamp(int(round(cy + length * math.sin(rad))), 0, h - 1)
        points.append((px, py))

    mask = np.zeros((h, w), dtype=np.float32)
    cv2.fillConvexPoly(mask, np.array(points, dtype=np.int32), 1.0, cv2.LINE_AA)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=2.0, sigmaY=2.0)
    mask = np.clip(mask, 0.0, 1.0)[..., None]

    darkened = (frame.astype(np.float32) * (1.0 - dim)).astype(np.uint8)
    mixed = (frame.astype(np.float32) * mask + darkened.astype(np.float32) * (1.0 - mask)).astype(np.uint8)

    p0 = (cx, cy)
    p_first = points[1]
    p_last = points[-1]
    cv2.line(mixed, p0, p_first, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.line(mixed, p0, p_last, (0, 255, 255), 2, cv2.LINE_AA)
    cv2.polylines(mixed, [np.array(points[1:], dtype=np.int32)], False, (0, 255, 255), 2, cv2.LINE_AA)
    tip = (
        _clamp(int(round(cx + ux * (length + 24))), 0, w - 1),
        _clamp(int(round(cy + uy * (length + 24))), 0, h - 1),
    )
    cv2.arrowedLine(mixed, p0, tip, (0, 255, 255), 2, cv2.LINE_AA, tipLength=0.2)
    cv2.putText(
        mixed,
        "POV",
        (_clamp(cx + 8, 0, w - 60), _clamp(cy - 8, 20, h - 20)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return mixed


def _draw_player_highlight(
    frame: np.ndarray,
    sample: Dict[str, Any],
    outline_width: float,
    glow_strength: float,
    fill_opacity: float,
    show_label: bool,
    label_text: str,
) -> np.ndarray:
    bbox = sample.get("bbox") or [0.0, 0.0, 0.0, 0.0]
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in _normalize_bbox([float(v) for v in bbox], w, h)]
    if x2 <= x1 or y2 <= y1:
        return frame

    color_hex = sample.get("displayColor") or "#00d4ff"
    color_rgb = tuple(int(color_hex[index : index + 2], 16) for index in (1, 3, 5)) if isinstance(color_hex, str) and len(color_hex) == 7 else (0, 212, 255)
    color_bgr = (color_rgb[2], color_rgb[1], color_rgb[0])
    outline_px = max(1, int(round(outline_width)))
    glow_px = max(outline_px + 2, int(round(outline_width + glow_strength * 3.0)))

    glow = frame.copy()
    cv2.rectangle(glow, (x1, y1), (x2, y2), color_bgr, glow_px, cv2.LINE_AA)
    frame = cv2.addWeighted(glow, min(0.85, 0.18 + glow_strength * 0.12), frame, 1.0, 0)

    if fill_opacity > 1e-4:
        fill = frame.copy()
        cv2.rectangle(fill, (x1, y1), (x2, y2), color_bgr, -1, cv2.LINE_AA)
        frame = cv2.addWeighted(fill, min(0.75, fill_opacity), frame, 1.0 - min(0.75, fill_opacity), 0)

    cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), outline_px, cv2.LINE_AA)
    if show_label:
        label = label_text or f"#{sample.get('trackId', '?')}"
        label_scale = 0.55
        label_thickness = 2
        text_size, baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, label_scale, label_thickness)
        label_x = max(0, min(w - text_size[0] - 10, x1))
        label_y = max(text_size[1] + 8, y1 - 8)
        cv2.rectangle(
            frame,
            (label_x, label_y - text_size[1] - baseline - 6),
            (label_x + text_size[0] + 8, label_y + 4),
            color_bgr,
            -1,
            cv2.LINE_AA,
        )
        cv2.putText(
            frame,
            label,
            (label_x + 4, label_y - 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            label_scale,
            (255, 255, 255),
            label_thickness,
            cv2.LINE_AA,
        )
    return frame


def _new_detector(conf_threshold: float, model_path: Optional[str]) -> PlayerDetector:
    detector = PlayerDetector(model_path=model_path)
    detector.conf_threshold = conf_threshold
    return detector


def _target_class_from_name(class_name: str) -> Optional[str]:
    if class_name == "person":
        return "player"
    if class_name == "sports ball":
        return "ball"
    return None


def _bgr_to_hex(color: np.ndarray) -> str:
    b, g, r = [int(_clamp(int(round(float(value))), 0, 255)) for value in color[:3]]
    return f"#{r:02x}{g:02x}{b:02x}"


def _estimate_grass_hsv(frame: np.ndarray) -> Optional[np.ndarray]:
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    lower = np.array([30, 40, 40], dtype=np.uint8)
    upper = np.array([80, 255, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower, upper)
    if cv2.countNonZero(mask) == 0:
        return None
    return np.array(cv2.mean(hsv, mask=mask)[:3], dtype=np.float32)


def _sample_jersey_color(
    frame: np.ndarray,
    bbox: List[float],
    grass_hsv: Optional[np.ndarray],
) -> Optional[np.ndarray]:
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in _normalize_bbox(bbox, width, height)]
    if x2 <= x1 or y2 <= y1:
        return None

    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None

    upper = crop[: max(1, crop.shape[0] // 2), :]
    hsv = cv2.cvtColor(upper, cv2.COLOR_BGR2HSV)
    mask = np.full(upper.shape[:2], 255, dtype=np.uint8)

    if grass_hsv is not None:
        grass_h = int(round(float(grass_hsv[0])))
        lower_h = max(0, grass_h - 12)
        upper_h = min(179, grass_h + 12)
        grass_mask = cv2.inRange(
            hsv,
            np.array([lower_h, 30, 30], dtype=np.uint8),
            np.array([upper_h, 255, 255], dtype=np.uint8),
        )
        mask = cv2.bitwise_and(mask, cv2.bitwise_not(grass_mask))

    sat_mask = np.where(hsv[:, :, 1] > 25, 255, 0).astype(np.uint8)
    val_mask = np.where(hsv[:, :, 2] > 20, 255, 0).astype(np.uint8)
    mask = cv2.bitwise_and(mask, sat_mask)
    mask = cv2.bitwise_and(mask, val_mask)

    if cv2.countNonZero(mask) < 25:
        mask = np.full(upper.shape[:2], 255, dtype=np.uint8)

    color = np.array(cv2.mean(upper, mask=mask)[:3], dtype=np.float32)
    if not np.isfinite(color).all():
        return None
    return color


def _cluster_track_team_meta(track_color_samples: Dict[int, List[np.ndarray]]) -> Dict[int, Dict[str, Any]]:
    track_means: Dict[int, np.ndarray] = {
        track_id: np.mean(np.stack(samples, axis=0), axis=0)
        for track_id, samples in track_color_samples.items()
        if samples
    }
    if not track_means:
        return {}

    track_ids = list(track_means.keys())
    colors = np.array([track_means[track_id] for track_id in track_ids], dtype=np.float32)

    if len(track_ids) == 1 or len(np.unique(np.round(colors).astype(np.int32), axis=0)) < 2:
        center = np.mean(colors, axis=0)
        return {
            track_id: {
                "teamCluster": 0,
                "teamLabel": "Team A",
                "displayColor": _bgr_to_hex(center),
                "jerseyColor": [round(float(v), 2) for v in track_means[track_id].tolist()],
            }
            for track_id in track_ids
        }

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _compactness, labels, centers = cv2.kmeans(colors, 2, None, criteria, 5, cv2.KMEANS_PP_CENTERS)
    centers = centers.astype(np.float32)
    center_order = sorted(range(len(centers)), key=lambda idx: tuple(float(v) for v in centers[idx]))
    cluster_remap = {old_idx: new_idx for new_idx, old_idx in enumerate(center_order)}

    meta: Dict[int, Dict[str, Any]] = {}
    for index, track_id in enumerate(track_ids):
        raw_cluster = int(labels[index][0])
        stable_cluster = cluster_remap[raw_cluster]
        center = centers[raw_cluster]
        meta[track_id] = {
            "teamCluster": stable_cluster,
            "teamLabel": f"Team {'AB'[stable_cluster]}",
            "displayColor": _bgr_to_hex(center),
            "jerseyColor": [round(float(v), 2) for v in track_means[track_id].tolist()],
        }
    return meta


def _build_detect_targets(samples: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    ranked = sorted(samples, key=lambda item: item.get("confidence", 0.0), reverse=True)
    targets: List[Dict[str, Any]] = []
    for index, sample in enumerate(ranked[:limit]):
        target_class = _target_class_from_name(str(sample.get("className", "")))
        if target_class is None:
            continue
        targets.append(
            {
                "id": sample.get("id") or f"detect_{index}",
                "label": "足球" if target_class == "ball" else f"候选球员 {index + 1}",
                "class": target_class,
                "confidence": float(sample.get("confidence", 0.0)),
                "bbox": sample.get("bbox"),
                "sampleTime": float(sample.get("timestamp", 0.0)),
                "source": "detect",
            }
        )
    return targets


def _build_track_targets(
    track_samples: List[Dict[str, Any]],
    limit: int,
    track_team_meta: Optional[Dict[int, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for sample in track_samples:
        track_id = sample.get("trackId")
        if isinstance(track_id, int):
            grouped.setdefault(track_id, []).append(sample)

    targets: List[Dict[str, Any]] = []
    for track_id, samples in grouped.items():
        ordered = sorted(samples, key=lambda item: float(item.get("timestamp", 0.0)))
        latest = ordered[-1]
        confidences = [float(item.get("confidence", 0.0)) for item in ordered]
        team_meta = (track_team_meta or {}).get(track_id, {})
        targets.append(
            {
                "id": f"track_{track_id}",
                "label": f"球员 #{track_id}",
                "class": "player",
                "trackId": track_id,
                "confidence": float(np.mean(confidences)) if confidences else 0.0,
                "appearances": len(ordered),
                "firstTimestamp": float(ordered[0].get("timestamp", 0.0)),
                "lastTimestamp": float(latest.get("timestamp", 0.0)),
                "latestBBox": latest.get("bbox"),
                "source": "track",
                "teamCluster": team_meta.get("teamCluster"),
                "teamLabel": team_meta.get("teamLabel"),
                "displayColor": team_meta.get("displayColor"),
                "jerseyColor": team_meta.get("jerseyColor"),
            }
        )

    targets.sort(key=lambda item: (item["appearances"], item["confidence"]), reverse=True)
    return targets[:limit]


def _sample_center(sample: Dict[str, Any]) -> Tuple[float, float]:
    center = sample.get("center")
    if isinstance(center, (list, tuple)) and len(center) >= 2:
        try:
            return float(center[0]), float(center[1])
        except Exception:
            pass
    bbox = sample.get("bbox") or [0.0, 0.0, 0.0, 0.0]
    return (float(bbox[0]) + float(bbox[2])) / 2.0, (float(bbox[1]) + float(bbox[3])) / 2.0


def _moving_average_centers(samples: List[Dict[str, Any]], radius: int = 2) -> None:
    if not samples:
        return
    raw_centers = [_sample_center(sample) for sample in samples]
    for index, sample in enumerate(samples):
        start = max(0, index - radius)
        end = min(len(samples), index + radius + 1)
        window = raw_centers[start:end]
        mean_x = float(sum(point[0] for point in window) / len(window))
        mean_y = float(sum(point[1] for point in window) / len(window))
        sample["center"] = [round(mean_x, 2), round(mean_y, 2)]


def _track_quality(samples: List[Dict[str, Any]]) -> Dict[str, float]:
    ordered = sorted(samples, key=lambda item: (float(item.get("timestamp", 0.0)), int(item.get("frame", 0))))
    if not ordered:
        return {"trackSpan": 0.0, "visibleRatio": 0.0, "avgConfidence": 0.0}
    first = ordered[0]
    last = ordered[-1]
    confidences = [float(item.get("confidence", 0.0)) for item in ordered]
    frame_span = max(1, int(last.get("frame", 0)) - int(first.get("frame", 0)) + 1)
    return {
        "trackSpan": round(max(0.0, float(last.get("timestamp", 0.0)) - float(first.get("timestamp", 0.0))), 3),
        "visibleRatio": round(len(ordered) / frame_span, 4),
        "avgConfidence": round(float(np.mean(confidences)) if confidences else 0.0, 4),
    }


def _track_is_stable(samples: List[Dict[str, Any]], fps: float) -> bool:
    if not samples:
        return False
    quality = _track_quality(samples)
    min_appearances = max(5, int(round(max(1.0, fps) * 0.2)))
    min_span = max(0.35, min_appearances / max(1.0, fps))
    return (
        len(samples) >= min_appearances
        and quality["trackSpan"] >= min_span
        and quality["visibleRatio"] >= 0.12
        and quality["avgConfidence"] >= 0.12
    )


def _build_track_structures(
    track_samples: List[Dict[str, Any]],
    fps: float,
    limit: int,
    track_team_meta: Optional[Dict[int, Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[int, List[Dict[str, Any]]]]:
    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for sample in track_samples:
        track_id = sample.get("trackId")
        if isinstance(track_id, int):
            grouped.setdefault(track_id, []).append(sample)

    valid_grouped: Dict[int, List[Dict[str, Any]]] = {}
    tracks_payload: List[Dict[str, Any]] = []
    targets_payload: List[Dict[str, Any]] = []
    for track_id, samples in grouped.items():
        ordered = sorted(samples, key=lambda item: (float(item.get("timestamp", 0.0)), int(item.get("frame", 0))))
        _moving_average_centers(ordered)
        if not _track_is_stable(ordered, fps):
            continue

        valid_grouped[track_id] = ordered
        quality = _track_quality(ordered)
        latest = ordered[-1]
        centers = [_sample_center(sample) for sample in ordered]
        path_length = 0.0
        for index in range(1, len(centers)):
            x1, y1 = centers[index - 1]
            x2, y2 = centers[index]
            path_length += float(math.hypot(x2 - x1, y2 - y1))
        team_meta = (track_team_meta or {}).get(track_id, {})
        track_info = {
            "trackId": track_id,
            "appearances": len(ordered),
            "firstFrame": int(ordered[0].get("frame", 0)),
            "lastFrame": int(latest.get("frame", 0)),
            "firstTimestamp": float(ordered[0].get("timestamp", 0.0)),
            "lastTimestamp": float(latest.get("timestamp", 0.0)),
            "trackSpan": quality["trackSpan"],
            "visibleRatio": quality["visibleRatio"],
            "avgConfidence": quality["avgConfidence"],
            "pathLength": round(path_length, 2),
            "latestBbox": latest.get("bbox"),
            "latestCenter": latest.get("center"),
            **team_meta,
        }
        tracks_payload.append(track_info)
        targets_payload.append(
            {
                "id": f"track_{track_id}",
                "label": f"球员 #{track_id}",
                "class": "player",
                "trackId": track_id,
                "confidence": quality["avgConfidence"],
                "appearances": len(ordered),
                "firstTimestamp": float(ordered[0].get("timestamp", 0.0)),
                "lastTimestamp": float(latest.get("timestamp", 0.0)),
                "trackSpan": quality["trackSpan"],
                "visibleRatio": quality["visibleRatio"],
                "avgConfidence": quality["avgConfidence"],
                "latestBBox": latest.get("bbox"),
                "sampleTime": float(latest.get("timestamp", 0.0)),
                "source": "track",
                "teamCluster": team_meta.get("teamCluster"),
                "teamLabel": team_meta.get("teamLabel"),
                "displayColor": team_meta.get("displayColor"),
                "jerseyColor": team_meta.get("jerseyColor"),
            }
        )

    tracks_payload.sort(key=lambda item: (item["appearances"], item["avgConfidence"], item["trackSpan"]), reverse=True)
    targets_payload.sort(key=lambda item: (item["appearances"], item["avgConfidence"], item["trackSpan"]), reverse=True)
    limited_ids = {int(item["trackId"]) for item in tracks_payload[:limit]}
    limited_grouped = {track_id: samples for track_id, samples in valid_grouped.items() if track_id in limited_ids}
    return tracks_payload[:limit], targets_payload[:limit], limited_grouped


def _parse_json_list(raw: Optional[str], warnings: List[str], label: str, file_path: Optional[str] = None) -> List[Any]:
    if file_path:
        try:
            text = Path(file_path).read_text(encoding="utf-8")
        except Exception:
            warnings.append(f"{label} file could not be read; ignored.")
            return []
    elif raw is None:
        return []
    else:
        text = str(raw).strip()
    if not text:
        return []
    try:
        payload = json.loads(text)
    except Exception:
        warnings.append(f"{label} is not valid JSON; ignored.")
        return []
    if not isinstance(payload, list):
        warnings.append(f"{label} must be a JSON array; ignored.")
        return []
    return payload


def _build_track_index(track_samples: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    grouped: Dict[int, List[Dict[str, Any]]] = {}
    for sample in track_samples:
        track_id = sample.get("trackId")
        if isinstance(track_id, int):
            grouped.setdefault(track_id, []).append(sample)
    index: Dict[int, Dict[str, Any]] = {}
    for track_id, samples in grouped.items():
        ordered = sorted(samples, key=lambda item: (float(item.get("timestamp", 0.0)), int(item.get("frame", 0))))
        index[track_id] = {
            "times": [float(item.get("timestamp", 0.0)) for item in ordered],
            "samples": ordered,
        }
    return index


def _resolve_track_sample(
    track_index: Dict[int, Dict[str, Any]],
    track_id: int,
    timestamp: float,
    exact_tolerance: float = 0.14,
    interpolate_gap: float = 0.4,
) -> Optional[Dict[str, Any]]:
    entry = track_index.get(track_id)
    if not entry:
        return None
    times: List[float] = entry["times"]
    samples: List[Dict[str, Any]] = entry["samples"]
    if not times:
        return None

    position = bisect_left(times, timestamp)
    candidates: List[Tuple[float, Dict[str, Any]]] = []
    if position < len(samples):
        candidates.append((abs(times[position] - timestamp), samples[position]))
    if position > 0:
        candidates.append((abs(times[position - 1] - timestamp), samples[position - 1]))
    if candidates:
        delta, sample = min(candidates, key=lambda item: item[0])
        if delta <= exact_tolerance:
            return sample

    if 0 < position < len(samples):
        prev_sample = samples[position - 1]
        next_sample = samples[position]
        prev_time = times[position - 1]
        next_time = times[position]
        gap = next_time - prev_time
        if 1e-6 < gap <= interpolate_gap and prev_time <= timestamp <= next_time:
            ratio = (timestamp - prev_time) / gap
            prev_bbox = prev_sample.get("bbox") or [0.0, 0.0, 0.0, 0.0]
            next_bbox = next_sample.get("bbox") or [0.0, 0.0, 0.0, 0.0]
            bbox = [
                round(float(prev_bbox[index]) + (float(next_bbox[index]) - float(prev_bbox[index])) * ratio, 2)
                for index in range(4)
            ]
            sample = dict(prev_sample)
            sample["timestamp"] = float(timestamp)
            sample["bbox"] = bbox
            sample["center"] = [round((bbox[0] + bbox[2]) / 2.0, 2), round((bbox[1] + bbox[3]) / 2.0, 2)]
            sample["interpolated"] = True
            return sample

    return None


def detect_players(args: argparse.Namespace) -> Dict[str, Any]:
    detector = _new_detector(args.confidence, args.model_path)
    args.model_path = getattr(detector, "resolved_model_path", args.model_path)
    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        return _result_error("detect-players", f"Cannot open video: {args.video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_hint = (total_frames / fps) if fps > 0 and total_frames > 0 else None
    start_time, end_time, warnings = _window_bounds(args, duration_hint)

    output_video = None
    writer = None
    if args.write_video:
        output_video = _output_path(args.video_path, args.output_dir, "detected")
        writer = cv2.VideoWriter(output_video, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    processed_results: List[FrameResult] = []
    detection_samples: List[Dict[str, Any]] = []
    players_flat: List[Dict[str, Any]] = []
    confidences: List[float] = []
    processed_frames = 0
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        timestamp = frame_idx / fps
        in_window = _timestamp_in_window(timestamp, start_time, end_time)
        can_process = in_window and (args.max_frames is None or processed_frames < args.max_frames)
        output_frame = frame

        if can_process:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_result = detector.detect_frame(rgb)
            frame_result.frame_index = frame_idx
            frame_result.timestamp = timestamp
            frame_result.detections = [
                PlayerDetection(
                    bbox=_normalize_bbox(d.bbox, width, height),
                    confidence=d.confidence,
                    class_id=d.class_id,
                    class_name=d.class_name,
                    team=d.team,
                    player_id=d.player_id,
                )
                for d in frame_result.detections
            ]
            processed_results.append(frame_result)
            processed_frames += 1

            for det in frame_result.detections:
                sample = {
                    "id": f"detect_{frame_result.frame_index}_{len(detection_samples)}",
                    "frame": frame_result.frame_index,
                    "timestamp": frame_result.timestamp,
                    "confidence": det.confidence,
                    "bbox": [round(x, 2) for x in det.bbox],
                    "className": det.class_name,
                }
                detection_samples.append(sample)

                if det.class_name != "person":
                    continue
                players_flat.append(sample)
                confidences.append(det.confidence)

            if writer is not None:
                output_frame = detector._visualize_detections(frame.copy(), frame_result)

        if writer is not None:
            writer.write(output_frame)

        frame_idx += 1

    cap.release()
    if writer is not None:
        writer.release()

    stats = detector.analyze_detection_statistics(processed_results)
    targets = _build_detect_targets(detection_samples, args.max_output_items)
    return _result_ok(
        "detect-players",
        {
            "players": players_flat,
            "detectionSamples": players_flat,
            "playersTotal": len(players_flat),
            "detectionSamplesTotal": len(players_flat),
            "targets": targets,
            "framesProcessed": processed_frames,
            "averageConfidence": float(np.mean(confidences)) if confidences else 0.0,
            "statistics": stats,
            "warnings": warnings,
            "summary": _summary_payload(
                args,
                "detect-players",
                "Player Detection",
                processed_frames,
                len(players_flat),
                warnings,
                output_video,
                f"Detected {len(targets)} candidate targets.",
            ),
            "artifacts": {
                "annotatedVideo": output_video,
            },
        },
    )


def track_players(args: argparse.Namespace) -> Dict[str, Any]:
    detector = _new_detector(args.confidence, args.model_path)
    args.model_path = getattr(detector, "resolved_model_path", args.model_path)

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        return _result_error("track-players", f"Cannot open video: {args.video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_hint = (total_frames / fps) if fps > 0 and total_frames > 0 else None
    start_time, end_time, warnings = _window_bounds(args, duration_hint)

    output_video = None
    writer = None
    if args.write_video:
        output_video = _output_path(args.video_path, args.output_dir, "tracked")
        writer = cv2.VideoWriter(output_video, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    tracker_config = "botsort.yaml"
    tracker_type = "BoT-SORT"
    tracking_backend = "ultralytics-botsort"
    frame_idx = 0
    processed_frames = 0
    track_samples: List[Dict[str, Any]] = []
    grass_hsv: Optional[np.ndarray] = None
    track_color_samples: Dict[int, List[np.ndarray]] = {}

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        timestamp = frame_idx / fps
        in_window = _timestamp_in_window(timestamp, start_time, end_time)
        can_process = in_window and (args.max_frames is None or processed_frames < args.max_frames)
        output_frame = frame

        if can_process:
            if grass_hsv is None or processed_frames % 60 == 0:
                grass_hsv = _estimate_grass_hsv(frame)

            try:
                results = detector.model.track(
                    frame,
                    conf=detector.conf_threshold,
                    iou=detector.iou_threshold,
                    classes=[0],
                    persist=True,
                    tracker=tracker_config,
                    verbose=False,
                    device=detector.device,
                )
            except Exception as tracking_error:
                if tracker_config != "bytetrack.yaml":
                    warnings.append(f"BoT-SORT unavailable, fell back to ByteTrack: {tracking_error}")
                    tracker_config = "bytetrack.yaml"
                    tracker_type = "ByteTrack"
                    tracking_backend = "ultralytics-bytetrack"
                    results = detector.model.track(
                        frame,
                        conf=detector.conf_threshold,
                        iou=detector.iou_threshold,
                        classes=[0],
                        persist=True,
                        tracker=tracker_config,
                        verbose=False,
                        device=detector.device,
                    )
                else:
                    cap.release()
                    if writer is not None:
                        writer.release()
                    return _result_error("track-players", f"Tracking failed: {tracking_error}")

            processed_frames += 1
            result = results[0] if results else None
            boxes = result.boxes if result is not None else None
            ids = boxes.id.int().cpu().tolist() if boxes is not None and boxes.id is not None else []
            xyxy = boxes.xyxy.cpu().numpy().tolist() if boxes is not None and boxes.xyxy is not None else []
            confidences = boxes.conf.cpu().numpy().tolist() if boxes is not None and boxes.conf is not None else []
            class_ids = boxes.cls.int().cpu().tolist() if boxes is not None and boxes.cls is not None else []

            for index, track_id in enumerate(ids):
                class_id = int(class_ids[index]) if index < len(class_ids) else 0
                if class_id != 0:
                    continue
                bbox = _normalize_bbox(list(xyxy[index]), width, height)
                jersey_color = _sample_jersey_color(frame, bbox, grass_hsv)
                if jersey_color is not None:
                    track_color_samples.setdefault(int(track_id), []).append(jersey_color)
                center_x = (float(bbox[0]) + float(bbox[2])) / 2.0
                center_y = (float(bbox[1]) + float(bbox[3])) / 2.0
                sample_payload = {
                    "frame": frame_idx,
                    "timestamp": round(float(timestamp), 4),
                    "trackId": int(track_id),
                    "confidence": round(float(confidences[index]) if index < len(confidences) else 0.0, 4),
                    "bbox": [round(float(v), 2) for v in bbox],
                    "center": [round(center_x, 2), round(center_y, 2)],
                }
                if jersey_color is not None:
                    sample_payload["jerseyColor"] = [round(float(v), 2) for v in jersey_color.tolist()]
                track_samples.append(sample_payload)

            if writer is not None and result is not None:
                output_frame = result.plot()

        if writer is not None:
            writer.write(output_frame)

        frame_idx += 1

    cap.release()
    if writer is not None:
        writer.release()

    team_meta = _cluster_track_team_meta(track_color_samples)
    for sample in track_samples:
        sample_meta = team_meta.get(int(sample.get("trackId", -1)))
        if sample_meta:
            sample.update(sample_meta)

    tracks_payload, targets, valid_track_index = _build_track_structures(
        track_samples,
        fps,
        args.max_output_items,
        team_meta,
    )
    valid_ids = set(valid_track_index.keys())
    filtered_samples = [sample for sample in track_samples if int(sample.get("trackId", -1)) in valid_ids]

    return _result_ok(
        "track-players",
        {
            "tracks": tracks_payload,
            "tracksTotal": len(tracks_payload),
            "trackSamples": filtered_samples,
            "trackSamplesTotal": len(filtered_samples),
            "targets": targets,
            "framesProcessed": processed_frames,
            "warnings": warnings,
            "trackingBackend": tracking_backend,
            "trackerType": tracker_type,
            "modelResolved": args.model_path,
            "summary": _summary_payload(
                args,
                "track-players",
                "Multi-Object Tracking",
                processed_frames,
                len(filtered_samples),
                warnings,
                output_video,
                f"Tracked {len(targets)} stable player targets with {tracker_type}.",
            ),
            "artifacts": {
                "trackedVideo": output_video,
            },
        },
    )


def magnifier_effect(args: argparse.Namespace) -> Dict[str, Any]:
    detector = _new_detector(args.confidence, args.model_path)
    args.model_path = getattr(detector, "resolved_model_path", args.model_path)
    tracker = PlayerTracker(max_age=args.max_age, min_hits=2)

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        return _result_error("magnifier-effect", f"Cannot open video: {args.video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_hint = (total_frames / fps) if fps > 0 and total_frames > 0 else None
    start_time, end_time, range_warnings = _window_bounds(args, duration_hint)
    output_video = _output_path(args.video_path, args.output_dir, "magnifier")
    writer = cv2.VideoWriter(output_video, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    warnings: List[str] = list(range_warnings)
    raw_manual_anchor = _parse_manual_anchor(args.manual_anchor)
    if args.manual_anchor and raw_manual_anchor is None:
        warnings.append("manualAnchor format invalid; ignored.")
    manual_anchor = _normalize_manual_anchor(raw_manual_anchor, width, height, warnings)
    keyframes = _parse_keyframes_json(getattr(args, "keyframes_json", None), warnings)

    radius = int(_clamp(args.magnifier_radius, 20, 520))
    zoom = _clamp_float(args.magnifier_zoom, 1.0, 8.0)
    feather = _clamp_float(args.magnifier_feather, 0.0, 64.0)

    if radius != args.magnifier_radius:
        warnings.append("magnifierRadius clamped to [20, 520].")
    if abs(zoom - args.magnifier_zoom) > 1e-6:
        warnings.append("magnifierZoom clamped to [1.0, 8.0].")
    if abs(feather - args.magnifier_feather) > 1e-6:
        warnings.append("magnifierFeather clamped to [0, 64].")

    focused_points: List[Dict[str, Any]] = []
    effect_meta: List[Dict[str, Any]] = []
    frame_idx = 0
    processed_frames = 0
    warned_manual_missing = False
    last_auto_center: Optional[Tuple[int, int]] = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        timestamp = frame_idx / fps
        in_window = _timestamp_in_window(timestamp, start_time, end_time)
        can_process = in_window and (args.max_frames is None or processed_frames < args.max_frames)

        if can_process:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            fr = detector.detect_frame(rgb)
            fr.frame_index = frame_idx
            fr.timestamp = timestamp
            fr = tracker.update(fr)
            processed_frames += 1

            target = _pick_focus_detection(fr.detections, args.focus_mode, args.focus_player_id)
            auto_center = _bbox_center(target.bbox) if target is not None else last_auto_center
            if auto_center is not None:
                last_auto_center = auto_center

            keyframe = _interpolate_keyframe(keyframes, timestamp)
            manual_center = _anchor_from_keyframe(keyframe, width, height) or manual_anchor
            center, source = _resolve_control_value(args.control_mode, auto_center, manual_center)
            if source == "manual" and keyframe is not None:
                source = str(keyframe.get("source") or "manual")

            if args.control_mode == "manual" and manual_center is None and not warned_manual_missing:
                warnings.append("manual mode missing manualAnchor; fell back to auto focus.")
                warned_manual_missing = True

            if center is not None:
                cx, cy = center
                frame = _draw_magnifier(frame, (cx, cy), radius, zoom, feather)
                focused_points.append(
                    {
                        "frame": frame_idx,
                        "timestamp": fr.timestamp,
                        "x": cx,
                        "y": cy,
                        "targetClass": target.class_name if target is not None else None,
                        "targetTrackId": target.player_id if target is not None else None,
                        "source": source,
                    }
                )
                effect_meta.append(
                    {
                        "frame": frame_idx,
                        "timestamp": fr.timestamp,
                        "x": cx,
                        "y": cy,
                        "radius": radius,
                        "zoom": zoom,
                        "feather": feather,
                        "controlMode": args.control_mode,
                        "interactionMode": getattr(args, "interaction_mode", "pinned"),
                        "source": source,
                        "targetClass": target.class_name if target is not None else None,
                        "targetTrackId": target.player_id if target is not None else None,
                    }
                )

        writer.write(frame)
        frame_idx += 1

    cap.release()
    writer.release()

    return _result_ok(
        "magnifier-effect",
        {
            "framesProcessed": processed_frames,
            "controlModeApplied": args.control_mode,
            "focusSamples": focused_points[: args.max_output_items],
            "focusSamplesTotal": len(focused_points),
            "effectMeta": effect_meta[: args.max_output_items],
            "effectMetaTotal": len(effect_meta),
            "keyframesApplied": len(keyframes),
            "warnings": warnings,
            "summary": _summary_payload(
                args,
                "magnifier-effect",
                "Magnifier",
                processed_frames,
                len(effect_meta),
                warnings,
                output_video,
                f"Rendered magnifier effect on {len(effect_meta)} frames.",
            ),
            "artifacts": {
                "magnifierVideo": output_video,
            },
        },
    )
def player_pov(args: argparse.Namespace) -> Dict[str, Any]:
    detector = _new_detector(args.confidence, args.model_path)
    args.model_path = getattr(detector, "resolved_model_path", args.model_path)
    tracker = PlayerTracker(max_age=args.max_age, min_hits=2)

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        return _result_error("player-pov", f"Cannot open video: {args.video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_hint = (total_frames / fps) if fps > 0 and total_frames > 0 else None
    start_time, end_time, range_warnings = _window_bounds(args, duration_hint)
    output_video = _output_path(args.video_path, args.output_dir, "pov")
    writer = cv2.VideoWriter(output_video, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    warnings: List[str] = list(range_warnings)
    raw_manual_anchor = _parse_manual_anchor(args.manual_anchor)
    if args.manual_anchor and raw_manual_anchor is None:
        warnings.append("manualAnchor format invalid; ignored.")
    manual_anchor = _normalize_manual_anchor(raw_manual_anchor, width, height, warnings)
    keyframes = _parse_keyframes_json(getattr(args, "keyframes_json", None), warnings)

    manual_direction_vec: Optional[Tuple[float, float]] = None
    if args.manual_direction is not None:
        manual_direction_vec = _angle_to_vector(args.manual_direction)

    aperture = _clamp_float(args.fov_aperture, 10.0, 170.0)
    length = _clamp_float(args.fov_length, 40.0, float(max(width, height) * 2.0))
    dim = _clamp_float(args.fov_dim, 0.0, 0.95)
    if abs(aperture - args.fov_aperture) > 1e-6:
        warnings.append("fovAperture clamped to [10, 170].")
    if abs(length - args.fov_length) > 1e-6:
        warnings.append("fovLength clamped to [40, 2*max(width,height)].")
    if abs(dim - args.fov_dim) > 1e-6:
        warnings.append("fovDim clamped to [0, 0.95].")

    last_center_by_track: Dict[int, Tuple[int, int]] = {}
    last_direction_by_track: Dict[int, Tuple[float, float]] = {}
    pov_samples: List[Dict[str, Any]] = []
    effect_meta: List[Dict[str, Any]] = []
    frame_idx = 0
    processed_frames = 0
    warned_manual_anchor_missing = False
    warned_manual_direction_missing = False

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        timestamp = frame_idx / fps
        in_window = _timestamp_in_window(timestamp, start_time, end_time)
        can_process = in_window and (args.max_frames is None or processed_frames < args.max_frames)

        if can_process:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            fr = detector.detect_frame(rgb)
            fr.frame_index = frame_idx
            fr.timestamp = timestamp
            fr = tracker.update(fr)
            processed_frames += 1

            target = _pick_focus_detection(fr.detections, "player", args.focus_player_id)
            auto_center: Optional[Tuple[int, int]] = None
            auto_direction: Optional[Tuple[float, float]] = None
            track_id = -1
            if target is not None:
                auto_center = _bbox_center(target.bbox)
                track_id = target.player_id or -1
                prev = last_center_by_track.get(track_id)
                if prev is not None:
                    dx = auto_center[0] - prev[0]
                    dy = auto_center[1] - prev[1]
                    if abs(dx) + abs(dy) > 2:
                        auto_direction = (float(dx), float(dy))
                        last_direction_by_track[track_id] = auto_direction
                    elif track_id in last_direction_by_track:
                        auto_direction = last_direction_by_track[track_id]
                elif track_id in last_direction_by_track:
                    auto_direction = last_direction_by_track[track_id]
                last_center_by_track[track_id] = auto_center

            keyframe = _interpolate_keyframe(keyframes, timestamp)
            manual_center = _anchor_from_keyframe(keyframe, width, height) or manual_anchor
            manual_direction = _direction_from_keyframe(keyframe) or manual_direction_vec

            center, center_source = _resolve_control_value(args.control_mode, auto_center, manual_center)
            direction, direction_source = _resolve_control_value(args.control_mode, auto_direction, manual_direction)
            if center_source == "manual" and keyframe is not None:
                center_source = str(keyframe.get("source") or "manual")
            if direction_source == "manual" and keyframe is not None:
                direction_source = str(keyframe.get("source") or "manual")

            if args.control_mode == "manual" and manual_center is None and not warned_manual_anchor_missing:
                warnings.append("manual mode missing manualAnchor; center fell back to auto target.")
                warned_manual_anchor_missing = True
            if args.control_mode == "manual" and manual_direction is None and not warned_manual_direction_missing:
                warnings.append("manual mode missing manualDirection; direction fell back to auto estimate.")
                warned_manual_direction_missing = True

            if center is not None and direction is not None:
                frame = _draw_pov(frame, center, direction, aperture_deg=aperture, length=length, dim=dim)
                cx, cy = center
                direction_deg = _vector_to_angle(direction)
                pov_samples.append(
                    {
                        "frame": frame_idx,
                        "timestamp": fr.timestamp,
                        "x": cx,
                        "y": cy,
                        "trackId": track_id,
                        "direction": [round(direction[0], 2), round(direction[1], 2)],
                        "directionDeg": round(direction_deg, 2),
                        "source": center_source,
                        "directionSource": direction_source,
                    }
                )
                effect_meta.append(
                    {
                        "frame": frame_idx,
                        "timestamp": fr.timestamp,
                        "x": cx,
                        "y": cy,
                        "directionDeg": round(direction_deg, 3),
                        "source": center_source,
                        "directionSource": direction_source,
                        "aperture": aperture,
                        "length": length,
                        "dim": dim,
                        "controlMode": args.control_mode,
                        "interactionMode": getattr(args, "interaction_mode", "pinned"),
                        "targetTrackId": track_id if track_id >= 0 else None,
                    }
                )

        writer.write(frame)
        frame_idx += 1

    cap.release()
    writer.release()

    return _result_ok(
        "player-pov",
        {
            "framesProcessed": processed_frames,
            "controlModeApplied": args.control_mode,
            "povSamples": pov_samples[: args.max_output_items],
            "povSamplesTotal": len(pov_samples),
            "effectMeta": effect_meta[: args.max_output_items],
            "effectMetaTotal": len(effect_meta),
            "keyframesApplied": len(keyframes),
            "warnings": warnings,
            "summary": _summary_payload(
                args,
                "player-pov",
                "Player POV",
                processed_frames,
                len(effect_meta),
                warnings,
                output_video,
                f"Rendered POV effect on {len(effect_meta)} frames.",
            ),
            "artifacts": {
                "povVideo": output_video,
            },
        },
    )


def player_highlight(args: argparse.Namespace) -> Dict[str, Any]:
    warnings: List[str] = []
    raw_target_bindings = _parse_json_list(
        getattr(args, "target_bindings_json", None),
        warnings,
        "targetBindingsJson",
        getattr(args, "target_bindings_path", None),
    )
    raw_track_samples = _parse_json_list(
        getattr(args, "track_samples_json", None),
        warnings,
        "trackSamplesJson",
        getattr(args, "track_samples_path", None),
    )

    target_bindings: List[Dict[str, Any]] = []
    for item in raw_target_bindings:
        if not isinstance(item, dict):
            continue
        track_id = item.get("trackId")
        if track_id is None:
            continue
        try:
            normalized_track_id = int(track_id)
        except Exception:
            continue
        target_bindings.append(
            {
                "trackId": normalized_track_id,
                "label": str(item.get("label") or f"球员 #{normalized_track_id}"),
                "displayColor": item.get("displayColor"),
                "teamCluster": item.get("teamCluster"),
                "teamLabel": item.get("teamLabel"),
            }
        )

    track_samples: List[Dict[str, Any]] = []
    for item in raw_track_samples:
        if not isinstance(item, dict):
            continue
        track_id = item.get("trackId")
        bbox = item.get("bbox")
        timestamp = item.get("timestamp")
        if track_id is None or not isinstance(bbox, list) or len(bbox) < 4 or timestamp is None:
            continue
        try:
            normalized_track_id = int(track_id)
            normalized_timestamp = float(timestamp)
        except Exception:
            continue
        sample = dict(item)
        sample["trackId"] = normalized_track_id
        sample["timestamp"] = normalized_timestamp
        track_samples.append(sample)

    if not track_samples:
        return _result_error("player-highlight", "player-highlight requires trackSamplesJson from track-players.")
    if not target_bindings:
        return _result_error("player-highlight", "player-highlight requires at least one selected target binding.")

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        return _result_error("player-highlight", f"Cannot open video: {args.video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_hint = (total_frames / fps) if fps > 0 and total_frames > 0 else None
    start_time, end_time, range_warnings = _window_bounds(args, duration_hint)
    warnings.extend(range_warnings)

    outline_width = _clamp_float(args.highlight_outline_width, 1.0, 12.0)
    glow_strength = _clamp_float(args.highlight_glow_strength, 0.0, 8.0)
    fill_opacity = _clamp_float(args.highlight_fill_opacity, 0.0, 0.85)
    show_label = bool(int(getattr(args, "highlight_show_label", 1)))

    output_video = None
    writer = None
    if args.write_video:
        output_video = _output_path(args.video_path, args.output_dir, "player_highlight")
        writer = cv2.VideoWriter(output_video, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    track_index = _build_track_index(track_samples)
    selected_track_ids = [int(item["trackId"]) for item in target_bindings]
    target_lookup = {int(item["trackId"]): item for item in target_bindings}
    highlight_samples: List[Dict[str, Any]] = []
    processed_frames = 0
    frame_idx = 0
    exact_tolerance = max(0.12, 1.5 / max(1.0, fps))
    interpolate_gap = max(0.35, 4.0 / max(1.0, fps))

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        timestamp = frame_idx / fps
        in_window = _timestamp_in_window(timestamp, start_time, end_time)
        can_process = in_window and (args.max_frames is None or processed_frames < args.max_frames)
        output_frame = frame

        if can_process:
            processed_frames += 1
            output_frame = frame.copy()
            for track_id in selected_track_ids:
                resolved = _resolve_track_sample(
                    track_index,
                    track_id,
                    timestamp,
                    exact_tolerance=exact_tolerance,
                    interpolate_gap=interpolate_gap,
                )
                if resolved is None:
                    continue
                binding = target_lookup.get(track_id, {})
                merged = dict(resolved)
                for key in ("displayColor", "teamCluster", "teamLabel", "label"):
                    if binding.get(key) is not None:
                        merged[key] = binding.get(key)
                label_text = str(binding.get("label") or f"球员 #{track_id}")
                output_frame = _draw_player_highlight(
                    output_frame,
                    merged,
                    outline_width=outline_width,
                    glow_strength=glow_strength,
                    fill_opacity=fill_opacity,
                    show_label=show_label,
                    label_text=label_text,
                )
                highlight_samples.append(
                    {
                        "frame": frame_idx,
                        "timestamp": round(float(timestamp), 4),
                        "trackId": track_id,
                        "bbox": merged.get("bbox"),
                        "center": merged.get("center"),
                        "label": label_text,
                        "displayColor": merged.get("displayColor"),
                        "teamCluster": merged.get("teamCluster"),
                        "teamLabel": merged.get("teamLabel"),
                        "interpolated": bool(merged.get("interpolated")),
                    }
                )

        if writer is not None:
            writer.write(output_frame)
        frame_idx += 1

    cap.release()
    if writer is not None:
        writer.release()

    targets = [
        {
            "id": f"highlight_{item['trackId']}",
            "label": item["label"],
            "class": "player",
            "trackId": int(item["trackId"]),
            "source": "track",
            "displayColor": item.get("displayColor"),
            "teamCluster": item.get("teamCluster"),
            "teamLabel": item.get("teamLabel"),
        }
        for item in target_bindings
    ]

    return _result_ok(
        "player-highlight",
        {
            "framesProcessed": processed_frames,
            "highlightSamples": highlight_samples,
            "highlightSamplesTotal": len(highlight_samples),
            "trackSamples": track_samples,
            "trackSamplesTotal": len(track_samples),
            "targets": targets,
            "targetBindings": target_bindings,
            "warnings": warnings,
            "summary": _summary_payload(
                args,
                "player-highlight",
                "Player Highlight",
                processed_frames,
                len(highlight_samples),
                warnings,
                output_video,
                f"Rendered highlight for {len(target_bindings)} selected player targets.",
            ),
            "artifacts": {
                "highlightVideo": output_video,
            },
        },
    )
def _select_highlight_segments(score_by_second: Dict[int, float], duration: int, top_k: int) -> List[Dict[str, Any]]:
    if not score_by_second:
        return []

    ranked = sorted(score_by_second.items(), key=lambda kv: kv[1], reverse=True)
    selected: List[Tuple[int, int, float]] = []

    for second, score in ranked:
        start = max(0, second - duration // 2)
        end = start + duration

        overlapped = False
        for s, e, _ in selected:
            if not (end <= s or start >= e):
                overlapped = True
                break
        if overlapped:
            continue

        selected.append((start, end, score))
        if len(selected) >= top_k:
            break

    selected.sort(key=lambda x: x[0])
    return [
        {
            "start": s,
            "end": e,
            "score": round(score, 4),
        }
        for s, e, score in selected
    ]


def auto_highlight(args: argparse.Namespace) -> Dict[str, Any]:
    detector = _new_detector(args.confidence, args.model_path)
    args.model_path = getattr(detector, "resolved_model_path", args.model_path)

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        return _result_error("auto-highlight", f"Cannot open video: {args.video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration_hint = (total_frames / fps) if fps > 0 and total_frames > 0 else None
    start_time, end_time, warnings = _window_bounds(args, duration_hint)

    prev_gray = None
    score_by_second: Dict[int, float] = {}
    frame_idx = 0
    processed_frames = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        timestamp = frame_idx / fps
        in_window = _timestamp_in_window(timestamp, start_time, end_time)
        can_process = in_window and (args.max_frames is None or processed_frames < args.max_frames)
        if can_process:
            sec = int(timestamp)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            motion = 0.0
            if prev_gray is not None:
                diff = cv2.absdiff(gray, prev_gray)
                motion = float(np.mean(diff) / 255.0)
            prev_gray = gray

            if frame_idx % max(1, int(fps // 2)) == 0:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                fr = detector.detect_frame(rgb)
                players = len([d for d in fr.detections if d.class_name == "person"])
                balls = len([d for d in fr.detections if d.class_name == "sports ball"])
            else:
                players = 0
                balls = 0

            score = motion * 1.8 + min(players, 14) * 0.08 + balls * 0.6
            score_by_second[sec] = score_by_second.get(sec, 0.0) + score
            processed_frames += 1

        frame_idx += 1

    cap.release()

    segments = _select_highlight_segments(score_by_second, args.highlight_duration, args.max_highlights)
    peak_score = max(score_by_second.values()) if score_by_second else 0.0
    highlight_clips = [
        {
            "id": f"highlight_{index + 1}",
            "title": f"高光片段 {index + 1}",
            "start": segment["start"],
            "end": segment["end"],
            "score": segment["score"],
            "confidence": round(segment["score"] / peak_score, 4) if peak_score > 1e-6 else 0.0,
        }
        for index, segment in enumerate(segments)
    ]

    return _result_ok(
        "auto-highlight",
        {
            "framesProcessed": processed_frames,
            "segments": segments,
            "segmentsTotal": len(segments),
            "highlightClips": highlight_clips,
            "warnings": warnings,
            "summary": _summary_payload(
                args,
                "auto-highlight",
                "Auto Highlight",
                processed_frames,
                len(segments),
                warnings,
                None,
                f"Generated {len(highlight_clips)} highlight clips.",
            ),
            "scoring": {
                "secondsAnalyzed": len(score_by_second),
                "peakScore": round(peak_score, 4),
            },
            "artifacts": {
                "highlightsJson": str(Path(args.output_dir) / f"{Path(args.video_path).stem}_highlights.json"),
            },
        },
    )
def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Football analysis CLI")
    parser.add_argument("--operation", required=True, choices=["detect-players", "track-players", "magnifier-effect", "player-pov", "player-highlight", "auto-highlight"])
    parser.add_argument("--video-path", required=True)
    parser.add_argument("--output-dir", default=".")
    parser.add_argument("--scope", choices=["selection", "track", "full"], default="full")
    parser.add_argument("--start-time", type=float, default=0.0)
    parser.add_argument("--end-time", type=float, default=None)
    parser.add_argument("--confidence", type=float, default=0.35)
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--max-output-items", type=int, default=120)
    parser.add_argument("--write-video", action="store_true")
    parser.add_argument("--model-path", default=None)

    # tracking/effect params
    parser.add_argument("--max-age", type=int, default=30)
    parser.add_argument("--focus-mode", choices=["player", "ball"], default="player")
    parser.add_argument("--focus-player-id", type=int, default=None)
    parser.add_argument("--control-mode", choices=["auto", "manual", "hybrid"], default="hybrid")
    parser.add_argument("--interaction-mode", choices=["cursor-follow", "pinned", "auto-target"], default="pinned")
    parser.add_argument("--manual-anchor", default=None, help="manual anchor point in source coordinates, format x,y")
    parser.add_argument("--manual-direction", type=float, default=None, help="manual direction in degree")
    parser.add_argument("--keyframes-json", default=None, help="serialized effect keyframes")
    parser.add_argument("--target-bindings-json", default=None, help="serialized selected target bindings")
    parser.add_argument("--target-bindings-path", default=None, help="path to selected target bindings JSON")
    parser.add_argument("--track-samples-json", default=None, help="serialized track sample payload from track-players")
    parser.add_argument("--track-samples-path", default=None, help="path to track sample JSON from track-players")
    parser.add_argument("--magnifier-radius", type=int, default=120)
    parser.add_argument("--magnifier-zoom", type=float, default=2.0)
    parser.add_argument("--magnifier-feather", type=float, default=10.0)
    # backward compatible alias for POV aperture
    parser.add_argument("--pov-angle", type=float, default=48.0)
    parser.add_argument("--fov-aperture", type=float, default=None)
    parser.add_argument("--fov-length", type=float, default=320.0)
    parser.add_argument("--fov-dim", type=float, default=0.5)
    parser.add_argument("--highlight-outline-width", type=float, default=3.0)
    parser.add_argument("--highlight-glow-strength", type=float, default=1.8)
    parser.add_argument("--highlight-fill-opacity", type=float, default=0.18)
    parser.add_argument("--highlight-show-label", type=int, default=1)

    # highlight params
    parser.add_argument("--highlight-duration", type=int, default=10)
    parser.add_argument("--max-highlights", type=int, default=6)

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()

    if not os.path.exists(args.video_path):
        _json_print(_result_error(args.operation, f"Video not found: {args.video_path}"))
        return 1

    os.makedirs(args.output_dir, exist_ok=True)

    # Normalize 0 as unlimited.
    if args.max_frames <= 0:
        args.max_frames = None

    # Backward compatibility for POV aperture.
    if args.fov_aperture is None:
        args.fov_aperture = args.pov_angle

    try:
        if args.operation == "detect-players":
            result = detect_players(args)
        elif args.operation == "track-players":
            result = track_players(args)
        elif args.operation == "magnifier-effect":
            result = magnifier_effect(args)
        elif args.operation == "player-pov":
            result = player_pov(args)
        elif args.operation == "player-highlight":
            result = player_highlight(args)
        elif args.operation == "auto-highlight":
            result = auto_highlight(args)
            # Persist recommendation to disk for editor pipelines.
            highlights_json = Path(result["artifacts"]["highlightsJson"])
            highlights_json.write_text(
                json.dumps(
                    {
                        "video": args.video_path,
                        "operation": "auto-highlight",
                        "segments": result.get("segments", []),
                        "highlightClips": result.get("highlightClips", []),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            result = _result_error(args.operation, "Unsupported operation")

        _json_print(result)
        return 0 if result.get("success") else 1

    except Exception as exc:
        _json_print(
            _result_error(
                args.operation,
                str(exc),
                details=traceback.format_exc(limit=2),
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
