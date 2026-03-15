import React, { useState } from 'react';
import './ProjectPanel.css';

interface ProjectPanelProps {
  videoInfo: any;
  projectName: string;
  onProjectNameChange: (name: string) => void;
}

const ProjectPanel: React.FC<ProjectPanelProps> = ({ 
  videoInfo, 
  projectName, 
  onProjectNameChange 
}) => {
  const [clips, setClips] = useState<any[]>([]);
  const [markers, setMarkers] = useState<any[]>([]);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  const { ipcRenderer } = window.require('electron');

  // 添加标记点
  const addMarker = (time: number, type: string = 'generic') => {
    const newMarker = {
      id: Date.now(),
      time,
      type,
      label: `${type.charAt(0).toUpperCase() + type.slice(1)} at ${formatTime(time)}`,
      color: getMarkerColor(type)
    };
    setMarkers([...markers, newMarker]);
  };

  // 添加剪辑片段
  const addClip = (startTime: number, endTime: number, label: string) => {
    const newClip = {
      id: Date.now(),
      startTime,
      endTime,
      duration: endTime - startTime,
      label,
      tags: []
    };
    setClips([...clips, newClip]);
  };

  // 添加标签
  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag('');
    }
  };

  // 删除标签
  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  // 删除剪辑
  const handleRemoveClip = (clipId: number) => {
    setClips(clips.filter(clip => clip.id !== clipId));
  };

  // 删除标记
  const handleRemoveMarker = (markerId: number) => {
    setMarkers(markers.filter(marker => marker.id !== markerId));
  };

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 获取标记颜色
  const getMarkerColor = (type: string) => {
    const colors: Record<string, string> = {
      goal: '#e74c3c',
      shot: '#f39c12',
      foul: '#3498db',
      save: '#2ecc71',
      corner: '#9b59b6',
      generic: '#95a5a6'
    };
    return colors[type] || colors.generic;
  };

  // 保存项目
  const handleSaveProject = async () => {
    const projectData = {
      name: projectName,
      videoInfo,
      clips,
      markers,
      notes,
      tags,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      const result = await ipcRenderer.invoke('save-project-data', projectData);
      if (result.success) {
        alert(`Project saved to: ${result.path}`);
      }
    } catch (error) {
      alert(`Failed to save project: ${error.message}`);
    }
  };

  // 计算统计信息
  const stats = {
    totalClips: clips.length,
    totalDuration: clips.reduce((sum, clip) => sum + clip.duration, 0),
    totalMarkers: markers.length,
    goalMarkers: markers.filter(m => m.type === 'goal').length,
    shotMarkers: markers.filter(m => m.type === 'shot').length
  };

  return (
    <div className="project-panel">
      {/* 项目信息 */}
      <div className="project-info-section">
        <h3>📁 Project</h3>
        <div className="project-name-input">
          <input
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            placeholder="Enter project name"
          />
          <button 
            className="btn-save"
            onClick={handleSaveProject}
            title="Save Project"
          >
            💾
          </button>
        </div>

        {/* 视频信息 */}
        {videoInfo && (
          <div className="video-info-card">
            <h4>Video Information</h4>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Filename:</span>
                <span className="info-value">{videoInfo.filename}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Duration:</span>
                <span className="info-value">{formatTime(videoInfo.duration)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Resolution:</span>
                <span className="info-value">{videoInfo.width}x{videoInfo.height}</span>
              </div>
              <div className="info-item">
                <span className="info-label">FPS:</span>
                <span className="info-value">{Math.round(videoInfo.fps)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Size:</span>
                <span className="info-value">
                  {(videoInfo.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Format:</span>
                <span className="info-value">{videoInfo.format}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 快速标记 */}
      <div className="quick-markers-section">
        <h4>🚩 Quick Markers</h4>
        <div className="marker-buttons">
          <button 
            className="marker-btn goal"
            onClick={() => addMarker(videoInfo?.currentTime || 0, 'goal')}
          >
            ⚽ Goal
          </button>
          <button 
            className="marker-btn shot"
            onClick={() => addMarker(videoInfo?.currentTime || 0, 'shot')}
          >
            🎯 Shot
          </button>
          <button 
            className="marker-btn foul"
            onClick={() => addMarker(videoInfo?.currentTime || 0, 'foul')}
          >
            ⚠️ Foul
          </button>
          <button 
            className="marker-btn save"
            onClick={() => addMarker(videoInfo?.currentTime || 0, 'save')}
          >
            🧤 Save
          </button>
          <button 
            className="marker-btn corner"
            onClick={() => addMarker(videoInfo?.currentTime || 0, 'corner')}
          >
            🎯 Corner
          </button>
          <button 
            className="marker-btn generic"
            onClick={() => addMarker(videoInfo?.currentTime || 0, 'generic')}
          >
            📍 Marker
          </button>
        </div>
      </div>

      {/* 剪辑列表 */}
      <div className="clips-section">
        <div className="section-header">
          <h4>🎬 Clips ({stats.totalClips})</h4>
          <button 
            className="btn-add-clip"
            onClick={() => {
              const start = prompt('Enter start time (seconds):', '0');
              const end = prompt('Enter end time (seconds):', '10');
              const label = prompt('Enter clip label:', 'Clip');
              
              if (start && end && label) {
                addClip(parseFloat(start), parseFloat(end), label);
              }
            }}
          >
            + Add Clip
          </button>
        </div>
        
        {clips.length === 0 ? (
          <div className="empty-state">
            <p>No clips added yet. Add clips to create highlights.</p>
          </div>
        ) : (
          <div className="clips-list">
            {clips.map(clip => (
              <div key={clip.id} className="clip-card">
                <div className="clip-header">
                  <span className="clip-label">{clip.label}</span>
                  <button 
                    className="btn-remove"
                    onClick={() => handleRemoveClip(clip.id)}
                  >
                    ×
                  </button>
                </div>
                <div className="clip-info">
                  <span className="clip-time">
                    {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                  </span>
                  <span className="clip-duration">
                    Duration: {formatTime(clip.duration)}
                  </span>
                </div>
                <div className="clip-actions">
                  <button className="btn-action">Preview</button>
                  <button className="btn-action">Export</button>
                  <button className="btn-action">Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 标记列表 */}
      <div className="markers-section">
        <div className="section-header">
          <h4>📍 Markers ({stats.totalMarkers})</h4>
        </div>
        
        {markers.length === 0 ? (
          <div className="empty-state">
            <p>No markers added yet. Use quick markers to add events.</p>
          </div>
        ) : (
          <div className="markers-list">
            {markers.map(marker => (
              <div 
                key={marker.id} 
                className="marker-item"
                style={{ borderLeftColor: marker.color }}
              >
                <div className="marker-content">
                  <div className="marker-type">{marker.label}</div>
                  <div className="marker-time">{formatTime(marker.time)}</div>
                </div>
                <button 
                  className="btn-remove"
                  onClick={() => handleRemoveMarker(marker.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 标记统计 */}
        {markers.length > 0 && (
          <div className="markers-stats">
            <div className="stat-item">
              <span className="stat-label">Goals:</span>
              <span className="stat-value goal">{stats.goalMarkers}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Shots:</span>
              <span className="stat-value shot">{stats.shotMarkers}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total:</span>
              <span className="stat-value">{stats.totalMarkers}</span>
            </div>
          </div>
        )}
      </div>

      {/* 标签管理 */}
      <div className="tags-section">
        <h4>🏷️ Tags</h4>
        <div className="tags-input">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add a tag"
            onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
          />
          <button onClick={handleAddTag}>Add</button>
        </div>
        
        {tags.length > 0 && (
          <div className="tags-list">
            {tags.map(tag => (
              <div key={tag} className="tag-item">
                <span>{tag}</span>
                <button onClick={() => handleRemoveTag(tag)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 笔记 */}
      <div className="notes-section">
        <h4>📝 Notes</h4>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add notes about this project..."
          rows={4}
        />
        <div className="notes-info">
          <span>{notes.length} characters</span>
          <button 
            className="btn-save"
            onClick={() => alert('Notes saved')}
          >
            Save Notes
          </button>
        </div>
      </div>

      {/* 项目统计 */}
      <div className="project-stats">
        <h4>📊 Project Statistics</h4>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-number">{stats.totalClips}</div>
            <div className="stat-label">Clips</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{formatTime(stats.totalDuration)}</div>
            <div className="stat-label">Total Duration</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{stats.totalMarkers}</div>
            <div className="stat-label">Markers</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{tags.length}</div>
            <div className="stat-label">Tags</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectPanel;