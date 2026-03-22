import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './Timeline.css';
import { ClipItem, EffectItem, HighlightClip, SelectionState, TimelineItem, Track } from '../types';

interface TimelineProps {
  tracks: Track[];
  duration: number;
  fps: number;
  playheadTime: number;
  selection: SelectionState;
  markers?: HighlightClip[];
  onSeek: (time: number) => void;
  onSelectItem: (trackId: string, itemId: string) => void;
  onMoveItem: (trackId: string, itemId: string, start: number, end: number, lane: number) => void;
  onToggleItem: (trackId: string, itemId: string) => void;
  onDeleteItem: (trackId: string, itemId: string) => void;
}

type DragMode = 'move' | 'resize-left' | 'resize-right';

interface DragState {
  trackId: string;
  itemId: string;
  trackType: Track['type'];
  mode: DragMode;
  offset: number;
  start: number;
  end: number;
  lane: number;
}

interface DragPreview {
  trackId: string;
  itemId: string;
  start: number;
  end: number;
  lane: number;
}

const MIN_DURATION = 1 / 30;
const LANE_HEIGHT = 52;
const LANE_GAP = 8;
const TRACK_PADDING = 10;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function formatTime(seconds: number, fps: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * fps);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${frames.toString().padStart(2, '0')}`;
}

function itemBadge(item: TimelineItem): string {
  if (item.kind === 'clip') {
    const clip = item as ClipItem;
    if (clip.sourceType === 'original') return '原片';
    if (clip.sourceType === 'manual') return '手动';
    if (clip.sourceType === 'highlight-ai') return '高光';
    if (clip.sourceType === 'reference') return '参考';
    return '素材';
  }
  if (item.kind === 'asset') return '资源';
  const effect = item as EffectItem;
  if (effect.operation === 'magnifier-effect') return '放大镜';
  if (effect.operation === 'player-pov') return 'POV';
  if (effect.operation === 'track-players') return '跟踪';
  if (effect.operation === 'detect-players') return '检测';
  return 'AI';
}

function laneCountForTrack(track: Track, preview: DragPreview | null): number {
  const activeItems = preview && preview.trackId === track.id
    ? track.items.map((item) => (item.id === preview.itemId ? { ...item, ...preview } : item))
    : track.items;
  const maxLane = activeItems.reduce((current, item) => Math.max(current, Number(item.lane || 0)), 0);
  return track.type === 'video' ? 1 : Math.max(1, maxLane + 1);
}

function laneTop(lane: number): number {
  return TRACK_PADDING + lane * (LANE_HEIGHT + LANE_GAP);
}

function laneMinHeight(laneCount: number): number {
  return TRACK_PADDING * 2 + laneCount * LANE_HEIGHT + Math.max(0, laneCount - 1) * LANE_GAP;
}

const Timeline: React.FC<TimelineProps> = ({
  tracks,
  duration,
  fps,
  playheadTime,
  selection,
  markers = [],
  onSeek,
  onSelectItem,
  onMoveItem,
  onToggleItem,
  onDeleteItem,
}) => {
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const trackLaneRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const safeFps = Math.max(1, Math.round(fps || 30));
  const safeDuration = Math.max(duration, MIN_DURATION);
  const pxPerSecond = Math.max(52, 128 * zoom);
  const timelineWidth = Math.max(1400, safeDuration * pxPerSecond + 120);
  const frameStep = 1 / safeFps;

  const orderedTracks = useMemo(() => [...tracks].sort((a, b) => a.order - b.order), [tracks]);
  const snapPoints = useMemo(
    () => [0, safeDuration, playheadTime, ...orderedTracks.flatMap((track) => track.items.flatMap((item) => [item.start, item.end]))],
    [orderedTracks, playheadTime, safeDuration],
  );
  const laneCounts = useMemo(
    () => new Map(orderedTracks.map((track) => [track.id, laneCountForTrack(track, dragPreview)])),
    [dragPreview, orderedTracks],
  );

  const xToTime = useCallback((x: number) => clamp(x / pxPerSecond, 0, safeDuration), [pxPerSecond, safeDuration]);
  const timeToX = useCallback((time: number) => clamp(time, 0, safeDuration) * pxPerSecond, [pxPerSecond, safeDuration]);

  const snap = useCallback((time: number) => {
    const nearest = snapPoints.reduce(
      (best, point) => {
        const delta = Math.abs(point - time);
        return delta < best.delta ? { point, delta } : best;
      },
      { point: time, delta: Number.POSITIVE_INFINITY },
    );
    return nearest.delta <= 0.12 ? nearest.point : time;
  }, [snapPoints]);

  const autoScrollViewport = useCallback((event: MouseEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const threshold = 56;
    if (event.clientX < rect.left + threshold) viewport.scrollLeft -= 24;
    else if (event.clientX > rect.right - threshold) viewport.scrollLeft += 24;
    if (event.clientY < rect.top + threshold) viewport.scrollTop -= 20;
    else if (event.clientY > rect.bottom - threshold) viewport.scrollTop += 20;
  }, []);

  const laneFromPointer = useCallback((trackId: string, trackType: Track['type'], clientY: number) => {
    if (trackType === 'video') return 0;
    const laneRoot = trackLaneRefs.current[trackId];
    if (!laneRoot) return 0;
    const rect = laneRoot.getBoundingClientRect();
    const raw = Math.floor((clientY - rect.top - TRACK_PADDING) / (LANE_HEIGHT + LANE_GAP));
    const maxLane = Math.max(0, (laneCounts.get(trackId) || 1));
    return clamp(raw, 0, maxLane);
  }, [laneCounts]);

  const beginDrag = (event: React.MouseEvent, trackId: string, itemId: string, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    const track = orderedTracks.find((item) => item.id === trackId);
    const target = track?.items.find((item) => item.id === itemId);
    if (!track || !target || !contentRef.current || !viewportRef.current) return;
    const pointerX = event.clientX - contentRef.current.getBoundingClientRect().left + viewportRef.current.scrollLeft;
    const pointerTime = xToTime(pointerX);
    const lane = Math.max(0, Number(target.lane || 0));
    setDragState({ trackId, itemId, trackType: track.type, mode, offset: pointerTime - target.start, start: target.start, end: target.end, lane });
    setDragPreview({ trackId, itemId, start: target.start, end: target.end, lane });
    onSelectItem(trackId, itemId);
  };

  useEffect(() => {
    if (!dragState) return undefined;

    const onMove = (event: MouseEvent) => {
      if (!contentRef.current || !viewportRef.current) return;
      autoScrollViewport(event);
      const pointerX = event.clientX - contentRef.current.getBoundingClientRect().left + viewportRef.current.scrollLeft;
      const pointerTime = xToTime(pointerX);
      let start = dragState.start;
      let end = dragState.end;
      let lane = dragState.lane;

      if (dragState.mode === 'move') {
        const length = dragState.end - dragState.start;
        start = snap(pointerTime - dragState.offset);
        end = start + length;
        lane = laneFromPointer(dragState.trackId, dragState.trackType, event.clientY);
      } else if (dragState.mode === 'resize-left') {
        start = snap(clamp(pointerTime, 0, dragState.end - MIN_DURATION));
      } else {
        end = snap(clamp(pointerTime, dragState.start + MIN_DURATION, safeDuration));
      }

      setDragPreview({
        trackId: dragState.trackId,
        itemId: dragState.itemId,
        lane,
        start: Math.round(start / frameStep) * frameStep,
        end: Math.round(end / frameStep) * frameStep,
      });
    };

    const onUp = () => {
      if (dragPreview) onMoveItem(dragPreview.trackId, dragPreview.itemId, dragPreview.start, dragPreview.end, dragPreview.lane);
      setDragState(null);
      setDragPreview(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [autoScrollViewport, dragPreview, dragState, frameStep, laneFromPointer, onMoveItem, safeDuration, snap, xToTime]);

  const tickStep = safeDuration > 1200 ? 30 : safeDuration > 600 ? 10 : safeDuration > 120 ? 5 : 1;
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let t = 0; t <= safeDuration; t += tickStep) list.push(Number(t.toFixed(3)));
    if (list[list.length - 1] !== safeDuration) list.push(safeDuration);
    return list;
  }, [safeDuration, tickStep]);

  return (
    <div className="timeline-root">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-left">
          <button onClick={() => setZoom((prev) => clamp(prev * 0.85, 0.35, 4))}>缩小</button>
          <span>缩放 {zoom.toFixed(2)}x</span>
          <button onClick={() => setZoom((prev) => clamp(prev * 1.2, 0.35, 4))}>放大</button>
        </div>
        <div className="timeline-toolbar-right">
          <span>播放头 {formatTime(playheadTime, safeFps)}</span>
          <span>总时长 {formatTime(safeDuration, safeFps)}</span>
          <span>{orderedTracks.length} 条轨道</span>
        </div>
      </div>

      <div className="timeline-viewport" ref={viewportRef}>
        <div
          className="timeline-content"
          ref={contentRef}
          style={{ width: `${timelineWidth}px` }}
          onMouseDown={(event) => {
            if (!viewportRef.current || !contentRef.current) return;
            const x = event.clientX - contentRef.current.getBoundingClientRect().left + viewportRef.current.scrollLeft;
            onSeek(Math.round(xToTime(x) / frameStep) * frameStep);
          }}
        >
          <div className="timeline-ruler">
            {ticks.map((tick) => (
              <div key={tick} className="timeline-tick" style={{ left: `${timeToX(tick)}px` }}>
                <div className="timeline-tick-line" />
                <div className="timeline-tick-label">{formatTime(tick, safeFps)}</div>
              </div>
            ))}
            {markers.map((marker) => (
              <button
                key={marker.id}
                type="button"
                className="timeline-marker"
                style={{ left: `${timeToX(marker.start)}px` }}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onSeek(marker.start);
                }}
                title={`${marker.title} ${formatTime(marker.start, safeFps)} - ${formatTime(marker.end, safeFps)}`}
              />
            ))}
          </div>

          <div className="timeline-tracks">
            {orderedTracks.map((track) => {
              const laneCount = laneCounts.get(track.id) || 1;
              return (
                <div key={track.id} className={`timeline-track-row ${track.enabled ? '' : 'disabled'}`}>
                  <div className="timeline-track-header">
                    <div className="timeline-track-title">
                      <strong>{track.name}</strong>
                      <span>{track.items.length} 个片段</span>
                    </div>
                    <span>{track.type === 'video' ? '单层主轨' : `${laneCount} 条子轨`}</span>
                  </div>
                  <div
                    className="timeline-track-lane"
                    ref={(node) => { trackLaneRefs.current[track.id] = node; }}
                    style={{ minHeight: `${laneMinHeight(laneCount)}px` }}
                  >
                    {Array.from({ length: laneCount }).map((_, laneIndex) => (
                      <div
                        key={`${track.id}_lane_${laneIndex}`}
                        className="timeline-lane-guide"
                        style={{ top: `${laneTop(laneIndex)}px`, height: `${LANE_HEIGHT}px` }}
                      >
                        {track.type !== 'video' ? <span className="timeline-lane-label">L{laneIndex + 1}</span> : null}
                      </div>
                    ))}

                    {track.items.map((item) => {
                      const range = dragPreview && dragPreview.trackId === track.id && dragPreview.itemId === item.id ? dragPreview : item;
                      const selected = selection.trackId === track.id && selection.itemId === item.id;
                      return (
                        <div
                          key={item.id}
                          className={`timeline-item ${item.kind} ${item.enabled ? '' : 'muted'} ${selected ? 'selected' : ''} ${dragPreview?.itemId === item.id ? 'dragging' : ''}`}
                          style={{
                            left: `${timeToX(range.start)}px`,
                            top: `${laneTop(range.lane)}px`,
                            width: `${Math.max(6, timeToX(range.end) - timeToX(range.start))}px`,
                            height: `${LANE_HEIGHT}px`,
                          }}
                          onMouseDown={(event) => beginDrag(event, track.id, item.id, 'move')}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectItem(track.id, item.id);
                          }}
                        >
                          <div className="timeline-item-handle left" onMouseDown={(event) => beginDrag(event, track.id, item.id, 'resize-left')} />
                          <div className="timeline-item-main">
                            <div className="timeline-item-badge">{itemBadge(item)}</div>
                            <div className="timeline-item-label">{item.label}</div>
                          </div>
                          <div className="timeline-item-handle right" onMouseDown={(event) => beginDrag(event, track.id, item.id, 'resize-right')} />
                          <div className="timeline-item-actions">
                            <button
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleItem(track.id, item.id);
                              }}
                            >
                              {item.enabled ? '禁用' : '启用'}
                            </button>
                            <button
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteItem(track.id, item.id);
                              }}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="timeline-playhead" style={{ left: `${timeToX(playheadTime)}px` }}>
            <div className="timeline-playhead-head" />
            <div className="timeline-playhead-line" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Timeline;
