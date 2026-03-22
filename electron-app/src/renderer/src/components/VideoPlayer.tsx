import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './VideoPlayer.css';
import { EffectControlMode, EffectKeyframe, EffectTool, Point2D, PreviewEffectLayer } from '../types';

interface PlayerCommand {
  nonce: number;
  type: 'toggle-play' | 'step-forward' | 'step-backward' | 'seek';
  time?: number;
}

interface VideoPlayerProps {
  videoPath: string;
  videoInfo: any;
  isProcessing: boolean;
  monitorView?: 'fit' | 'original';
  focusMonitor?: boolean;
  interactionHintText?: string | null;
  externalSeekTime?: number | null;
  onSeekHandled?: () => void;
  onTimeChange?: (time: number) => void;
  onMetadata?: (meta: { duration: number; width: number; height: number }) => void;
  onMonitorViewFallback?: (nextView: 'fit', reason: 'viewport-too-small') => void;
  onToggleMonitorView?: () => void;
  onToggleFocusMonitor?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  previewEffects?: PreviewEffectLayer[];
  editableEffect?: PreviewEffectLayer | null;
  trackingOverlay?: any;
  onSetEffectTool: (tool: EffectTool) => void;
  onSetControlMode: (mode: EffectControlMode) => void;
  onSetInteractionMode: (mode: 'cursor-follow' | 'pinned' | 'auto-target') => void;
  onSetManualAnchor: (anchor: Point2D | null) => void;
  onSetManualDirectionDeg: (deg: number | null) => void;
  onPatchEffectParams: (patch: Record<string, number>) => void;
  onPatchEffectKeyframes: (keyframes: EffectKeyframe[]) => void;
  onClearManualControl: (fallbackMode?: EffectControlMode) => void;
  command?: PlayerCommand | null;
}

interface Point {
  x: number;
  y: number;
}

const OVERLAY_FPS = 15;
const DEFAULT_MANUAL = { anchor: null as Point2D | null, directionDeg: null as number | null };
const DEFAULT_PARAMS = {
  magnifierRadius: 120,
  magnifierZoom: 2,
  magnifierFeather: 10,
  povAngle: 60,
  fovAperture: 60,
  fovLength: 320,
  fovDim: 0.5,
  highlightOutlineWidth: 3,
  highlightGlowStrength: 1.8,
  highlightFillOpacity: 0.18,
};

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function nearestByTime<T extends { timestamp?: number; time?: number }>(items: T[] | undefined, currentTime: number, maxDelta = 0.4): T | null {
  if (!Array.isArray(items) || !items.length) return null;
  let best: T | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  items.forEach((item) => {
    const ts = Number(item.timestamp ?? item.time ?? -1);
    if (!Number.isFinite(ts)) return;
    const delta = Math.abs(ts - currentTime);
    if (delta < bestDelta) {
      best = item;
      bestDelta = delta;
    }
  });
  return best && bestDelta <= maxDelta ? best : null;
}

function sampleTime(item: { timestamp?: number; time?: number }): number {
  return Number(item.timestamp ?? item.time ?? -1);
}

function frameSamplesAtTime<T extends { timestamp?: number; time?: number }>(
  items: T[] | undefined,
  currentTime: number,
  frameTolerance: number,
  maxDelta: number,
): T[] {
  if (!Array.isArray(items) || !items.length) return [];
  let nearestTimestamp: number | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  items.forEach((item) => {
    const ts = sampleTime(item);
    if (!Number.isFinite(ts)) return;
    const delta = Math.abs(ts - currentTime);
    if (delta < bestDelta) {
      bestDelta = delta;
      nearestTimestamp = ts;
    }
  });
  if (!Number.isFinite(bestDelta) || nearestTimestamp == null || bestDelta > maxDelta) return [];
  const resolvedTimestamp = nearestTimestamp;
  return items.filter((item) => Math.abs(sampleTime(item) - resolvedTimestamp) <= frameTolerance);
}

