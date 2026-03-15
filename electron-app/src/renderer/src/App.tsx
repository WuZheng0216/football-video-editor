import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import VideoPlayer from './components/VideoPlayer';
import Timeline from './components/Timeline';
import AIToolsPanel from './components/AIToolsPanel';
import ExportPanel from './components/ExportPanel';
import {
  AiPresetId,
  AiRunScope,
  AiRunSummary,
  AiRuntimeConfig,
  ClipItem,
  EffectControlState,
  EffectItem,
  EffectKeyframe,
  EffectOperation,
  HighlightClip,
  SelectionState,
  SidebarTab,
  TargetBinding,
  TimelineItem,
  TimelineSnapshot,
  Track,
} from './types';

type PlayerCommand = { nonce: number; type: 'toggle-play' | 'step-forward' | 'step-backward' | 'seek'; time?: number };

const MAIN_TRACK_ID = 'track_video_main';
const EFFECT_TRACK_ID = 'track_effect_ai';
const OVERLAY_TRACK_ID = 'track_overlay_asset';
const MIN_DURATION = 1 / 30;

const PRESET_LABEL: Record<AiPresetId, string> = {
  'detect-players': '\u7403\u5458\u68c0\u6d4b',
  'track-players': '\u591a\u76ee\u6807\u8ddf\u8e2a',
  'magnifier-effect': '\u653e\u5927\u955c',
  'player-pov': '\u7403\u5458\u89c6\u89d2',
  'auto-highlight': '\u81ea\u52a8\u9ad8\u5149',
};

const DEFAULT_EFFECT: EffectControlState = {
  activeTool: 'magnifier-effect',
  controlMode: 'hybrid',
  interactionMode: 'cursor-follow',
  manual: { anchor: null, directionDeg: null },
  params: { magnifierRadius: 120, magnifierZoom: 2, magnifierFeather: 10, povAngle: 60, fovAperture: 60, fovLength: 320, fovDim: 0.5 },
  targetBinding: null,
};

const DEFAULT_AI_RUNTIME: AiRuntimeConfig = {
  confidenceThreshold: 0.35,
  maxFrames: 0,
  writeVideo: true,
  focusMode: 'player',
  modelPreference: 'best',
  customModelPath: '',
};

