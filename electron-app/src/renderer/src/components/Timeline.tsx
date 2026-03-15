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
  onUpdateItemRange: (trackId: string, itemId: string, start: number, end: number) => void;
  onToggleItem: (trackId: string, itemId: string) => void;
  onDeleteItem: (trackId: string, itemId: string) => void;
}

type DragMode = 'move' | 'resize-left' | 'resize-right';

interface DragState {
  trackId: string;
  itemId: string;
  mode: DragMode;
  offset: number;
  start: number;
  end: number;
}

const MIN_DURATION = 1 / 30;

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
    if (clip.sourceType === 'original') return '\u539f\u7247';
    if (clip.sourceType === 'manual') return '\u7247\u6bb5';
    return '\u7d20\u6750';
  }
  if (item.kind === 'asset') return '\u8986\u76d6';
  const effect = item as EffectItem;
  if (effect.operation === 'magnifier-effect') return '\u653e\u5927\u955c';
  if (effect.operation === 'player-pov') return 'POV';
  if (effect.operation === 'track-players') return '\u8ddf\u8e2a';
  if (effect.operation === 'detect-players') return '\u68c0\u6d4b';
  return 'AI';
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
  onUpdateItemRange,
  onToggleItem,
  onDeleteItem,
}) => {
  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<{ trackId: string; itemId: string; start: number; end: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const safeFps = Math.max(1, Math.round(fps || 30));
  const safeDuration = Math.max(duration, MIN_DURATION);
  const pxPerSecond = Math.max(48, 120 * zoom);
  const timelineWidth = Math.max(1400, safeDuration * pxPerSecond + 120);
  const frameStep = 1 / safeFps;

  const orderedTracks = useMemo(() => [...tracks].sort((a, b) => a.order - b.order), [tracks]);
  const snapPoints = useMemo(
    () => [0, safeDuration, playheadTime, ...orderedTracks.flatMap((track) => track.items.flatMap((item) => [item.start, item.end]))],
    [orderedTracks, playheadTime, safeDuration],
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

  const beginDrag = (event: React.MouseEvent, trackId: string, itemId: string, mode: DragMode) => {
    event.preventDefault();
    event.stopPropagation();
    const track = orderedTracks.find((item) => item.id === trackId);
    const target = track?.items.find((item) => item.id === itemId);
    if (!track || !target || !contentRef.current || !viewportRef.current) return;
    const pointerX = event.clientX - contentRef.current.getBoundingClientRect().left + viewportRef.current.scrollLeft;
    const pointerTime = xToTime(pointerX);
    setDragState({ trackId, itemId, mode, offset: pointerTime - target.start, start: target.start, end: target.end });
    setDragPreview({ trackId, itemId, start: target.start, end: target.end });
    onSelectItem(trackId, itemId);
  };

  useEffect(() => {
    if (!dragState) return undefined;

    const onMove = (event: MouseEvent) => {
      if (!contentRef.current || !viewportRef.current) return;
      const pointerX = event.clientX - contentRef.current.getBoundingClientRect().left + viewportRef.current.scrollLeft;
      const pointerTime = xToTime(pointerX);
      let start = dragState.start;
      let end = dragState.end;

      if (dragState.mode === 'move') {
        const length = dragState.end - dragState.start;
        start = snap(pointerTime - dragState.offset);
        end = start + length;
      } else if (dragState.mode === 'resize-left') {
        start = snap(clamp(pointerTime, 0, dragState.end - MIN_DURATION));
      } else {
        end = snap(clamp(pointerTime, dragState.start + MIN_DURATION, safeDuration));
      }

      setDragPreview({
        trackId: dragState.trackId,
        itemId: dragState.itemId,
        start: Math.round(start / frameStep) * frameStep,
        end: Math.round(end / frameStep) * frameStep,
      });
    };

    const onUp = () => {
      if (dragPreview) onUpdateItemRange(dragPreview.trackId, dragPreview.itemId, dragPreview.start, dragPreview.end);
      setDragState(null);
      setDragPreview(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragPreview, dragState, frameStep, onUpdateItemRange, safeDuration, snap, xToTime]);

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
          <button onClick={() => setZoom((prev) => clamp(prev * 0.85, 0.35, 4))}>{'\u7f29\u5c0f'}</button>
          <span>{'\u7f29\u653e'} {zoom.toFixed(2)}x</span>
          <button onClick={() => setZoom((prev) => clamp(prev * 1.2, 0.35, 4))}>{'\u653e\u5927'}</button>
        </div>
        <div className="timeline-toolbar-right">
          <span>{'\u64ad\u653e\u5934'} {formatTime(playheadTime, safeFps)}</span>
          <span>{'\u603b\u65f6\u957f'} {formatTime(safeDuration, safeFps)}</span>
          <span>{orderedTracks.length} {'\u6761\u8f68\u9053'}</span>
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
            {orderedTracks.map((track) => (
              <div key={track.id} className={`timeline-track-row ${track.enabled ? '' : 'disabled'}`}>
                <div className="timeline-track-header">
                  <strong>{track.name}</strong>
                  <span>{track.items.length} {'\u4e2a\u7247\u6bb5'}</span>
                </div>
                <div className="timeline-track-lane">
                  {track.items.map((item) => {
                    const range = dragPreview && dragPreview.trackId === track.id && dragPreview.itemId === item.id ? dragPreview : item;
                    const selected = selection.trackId === track.id && selection.itemId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`timeline-item ${item.kind} ${item.enabled ? '' : 'muted'} ${selected ? 'selected' : ''}`}
                        style={{ left: `${timeToX(range.start)}px`, width: `${Math.max(6, timeToX(range.end) - timeToX(range.start))}px` }}
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
                          <button onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onToggleItem(track.id, item.id); }}>
                            {item.enabled ? '\u7981\u7528' : '\u542f\u7528'}
                          </button>
                          <button onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDeleteItem(track.id, item.id); }}>
                            {'\u5220\u9664'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
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