function hexToRgba(hex: string | null | undefined, alpha: number): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return `rgba(0, 212, 255, ${alpha})`;
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function interpolateTrackSample(samples: any[], trackId: number, currentTime: number, exactTolerance = 0.14, interpolateGap = 0.4): any | null {
  const trackSamples = samples
    .filter((item) => Number(item?.trackId) === Number(trackId))
    .sort((a, b) => sampleTime(a) - sampleTime(b));
  if (!trackSamples.length) return null;
  const exact = nearestByTime(trackSamples, currentTime, exactTolerance);
  if (exact) return exact;

  for (let index = 0; index < trackSamples.length - 1; index += 1) {
    const current = trackSamples[index];
    const next = trackSamples[index + 1];
    const start = sampleTime(current);
    const end = sampleTime(next);
    if (!Number.isFinite(start) || !Number.isFinite(end) || currentTime < start || currentTime > end) continue;
    if (end - start > interpolateGap || end - start <= 0.0001) continue;
    const currentBox = Array.isArray(current?.bbox) ? current.bbox : null;
    const nextBox = Array.isArray(next?.bbox) ? next.bbox : null;
    if (!currentBox || !nextBox || currentBox.length < 4 || nextBox.length < 4) continue;
    const ratio = (currentTime - start) / (end - start);
    const bbox = currentBox.map((value: number, boxIndex: number) => Number((value + (nextBox[boxIndex] - value) * ratio).toFixed(2)));
    return {
      ...current,
      timestamp: currentTime,
      bbox,
      center: [Number(((bbox[0] + bbox[2]) / 2).toFixed(2)), Number(((bbox[1] + bbox[3]) / 2).toFixed(2))],
      interpolated: true,
    };
  }
  return null;
}

function interpolateKeyframe(keyframes: EffectKeyframe[], currentTime: number): EffectKeyframe | null {
  if (!keyframes.length) return null;
  if (currentTime <= keyframes[0].time) return keyframes[0];
  if (currentTime >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1];
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (currentTime < a.time || currentTime > b.time) continue;
    const ratio = (currentTime - a.time) / Math.max(0.0001, b.time - a.time);
    return {
      time: currentTime,
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
      directionDeg:
        typeof a.directionDeg === 'number' && typeof b.directionDeg === 'number'
          ? a.directionDeg + (b.directionDeg - a.directionDeg) * ratio
          : a.directionDeg ?? b.directionDeg,
      source: a.source ?? b.source,
    };
  }
  return nearestByTime(keyframes, currentTime, 1);
}

function normalizeEditableEffect(editableEffect: PreviewEffectLayer | null) {
  if (!editableEffect) return null;
  return {
    ...editableEffect,
    controlMode: editableEffect.controlMode || 'hybrid',
    interactionMode: editableEffect.interactionMode || 'pinned',
    manual: editableEffect.manual || DEFAULT_MANUAL,
    params: { ...DEFAULT_PARAMS, ...(editableEffect.params || {}) },
    keyframes: editableEffect.keyframes || [],
    targetBinding: editableEffect.targetBinding || null,
    targetBindings: editableEffect.targetBindings || [],
    showLabel: editableEffect.showLabel !== false,
  };
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoPath,
  videoInfo,
  isProcessing,
  monitorView = 'fit',
  focusMonitor = false,
  interactionHintText,
  externalSeekTime,
  onSeekHandled,
  onTimeChange,
  onMetadata,
  onMonitorViewFallback,
  onToggleMonitorView,
  onToggleFocusMonitor,
  onPlayingChange,
  previewEffects = [],
  editableEffect,
  trackingOverlay,
  onSetEffectTool,
  onSetControlMode,
  onSetInteractionMode,
  onSetManualAnchor,
  onSetManualDirectionDeg,
  onPatchEffectParams,
  onPatchEffectKeyframes,
  onClearManualControl,
  command,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const lastCommandRef = useRef(-1);
  const lastCaptureRef = useRef(0);
  const draggingRef = useRef(false);
  const hoverPointRef = useRef<Point | null>(null);
  const fallbackNotifiedRef = useRef(false);
  const metadataCallbackRef = useRef(onMetadata);
  const timeChangeCallbackRef = useRef(onTimeChange);
  const playingChangeCallbackRef = useRef(onPlayingChange);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wrapperSize, setWrapperSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    fallbackNotifiedRef.current = false;
  }, [videoPath]);
  useEffect(() => {
    metadataCallbackRef.current = onMetadata;
  }, [onMetadata]);
  useEffect(() => {
    timeChangeCallbackRef.current = onTimeChange;
  }, [onTimeChange]);
  useEffect(() => {
    playingChangeCallbackRef.current = onPlayingChange;
  }, [onPlayingChange]);

  const fps = Math.max(1, Number(videoInfo?.fps || 30));
  const activeEditableEffect = useMemo(() => normalizeEditableEffect(editableEffect ?? null), [editableEffect]);
  const interactive = activeEditableEffect?.operation === 'magnifier-effect' || activeEditableEffect?.operation === 'player-pov';
  const videoStyle = useMemo<CSSProperties>(() => (
    monitorView === 'original'
      ? {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 'auto',
        height: 'auto',
        maxWidth: 'none',
        maxHeight: 'none',
        transform: 'translate(-50%, -50%)',
        objectFit: 'none',
        objectPosition: 'center center',
        background: '#000',
      }
      : {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        objectPosition: 'center center',
        background: '#000',
      }
  ), [monitorView]);

  const ensureCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return null;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(2, Math.floor(rect.width));
    const height = Math.max(2, Math.floor(rect.height));
    if (width !== sizeRef.current.w || height !== sizeRef.current.h) {
      canvas.width = width;
      canvas.height = height;
      sizeRef.current = { w: width, h: height };
    }
    return canvas;
  }, []);

  const metrics = useCallback((canvas: HTMLCanvasElement) => {
    const sourceW = videoRef.current?.videoWidth || videoInfo?.width || 1920;
    const sourceH = videoRef.current?.videoHeight || videoInfo?.height || 1080;
    const scale = monitorView === 'original' ? 1 : Math.min(canvas.width / sourceW, canvas.height / sourceH);
    const drawW = sourceW * scale;
    const drawH = sourceH * scale;
    return { sourceW, sourceH, scale, offsetX: (canvas.width - drawW) / 2, offsetY: (canvas.height - drawH) / 2 };
  }, [monitorView, videoInfo]);

  const toCanvas = useCallback((point: Point, canvas: HTMLCanvasElement) => {
    const view = metrics(canvas);
    return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale };
  }, [metrics]);

  const toVideo = useCallback((clientX: number, clientY: number, canvas: HTMLCanvasElement): Point | null => {
    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const view = metrics(canvas);
    const x = localX - view.offsetX;
    const y = localY - view.offsetY;
    if (x < 0 || y < 0 || x > view.sourceW * view.scale || y > view.sourceH * view.scale) return null;
    return { x: clamp(x / view.scale, 0, view.sourceW - 1), y: clamp(y / view.scale, 0, view.sourceH - 1) };
  }, [metrics]);

  const getTrackPoint = useCallback((effect: PreviewEffectLayer) => {
    if (effect.targetBinding?.trackId == null) return null;
    const sources = [effect.result?.trackSamples, trackingOverlay?.trackSamples];
    const combined = sources.find((list) => Array.isArray(list) && list.length) || [];
    const sample = interpolateTrackSample(
      combined,
      Number(effect.targetBinding?.trackId),
      currentTime,
      Math.max(0.14, 1.5 / fps),
      Math.max(0.4, 4 / fps),
    ) as any;
    if (!sample?.bbox) return null;
    if (Array.isArray(sample.center) && sample.center.length >= 2) {
      return { x: Number(sample.center[0]), y: Number(sample.center[1]) };
    }
    return { x: (Number(sample.bbox[0]) + Number(sample.bbox[2])) / 2, y: (Number(sample.bbox[1]) + Number(sample.bbox[3])) / 2 };
  }, [currentTime, fps, trackingOverlay]);

  const resolveMagnifier = useCallback((effect: ReturnType<typeof normalizeEditableEffect>) => {
    if (!effect) return { point: null as Point | null };
    const keyframed = interpolateKeyframe(effect.keyframes, currentTime);
    if (effect.interactionMode === 'cursor-follow' && hoverPointRef.current) return { point: hoverPointRef.current };
    if (effect.interactionMode === 'auto-target') {
      const tracked = getTrackPoint(effect);
      if (tracked) return { point: tracked };
    }
    if (keyframed) return { point: { x: keyframed.x, y: keyframed.y } };
    if (effect.manual.anchor) return { point: effect.manual.anchor };
    const sample = nearestByTime(effect.result?.effectMeta || effect.result?.focusSamples, currentTime, 0.5) as any;
    return sample ? { point: { x: Number(sample.x), y: Number(sample.y) } } : { point: null };
  }, [currentTime, getTrackPoint]);

  const resolvePov = useCallback((effect: ReturnType<typeof normalizeEditableEffect>) => {
    if (!effect) return { point: null as Point | null, directionDeg: null as number | null };
    const keyframed = interpolateKeyframe(effect.keyframes, currentTime);
    const tracked = effect.interactionMode === 'auto-target' ? getTrackPoint(effect) : null;
    const sample = nearestByTime(effect.result?.effectMeta || effect.result?.povSamples, currentTime, 0.5) as any;
    const point = tracked || (keyframed ? { x: keyframed.x, y: keyframed.y } : effect.manual.anchor) || (sample ? { x: Number(sample.x), y: Number(sample.y) } : null);
    const directionDeg = typeof keyframed?.directionDeg === 'number' ? keyframed.directionDeg : effect.manual.directionDeg ?? sample?.directionDeg ?? null;
    return { point, directionDeg };
  }, [currentTime, getTrackPoint]);

  const captureKeyframe = useCallback((point: Point, directionDeg?: number) => {
    if (!activeEditableEffect) return;
    const now = performance.now();
    if (now - lastCaptureRef.current < 1000 / OVERLAY_FPS) return;
    lastCaptureRef.current = now;
    const next = [...activeEditableEffect.keyframes.filter((item) => Math.abs(item.time - currentTime) > 0.03), { time: currentTime, x: point.x, y: point.y, directionDeg, source: 'manual' as const }]
      .sort((a, b) => a.time - b.time);
    onPatchEffectKeyframes(next);
  }, [activeEditableEffect, currentTime, onPatchEffectKeyframes]);

  const drawDetection = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, effect: PreviewEffectLayer) => {
    const samples = Array.isArray(effect.result?.detectionSamples) && effect.result.detectionSamples.length
      ? effect.result.detectionSamples
      : effect.result?.players;
    const visibleSamples = frameSamplesAtTime(samples, currentTime, Math.max(0.001, 0.5 / fps), Math.max(0.08, 1.5 / fps));
    if (!visibleSamples.length) return;
    visibleSamples.forEach((player: any) => {
        const box = player.bbox || [0, 0, 0, 0];
        const a = toCanvas({ x: Number(box[0]), y: Number(box[1]) }, canvas);
        const b = toCanvas({ x: Number(box[2]), y: Number(box[3]) }, canvas);
        ctx.strokeStyle = '#3cc6ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x, a.y, Math.max(2, b.x - a.x), Math.max(2, b.y - a.y));
      });
  }, [currentTime, fps, toCanvas]);

  const drawTracking = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, effect: PreviewEffectLayer) => {
    const samples = effect.result?.trackSamples || trackingOverlay?.trackSamples;
    if (!Array.isArray(samples)) return;
    const selectedIds = new Set<number>(
      [
        effect.targetBinding?.trackId,
        ...(Array.isArray(effect.targetBindings) ? effect.targetBindings.map((item) => item?.trackId) : []),
      ]
        .filter((value): value is number => typeof value === 'number'),
    );
    frameSamplesAtTime(samples, currentTime, Math.max(0.001, 0.5 / fps), Math.max(0.08, 1.5 / fps))
      .forEach((sample: any) => {
        const selected = selectedIds.has(Number(sample.trackId));
        const box = sample.bbox || [0, 0, 0, 0];
        const a = toCanvas({ x: Number(box[0]), y: Number(box[1]) }, canvas);
        const b = toCanvas({ x: Number(box[2]), y: Number(box[3]) }, canvas);
        ctx.strokeStyle = selected ? '#ffe066' : (sample.displayColor || 'rgba(84, 255, 181, 0.9)');
        ctx.lineWidth = selected ? 3 : 2;
        ctx.strokeRect(a.x, a.y, Math.max(2, b.x - a.x), Math.max(2, b.y - a.y));
        ctx.fillStyle = selected ? '#ffe066' : (sample.displayColor || '#54ffb5');
        ctx.fillText(`#${sample.trackId}`, a.x + 4, Math.max(12, a.y - 6));
      });
  }, [currentTime, fps, toCanvas, trackingOverlay]);

  const drawPlayerHighlight = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, effect: ReturnType<typeof normalizeEditableEffect>) => {
    if (!effect || !Array.isArray(effect.targetBindings) || !effect.targetBindings.length) return;
    const samples = Array.isArray(effect.result?.trackSamples) && effect.result.trackSamples.length
      ? effect.result.trackSamples
      : trackingOverlay?.trackSamples;
    if (!Array.isArray(samples) || !samples.length) return;

    effect.targetBindings.forEach((binding) => {
      if (typeof binding?.trackId !== 'number') return;
      const sample = interpolateTrackSample(
        samples,
        Number(binding.trackId),
        currentTime,
        Math.max(0.14, 1.5 / fps),
        Math.max(0.4, 4 / fps),
      );
      if (!sample?.bbox) return;
      const box = sample.bbox || [0, 0, 0, 0];
      const a = toCanvas({ x: Number(box[0]), y: Number(box[1]) }, canvas);
      const b = toCanvas({ x: Number(box[2]), y: Number(box[3]) }, canvas);
      const width = Math.max(2, b.x - a.x);
      const height = Math.max(2, b.y - a.y);
      const color = binding.displayColor || sample.displayColor || '#00d4ff';
      const outlineWidth = Math.max(1, Number(effect.params.highlightOutlineWidth || 3));
      const glowStrength = Math.max(0, Number(effect.params.highlightGlowStrength || 1.8));
      const fillOpacity = Math.max(0, Math.min(0.85, Number(effect.params.highlightFillOpacity || 0.18)));

      ctx.save();
      ctx.fillStyle = hexToRgba(color, fillOpacity);
      ctx.fillRect(a.x, a.y, width, height);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = outlineWidth + glowStrength * 1.4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 + glowStrength * 8;
      ctx.strokeRect(a.x, a.y, width, height);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = outlineWidth;
      ctx.strokeRect(a.x, a.y, width, height);
      ctx.restore();

      if (effect.showLabel !== false) {
        const label = binding.label || `#${binding.trackId}`;
        ctx.save();
        ctx.font = '12px sans-serif';
        const labelWidth = ctx.measureText(label).width + 10;
        const labelHeight = 20;
        const labelX = a.x;
        const labelY = Math.max(4, a.y - labelHeight - 4);
        ctx.fillStyle = color;
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, labelX + 5, labelY + 14);
        ctx.restore();
      }
    });
  }, [currentTime, fps, toCanvas, trackingOverlay]);

  const drawMagnifier = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, effect: ReturnType<typeof normalizeEditableEffect>) => {
    if (!effect || !videoRef.current) return;
    const resolved = resolveMagnifier(effect);
    if (!resolved.point) return;
    const center = toCanvas(resolved.point, canvas);
    const view = metrics(canvas);
    const radius = Math.max(12, effect.params.magnifierRadius * view.scale);
    const sourceRadius = Math.max(8, effect.params.magnifierRadius / Math.max(1, effect.params.magnifierZoom));
    const sx = clamp(resolved.point.x - sourceRadius, 0, view.sourceW - 1);
    const sy = clamp(resolved.point.y - sourceRadius, 0, view.sourceH - 1);
    const sw = clamp(sourceRadius * 2, 2, view.sourceW - sx);
    const sh = clamp(sourceRadius * 2, 2, view.sourceH - sy);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(videoRef.current, sx, sy, sw, sh, center.x - radius, center.y - radius, radius * 2, radius * 2);
    ctx.restore();
    ctx.strokeStyle = '#ffd54a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [metrics, resolveMagnifier, toCanvas]);

  const drawPov = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, effect: ReturnType<typeof normalizeEditableEffect>) => {
    if (!effect) return;
    const resolved = resolvePov(effect);
    if (!resolved.point || resolved.directionDeg == null) return;
    const center = toCanvas(resolved.point, canvas);
    const view = metrics(canvas);
    const aperture = clamp(effect.params.fovAperture, 10, 170);
    const half = aperture / 2;
    const length = Math.max(20, effect.params.fovLength * view.scale);
    const dim = clamp(effect.params.fovDim, 0, 0.95);
    const points: Point[] = [{ x: center.x, y: center.y }];
    for (let i = 0; i <= 40; i += 1) {
      const ratio = i / 40;
      const angle = resolved.directionDeg - half + aperture * ratio;
      const rad = (angle * Math.PI) / 180;
      points.push({ x: center.x + Math.cos(rad) * length, y: center.y + Math.sin(rad) * length });
    }
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.closePath();
    ctx.stroke();
  }, [metrics, resolvePov, toCanvas]);

  const draw = useCallback(() => {
    const canvas = ensureCanvas();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    previewEffects.forEach((effect) => {
      if (effect.operation === 'detect-players') drawDetection(ctx, canvas, effect);
      if (effect.operation === 'track-players') drawTracking(ctx, canvas, effect);
      if (effect.operation === 'player-highlight') drawPlayerHighlight(ctx, canvas, normalizeEditableEffect(effect));
      if (effect.operation === 'magnifier-effect') drawMagnifier(ctx, canvas, normalizeEditableEffect(effect));
      if (effect.operation === 'player-pov') drawPov(ctx, canvas, normalizeEditableEffect(effect));
    });
  }, [drawDetection, drawMagnifier, drawPlayerHighlight, drawPov, drawTracking, ensureCanvas, previewEffects]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoPath) return;
    setLoadError(null);
    video.pause();
    const src = (window as any).require?.('url')?.pathToFileURL
      ? (window as any).require('url').pathToFileURL(videoPath).href
      : encodeURI(`file:///${videoPath.replace(/\\/g, '/')}`);
    video.src = src;
    video.load();
    const onLoaded = () => {
      setDuration(Number(video.duration || 0));
      metadataCallbackRef.current?.({ duration: Number(video.duration || 0), width: video.videoWidth || 0, height: video.videoHeight || 0 });
    };
    const onLoadedData = () => {
      setCurrentTime(video.currentTime || 0);
      setLoadError(null);
      requestAnimationFrame(() => draw());
    };
    const onTime = () => {
      setCurrentTime(video.currentTime || 0);
      timeChangeCallbackRef.current?.(video.currentTime || 0);
    };
    const onPlay = () => {
      setIsPlaying(true);
      playingChangeCallbackRef.current?.(true);
    };
    const onPause = () => {
      setIsPlaying(false);
      playingChangeCallbackRef.current?.(false);
    };
    const onError = () => setLoadError('视频加载失败，请检查文件路径或编码。');
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
    };
  }, [videoPath]);

  useEffect(() => {
    if (externalSeekTime == null || !videoRef.current) return;
    videoRef.current.currentTime = externalSeekTime;
    setCurrentTime(externalSeekTime);
    onSeekHandled?.();
  }, [externalSeekTime, onSeekHandled]);

  useEffect(() => {
    if (!command || command.nonce === lastCommandRef.current || !videoRef.current) return;
    lastCommandRef.current = command.nonce;
    if (command.type === 'toggle-play') {
      if (videoRef.current.paused) videoRef.current.play().catch(() => undefined);
      else videoRef.current.pause();
      return;
    }
    if (command.type === 'step-forward') {
      videoRef.current.currentTime = clamp(videoRef.current.currentTime + 1 / fps, 0, duration);
      return;
    }
    if (command.type === 'step-backward') {
      videoRef.current.currentTime = clamp(videoRef.current.currentTime - 1 / fps, 0, duration);
      return;
    }
    if (command.type === 'seek' && typeof command.time === 'number') {
      videoRef.current.currentTime = clamp(command.time, 0, duration);
    }
  }, [command, duration, fps]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (time: number) => {
      if (time - last > 1000 / OVERLAY_FPS) {
        draw();
        last = time;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [draw]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || typeof ResizeObserver === 'undefined') return undefined;
    const updateSize = () => setWrapperSize({ width: wrapper.clientWidth, height: wrapper.clientHeight });
    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [videoPath]);

  useEffect(() => {
    if (monitorView !== 'original') {
      fallbackNotifiedRef.current = false;
      return;
    }
    const videoWidth = Number(videoRef.current?.videoWidth || videoInfo?.width || 0);
    const videoHeight = Number(videoRef.current?.videoHeight || videoInfo?.height || 0);
    if (videoWidth <= 0 || videoHeight <= 0 || wrapperSize.width <= 0 || wrapperSize.height <= 0) return;
    const shouldFallback = videoWidth > wrapperSize.width || videoHeight > wrapperSize.height;
    if (!shouldFallback) {
      fallbackNotifiedRef.current = false;
      return;
    }
    if (fallbackNotifiedRef.current) return;
    fallbackNotifiedRef.current = true;
    onMonitorViewFallback?.('fit', 'viewport-too-small');
  }, [monitorView, onMonitorViewFallback, videoInfo?.height, videoInfo?.width, wrapperSize.height, wrapperSize.width]);

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive || !activeEditableEffect) return;
    const point = toVideo(event.clientX, event.clientY, canvas);
    if (!point) return;
    hoverPointRef.current = point;
    if (activeEditableEffect.operation === 'magnifier-effect' && activeEditableEffect.interactionMode === 'cursor-follow') {
      onSetEffectTool('magnifier-effect');
      onSetControlMode('hybrid');
      captureKeyframe(point);
    }
    if (activeEditableEffect.operation === 'player-pov' && draggingRef.current) {
      onSetEffectTool('player-pov');
      onSetControlMode('manual');
      if (!activeEditableEffect.manual.anchor) onSetManualAnchor(point);
      const anchor = activeEditableEffect.manual.anchor || point;
      const directionDeg = (Math.atan2(point.y - anchor.y, point.x - anchor.x) * 180) / Math.PI;
      onSetManualDirectionDeg(directionDeg);
      captureKeyframe(anchor, directionDeg);
    }
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive || !activeEditableEffect) return;
    event.preventDefault();
    const point = toVideo(event.clientX, event.clientY, canvas);
    if (!point) return;
    if (event.button === 2) {
      onClearManualControl('hybrid');
      onSetInteractionMode('auto-target');
      return;
    }
    draggingRef.current = true;
    if (activeEditableEffect.operation === 'magnifier-effect') {
      onSetEffectTool('magnifier-effect');
      onSetInteractionMode('pinned');
      onSetControlMode('manual');
      onSetManualAnchor(point);
      captureKeyframe(point);
    }
    if (activeEditableEffect.operation === 'player-pov') {
      onSetEffectTool('player-pov');
      onSetInteractionMode('pinned');
      onSetControlMode('manual');
      onSetManualAnchor(point);
    }
  };

  const handleMouseLeave = () => {
    draggingRef.current = false;
    hoverPointRef.current = null;
    if (activeEditableEffect?.operation === 'magnifier-effect' && activeEditableEffect.interactionMode === 'cursor-follow' && activeEditableEffect.controlMode === 'hybrid') {
      onSetManualAnchor(null);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!interactive || !activeEditableEffect) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    if (activeEditableEffect.operation === 'magnifier-effect') {
      if (event.shiftKey) onPatchEffectParams({ magnifierZoom: Number(clamp(activeEditableEffect.params.magnifierZoom + step * 0.1, 1, 8).toFixed(2)) });
      else onPatchEffectParams({ magnifierRadius: Math.round(clamp(activeEditableEffect.params.magnifierRadius + step * 8, 20, 520)) });
      return;
    }
    if (event.shiftKey) onPatchEffectParams({ fovAperture: Math.round(clamp(activeEditableEffect.params.fovAperture + step * 3, 10, 170)) });
    else if (event.ctrlKey) onPatchEffectParams({ fovDim: Number(clamp(activeEditableEffect.params.fovDim + step * 0.03, 0, 0.95).toFixed(3)) });
    else onPatchEffectParams({ fovLength: Math.round(clamp(activeEditableEffect.params.fovLength + step * 20, 40, 2400)) });
  };

  if (!videoPath) {
    return (
      <div className="video-player-empty">
        <div className="empty-state">
          <h3>等待导入视频</h3>
          <p>导入素材后，这里会实时预览播放器画面和所有叠加特效。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="video-player-container">
      <div className="video-wrapper" ref={wrapperRef}>
        <video
          ref={videoRef}
          className={`video-element ${monitorView === 'original' ? 'view-original' : 'view-fit'}`}
          style={videoStyle}
          playsInline
          preload="metadata"
          onClick={() => (videoRef.current?.paused ? videoRef.current.play().catch(() => undefined) : videoRef.current?.pause())}
        />
        <canvas
          ref={canvasRef}
          className={`selection-canvas ${interactive ? 'interactive' : 'passive'}`}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={() => { draggingRef.current = false; }}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onContextMenu={(event) => event.preventDefault()}
        />
        {interactionHintText && interactive ? <div className="interaction-hint-pill">{interactionHintText}</div> : null}
        {loadError ? <div className="processing-overlay"><span>{loadError}</span></div> : null}
        {isProcessing ? <div className="processing-overlay"><div className="spinner" /><span>正在生成预览...</span></div> : null}
      </div>
      <div className="video-controls">
        <div className="controls-section">
          <button className="control-btn text-btn" onClick={() => (videoRef.current?.paused ? videoRef.current.play().catch(() => undefined) : videoRef.current?.pause())}>{isPlaying ? '暂停' : '播放'}</button>
          <button className="control-btn text-btn" onClick={() => { if (videoRef.current) videoRef.current.currentTime = clamp(videoRef.current.currentTime - 1 / fps, 0, duration); }}>上一帧</button>
          <button className="control-btn text-btn" onClick={() => { if (videoRef.current) videoRef.current.currentTime = clamp(videoRef.current.currentTime + 1 / fps, 0, duration); }}>下一帧</button>
        </div>
        <div className="controls-section controls-timeline">
          <span className="time-display">{currentTime.toFixed(2)}s</span>
          <input className="timeline-slider" type="range" min="0" max={Math.max(0.1, duration)} step={1 / fps} value={clamp(currentTime, 0, Math.max(0.1, duration))} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} />
          <span className="time-display">{duration.toFixed(2)}s</span>
        </div>
        <div className="controls-section">
          <button className={`control-btn text-btn ${monitorView === 'original' ? 'is-active' : ''}`} onClick={() => onToggleMonitorView?.()}>
            {monitorView === 'fit' ? '原始尺寸' : '适应窗口'}
          </button>
          <button className={`control-btn text-btn ${focusMonitor ? 'is-active' : ''}`} onClick={() => onToggleFocusMonitor?.()}>
            {focusMonitor ? '退出专注' : '专注监看'}
          </button>
        </div>
        <div className="controls-section">
          <div className="volume-control">
            <span className="control-icon">音量</span>
            <input className="volume-slider" type="range" min="0" max="1" step="0.1" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (videoRef.current) videoRef.current.volume = next; }} />
          </div>
          <select className="playback-rate-select" value={rate} onChange={(event) => { const next = Number(event.target.value); setRate(next); if (videoRef.current) videoRef.current.playbackRate = next; }}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
