import React, { useMemo, useState } from 'react';
import './ExportPanel.css';
import { ClipItem, TimelineSnapshot } from '../types';

interface ExportPanelProps {
  videoPath: string;
  videoInfo: any;
  timelineSnapshot: TimelineSnapshot | null;
  onExported?: (result: any) => void;
}

function isClipItem(item: any): item is ClipItem {
  return item?.kind === 'clip';
}

function cloneSnapshot(snapshot: TimelineSnapshot): TimelineSnapshot {
  return JSON.parse(JSON.stringify(snapshot));
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const ExportPanel: React.FC<ExportPanelProps> = ({ videoPath, videoInfo, timelineSnapshot, onExported }) => {
  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
  const [mode, setMode] = useState<'timeline' | 'clips'>('timeline');
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [settings, setSettings] = useState({
    format: 'mp4',
    quality: 'high',
    resolution: '1080p',
    fps: 30,
    includeAudio: true,
    fileName: '足球时间线导出',
    outputPath: '',
  });

  const mainTrack = useMemo(() => timelineSnapshot?.tracks.find((track) => track.type === 'video') || null, [timelineSnapshot]);
  const originalClip = useMemo(
    () => (mainTrack?.items.find((item) => isClipItem(item) && item.sourceType === 'original') as ClipItem | null) || null,
    [mainTrack],
  );
  const highlightCandidates = useMemo(
    () => (timelineSnapshot?.tracks.find((track) => track.type === 'overlay')?.items.filter(isClipItem).sort((a, b) => a.start - b.start) || []),
    [timelineSnapshot],
  );
  const enabledCandidates = useMemo(() => highlightCandidates.filter((clip) => clip.enabled), [highlightCandidates]);
  const activeClips = useMemo(
    () => (mode === 'clips' ? enabledCandidates.filter((clip) => selectedClipIds.includes(clip.id)) : enabledCandidates),
    [enabledCandidates, mode, selectedClipIds],
  );

  const issues = useMemo(() => {
    const list: string[] = [];
    const duration = Number(videoInfo?.duration || 0);

    if (!timelineSnapshot) list.push('\u5f53\u524d\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u65f6\u95f4\u7ebf\u5feb\u7167\u3002');
    if (!videoPath) list.push('\u8bf7\u5148\u5bfc\u5165\u89c6\u9891\u3002');
    if (duration <= 0) list.push('\u5f53\u524d\u65e0\u6cd5\u8bfb\u53d6\u5b8c\u6574\u89c6\u9891\u65f6\u957f\uff0c\u901a\u5e38\u662f ffprobe \u7f3a\u5931\u6216\u5143\u6570\u636e\u89e3\u6790\u5931\u8d25\u3002');
    if (!originalClip) list.push('\u4e3b\u89c6\u9891\u8f68\u7f3a\u5c11\u5b8c\u6574\u539f\u59cb\u7d20\u6750\u3002');
    if (mode === 'clips' && !activeClips.length) list.push('\u5f53\u524d\u672a\u9009\u62e9\u4efb\u4f55\u9ad8\u5149\u5019\u9009\u7247\u6bb5\u3002');
    if (!settings.outputPath) list.push('\u8bf7\u5148\u9009\u62e9\u5bfc\u51fa\u8def\u5f84\u3002');

    return list;
  }, [activeClips.length, mode, originalClip, settings.outputPath, timelineSnapshot, videoInfo, videoPath]);

  const browseOutput = async () => {
    if (!ipcRenderer) return;
    const save = await ipcRenderer.invoke('open-save-dialog', {
      title: '\u9009\u62e9\u5bfc\u51fa\u89c6\u9891',
      defaultPath: `${settings.fileName}.${settings.format}`,
      filters: [{ name: '\u89c6\u9891\u6587\u4ef6', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }],
    });
    if (save && !save.canceled) setSettings((prev) => ({ ...prev, outputPath: save.filePath }));
  };

  const buildSnapshotForExport = () => {
    if (!timelineSnapshot) return null;
    const snapshot = cloneSnapshot(timelineSnapshot);
    if (mode !== 'clips') return snapshot;

    const overlayTrack = snapshot.tracks.find((item) => item.type === 'overlay');
    if (overlayTrack) {
      overlayTrack.items = overlayTrack.items.map((item) => (
        isClipItem(item)
          ? { ...item, enabled: item.enabled && selectedClipIds.includes(item.id) }
          : item
      ));
    }

    return snapshot;
  };

  const startExport = async () => {
    if (!ipcRenderer || issues.length) return;
    const snapshot = buildSnapshotForExport();
    if (!snapshot) return;

    setIsExporting(true);
    setProgress(0);
    setResult(null);

    const timer = window.setInterval(() => setProgress((prev) => Math.min(95, prev + 4)), 120);
    try {
      const response = await ipcRenderer.invoke('export-video', {
        inputPath: videoPath,
        outputPath: settings.outputPath,
        settings: {
          ...settings,
          mode,
          timelineSnapshot: snapshot,
        },
      });
      setResult(response);
      setProgress(100);
      onExported?.(response);
    } catch (error) {
      setResult({ success: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      window.clearInterval(timer);
      setIsExporting(false);
    }
  };

  return (
    <div className="export-panel">
      <div className="panel-header">
        <h3>{'\u5bfc\u51fa'}</h3>
        <p className="panel-subtitle">{'\u5bfc\u51fa\u4f1a\u57fa\u4e8e\u5f53\u524d\u65f6\u95f4\u7ebf\u7ed3\u679c\u3002\u5de6\u4fa7\u9884\u89c8\u5230\u4ec0\u4e48\uff0c\u53f3\u4fa7\u5c31\u5bfc\u51fa\u4ec0\u4e48\u3002'}</p>
      </div>

      <section className="export-section">
        <h4>{'\u5bfc\u51fa\u8303\u56f4'}</h4>
        <div className="mode-row">
          <label><input type="radio" checked={mode === 'timeline'} onChange={() => setMode('timeline')} />{'\u5f53\u524d\u65f6\u95f4\u7ebf'}</label>
          <label><input type="radio" checked={mode === 'clips'} onChange={() => setMode('clips')} />{'\u9009\u4e2d\u7247\u6bb5'}</label>
        </div>
      </section>

      {mode === 'clips' ? (
        <section className="export-section">
          <h4>{'\u5019\u9009\u7247\u6bb5'}</h4>
          <div className="clip-select-list">
            {enabledCandidates.length ? enabledCandidates.map((clip) => (
              <label key={clip.id} className="clip-select-item">
                <input
                  type="checkbox"
                  checked={selectedClipIds.includes(clip.id)}
                  onChange={(event) => setSelectedClipIds((prev) => (
                    event.target.checked ? [...prev, clip.id] : prev.filter((id) => id !== clip.id)
                  ))}
                />
                <span>{clip.label} | {formatTime(clip.start)} - {formatTime(clip.end)}</span>
              </label>
            )) : <div className="empty-placeholder">{'\u5f53\u524d\u6ca1\u6709\u5df2\u52a0\u5165\u7d20\u6750\u8f68\u7684\u9ad8\u5149\u5019\u9009\u7247\u6bb5\u3002'}</div>}
          </div>
        </section>
      ) : null}

      {issues.length ? (
        <section className="export-section">
          <h4>{'\u5bfc\u51fa\u524d\u68c0\u67e5'}</h4>
          <div className="result-warnings">{issues.map((issue, index) => <div key={`${issue}_${index}`}>{issue}</div>)}</div>
        </section>
      ) : null}

      <section className="export-section">
        <h4>{'\u5bfc\u51fa\u8bbe\u7f6e'}</h4>
        <div className="settings-grid">
          <label>
            {'\u683c\u5f0f'}
            <select value={settings.format} onChange={(event) => setSettings((prev) => ({ ...prev, format: event.target.value }))}>
              <option value="mp4">MP4</option>
              <option value="mov">MOV</option>
              <option value="avi">AVI</option>
              <option value="mkv">MKV</option>
              <option value="webm">WebM</option>
            </select>
          </label>
          <label>
            {'\u5206\u8fa8\u7387'}
            <select value={settings.resolution} onChange={(event) => setSettings((prev) => ({ ...prev, resolution: event.target.value }))}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="1440p">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
          <label>
            {'\u8d28\u91cf'}
            <select value={settings.quality} onChange={(event) => setSettings((prev) => ({ ...prev, quality: event.target.value }))}>
              <option value="low">{'\u4f4e'}</option>
              <option value="medium">{'\u4e2d'}</option>
              <option value="high">{'\u9ad8'}</option>
              <option value="ultra">{'\u8d85\u9ad8'}</option>
            </select>
          </label>
          <label>
            {'\u5e27\u7387'}
            <select value={settings.fps} onChange={(event) => setSettings((prev) => ({ ...prev, fps: Number(event.target.value) }))}>
              <option value={24}>24 FPS</option>
              <option value={30}>30 FPS</option>
              <option value={50}>50 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </label>
        </div>

        <label className="settings-inline">
          {'\u6587\u4ef6\u540d'}
          <input value={settings.fileName} onChange={(event) => setSettings((prev) => ({ ...prev, fileName: event.target.value }))} />
        </label>

        <label className="settings-inline">
          {'\u8f93\u51fa\u8def\u5f84'}
          <div className="path-row">
            <input value={settings.outputPath} readOnly />
            <button type="button" onClick={browseOutput}>{'\u9009\u62e9'}</button>
          </div>
        </label>

        <label className="checkbox-row compact">
          <input type="checkbox" checked={settings.includeAudio} onChange={(event) => setSettings((prev) => ({ ...prev, includeAudio: event.target.checked }))} />
          {'\u4fdd\u7559\u97f3\u9891'}
        </label>
      </section>

      <section className="export-section">
        <button className="export-btn" onClick={startExport} disabled={Boolean(issues.length) || isExporting}>
          {isExporting ? `\u5bfc\u51fa\u4e2d ${progress}%` : '\u5f00\u59cb\u5bfc\u51fa'}
        </button>
        {result ? (
          <div className={`result-box ${result.success ? 'success' : 'error'}`}>
            {result.success ? `\u5bfc\u51fa\u5b8c\u6210\uff1a${result.outputPath}` : `\u5bfc\u51fa\u5931\u8d25\uff1a${result.message || result.error || '\u672a\u77e5\u9519\u8bef'}`}
          </div>
        ) : null}
      </section>
    </div>
  );
};

export default ExportPanel;