const id = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const fileName = (inputPath: string) => inputPath.split(/[/\\]/).pop() || '\u672a\u547d\u540d\u89c6\u9891';
const formatTime = (seconds: number) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}.${String(Math.floor((Math.max(0, seconds) % 1) * 100)).padStart(2, '0')}`;
const normalizeRange = (start: number, end: number) => Math.max(start, end) - Math.min(start, end) < MIN_DURATION ? { start: Math.max(0, Math.min(start, end)), end: Math.max(0, Math.min(start, end)) + MIN_DURATION } : { start: Math.max(0, Math.min(start, end)), end: Math.max(start, end) };
const createTracks = (videoPath: string, duration: number): Track[] => {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const clip: ClipItem | null = videoPath && safeDuration > 0 ? { id: id('clip'), kind: 'clip', trackId: MAIN_TRACK_ID, label: '\u539f\u59cb\u7d20\u6750', start: 0, end: safeDuration, enabled: true, sourcePath: videoPath, sourceStart: 0, sourceEnd: safeDuration, sourceType: 'original' } : null;
  return [
    { id: MAIN_TRACK_ID, type: 'video', name: '\u4e3b\u89c6\u9891\u8f68', order: 0, enabled: true, items: clip ? [clip] : [] },
    { id: EFFECT_TRACK_ID, type: 'effect', name: 'AI \u6548\u679c\u8f68', order: 1, enabled: true, items: [] },
    { id: OVERLAY_TRACK_ID, type: 'overlay', name: '\u7d20\u6750 / \u8986\u76d6\u8f68', order: 2, enabled: true, items: [] },
  ];
};

function App() {
  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer as any;
  const [videoPath, setVideoPath] = useState('');
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [tracks, setTracks] = useState<Track[]>(createTracks('', 0));
  const [selection, setSelection] = useState<SelectionState>({ trackId: null, itemId: null });
  const [playheadTime, setPlayheadTime] = useState(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [playerCommand, setPlayerCommand] = useState<PlayerCommand | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('inspector');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [focusMonitor, setFocusMonitor] = useState(false);
  const [monitorView, setMonitorView] = useState<'fit' | 'original'>('fit');
  const [statusText, setStatusText] = useState('\u8bf7\u5148\u5bfc\u5165\u89c6\u9891\u3002');
  const [isProcessing, setIsProcessing] = useState(false);
  const [effectControl, setEffectControl] = useState<EffectControlState>(clone(DEFAULT_EFFECT));
  const [aiRuntimeConfig, setAiRuntimeConfig] = useState<AiRuntimeConfig>(clone(DEFAULT_AI_RUNTIME));
  const [aiRunScope, setAiRunScope] = useState<AiRunScope>('selection');
  const [selectedAiPreset, setSelectedAiPreset] = useState<AiPresetId>('detect-players');
  const [runningTool, setRunningTool] = useState<AiPresetId | null>(null);
  const [aiResult, setAiResult] = useState<any>(null);
  const [summary, setSummary] = useState<AiRunSummary | null>(null);
  const [highlights, setHighlights] = useState<HighlightClip[]>([]);
  const [highlightDuration, setHighlightDuration] = useState(10);
  const [maxHighlights, setMaxHighlights] = useState(6);
  const [previewTargetBinding, setPreviewTargetBinding] = useState<TargetBinding | null>(null);
  const [undoStack, setUndoStack] = useState<Track[][]>([]);
  const [redoStack, setRedoStack] = useState<Track[][]>([]);
  const nonceRef = useRef(0);
  const tracksRef = useRef(tracks);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  const duration = useMemo(() => Math.max(0, Number(videoInfo?.duration || 0), ...tracks.flatMap((track) => track.items.map((item) => item.end))), [tracks, videoInfo]);
  const fps = useMemo(() => Math.max(1, Number(videoInfo?.fps || 30)), [videoInfo]);
  const snapshot = useMemo<TimelineSnapshot | null>(() => (videoPath ? { version: 4, sourceVideoPath: videoPath, duration, fps, tracks: clone(tracks) } : null), [duration, fps, tracks, videoPath]);
  const selectedEntry = useMemo(() => { const track = tracks.find((item) => item.id === selection.trackId); const item = track?.items.find((entry) => entry.id === selection.itemId); return track && item ? { track, item } : null; }, [selection, tracks]);
  const selectedEffect = selectedEntry?.item.kind === 'effect' ? selectedEntry.item as EffectItem : null;
  const effectKeyframes = useMemo<EffectKeyframe[]>(() => (selectedEffect?.payload?.keyframes || []) as EffectKeyframe[], [selectedEffect]);
  const overlayOperation = (selectedEffect?.operation || (selectedAiPreset !== 'auto-highlight' ? selectedAiPreset : null)) as EffectOperation | null;

  const pushHistory = useCallback(() => { setUndoStack((prev) => [...prev.slice(-19), clone(tracksRef.current)]); setRedoStack([]); }, []);
  const dispatchPlayerCommand = useCallback((type: PlayerCommand['type'], time?: number) => { nonceRef.current += 1; setPlayerCommand({ nonce: nonceRef.current, type, time }); }, []);
  const openSidebar = useCallback((tab: SidebarTab) => { setSidebarTab(tab); setSidebarCollapsed(false); }, []);
  const updateTracks = useCallback((updater: (prev: Track[]) => Track[]) => setTracks((prev) => updater(prev)), []);

  const openVideo = useCallback(async (path: string) => {
    setVideoPath(path);
    setVideoInfo(null);
    setTracks(createTracks(path, 0));
    setSelection({ trackId: null, itemId: null });
    setPlayheadTime(0);
    setSeekTime(0);
    setStatusText('\u89c6\u9891\u5df2\u5bfc\u5165\uff0c\u5f00\u59cb\u64ad\u653e\u6216\u5728\u65f6\u95f4\u7ebf\u4e0a\u526a\u8f91\u3002');
    const info = await ipcRenderer.invoke('get-video-info', path);
    setVideoInfo(info);
    if (info?.duration > 0) setTracks(createTracks(path, Number(info.duration || 0)));
    if (info?.infoWarning) setStatusText(info.infoWarning);
  }, [ipcRenderer]);

  useEffect(() => {
    if (!ipcRenderer) return undefined;
    const onOpenVideo = (_event: any, nextPath: string) => void openVideo(nextPath);
    ipcRenderer.on('open-video', onOpenVideo);
    ipcRenderer.on('detect-players', () => { setSelectedAiPreset('detect-players'); openSidebar('ai'); });
    ipcRenderer.on('track-players', () => { setSelectedAiPreset('track-players'); openSidebar('ai'); });
    ipcRenderer.on('auto-highlight', () => { setSelectedAiPreset('auto-highlight'); openSidebar('ai'); });
    ipcRenderer.on('export-video', () => openSidebar('export'));
    ipcRenderer.on('open-file-dialog', () => ipcRenderer.send('open-file-dialog'));
    return () => { ipcRenderer.removeListener('open-video', onOpenVideo); };
  }, [ipcRenderer, openSidebar, openVideo]);

  const runAiPreset = useCallback(async (tool: AiPresetId) => {
    if (!videoPath) return;
    const clip = selectedEntry?.item.kind === 'clip' ? selectedEntry.item as ClipItem : null;
    const rangeStart = aiRunScope === 'selection' && clip ? clip.start : 0;
    const rangeEnd = aiRunScope === 'selection' && clip ? clip.end : duration;
    setRunningTool(tool); setIsProcessing(true); setSelectedAiPreset(tool);
    try {
      const result = await ipcRenderer.invoke('run-ai-operation', {
        operation: tool, videoPath, confidence: aiRuntimeConfig.confidenceThreshold, maxFrames: aiRuntimeConfig.maxFrames, writeVideo: aiRuntimeConfig.writeVideo, focusMode: aiRuntimeConfig.focusMode, modelPreference: aiRuntimeConfig.modelPreference, modelPath: aiRuntimeConfig.modelPreference === 'custom' ? aiRuntimeConfig.customModelPath : undefined, scope: aiRunScope, rangeStart, rangeEnd, controlMode: effectControl.controlMode, interactionMode: effectControl.interactionMode, manualAnchor: effectControl.manual.anchor, manualDirectionDeg: effectControl.manual.directionDeg, magnifierRadius: effectControl.params.magnifierRadius, magnifierZoom: effectControl.params.magnifierZoom, magnifierFeather: effectControl.params.magnifierFeather, povAngle: effectControl.params.povAngle, fovAperture: effectControl.params.fovAperture, fovLength: effectControl.params.fovLength, fovDim: effectControl.params.fovDim, highlightDuration, maxHighlights, targetBinding: effectControl.targetBinding, keyframes: effectKeyframes,
      });
      setAiResult(result);
      setHighlights(Array.isArray(result?.highlightClips) ? result.highlightClips : []);
      setSummary({ operation: tool, scope: aiRunScope, title: PRESET_LABEL[tool], success: result?.success !== false, framesProcessed: Number(result?.summary?.framesProcessed ?? result?.framesProcessed ?? 0), generatedItems: Number(result?.summary?.generatedItems ?? result?.highlightClips?.length ?? result?.targets?.length ?? 0), warnings: Array.isArray(result?.warnings) ? result.warnings : [], message: result?.success === false ? result?.error : `${PRESET_LABEL[tool]}\u5df2\u5b8c\u6210\u3002` });
      if (tool === 'magnifier-effect' || tool === 'player-pov') {
        pushHistory();
        const effect: EffectItem = {
          id: id('effect'),
          kind: 'effect',
          trackId: EFFECT_TRACK_ID,
          label: `${PRESET_LABEL[tool]}\u7247\u6bb5`,
          start: rangeStart,
          end: Math.max(rangeStart + MIN_DURATION, rangeEnd),
          enabled: true,
          operation: tool,
          effectSource: 'manual',
          controlMode: effectControl.controlMode,
          manual: effectControl.manual,
          params: effectControl.params,
          payload: {
            scope: aiRunScope,
            rangeStart,
            rangeEnd,
            targetBinding: effectControl.targetBinding,
            keyframes: effectKeyframes,
            interactionMode: effectControl.interactionMode,
          },
        };
        updateTracks((prev) => prev.map((track) => (
          track.id === EFFECT_TRACK_ID
            ? { ...track, items: [...track.items, effect].sort((a, b) => a.start - b.start) }
            : track
        )));
        setSelection({ trackId: EFFECT_TRACK_ID, itemId: effect.id });
      }
      setStatusText(result?.success === false ? result?.error : `${PRESET_LABEL[tool]}\u5df2\u5b8c\u6210\u3002`);
    } catch (error) {
      setSummary({
        operation: tool,
        scope: aiRunScope,
        title: PRESET_LABEL[tool],
        success: false,
        framesProcessed: 0,
        generatedItems: 0,
        warnings: [],
        message: `${PRESET_LABEL[tool]}\u6267\u884c\u5931\u8d25\uff1a${error instanceof Error ? error.message : String(error)}`,
      });
      setStatusText(`${PRESET_LABEL[tool]}\u6267\u884c\u5931\u8d25\uff1a${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunningTool(null);
      setIsProcessing(false);
    }
  }, [aiRunScope, aiRuntimeConfig, duration, effectControl, effectKeyframes, highlightDuration, ipcRenderer, maxHighlights, pushHistory, selectedEntry, updateTracks, videoPath]);

  const deleteSelectedItem = useCallback(() => {
    if (!selectedEntry) return;
    pushHistory();
    updateTracks((prev) => prev.map((track) => track.id !== selectedEntry.track.id ? track : { ...track, items: track.items.filter((item) => item.id !== selectedEntry.item.id) }));
    setSelection({ trackId: null, itemId: null });
  }, [pushHistory, selectedEntry, updateTracks]);

  const splitSelectedItem = useCallback(() => {
    if (!selectedEntry || playheadTime <= selectedEntry.item.start || playheadTime >= selectedEntry.item.end) return;
    pushHistory();
    updateTracks((prev) => prev.map((track) => track.id !== selectedEntry.track.id ? track : { ...track, items: track.items.flatMap((item) => item.id !== selectedEntry.item.id ? [item] : [{ ...item, id: id('left'), end: playheadTime } as TimelineItem, { ...item, id: id('right'), start: playheadTime } as TimelineItem]) }));
  }, [playheadTime, pushHistory, selectedEntry, updateTracks]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">{'\u8db3\u7403\u89c6\u9891\u526a\u8f91\u5668'}</h1>
          <span className="project-name">{videoPath ? fileName(videoPath) : '\u672a\u6253\u5f00\u9879\u76ee'}</span>
        </div>
        <div className="header-right">
          <button className="btn btn-primary" onClick={() => ipcRenderer?.send('open-file-dialog')}>{'\u5bfc\u5165\u89c6\u9891'}</button>
          <button className="btn btn-secondary" onClick={() => openSidebar('ai')}>{'AI \u5de5\u5177'}</button>
          <button className="btn btn-secondary" onClick={() => openSidebar('export')}>{'\u5bfc\u51fa'}</button>
          <button className="btn btn-secondary" onClick={() => setFocusMonitor((prev) => !prev)}>{focusMonitor ? '\u9000\u51fa\u4e13\u6ce8\u76d1\u770b' : '\u4e13\u6ce8\u76d1\u770b'}</button>
        </div>
      </header>
      <div className="app-content">
        {!videoPath ? <div className="welcome-screen"><div className="welcome-content"><h2>{'\u5bfc\u5165\u4e00\u6bb5\u8db3\u7403\u6bd4\u8d5b\u89c6\u9891\uff0c\u5f00\u59cb\u526a\u8f91\u4e0e\u5206\u6790'}</h2><p>{'\u5de6\u4fa7\u7528\u4e8e\u89c2\u770b\u548c\u526a\u8f91\uff0c\u53f3\u4fa7\u7528\u4e8e AI \u5206\u6790\u3001\u68c0\u67e5\u5668\u4e0e\u5bfc\u51fa\u3002'}</p><button className="btn btn-primary btn-large" onClick={() => ipcRenderer?.send('open-file-dialog')}>{'\u5f00\u59cb\u5bfc\u5165'}</button></div></div> : (
          <div className={`editor-layout ${focusMonitor ? 'focus-monitor' : ''}`}>
            <div className="editor-main">
              <section className="monitor-shell">
                <div className="monitor-toolbar">
                  <div className="monitor-toolbar-left"><strong>{videoInfo?.filename || fileName(videoPath)}</strong><span>{videoInfo?.width || 0} x {videoInfo?.height || 0} · {fps.toFixed(1)} FPS · {formatTime(duration)}</span><span>{overlayOperation ? `\u5f53\u524d\u53e0\u52a0\uff1a${PRESET_LABEL[(overlayOperation as AiPresetId) || 'detect-players']}` : '\u5f53\u524d\u53e0\u52a0\uff1a\u65e0'}</span></div>
                  <div className="monitor-toolbar-right"><button className={`chip-btn ${monitorView === 'fit' ? 'active' : ''}`} onClick={() => setMonitorView('fit')}>{'\u9002\u5e94\u7a97\u53e3'}</button><button className={`chip-btn ${monitorView === 'original' ? 'active' : ''}`} onClick={() => setMonitorView('original')}>100%</button></div>
                </div>
                <div className="monitor-stage">
                  <VideoPlayer videoPath={videoPath} videoInfo={videoInfo} isProcessing={isProcessing} monitorView={monitorView} externalSeekTime={seekTime} onSeekHandled={() => setSeekTime(null)} onTimeChange={setPlayheadTime} onPlayingChange={setIsPlaying} onMetadata={(meta) => { setVideoInfo((prev: any) => ({ ...(prev || {}), ...meta })); if (videoPath && meta.duration > 0) setTracks(createTracks(videoPath, meta.duration)); }} aiOverlay={aiResult} overlayOperation={overlayOperation || undefined} effectControl={effectControl} effectKeyframes={effectKeyframes} overlayTargetBinding={previewTargetBinding || effectControl.targetBinding} onSetEffectTool={(tool) => setEffectControl((prev) => ({ ...prev, activeTool: tool }))} onSetControlMode={(mode) => setEffectControl((prev) => ({ ...prev, controlMode: mode }))} onSetInteractionMode={(mode) => setEffectControl((prev) => ({ ...prev, interactionMode: mode }))} onSetManualAnchor={(anchor) => setEffectControl((prev) => ({ ...prev, manual: { ...prev.manual, anchor } }))} onSetManualDirectionDeg={(directionDeg) => setEffectControl((prev) => ({ ...prev, manual: { ...prev.manual, directionDeg } }))} onPatchEffectParams={(patch) => setEffectControl((prev) => ({ ...prev, params: { ...prev.params, ...patch } }))} onPatchEffectKeyframes={() => undefined} onClearManualControl={() => setEffectControl((prev) => ({ ...prev, manual: { anchor: null, directionDeg: null }, controlMode: 'hybrid' }))} command={playerCommand} interactionHintText={selectedAiPreset === 'magnifier-effect' ? '\u653e\u5927\u955c\uff1a\u6eda\u8f6e\u8c03\u534a\u5f84\uff0cShift + \u6eda\u8f6e\u8c03\u500d\u7387\u3002' : selectedAiPreset === 'player-pov' ? '\u7403\u5458\u89c6\u89d2\uff1a\u62d6\u52a8\u8c03\u65b9\u5411\uff0cShift/Ctrl + \u6eda\u8f6e\u8c03\u53c2\u6570\u3002' : null} />
                </div>
              </section>
              <section className="edit-strip">
                <div className="edit-strip-left"><button className="btn btn-secondary" onClick={() => dispatchPlayerCommand('toggle-play')}>{isPlaying ? '\u6682\u505c' : '\u64ad\u653e'}</button><button className="btn btn-secondary" onClick={() => dispatchPlayerCommand('step-backward')}>{'\u4e0a\u4e00\u5e27'}</button><button className="btn btn-secondary" onClick={() => dispatchPlayerCommand('step-forward')}>{'\u4e0b\u4e00\u5e27'}</button><button className="btn btn-secondary" onClick={splitSelectedItem}>{'\u5206\u5272 (S)'}</button><button className="btn btn-secondary" onClick={deleteSelectedItem} disabled={!selectedEntry}>{'\u5220\u9664'}</button></div>
                <div className="edit-strip-right"><span className="edit-status">{'\u64ad\u653e\u5934 '}{formatTime(playheadTime)}</span><span className="edit-status">{statusText}</span></div>
              </section>
              <section className="timeline-stage"><Timeline tracks={tracks} duration={duration} fps={fps} playheadTime={playheadTime} selection={selection} markers={highlights} onSeek={(time) => { setPlayheadTime(time); setSeekTime(time); }} onSelectItem={(trackId, itemId) => setSelection({ trackId, itemId })} onUpdateItemRange={(trackId, itemId, start, end) => { const next = normalizeRange(start, end); updateTracks((prev) => prev.map((track) => track.id !== trackId ? track : { ...track, items: track.items.map((item) => item.id !== itemId ? item : ({ ...item, start: next.start, end: next.end } as TimelineItem)) })); }} onToggleItem={(trackId, itemId) => updateTracks((prev) => prev.map((track) => track.id !== trackId ? track : { ...track, items: track.items.map((item) => item.id !== itemId ? item : ({ ...item, enabled: !item.enabled } as TimelineItem)) }))} onDeleteItem={(trackId, itemId) => updateTracks((prev) => prev.map((track) => track.id !== trackId ? track : { ...track, items: track.items.filter((item) => item.id !== itemId) }))} /></section>
            </div>
            {!focusMonitor ? <aside className={`workspace-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}><div className="sidebar-tabs">{(['inspector', 'ai', 'export'] as SidebarTab[]).map((tab) => <button key={tab} className={`sidebar-tab ${sidebarTab === tab ? 'active' : ''}`} onClick={() => openSidebar(tab)}>{tab === 'inspector' ? '\u68c0\u67e5\u5668' : tab === 'ai' ? 'AI \u5de5\u5177' : '\u5bfc\u51fa'}</button>)}<button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed((prev) => !prev)}>{sidebarCollapsed ? '\u5c55\u5f00' : '\u6536\u8d77'}</button></div>{!sidebarCollapsed ? <div className="sidebar-body">{sidebarTab === 'inspector' ? <div className="inspector-panel">{selectedEntry ? <div className="inspector-section"><h3>{selectedEntry.item.kind === 'effect' ? 'AI \u6548\u679c\u7247\u6bb5' : '\u89c6\u9891\u6216\u7d20\u6750\u7247\u6bb5'}</h3><label>{'\u540d\u79f0'}<input value={selectedEntry.item.label} onChange={(event) => updateTracks((prev) => prev.map((track) => track.id !== selectedEntry.track.id ? track : { ...track, items: track.items.map((item) => item.id !== selectedEntry.item.id ? item : ({ ...item, label: event.target.value } as TimelineItem)) }))} /></label><label>{'\u542f\u7528\u7247\u6bb5'}<input type="checkbox" checked={selectedEntry.item.enabled} onChange={(event) => updateTracks((prev) => prev.map((track) => track.id !== selectedEntry.track.id ? track : { ...track, items: track.items.map((item) => item.id !== selectedEntry.item.id ? item : ({ ...item, enabled: event.target.checked } as TimelineItem)) }))} /></label></div> : <div className="inspector-empty"><strong>{'\u672a\u9009\u4e2d\u4efb\u4f55\u7247\u6bb5'}</strong><p>{'\u70b9\u51fb\u65f6\u95f4\u7ebf\u4e2d\u7684\u7247\u6bb5\uff0c\u53ef\u5728\u53f3\u4fa7\u67e5\u770b\u5c5e\u6027\u3002'}</p></div>}</div> : null}{sidebarTab === 'ai' ? <AIToolsPanel videoPath={videoPath} videoInfo={videoInfo} activePreset={selectedAiPreset} runningTool={runningTool} aiRunScope={aiRunScope} scopeLabel={aiRunScope === 'selection' ? '\u9009\u4e2d\u7247\u6bb5' : aiRunScope === 'track' ? '\u5f53\u524d\u8f68\u9053' : '\u5168\u7247'} effectControl={effectControl} aiRuntimeConfig={aiRuntimeConfig} highlightDuration={highlightDuration} maxHighlights={maxHighlights} summary={summary} result={aiResult} targets={[]} highlightClips={highlights} previewTargetBinding={previewTargetBinding} onPresetChange={setSelectedAiPreset} onRunPreset={(tool) => void runAiPreset(tool)} onScopeChange={setAiRunScope} onSetEffectTool={(tool) => setEffectControl((prev) => ({ ...prev, activeTool: tool }))} onSetControlMode={(mode) => setEffectControl((prev) => ({ ...prev, controlMode: mode }))} onSetInteractionMode={(mode) => setEffectControl((prev) => ({ ...prev, interactionMode: mode }))} onPatchEffectParams={(patch) => setEffectControl((prev) => ({ ...prev, params: { ...prev.params, ...patch } }))} onSetManualAnchor={(anchor) => setEffectControl((prev) => ({ ...prev, manual: { ...prev.manual, anchor } }))} onSetManualDirectionDeg={(deg) => setEffectControl((prev) => ({ ...prev, manual: { ...prev.manual, directionDeg: deg } }))} onTargetBindingChange={(target) => setEffectControl((prev) => ({ ...prev, targetBinding: target }))} onPreviewTarget={setPreviewTargetBinding} onApplyTarget={(_tool, target) => { setPreviewTargetBinding(target); setEffectControl((prev) => ({ ...prev, targetBinding: target })); }} onAiRuntimeConfigChange={setAiRuntimeConfig} onHighlightDurationChange={setHighlightDuration} onMaxHighlightsChange={setMaxHighlights} onAddHighlightClip={(clip) => setHighlights((prev) => prev.filter((item) => item.id !== clip.id))} onAddAllHighlightClips={() => undefined} /> : null}{sidebarTab === 'export' ? <ExportPanel videoPath={videoPath} videoInfo={videoInfo} timelineSnapshot={snapshot} onExported={(result) => setStatusText(result?.success ? '\u5bfc\u51fa\u5b8c\u6210\u3002' : '\u5bfc\u51fa\u5931\u8d25\u3002')} /> : null}</div> : null}</aside> : null}\n          </div>
        )}
      </div>
      <footer className="app-footer"><div className="status-info">{videoPath ? <><span className="status-item">{fileName(videoPath)}</span><span className="status-item">{formatTime(duration)}</span><span className="status-item">{fps.toFixed(1)} FPS</span></> : <span className="status-item">{'\u7b49\u5f85\u5bfc\u5165\u89c6\u9891...'}</span>}</div><div className="status-indicator">{statusText}</div></footer>
    </div>
  );
}

export default App;
