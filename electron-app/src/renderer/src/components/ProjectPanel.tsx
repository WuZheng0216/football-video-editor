import React, { useMemo, useState } from 'react';
import './ProjectPanel.css';
import { MarkerType, TimelineClip, TimelineMarker } from '../types';

interface ProjectPanelProps {
  videoInfo: any;
  projectName: string;
  currentTime: number;
  clips: TimelineClip[];
  markers: TimelineMarker[];
  onProjectNameChange: (name: string) => void;
  onAddClip: (start: number, end: number, label: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  onDeleteClip: (clipId: string) => void;
  onToggleClip: (clipId: string) => void;
  onAddMarker: (type: MarkerType, label?: string) => void;
  onDeleteMarker: (markerId: string) => void;
}

const MARKER_OPTIONS: Array<{ type: MarkerType; label: string }> = [
  { type: 'goal', label: '进球' },
  { type: 'shot', label: '射门' },
  { type: 'foul', label: '犯规' },
  { type: 'save', label: '扑救' },
  { type: 'corner', label: '角球' },
  { type: 'note', label: '备注' },
];

const MARKER_COLOR: Record<MarkerType, string> = {
  goal: '#ef4444',
  shot: '#f59e0b',
  foul: '#6366f1',
  save: '#10b981',
  corner: '#8b5cf6',
  note: '#64748b',
};

const ProjectPanel: React.FC<ProjectPanelProps> = ({
  videoInfo,
  projectName,
  currentTime,
  clips,
  markers,
  onProjectNameChange,
  onAddClip,
  onUpdateClip,
  onDeleteClip,
  onToggleClip,
  onAddMarker,
  onDeleteMarker,
}) => {
  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;

  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(10);
  const [clipLabel, setClipLabel] = useState('手动片段');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  const formatTime = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const sortedClips = useMemo(() => [...clips].sort((a, b) => a.start - b.start), [clips]);
  const sortedMarkers = useMemo(() => [...markers].sort((a, b) => a.time - b.time), [markers]);

  const handleCreateClip = () => {
    const start = Math.min(inPoint, outPoint);
    const end = Math.max(inPoint, outPoint);
    if (end - start < 0.1) {
      alert('片段时长至少需要 0.1 秒。');
      return;
    }
    onAddClip(start, end, clipLabel || `手动片段 ${sortedClips.length + 1}`);
  };

  const handleAddTag = () => {
    const value = newTag.trim();
    if (!value || tags.includes(value)) {
      return;
    }
    setTags((prev) => [...prev, value]);
    setNewTag('');
  };

  const handleSaveProjectData = async () => {
    if (!ipcRenderer) {
      alert('当前不在 Electron 环境，无法保存项目文件。');
      return;
    }

    try {
      const payload = {
        name: projectName,
        videoInfo,
        clips,
        markers,
        notes,
        tags,
        updatedAt: new Date().toISOString(),
      };
      const res = await ipcRenderer.invoke('save-project-data', payload);
      if (res?.success) {
        alert(`项目已保存：${res.path}`);
      } else {
        alert('保存失败，请查看控制台。');
      }
    } catch (error: any) {
      alert(`保存失败：${error?.message || String(error)}`);
    }
  };

  return (
    <div className="project-panel">
      <section className="project-section">
        <div className="section-title-row">
          <h3>编辑面板</h3>
          <button className="btn-small" onClick={handleSaveProjectData}>
            保存项目数据
          </button>
        </div>
        <label className="field-label">
          项目名称
          <input value={projectName} onChange={(event) => onProjectNameChange(event.target.value)} placeholder="输入项目名称" />
        </label>
      </section>

      <section className="project-section">
        <h4>片段创建（入点/出点）</h4>
        <div className="current-time">当前播放时间：{formatTime(currentTime)} ({currentTime.toFixed(2)}s)</div>

        <div className="point-controls">
          <button className="btn-outline" onClick={() => setInPoint(currentTime)}>
            设为入点
          </button>
          <span>入点 {formatTime(inPoint)}</span>
          <button className="btn-outline" onClick={() => setOutPoint(currentTime)}>
            设为出点
          </button>
          <span>出点 {formatTime(outPoint)}</span>
        </div>

        <div className="clip-create-grid">
          <label className="field-label">
            入点秒数
            <input type="number" min={0} step={0.1} value={inPoint} onChange={(event) => setInPoint(Number(event.target.value) || 0)} />
          </label>
          <label className="field-label">
            出点秒数
            <input type="number" min={0} step={0.1} value={outPoint} onChange={(event) => setOutPoint(Number(event.target.value) || 0)} />
          </label>
          <label className="field-label">
            片段名称
            <input value={clipLabel} onChange={(event) => setClipLabel(event.target.value)} />
          </label>
        </div>
        <button className="btn-primary-block" onClick={handleCreateClip}>
          添加手动片段
        </button>
      </section>

      <section className="project-section">
        <h4>事件标记</h4>
        <div className="marker-grid">
          {MARKER_OPTIONS.map((item) => (
            <button key={item.type} className="marker-btn" onClick={() => onAddMarker(item.type)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="project-section">
        <div className="section-title-row">
          <h4>片段列表（{sortedClips.length}）</h4>
        </div>
        {sortedClips.length === 0 ? (
          <div className="empty-text">暂无片段，先创建手动片段或在 AI 工具中生成自动集锦。</div>
        ) : (
          <div className="clip-list">
            {sortedClips.map((clip) => (
              <div key={clip.id} className={`clip-row ${clip.enabled ? '' : 'disabled'}`}>
                <label className="checkbox-inline">
                  <input type="checkbox" checked={clip.enabled} onChange={() => onToggleClip(clip.id)} />
                  启用
                </label>
                <input
                  className="clip-label-input"
                  value={clip.label}
                  onChange={(event) => onUpdateClip(clip.id, { label: event.target.value })}
                />
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clip.start}
                  onChange={(event) => onUpdateClip(clip.id, { start: Number(event.target.value) || 0 })}
                />
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={clip.end}
                  onChange={(event) => onUpdateClip(clip.id, { end: Number(event.target.value) || 0 })}
                />
                <button className="btn-danger-text" onClick={() => onDeleteClip(clip.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="project-section">
        <h4>标记列表（{sortedMarkers.length}）</h4>
        {sortedMarkers.length === 0 ? (
          <div className="empty-text">暂无标记。</div>
        ) : (
          <div className="marker-list">
            {sortedMarkers.map((marker) => (
              <div key={marker.id} className="marker-row" style={{ borderLeftColor: MARKER_COLOR[marker.type] }}>
                <div className="marker-meta">
                  <strong>{marker.label}</strong>
                  <span>{formatTime(marker.time)}</span>
                </div>
                <button className="btn-danger-text" onClick={() => onDeleteMarker(marker.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="project-section">
        <h4>标签与备注</h4>
        <div className="tag-input-row">
          <input
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            placeholder="输入标签后回车或点击添加"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddTag();
              }
            }}
          />
          <button className="btn-small" onClick={handleAddTag}>
            添加
          </button>
        </div>
        {tags.length > 0 && (
          <div className="tag-list">
            {tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
                <button onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="记录战术、旁白、镜头说明等..." />
      </section>
    </div>
  );
};

export default ProjectPanel;
