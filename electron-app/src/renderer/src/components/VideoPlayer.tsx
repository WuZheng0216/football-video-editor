import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './VideoPlayer.css';
import { EffectControlMode, EffectControlState, EffectKeyframe, EffectTool, Point2D, TargetBinding } from '../types';

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
  interactionHintText?: string | null;
  externalSeekTime?: number | null;
  onSeekHandled?: () => void;
  onTimeChange?: (time: number) => void;
  onMetadata?: (meta: { duration: number; width: number; height: number }) => void;
  onPlayingChange?: (playing: boolean) => void;
  aiOverlay?: any;
  overlayOperation?: string;
  effectControl: EffectControlState;
  effectKeyframes?: EffectKeyframe[];
  overlayTargetBinding?: TargetBinding | null;
  onSetEffectTool: (tool: EffectTool) => void;
  onSetControlMode: (mode: EffectControlMode) => void;
  onSetInteractionMode: (mode: EffectControlState['interactionMode']) => void;
  onSetManualAnchor: (anchor: Point2D | null) => void;
  onSetManualDirectionDeg: (deg: number | null) => void;
  onPatchEffectParams: (patch: Partial<EffectControlState['params']>) => void;
  onPatchEffectKeyframes: (keyframes: EffectKeyframe[]) => void;
  onClearManualControl: (fallbackMode?: EffectControlMode) => void;
  command?: PlayerCommand | null;
}

interface Point {
  x: number;
  y: number;
}

