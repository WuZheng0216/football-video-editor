import React, { useRef, useState, useEffect } from 'react';
import './VideoPlayer.css';

interface VideoPlayerProps {
  videoPath: string;
  videoInfo: any;
  isProcessing: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoPath, videoInfo, isProcessing }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [selectedArea, setSelectedArea] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{x: number, y: number} | null>(null);

  // 初始化视频
  useEffect(() => {
    if (videoRef.current && videoPath) {
      const video = videoRef.current;
      
      // 设置视频源
      const normalizedPath = videoPath.replace(/\\/g, '/');
      const fileUrl = normalizedPath.startsWith('/')
        ? `file://${normalizedPath}`
        : `file:///${normalizedPath}`;
      video.src = encodeURI(fileUrl);
      
      // 监听事件
      video.addEventListener('loadedmetadata', () => {
        setDuration(video.duration);
      });
      
      video.addEventListener('timeupdate', () => {
        setCurrentTime(video.currentTime);
      });
      
      video.addEventListener('play', () => {
        setIsPlaying(true);
      });
      
      video.addEventListener('pause', () => {
        setIsPlaying(false);
      });
      
      video.addEventListener('ended', () => {
        setIsPlaying(false);
      });
    }
  }, [videoPath]);

  // 控制视频播放
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    if (videoRef.current) {
      videoRef.current.volume = value;
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  // 截图功能
  const captureFrame = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // 转换为数据URL
        const dataUrl = canvas.toDataURL('image/png');
        
        // 下载图片
        const link = document.createElement('a');
        link.download = `frame_${Math.round(currentTime)}s.png`;
        link.href = dataUrl;
        link.click();
      }
    }
  };

  // 区域选择功能（用于局部放大）
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!videoRef.current) return;
    
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setIsSelecting(true);
    setSelectionStart({ x, y });
    setSelectedArea(null);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !selectionStart || !videoRef.current) return;
    
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const width = x - selectionStart.x;
    const height = y - selectionStart.y;
    
    // 更新选择区域
    setSelectedArea({
      x: selectionStart.x,
      y: selectionStart.y,
      width,
      height
    });
  };

  const handleCanvasMouseUp = () => {
    setIsSelecting(false);
    setSelectionStart(null);
    
    // 如果选择了区域，可以触发局部放大
    if (selectedArea && Math.abs(selectedArea.width) > 10 && Math.abs(selectedArea.height) > 10) {
      console.log('Selected area for zoom:', selectedArea);
      // 这里可以触发局部放大功能
    }
  };

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;
      
      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeek(Math.max(0, currentTime - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSeek(Math.min(duration, currentTime + 5));
          break;
        case 'f':
          e.preventDefault();
          if (videoRef.current.requestFullscreen) {
            videoRef.current.requestFullscreen();
          }
          break;
        case 's':
          e.preventDefault();
          captureFrame();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, duration]);

  if (!videoPath) {
    return (
      <div className="video-player-empty">
        <div className="empty-state">
          <div className="empty-icon">🎬</div>
          <h3>No Video Loaded</h3>
          <p>Open a video file to start editing</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="video-player-container"
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(false)}
    >
      {/* 视频元素 */}
      <div className="video-wrapper">
        <video
          ref={videoRef}
          className="video-element"
          onClick={togglePlay}
        />
        
        {/* 用于区域选择的画布 */}
        <canvas
          ref={canvasRef}
          className="selection-canvas"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
        
        {/* 选择区域可视化 */}
        {selectedArea && (
          <div 
            className="selection-overlay"
            style={{
              left: `${selectedArea.x}px`,
              top: `${selectedArea.y}px`,
              width: `${Math.abs(selectedArea.width)}px`,
              height: `${Math.abs(selectedArea.height)}px`,
              border: '2px dashed #00ff00'
            }}
          />
        )}
        
        {/* 加载指示器 */}
        {isProcessing && (
          <div className="processing-overlay">
            <div className="spinner"></div>
            <span>Processing...</span>
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className={`video-controls ${showControls ? 'visible' : 'hidden'}`}>
        {/* 播放控制 */}
        <div className="controls-section">
          <button 
            className="control-btn"
            onClick={togglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? '⏸️' : '▶️'}
          </button>
          
          <button 
            className="control-btn"
            onClick={() => handleSeek(Math.max(0, currentTime - 5))}
            title="Rewind 5s (←)"
          >
            ⏪
          </button>
          
          <button 
            className="control-btn"
            onClick={() => handleSeek(Math.min(duration, currentTime + 5))}
            title="Forward 5s (→)"
          >
            ⏩
          </button>
          
          <button 
            className="control-btn"
            onClick={captureFrame}
            title="Capture Frame (S)"
          >
            📸
          </button>
        </div>

        {/* 时间线 */}
        <div className="controls-section timeline-section">
          <span className="time-display">{formatTime(currentTime)}</span>
          
          <input
            type="range"
            className="timeline-slider"
            min="0"
            max={duration || 100}
            value={currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            step="0.1"
          />
          
          <span className="time-display">{formatTime(duration)}</span>
        </div>

        {/* 音量和其他设置 */}
        <div className="controls-section">
          <div className="volume-control">
            <span className="control-icon">🔊</span>
            <input
              type="range"
              className="volume-slider"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            />
          </div>
          
          <select
            className="playback-rate-select"
            value={playbackRate}
            onChange={(e) => handlePlaybackRateChange(parseFloat(e.target.value))}
          >
            <option value="0.25">0.25x</option>
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1x (Normal)</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          
          <button 
            className="control-btn"
            onClick={() => {
              if (videoRef.current?.requestFullscreen) {
                videoRef.current.requestFullscreen();
              }
            }}
            title="Fullscreen (F)"
          >
            ⛶
          </button>
        </div>
      </div>

      {/* 视频信息 */}
      <div className="video-info">
        <div className="info-row">
          <span className="info-label">File:</span>
          <span className="info-value">{videoInfo?.filename || 'Unknown'}</span>
        </div>
        
        <div className="info-row">
          <span className="info-label">Resolution:</span>
          <span className="info-value">
            {videoInfo?.width || 0}x{videoInfo?.height || 0}
          </span>
        </div>
        
        <div className="info-row">
          <span className="info-label">Duration:</span>
          <span className="info-value">
            {formatTime(videoInfo?.duration || 0)}
          </span>
        </div>
        
        <div className="info-row">
          <span className="info-label">FPS:</span>
          <span className="info-value">
            {videoInfo?.fps ? Math.round(videoInfo.fps) : 'Unknown'}
          </span>
        </div>
      </div>

      {/* 快捷操作提示 */}
      <div className="shortcuts-hint">
        <div className="shortcut-item">
          <kbd>Space</kbd>
          <span>Play/Pause</span>
        </div>
        
        <div className="shortcut-item">
          <kbd>←</kbd>
          <kbd>→</kbd>
          <span>Seek 5s</span>
        </div>
        
        <div className="shortcut-item">
          <kbd>S</kbd>
          <span>Capture Frame</span>
        </div>
        
        <div className="shortcut-item">
          <kbd>F</kbd>
          <span>Fullscreen</span>
        </div>
        
        <div className="shortcut-item">
          <span>Drag</span>
          <span>Select Area</span>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
