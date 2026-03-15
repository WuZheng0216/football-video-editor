import React, { useState, useEffect, useRef } from 'react';
import './Timeline.css';

interface TimelineProps {
  videoPath: string;
  videoInfo: any;
}

interface Clip {
  id: number;
  startTime: number;
  endTime: number;
  label: string;
  color: string;
}

interface Marker {
  id: number;
  time: number;
  type: string;
  label: string;
  color: string;
}

const Timeline: React.FC<TimelineProps> = ({ videoPath, videoInfo }) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(videoInfo?.duration || 0);
  const [clips, setClips] = useState<Clip[]>([
    { id: 1, startTime: 0, endTime: 10, label: 'Opening', color: '#3498db' },
    { id: 2, startTime: 30, endTime: 45, label: 'Goal', color: '#2ecc71' },
    { id: 3, startTime: 60, endTime: 75, label: 'Save', color: '#e74c3c' }
  ]);
  const [markers, setMarkers] = useState<Marker[]>([
    { id: 1, time: 15, type: 'shot', label: 'Shot Attempt', color: '#f39c12' },
    { id: 2, time: 32, type: 'goal', label: 'GOAL!', color: '#2ecc71' },
    { id: 3, time: 65, type: 'save', label: 'Great Save', color: '#3498db' }
  ]);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedClip, setSelectedClip] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const timelineRef = useRef<HTMLDivElement>(null);

  // 监听视频时间更新
  useEffect(() => {
    if (videoInfo?.duration) {
      setDuration(videoInfo.duration);
    }
  }, [videoInfo]);

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 处理时间线点击
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const totalWidth = rect.width;
    
    const clickedTime = (clickX / totalWidth) * duration;
    setCurrentTime(clickedTime);
    
    // 发送到主进程进行跳转
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('seek-video', clickedTime);
    }
  };

  // 添加剪辑
  const addClip = () => {
    const start = currentTime;
    const end = Math.min(currentTime + 10, duration);
    const newClip: Clip = {
      id: Date.now(),
      startTime: start,
      endTime: end,
      label: `Clip ${clips.length + 1}`,
      color: `hsl(${Math.random() * 360}, 70%, 60%)`
    };
    setClips([...clips, newClip]);
  };

  // 添加标记
  const addMarker = (type: string) => {
    const markerTypes: Record<string, { label: string; color: string }> = {
      goal: { label: 'Goal', color: '#2ecc71' },
      shot: { label: 'Shot', color: '#f39c12' },
      foul: { label: 'Foul', color: '#e74c3c' },
      save: { label: 'Save', color: '#3498db' },
      generic: { label: 'Marker', color: '#95a5a6' }
    };

    const markerType = markerTypes[type] || markerTypes.generic;
    const newMarker: Marker = {
      id: Date.now(),
      time: currentTime,
      type,
      label: markerType.label,
      color: markerType.color
    };
    setMarkers([...markers, newMarker]);
  };

  // 删除剪辑
  const deleteClip = (clipId: number) => {
    setClips(clips.filter(clip => clip.id !== clipId));
  };

  // 删除标记
  const deleteMarker = (markerId: number) => {
    setMarkers(markers.filter(marker => marker.id !== markerId));
  };

  // 计算时间线位置
  const getTimelinePosition = (time: number) => {
    return (time / duration) * 100;
  };

  // 缩放控制
  const zoomIn = () => {
    setZoom(Math.min(zoom * 1.5, 10));
  };

  const zoomOut = () => {
    setZoom(Math.max(zoom / 1.5, 0.1));
  };

  // 剪辑持续时间
  const totalClipDuration = clips.reduce((total, clip) => {
    return total + (clip.endTime - clip.startTime);
  }, 0);

  if (!videoPath) {
    return (
      <div className="timeline-empty">
        <div className="empty-state">
          <div className="empty-icon">⏱️</div>
          <h3>No Video Loaded</h3>
          <p>Open a video to see the timeline</p>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline-container">
      {/* 控制栏 */}
      <div className="timeline-controls">
        <div className="control-group">
          <button 
            className="control-btn"
            onClick={addClip}
            title="Add Clip at Current Time"
          >
            ✂️ Add Clip
          </button>
          
          <div className="marker-buttons">
            <button 
              className="marker-btn goal"
              onClick={() => addMarker('goal')}
              title="Add Goal Marker"
            >
              ⚽
            </button>
            <button 
              className="marker-btn shot"
              onClick={() => addMarker('shot')}
              title="Add Shot Marker"
            >
              🎯
            </button>
            <button 
              className="marker-btn foul"
              onClick={() => addMarker('foul')}
              title="Add Foul Marker"
            >
              ⚠️
            </button>
            <button 
              className="marker-btn save"
              onClick={() => addMarker('save')}
              title="Add Save Marker"
            >
              🧤
            </button>
          </div>
        </div>

        <div className="control-group">
          <div className="zoom-controls">
            <button onClick={zoomOut} title="Zoom Out">🔍−</button>
            <span>Zoom: {zoom.toFixed(1)}x</span>
            <button onClick={zoomIn} title="Zoom In">🔍+</button>
          </div>
          
          <div className="time-display">
            <span className="current-time">{formatTime(currentTime)}</span>
            <span className="separator">/</span>
            <span className="total-time">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="control-group">
          <div className="stats">
            <span className="stat-item">
              Clips: <strong>{clips.length}</strong>
            </span>
            <span className="stat-item">
              Markers: <strong>{markers.length}</strong>
            </span>
            <span className="stat-item">
              Duration: <strong>{formatTime(totalClipDuration)}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* 时间线主体 */}
      <div 
        className="timeline-track"
        ref={timelineRef}
        onClick={handleTimelineClick}
        style={{ transform: `scaleX(${zoom})` }}
      >
        {/* 时间刻度 */}
        <div className="time-ticks">
          {Array.from({ length: Math.ceil(duration / 10) + 1 }).map((_, i) => {
            const time = i * 10;
            return (
              <div 
                key={i}
                className="time-tick"
                style={{ left: `${getTimelinePosition(time)}%` }}
              >
                <div className="tick-line"></div>
                <div className="tick-label">{formatTime(time)}</div>
              </div>
            );
          })}
        </div>

        {/* 剪辑轨道 */}
        <div className="clips-track">
          {clips.map(clip => (
            <div
              key={clip.id}
              className="clip-segment"
              style={{
                left: `${getTimelinePosition(clip.startTime)}%`,
                width: `${getTimelinePosition(clip.endTime - clip.startTime)}%`,
                backgroundColor: clip.color
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedClip(clip.id);
              }}
            >
              <div className="clip-label">{clip.label}</div>
              <div className="clip-duration">
                {formatTime(clip.endTime - clip.startTime)}
              </div>
              {selectedClip === clip.id && (
                <button 
                  className="delete-clip"
                  onClick={() => deleteClip(clip.id)}
                  title="Delete Clip"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 标记轨道 */}
        <div className="markers-track">
          {markers.map(marker => (
            <div
              key={marker.id}
              className="marker"
              style={{
                left: `${getTimelinePosition(marker.time)}%`,
                borderColor: marker.color
              }}
              title={`${marker.label} at ${formatTime(marker.time)}`}
              onClick={(e) => {
                e.stopPropagation();
                setCurrentTime(marker.time);
              }}
            >
              <div className="marker-icon">
                {marker.type === 'goal' && '⚽'}
                {marker.type === 'shot' && '🎯'}
                {marker.type === 'foul' && '⚠️'}
                {marker.type === 'save' && '🧤'}
                {!['goal', 'shot', 'foul', 'save'].includes(marker.type) && '📍'}
              </div>
              <div className="marker-tooltip">
                {marker.label}
                <button 
                  className="delete-marker"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMarker(marker.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 当前时间指针 */}
        <div 
          className="playhead"
          style={{ left: `${getTimelinePosition(currentTime)}%` }}
        >
          <div className="playhead-line"></div>
          <div className="playhead-time">{formatTime(currentTime)}</div>
        </div>

        {/* 进度条背景 */}
        <div className="timeline-background">
          <div 
            className="progress-bar"
            style={{ width: `${getTimelinePosition(currentTime)}%` }}
          ></div>
        </div>
      </div>

      {/* 剪辑列表 */}
      <div className="clips-list">
        <h4>📋 Clips ({clips.length})</h4>
        {clips.length === 0 ? (
          <div className="empty-list">No clips added yet</div>
        ) : (
          <div className="clips-container">
            {clips.map(clip => (
              <div 
                key={clip.id} 
                className={`clip-item ${selectedClip === clip.id ? 'selected' : ''}`}
                onClick={() => setSelectedClip(clip.id)}
                style={{ borderLeftColor: clip.color }}
              >
                <div className="clip-info">
                  <div className="clip-name">{clip.label}</div>
                  <div className="clip-time">
                    {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                  </div>
                </div>
                <div className="clip-actions">
                  <button 
                    className="action-btn play"
                    onClick={() => setCurrentTime(clip.startTime)}
                    title="Play from here"
                  >
                    ▶️
                  </button>
                  <button 
                    className="action-btn delete"
                    onClick={() => deleteClip(clip.id)}
                    title="Delete clip"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 标记列表 */}
      <div className="markers-list">
        <h4>📍 Markers ({markers.length})</h4>
        {markers.length === 0 ? (
          <div className="empty-list">No markers added yet</div>
        ) : (
          <div className="markers-container">
            {markers.map(marker => (
              <div 
                key={marker.id} 
                className="marker-item"
                style={{ borderLeftColor: marker.color }}
                onClick={() => setCurrentTime(marker.time)}
              >
                <div className="marker-icon-small">
                  {marker.type === 'goal' && '⚽'}
                  {marker.type === 'shot' && '🎯'}
                  {marker.type === 'foul' && '⚠️'}
                  {marker.type === 'save' && '🧤'}
                </div>
                <div className="marker-info">
                  <div className="marker-label">{marker.label}</div>
                  <div className="marker-time">{formatTime(marker.time)}</div>
                </div>
                <button 
                  className="delete-marker-small"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMarker(marker.id);
                  }}
                  title="Delete marker"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 时间线提示 */}
      <div className="timeline-hint">
        <div className="hint-item">
          <div className="hint-color clip"></div>
          <span>Click to add clips</span>
        </div>
        <div className="hint-item">
          <div className="hint-color marker"></div>
          <span>Use buttons to add markers</span>
        </div>
        <div className="hint-item">
          <div className="hint-color playhead"></div>
          <span>Drag or click to seek</span>
        </div>
      </div>
    </div>
  );
};

export default Timeline;