const OVERLAY_FPS = 15;

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

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoPath,
  videoInfo,
  isProcessing,
  monitorView = 'fit',
  interactionHintText,
  externalSeekTime,
  onSeekHandled,
  onTimeChange,
  onMetadata,
  onPlayingChange,
  aiOverlay,
  overlayOperation,
  effectControl,
  effectKeyframes = [],
  overlayTargetBinding,
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const lastLoadedPathRef = useRef('');
  const lastCommandRef = useRef(-1);
  const lastCaptureRef = useRef(0);
  const draggingRef = useRef(false);
  const hoverPointRef = useRef<Point | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fps = Math.max(1, Number(videoInfo?.fps || 30));
  const interactive = overlayOperation === 'magnifier-effect' || overlayOperation === 'player-pov';

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

  const getTrackPoint = useCallback(() => {
    if (overlayTargetBinding?.trackId == null) return null;
    const sample = nearestByTime(
      aiOverlay?.trackSamples?.filter((item: any) => Number(item.trackId) === Number(overlayTargetBinding.trackId)),
      currentTime,
      0.5,
    ) as any;
    if (!sample?.bbox) return null;
    return { x: (Number(sample.bbox[0]) + Number(sample.bbox[2])) / 2, y: (Number(sample.bbox[1]) + Number(sample.bbox[3])) / 2 };
  }, [aiOverlay, currentTime, overlayTargetBinding]);

  const resolveMagnifier = useCallback(() => {
    const keyframed = interpolateKeyframe(effectKeyframes, currentTime);
    if (effectControl.interactionMode === 'cursor-follow' && hoverPointRef.current) return { point: hoverPointRef.current, source: 'manual' };
    if (effectControl.interactionMode === 'auto-target') {
      const tracked = getTrackPoint();
      if (tracked) return { point: tracked, source: 'ai' };
    }
    if (keyframed) return { point: { x: keyframed.x, y: keyframed.y }, source: keyframed.source || 'manual' };
    if (effectControl.manual.anchor) return { point: effectControl.manual.anchor, source: 'manual' };
    const sample = nearestByTime(aiOverlay?.effectMeta || aiOverlay?.focusSamples, currentTime, 0.5) as any;
    return sample ? { point: { x: Number(sample.x), y: Number(sample.y) }, source: 'ai' } : { point: null, source: 'ai' };
  }, [aiOverlay, currentTime, effectControl, effectKeyframes, getTrackPoint]);

  const resolvePov = useCallback(() => {
    const keyframed = interpolateKeyframe(effectKeyframes, currentTime);
    const tracked = effectControl.interactionMode === 'auto-target' ? getTrackPoint() : null;
    const sample = nearestByTime(aiOverlay?.effectMeta || aiOverlay?.povSamples, currentTime, 0.5) as any;
    const point = tracked || (keyframed ? { x: keyframed.x, y: keyframed.y } : effectControl.manual.anchor) || (sample ? { x: Number(sample.x), y: Number(sample.y) } : null);
    const directionDeg = typeof keyframed?.directionDeg === 'number' ? keyframed.directionDeg : effectControl.manual.directionDeg ?? sample?.directionDeg ?? null;
    return { point, directionDeg };
  }, [aiOverlay, currentTime, effectControl, effectKeyframes, getTrackPoint]);

  const captureKeyframe = useCallback((point: Point, directionDeg?: number) => {
    const now = performance.now();
    if (now - lastCaptureRef.current < 1000 / OVERLAY_FPS) return;
    lastCaptureRef.current = now;
    const next = [...effectKeyframes.filter((item) => Math.abs(item.time - currentTime) > 0.03), { time: currentTime, x: point.x, y: point.y, directionDeg, source: 'manual' as const }]
      .sort((a, b) => a.time - b.time);
    onPatchEffectKeyframes(next);
  }, [currentTime, effectKeyframes, onPatchEffectKeyframes]);

  const draw = useCallback(() => {
    const canvas = ensureCanvas();
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (overlayOperation === 'detect-players' && Array.isArray(aiOverlay?.players)) {
      aiOverlay.players.filter((item: any) => Math.abs(Number(item.timestamp || 0) - currentTime) < 0.25).forEach((player: any) => {
        const box = player.bbox || [0, 0, 0, 0];
        const a = toCanvas({ x: Number(box[0]), y: Number(box[1]) }, canvas);
        const b = toCanvas({ x: Number(box[2]), y: Number(box[3]) }, canvas);
        ctx.strokeStyle = '#3cc6ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x, a.y, Math.max(2, b.x - a.x), Math.max(2, b.y - a.y));
      });
    }

    if (overlayOperation === 'track-players' && Array.isArray(aiOverlay?.trackSamples)) {
      aiOverlay.trackSamples.filter((item: any) => Math.abs(Number(item.timestamp || 0) - currentTime) < 0.2).forEach((sample: any) => {
        const selected = overlayTargetBinding?.trackId != null && Number(sample.trackId) === Number(overlayTargetBinding.trackId);
        const box = sample.bbox || [0, 0, 0, 0];
        const a = toCanvas({ x: Number(box[0]), y: Number(box[1]) }, canvas);
        const b = toCanvas({ x: Number(box[2]), y: Number(box[3]) }, canvas);
        ctx.strokeStyle = selected ? '#ffe066' : 'rgba(84, 255, 181, 0.9)';
        ctx.lineWidth = selected ? 3 : 2;
        ctx.strokeRect(a.x, a.y, Math.max(2, b.x - a.x), Math.max(2, b.y - a.y));
        ctx.fillStyle = selected ? '#ffe066' : '#54ffb5';
        ctx.fillText(`#${sample.trackId}`, a.x + 4, Math.max(12, a.y - 6));
      });
    }

    if (overlayOperation === 'magnifier-effect') {
      const resolved = resolveMagnifier();
      if (!resolved.point || !videoRef.current) return;
      const center = toCanvas(resolved.point, canvas);
      const view = metrics(canvas);
      const radius = Math.max(12, effectControl.params.magnifierRadius * view.scale);
      const sourceRadius = Math.max(8, effectControl.params.magnifierRadius / Math.max(1, effectControl.params.magnifierZoom));
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
    }

    if (overlayOperation === 'player-pov') {
      const resolved = resolvePov();
      if (!resolved.point || resolved.directionDeg == null) return;
      const center = toCanvas(resolved.point, canvas);
      const view = metrics(canvas);
      const aperture = clamp(effectControl.params.fovAperture, 10, 170);
      const half = aperture / 2;
      const length = Math.max(20, effectControl.params.fovLength * view.scale);
      const dim = clamp(effectControl.params.fovDim, 0, 0.95);
      const points: Point[] = [{ x: center.x, y: center.y }];
      for (let i = 0; i <= 40; i += 1) {
        const ratio = i / 40;
        const angle = resolved.directionDeg - half + aperture * ratio;
        const rad = (angle * Math.PI) / 180;
        points.push({ x: center.x + Math.cos(rad) * length, y: center.y + Math.sin(rad) * length });
      }
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${dim})`;
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
    }
  }, [aiOverlay, currentTime, effectControl, effectKeyframes, ensureCanvas, metrics, overlayOperation, overlayTargetBinding, resolveMagnifier, resolvePov, toCanvas]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoPath || lastLoadedPathRef.current === videoPath) return;
    lastLoadedPathRef.current = videoPath;
    setLoadError(null);
    video.pause();
    const src = (window as any).require?.('url')?.pathToFileURL ? (window as any).require('url').pathToFileURL(videoPath).href : encodeURI(`file:///${videoPath.replace(/\\/g, '/')}`);
    video.src = src;
    video.load();
    const onLoaded = () => {
      setDuration(Number(video.duration || 0));
      onMetadata?.({ duration: Number(video.duration || 0), width: video.videoWidth || 0, height: video.videoHeight || 0 });
    };
    const onTime = () => {
      setCurrentTime(video.currentTime || 0);
      onTimeChange?.(video.currentTime || 0);
    };
    const onPlay = () => {
      setIsPlaying(true);
      onPlayingChange?.(true);
    };
    const onPause = () => {
      setIsPlaying(false);
      onPlayingChange?.(false);
    };
    const onError = () => setLoadError('视频加载失败，请检查路径或编码格式。');
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('error', onError);
    };
  }, [onMetadata, onPlayingChange, onTimeChange, videoPath]);

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

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;
    const point = toVideo(event.clientX, event.clientY, canvas);
    if (!point) return;
    hoverPointRef.current = point;
    if (overlayOperation === 'magnifier-effect' && effectControl.interactionMode === 'cursor-follow') {
      onSetEffectTool('magnifier-effect');
      onSetControlMode('hybrid');
      captureKeyframe(point);
    }
    if (overlayOperation === 'player-pov' && draggingRef.current) {
      onSetEffectTool('player-pov');
      onSetControlMode('manual');
      if (!effectControl.manual.anchor) onSetManualAnchor(point);
      const anchor = effectControl.manual.anchor || point;
      const directionDeg = (Math.atan2(point.y - anchor.y, point.x - anchor.x) * 180) / Math.PI;
      onSetManualDirectionDeg(directionDeg);
      captureKeyframe(anchor, directionDeg);
    }
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !interactive) return;
    event.preventDefault();
    const point = toVideo(event.clientX, event.clientY, canvas);
    if (!point) return;
    if (event.button === 2) {
      onClearManualControl('hybrid');
      onSetInteractionMode('auto-target');
      return;
    }
    draggingRef.current = true;
    if (overlayOperation === 'magnifier-effect') {
      onSetEffectTool('magnifier-effect');
      onSetInteractionMode('pinned');
      onSetControlMode('manual');
      onSetManualAnchor(point);
      captureKeyframe(point);
    }
    if (overlayOperation === 'player-pov') {
      onSetEffectTool('player-pov');
      onSetInteractionMode('pinned');
      onSetControlMode('manual');
      onSetManualAnchor(point);
    }
  };

  const handleMouseLeave = () => {
    draggingRef.current = false;
    hoverPointRef.current = null;
    if (overlayOperation === 'magnifier-effect' && effectControl.interactionMode === 'cursor-follow' && effectControl.controlMode === 'hybrid') {
      onSetManualAnchor(null);
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 1 : -1;
    if (overlayOperation === 'magnifier-effect') {
      if (event.shiftKey) onPatchEffectParams({ magnifierZoom: Number(clamp(effectControl.params.magnifierZoom + step * 0.1, 1, 8).toFixed(2)) });
      else onPatchEffectParams({ magnifierRadius: Math.round(clamp(effectControl.params.magnifierRadius + step * 8, 20, 520)) });
      return;
    }
    if (event.shiftKey) onPatchEffectParams({ fovAperture: Math.round(clamp(effectControl.params.fovAperture + step * 3, 10, 170)) });
    else if (event.ctrlKey) onPatchEffectParams({ fovDim: Number(clamp(effectControl.params.fovDim + step * 0.03, 0, 0.95).toFixed(3)) });
    else onPatchEffectParams({ fovLength: Math.round(clamp(effectControl.params.fovLength + step * 20, 40, 2400)) });
  };

  if (!videoPath) {
    return <div className="video-player-empty"><div className="empty-state"><h3>等待导入视频</h3><p>导入素材后，可直接在这里播放、预览和操作效果。</p></div></div>;
  }

  return (
    <div className="video-player-container">
      <div className="video-wrapper">
        <video ref={videoRef} className={`video-element ${monitorView === 'original' ? 'view-original' : 'view-fit'}`} playsInline preload="metadata" onClick={() => (videoRef.current?.paused ? videoRef.current.play().catch(() => undefined) : videoRef.current?.pause())} />
        <canvas ref={canvasRef} className={`selection-canvas ${interactive ? 'interactive' : 'passive'}`} onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onMouseUp={() => { draggingRef.current = false; }} onMouseLeave={handleMouseLeave} onWheel={handleWheel} onContextMenu={(event) => event.preventDefault()} />
        {interactionHintText && interactive ? <div className="interaction-hint-pill">{interactionHintText}</div> : null}
        {loadError ? <div className="processing-overlay"><span>{loadError}</span></div> : null}
        {isProcessing ? <div className="processing-overlay"><div className="spinner" /><span>处理中...</span></div> : null}
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
