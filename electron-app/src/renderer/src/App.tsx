import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import VideoPlayer from './components/VideoPlayer';
import Timeline from './components/Timeline';
import AIToolsPanel from './components/AIToolsPanel';
import ExportPanel from './components/ExportPanel';
import MediaLibraryPanel from './components/MediaLibraryPanel';
import {
  AiPresetId,
  AiRunScope,
  AiRunSummary,
  AiRuntimeConfig,
  AnalysisCache,
  ClipItem,
  EditorProject,
  EffectControlState,
  EffectItem,
  EffectKeyframe,
  EffectOperation,
  HighlightClip,
  MediaLibraryItem,
  PreviewEffectLayer,
  SelectionState,
  SidebarTab,
  TargetBinding,
  TimelineItem,
  TimelineSnapshot,
  Track,
} from './types';

type PlayerCommand = {
  nonce: number;
  type: 'toggle-play' | 'step-forward' | 'step-backward' | 'seek';
  time?: number;
};

const PROJECT_VERSION = 3;
const MAIN_TRACK_ID = 'track_video_main';
const EFFECT_TRACK_ID = 'track_effect_ai';
const OVERLAY_TRACK_ID = 'track_overlay_asset';
const MIN_DURATION = 1 / 30;

const PRESET_LABEL: Record<string, string> = {
  'detect-players': '球员检测',
  'track-players': '球员跟踪',
  'magnifier-effect': '放大镜',
  'player-pov': '球员 POV',
  'auto-highlight': '自动高光',
};

(PRESET_LABEL as Record<AiPresetId, string>)['player-highlight'] = '多人高亮';

const TRACK_META = {
  [MAIN_TRACK_ID]: { id: MAIN_TRACK_ID, type: 'video' as const, name: '主视频轨', order: 0 },
  [EFFECT_TRACK_ID]: { id: EFFECT_TRACK_ID, type: 'effect' as const, name: 'AI 特效轨', order: 1 },
  [OVERLAY_TRACK_ID]: { id: OVERLAY_TRACK_ID, type: 'overlay' as const, name: '素材 / 高光轨', order: 2 },
};

const DEFAULT_EFFECT: EffectControlState = {
  activeTool: 'magnifier-effect',
  controlMode: 'hybrid',
  interactionMode: 'cursor-follow',
  manual: { anchor: null, directionDeg: null },
  params: {
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
  },
  targetBinding: null,
  targetBindings: [],
  highlightShowLabel: true,
};

const DEFAULT_AI: AiRuntimeConfig = {
  confidenceThreshold: 0.35,
  maxFrames: 0,
  writeVideo: true,
  focusMode: 'player',
  modelPreference: 'best',
  customModelPath: '',
};

const METADATA_LOADING_LABEL = '视频时长读取中，请等待元数据加载完成';
const METADATA_LOADING_STATUS = '已打开视频，正在通过播放器读取视频时长...';

const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1500;
const ORIGINAL_VIEW_FALLBACK_STATUS = '当前窗口不足以显示原始尺寸，已自动切回适应窗口。';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const fileName = (inputPath: string) => inputPath.split(/[/\\]/).pop() || 'untitled';
const stripExt = (name: string) => name.replace(/\.[^.]+$/, '') || name;
const clipKey = (start: number, end: number) => `${start.toFixed(3)}_${end.toFixed(3)}`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => Math.max(aStart, bStart) < Math.min(aEnd, bEnd) - 1 / 120;
const formatTime = (seconds: number) => {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const cents = Math.floor((safe % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cents).padStart(2, '0')}`;
};

const previewEffectComparator = (a: PreviewEffectLayer, b: PreviewEffectLayer) =>
  b.lane - a.lane || a.operation.localeCompare(b.operation) || a.label.localeCompare(b.label);

function sortTrackItems(trackType: Track['type'], items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    const laneDiff = (trackType === 'video' ? 0 : a.lane) - (trackType === 'video' ? 0 : b.lane);
    if (laneDiff !== 0) return laneDiff;
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.label.localeCompare(b.label);
  });
}

function findAvailableLane(items: TimelineItem[], trackType: Track['type'], start: number, end: number, ignoreItemId?: string): number {
  if (trackType === 'video') return 0;
  let lane = 0;
  while (items.some((item) => item.id !== ignoreItemId && item.lane === lane && overlaps(item.start, item.end, start, end))) {
    lane += 1;
  }
  return lane;
}

function normalizeTrack(track: Track): Track {
  const pending = [...(track.items || [])]
    .filter((item) => Number(item.end || 0) - Number(item.start || 0) >= 1 / 120)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const placed: TimelineItem[] = [];
  pending.forEach((rawItem) => {
    const lane = track.type === 'video'
      ? 0
      : Number.isFinite(rawItem.lane)
        ? Math.max(0, Number(rawItem.lane))
        : findAvailableLane(placed, track.type, rawItem.start, rawItem.end, rawItem.id);
    placed.push({ ...rawItem, trackId: track.id, lane });
  });

  return {
    ...track,
    enabled: track.enabled !== false,
    items: sortTrackItems(track.type, placed),
  };
}

function normalizeTracksCollection(inputTracks: Track[], videoPath: string, durationHint: number): Track[] {
  const trackMap = new Map<string, Track>();
  inputTracks.forEach((track) => {
    trackMap.set(track.id || `${track.type}_${track.order ?? 0}`, {
      ...track,
      id: track.id || `${track.type}_${track.order ?? 0}`,
      order: Number.isFinite(track.order) ? track.order : 0,
      items: Array.isArray(track.items) ? track.items : [],
    });
  });

  Object.values(TRACK_META).forEach((meta) => {
    if (!trackMap.has(meta.id)) trackMap.set(meta.id, { ...meta, enabled: true, items: [] });
  });

  const ordered = Array.from(trackMap.values())
    .map((track) => normalizeTrack({ ...track, ...(TRACK_META[track.id as keyof typeof TRACK_META] || {}) }))
    .sort((a, b) => a.order - b.order);

  const mainTrack = ordered.find((track) => track.id === MAIN_TRACK_ID);
  const safeDuration = Math.max(0, Number(durationHint || 0));
  if (mainTrack && safeDuration > 0 && videoPath) {
    const originalIndex = mainTrack.items.findIndex((item) => item.kind === 'clip' && (item as ClipItem).sourceType === 'original');
    const originalClip: ClipItem = {
      id: originalIndex >= 0 ? mainTrack.items[originalIndex].id : 'clip_full',
      kind: 'clip',
      trackId: MAIN_TRACK_ID,
      label: '原始素材',
      start: 0,
      end: safeDuration,
      lane: 0,
      enabled: true,
      sourcePath: videoPath,
      sourceStart: 0,
      sourceEnd: safeDuration,
      sourceType: 'original',
    };
    if (originalIndex === -1) mainTrack.items = sortTrackItems(mainTrack.type, [originalClip, ...mainTrack.items]);
    else mainTrack.items[originalIndex] = originalClip;
  }

  return ordered.map((track) => normalizeTrack(track));
}

const createTracks = (videoPath: string, duration: number): Track[] => {
  const safeDuration = Math.max(0, Number(duration || 0));
  const sourceClip: ClipItem | null = videoPath && safeDuration > 0
    ? {
        id: makeId('clip'),
        kind: 'clip',
        trackId: MAIN_TRACK_ID,
        label: '原始素材',
        start: 0,
        end: safeDuration,
        lane: 0,
        enabled: true,
        sourcePath: videoPath,
        sourceStart: 0,
        sourceEnd: safeDuration,
        sourceType: 'original',
      }
    : null;
  return [
    { ...TRACK_META[MAIN_TRACK_ID], enabled: true, items: sourceClip ? [sourceClip] : [] },
    { ...TRACK_META[EFFECT_TRACK_ID], enabled: true, items: [] },
    { ...TRACK_META[OVERLAY_TRACK_ID], enabled: true, items: [] },
  ];
};

const createSourceItem = (path: string, info: any): MediaLibraryItem => ({
  id: `source_${path}`,
  kind: 'source-video',
  label: info?.filename || fileName(path),
  path,
  createdAt: new Date().toISOString(),
  sourceVideoPath: path,
  duration: Number(info?.duration || 0) || undefined,
  fps: Number(info?.fps || 0) || undefined,
  width: Number(info?.width || 0) || undefined,
  height: Number(info?.height || 0) || undefined,
  size: Number(info?.size || 0) || undefined,
});

const upsertLibrary = (items: MediaLibraryItem[], nextItem: MediaLibraryItem): MediaLibraryItem[] => {
  const index = items.findIndex((item) => item.kind === nextItem.kind && item.path === nextItem.path && item.artifactKey === nextItem.artifactKey);
  if (index === -1) return [nextItem, ...items];
  const current = items[index];
  const merged = { ...current, ...nextItem, id: current.id, createdAt: current.createdAt };
  return [merged, ...items.filter((_, i) => i !== index)];
};

const normalizeSummary = (tool: AiPresetId, scope: AiRunScope, result: any): AiRunSummary => ({
  operation: tool,
  scope,
  title: PRESET_LABEL[tool],
  success: result?.success !== false,
  framesProcessed: Number(result?.summary?.framesProcessed ?? result?.framesProcessed ?? 0),
  generatedItems: Number(result?.summary?.generatedItems ?? result?.highlightClips?.length ?? result?.targets?.length ?? 0),
  warnings: Array.isArray(result?.warnings) ? result.warnings : [],
  outputPath: result?.summary?.outputPath || null,
  modelResolved: result?.modelResolved || result?.summary?.modelResolved || null,
  rangeStart: typeof result?.summary?.rangeStart === 'number' ? result.summary.rangeStart : undefined,
  rangeEnd: typeof result?.summary?.rangeEnd === 'number' ? result.summary.rangeEnd : undefined,
  message: result?.error || result?.summary?.message || `${PRESET_LABEL[tool]}已完成`,
  targetsDetected: Array.isArray(result?.targets) ? result.targets.length : 0,
  highlightsGenerated: Array.isArray(result?.highlightClips) ? result.highlightClips.length : 0,
  updatedExistingItem: false,
});

const effectStateFromItem = (item: EffectItem): EffectControlState => ({
  activeTool: item.operation === 'player-pov' ? 'player-pov' : 'magnifier-effect',
  controlMode: item.operation === 'magnifier-effect' || item.operation === 'player-pov'
    ? item.controlMode || 'hybrid'
    : DEFAULT_EFFECT.controlMode,
  interactionMode: item.operation === 'magnifier-effect' || item.operation === 'player-pov'
    ? item.payload?.interactionMode || 'pinned'
    : DEFAULT_EFFECT.interactionMode,
  manual: clone(item.manual || DEFAULT_EFFECT.manual),
  params: { ...DEFAULT_EFFECT.params, ...(item.params || {}) },
  targetBinding: item.payload?.targetBinding || null,
  targetBindings: Array.isArray(item.payload?.targetBindings) ? clone(item.payload?.targetBindings || []) : [],
  highlightShowLabel: item.payload?.showLabel !== false,
});

const runtimeConfigFromItem = (item: EffectItem): AiRuntimeConfig => ({
  confidenceThreshold: Number(item.payload?.confidence ?? DEFAULT_AI.confidenceThreshold),
  maxFrames: Number(item.payload?.maxFrames ?? DEFAULT_AI.maxFrames) || 0,
  writeVideo: true,
  focusMode: item.payload?.targetBinding?.class === 'ball' ? 'ball' : item.payload?.focusMode || DEFAULT_AI.focusMode,
  modelPreference: item.payload?.modelPreference || DEFAULT_AI.modelPreference,
  customModelPath: item.payload?.modelPath || '',
});

const updateEffectRange = (item: TimelineItem, start: number, end: number, lane = item.lane): TimelineItem => item.kind !== 'effect'
  ? { ...item, start, end, lane }
  : { ...(item as EffectItem), start, end, lane, payload: { ...((item as EffectItem).payload || {}), rangeStart: start, rangeEnd: end } };

function toPreviewEffectLayer(item: EffectItem, fallbackResult: any, editable = false): PreviewEffectLayer {
  return {
    id: item.id,
    label: item.label,
    operation: item.operation,
    lane: Math.max(0, Number(item.lane || 0)),
    result: item.payload?.previewResult || fallbackResult || null,
    controlMode: item.controlMode || 'hybrid',
    interactionMode: item.payload?.interactionMode || 'pinned',
    manual: clone(item.manual || DEFAULT_EFFECT.manual),
    params: { ...DEFAULT_EFFECT.params, ...(item.params || {}) },
    targetBinding: item.payload?.targetBinding || null,
    targetBindings: Array.isArray(item.payload?.targetBindings) ? clone(item.payload?.targetBindings || []) : [],
    keyframes: Array.isArray(item.payload?.keyframes) ? clone(item.payload?.keyframes || []) : [],
    showLabel: item.payload?.showLabel !== false,
    editable,
  };
}

function App() {
  const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer as any;
  const [projectName, setProjectName] = useState('足球视频编辑器');
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null);
  const [projectCreatedAt, setProjectCreatedAt] = useState(() => new Date().toISOString());
  const [videoPath, setVideoPath] = useState('');
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [tracks, setTracks] = useState<Track[]>(createTracks('', 0));
  const [selection, setSelection] = useState<SelectionState>({ trackId: null, itemId: null });
  const [playheadTime, setPlayheadTime] = useState(0);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [playerCommand, setPlayerCommand] = useState<PlayerCommand | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1920));
  const [isPlaying, setIsPlaying] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('inspector');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusMonitor, setFocusMonitor] = useState(false);
  const [monitorView, setMonitorView] = useState<'fit' | 'original'>('fit');
  const [statusText, setStatusText] = useState('先导入一段比赛视频。');
  const [isProcessing, setIsProcessing] = useState(false);
  const [effectControl, setEffectControl] = useState<EffectControlState>(clone(DEFAULT_EFFECT));
  const [aiRuntimeConfig, setAiRuntimeConfig] = useState<AiRuntimeConfig>(clone(DEFAULT_AI));
  const [aiRunScope, setAiRunScope] = useState<AiRunScope>('selection');
  const [selectedAiPreset, setSelectedAiPreset] = useState<AiPresetId>('detect-players');
  const [runningTool, setRunningTool] = useState<AiPresetId | null>(null);
  const [summary, setSummary] = useState<AiRunSummary | null>(null);
  const [previewTargetBinding, setPreviewTargetBinding] = useState<TargetBinding | null>(null);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibraryItem[]>([]);
  const [analysisCache, setAnalysisCache] = useState<AnalysisCache>({});
  const [draftEffectKeyframes, setDraftEffectKeyframes] = useState<EffectKeyframe[]>([]);
  const [highlightDuration, setHighlightDuration] = useState(10);
  const [maxHighlights, setMaxHighlights] = useState(6);
  const [clipDraftStart, setClipDraftStart] = useState(0);
  const [clipDraftEnd, setClipDraftEnd] = useState(10);
  const [clipDraftLabel, setClipDraftLabel] = useState('手动片段');
  const [undoStack, setUndoStack] = useState<Track[][]>([]);
  const [redoStack, setRedoStack] = useState<Track[][]>([]);
  const tracksRef = useRef(tracks);
  const nonceRef = useRef(0);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  const duration = useMemo(() => Math.max(0, Number(videoInfo?.duration || 0), ...tracks.flatMap((track) => track.items.map((item) => item.end))), [tracks, videoInfo]);
  const fps = useMemo(() => Math.max(1, Number(videoInfo?.fps || 30)), [videoInfo]);
  const autoCollapsed = !focusMonitor && viewportWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
  const effectiveSidebarCollapsed = !focusMonitor && (sidebarCollapsed || autoCollapsed);
  const videoDurationReady = useMemo(() => {
    const declaredDuration = Number(videoInfo?.duration || 0);
    if (declaredDuration > MIN_DURATION * 2) return true;
    return tracks.some((track) => track.type === 'video' && track.items.some((item) => item.kind === 'clip' && item.end - item.start > MIN_DURATION * 2));
  }, [tracks, videoInfo]);
  useEffect(() => {
    if (!videoPath) return;
    const declaredDuration = Number(videoInfo?.duration || 0);
    if (declaredDuration > MIN_DURATION * 2 || videoDurationReady) {
      setStatusText(`视频元数据已就绪，时长 ${formatTime(Math.max(declaredDuration, duration))}`);
      return;
    }
    if (videoInfo?.metadataSource !== 'missing-file') {
      setStatusText(METADATA_LOADING_STATUS);
    }
  }, [duration, videoDurationReady, videoInfo?.duration, videoInfo?.metadataSource, videoPath]);
  const snapshot = useMemo<TimelineSnapshot | null>(() => videoPath ? { version: PROJECT_VERSION, sourceVideoPath: videoPath, duration, fps, tracks: clone(tracks) } : null, [duration, fps, tracks, videoPath]);
  const selectedEntry = useMemo(() => {
    const track = tracks.find((item) => item.id === selection.trackId);
    const item = track?.items.find((entry) => entry.id === selection.itemId);
    return track && item ? { track, item } : null;
  }, [selection, tracks]);
  const selectedEffect = selectedEntry?.item.kind === 'effect' ? (selectedEntry.item as EffectItem) : null;
  const effectTrack = useMemo(() => tracks.find((track) => track.id === EFFECT_TRACK_ID) || null, [tracks]);
  const overlayTrack = useMemo(() => tracks.find((track) => track.id === OVERLAY_TRACK_ID) || null, [tracks]);
  const effectKeyframes = useMemo(() => (selectedEffect?.payload?.keyframes as EffectKeyframe[] | undefined) || draftEffectKeyframes, [draftEffectKeyframes, selectedEffect]);
  const activeResult = useMemo(() => {
    if (selectedEffect?.payload?.previewResult) return selectedEffect.payload.previewResult;
    if (selectedEffect) {
      return analysisCache[selectedEffect.operation as AiPresetId]?.result
        || (selectedEffect.operation === 'player-highlight' ? analysisCache['track-players']?.result : null)
        || null;
    }
    if (selectedAiPreset === 'player-highlight') {
      return analysisCache['player-highlight']?.result || analysisCache['track-players']?.result || null;
    }
    return analysisCache[selectedAiPreset]?.result || null;
  }, [analysisCache, selectedAiPreset, selectedEffect]);
  const trackingOverlay = useMemo(
    () => selectedEffect?.operation === 'track-players'
      ? selectedEffect.payload?.previewResult || analysisCache['track-players']?.result || null
      : analysisCache['track-players']?.result || null,
    [analysisCache, selectedEffect],
  );
  const availableTargets = useMemo(() => {
    const preferTrackTargets = selectedEffect?.operation === 'player-highlight' || selectedAiPreset === 'player-highlight';
    const selectedTargets = selectedEffect?.payload?.targets;
    if (selectedEffect?.operation !== 'player-highlight' && Array.isArray(selectedTargets) && selectedTargets.length) return selectedTargets;
    if (Array.isArray(analysisCache['track-players']?.result?.targets)) return analysisCache['track-players']?.result?.targets;
    if (!preferTrackTargets && Array.isArray(activeResult?.targets) && activeResult.targets.length) return activeResult.targets;
    if (Array.isArray(analysisCache['detect-players']?.result?.targets)) return analysisCache['detect-players']?.result?.targets;
    return [];
  }, [activeResult, analysisCache, selectedAiPreset, selectedEffect]);
  const highlightCandidates = useMemo<HighlightClip[]>(() => Array.isArray(analysisCache['auto-highlight']?.result?.highlightClips) ? analysisCache['auto-highlight']?.result?.highlightClips : [], [analysisCache]);
  const addedHighlightKeys = useMemo(() => new Set((overlayTrack?.items || []).filter((item) => item.kind === 'clip' && (item as ClipItem).sourceType === 'highlight-ai').map((item) => clipKey((item as ClipItem).sourceStart, (item as ClipItem).sourceEnd))), [overlayTrack]);
  const panelSummary = useMemo<AiRunSummary | null>(() => {
    if (summary && (summary.operation === selectedAiPreset || summary.operation === selectedEffect?.operation)) return summary;
    if (selectedEffect?.payload?.summary) return selectedEffect.payload.summary as AiRunSummary;
    return (analysisCache[selectedAiPreset]?.summary as AiRunSummary | null) || null;
  }, [analysisCache, selectedAiPreset, selectedEffect, summary]);
  const activeTimelineEffects = useMemo(
    () => (effectTrack?.items || [])
      .filter((item): item is EffectItem => item.kind === 'effect' && item.enabled && playheadTime >= item.start && playheadTime < item.end)
      .map((item) => toPreviewEffectLayer(item, analysisCache[item.operation as AiPresetId]?.result || (item.operation === 'player-highlight' ? analysisCache['track-players']?.result : null) || null, false))
      .sort(previewEffectComparator),
    [analysisCache, effectTrack, playheadTime],
  );
  const draftPreviewEffect = useMemo<PreviewEffectLayer | null>(() => {
    if (selectedEffect || selectedAiPreset === 'auto-highlight') return null;
    const draftResult = selectedAiPreset === 'player-highlight' ? (activeResult || trackingOverlay) : activeResult;
    if (!draftResult && selectedAiPreset !== 'magnifier-effect' && selectedAiPreset !== 'player-pov') return null;
    if (!videoDurationReady) {
      return {
        id: 'draft_effect_loading',
        operation: selectedAiPreset as EffectOperation,
        lane: -1,
        result: null,
        controlMode: effectControl.controlMode,
        interactionMode: effectControl.interactionMode,
        manual: clone(effectControl.manual),
        params: clone(effectControl.params),
        targetBinding: previewTargetBinding || effectControl.targetBinding,
        targetBindings: clone(effectControl.targetBindings),
        keyframes: clone(effectKeyframes),
        showLabel: effectControl.highlightShowLabel,
        editable: true,
        draft: true,
        start: 0,
        end: 0,
        label: '视频时长读取中，请等待元数据加载完成',
      };
    }
    if (!videoDurationReady) {
      return {
        id: 'draft_effect_loading_2',
        operation: selectedAiPreset as EffectOperation,
        lane: -1,
        result: null,
        controlMode: effectControl.controlMode,
        interactionMode: effectControl.interactionMode,
        manual: clone(effectControl.manual),
        params: clone(effectControl.params),
        targetBinding: previewTargetBinding || effectControl.targetBinding,
        targetBindings: clone(effectControl.targetBindings),
        keyframes: clone(effectKeyframes),
        showLabel: effectControl.highlightShowLabel,
        editable: true,
        draft: true,
        start: 0,
        end: 0,
        label: '视频时长读取中，请等待元数据加载完成',
      };
    }
    return {
      id: 'draft_effect',
      label: '当前草稿',
      operation: selectedAiPreset as EffectOperation,
      lane: -1,
      result: draftResult,
      controlMode: effectControl.controlMode,
      interactionMode: effectControl.interactionMode,
      manual: clone(effectControl.manual),
      params: clone(effectControl.params),
      targetBinding: previewTargetBinding || effectControl.targetBinding,
      targetBindings: clone(effectControl.targetBindings),
      keyframes: clone(effectKeyframes),
      showLabel: effectControl.highlightShowLabel,
      editable: true,
      draft: true,
    };
  }, [activeResult, effectControl, effectKeyframes, previewTargetBinding, selectedAiPreset, selectedEffect, trackingOverlay]);
  const editableEffect = useMemo<PreviewEffectLayer | null>(() => {
    if (selectedEffect) return toPreviewEffectLayer(selectedEffect, activeResult, true);
    return draftPreviewEffect;
  }, [activeResult, draftPreviewEffect, selectedEffect]);
  const previewEffects = useMemo(
    () => (editableEffect ? [...activeTimelineEffects.filter((item) => item.id !== editableEffect.id), editableEffect].sort(previewEffectComparator) : activeTimelineEffects),
    [activeTimelineEffects, editableEffect],
  );

  const pushHistory = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-19), clone(tracksRef.current)]);
    setRedoStack([]);
  }, []);

  const dispatchPlayerCommand = useCallback((type: PlayerCommand['type'], time?: number) => {
    nonceRef.current += 1;
    setPlayerCommand({ nonce: nonceRef.current, type, time });
  }, []);

  const openSidebar = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
    setSidebarCollapsed(false);
  }, []);

  const rangeForScope = useCallback((scope: AiRunScope) => {
    if (scope !== 'full' && selectedEntry?.item) {
      return {
        start: selectedEntry.item.start,
        end: selectedEntry.item.end,
        label: `${selectedEntry.item.label}（${formatTime(selectedEntry.item.start)} - ${formatTime(selectedEntry.item.end)}）`,
      };
    }
    if (!videoDurationReady) {
      return {
        start: 0,
        end: 0,
        label: '视频时长读取中，请等待元数据加载完成',
      };
    }
    return {
      start: 0,
      end: Math.max(duration, MIN_DURATION),
      label: scope === 'selection' ? '未选中片段，已自动切换为整段视频' : `整段视频（${formatTime(duration)}）`,
    };
  }, [duration, selectedEntry, videoDurationReady]);

  const mutateTracks = useCallback((updater: (prev: Track[]) => Track[], withHistory = true) => {
    if (withHistory) pushHistory();
    setTracks((prev) => normalizeTracksCollection(updater(prev), videoPath, Number(videoInfo?.duration || 0)));
  }, [pushHistory, videoInfo, videoPath]);

  const patchSelectedEffect = useCallback((updater: (value: EffectItem) => EffectItem) => {
    if (!selectedEffect) return;
    setTracks((prev) => normalizeTracksCollection(prev.map((track) => (
      track.id !== selectedEffect.trackId
        ? track
        : { ...track, items: track.items.map((item) => item.id !== selectedEffect.id ? item : updater(item as EffectItem)) }
    )), videoPath, Number(videoInfo?.duration || 0)));
  }, [selectedEffect, videoInfo, videoPath]);

  const registerMediaItem = useCallback(async (partial: Omit<MediaLibraryItem, 'id' | 'createdAt'>) => {
    if (!partial.path) return;
    const nextInfo = ipcRenderer && /\.(mp4|mov|avi|mkv|webm)$/i.test(partial.path) ? await ipcRenderer.invoke('get-video-info', partial.path).catch(() => null) : null;
    const nextItem: MediaLibraryItem = {
      id: makeId('media'),
      createdAt: new Date().toISOString(),
      ...partial,
      duration: Number(nextInfo?.duration || partial.duration || 0) || undefined,
      fps: Number(nextInfo?.fps || partial.fps || 0) || undefined,
      width: Number(nextInfo?.width || partial.width || 0) || undefined,
      height: Number(nextInfo?.height || partial.height || 0) || undefined,
      size: Number(nextInfo?.size || partial.size || 0) || undefined,
    };
    setMediaLibrary((prev) => upsertLibrary(prev, nextItem));
  }, [ipcRenderer]);

  const registerArtifacts = useCallback(async (tool: AiPresetId, result: any) => {
    const entries = Object.entries(result?.artifacts || {}).filter(([, value]) => typeof value === 'string' && value);
    for (const [artifactKey, artifactPath] of entries) {
      await registerMediaItem({ kind: 'ai-artifact', label: `${PRESET_LABEL[tool]} / ${artifactKey}`, path: String(artifactPath), sourceVideoPath: videoPath || undefined, operation: tool, artifactKey });
    }
  }, [registerMediaItem, videoPath]);

  const startFreshProject = useCallback((path: string, info?: any) => {
    setProjectName(stripExt(fileName(path)) || '足球项目');
    setProjectFilePath(null);
    setProjectCreatedAt(new Date().toISOString());
    setVideoPath(path);
    setVideoInfo(info || null);
    setTracks(normalizeTracksCollection(createTracks(path, Number(info?.duration || 0)), path, Number(info?.duration || 0)));
    setSelection({ trackId: null, itemId: null });
    setPlayheadTime(0);
    setSeekTime(0);
    setSidebarTab('inspector');
    setSidebarCollapsed(false);
    setFocusMonitor(false);
    setMonitorView('fit');
    setStatusText('视频已导入，可以开始分析、编排和导出。');
    setIsProcessing(false);
    setEffectControl(clone(DEFAULT_EFFECT));
    setAiRuntimeConfig(clone(DEFAULT_AI));
    setAiRunScope('selection');
    setSelectedAiPreset('detect-players');
    setSummary(null);
    setPreviewTargetBinding(null);
    setMediaLibrary(path ? [createSourceItem(path, info)] : []);
    setAnalysisCache({});
    setDraftEffectKeyframes([]);
    setHighlightDuration(10);
    setMaxHighlights(6);
    setClipDraftStart(0);
    setClipDraftEnd(Math.min(10, Math.max(4, Number(info?.duration || 10))));
    setClipDraftLabel('手动片段');
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const openVideo = useCallback(async (path: string) => {
    if (!ipcRenderer) {
      startFreshProject(path);
      return;
    }
    try {
      const info = await ipcRenderer.invoke('get-video-info', path);
      startFreshProject(path, info);
      if (Number(info?.duration || 0) > 0) {
        setTracks(normalizeTracksCollection(createTracks(path, Number(info.duration || 0)), path, Number(info.duration || 0)));
        setStatusText(`已读取视频时长 ${formatTime(Number(info.duration || 0))}。`);
      } else {
        setStatusText('正在等待播放器读取视频真实时长，请稍候。');
      }
      setMediaLibrary((prev) => upsertLibrary(prev, createSourceItem(path, info)));
      if (info?.infoWarning) setStatusText(info.infoWarning);
    } catch (error) {
      startFreshProject(path);
      setStatusText(`读取视频元数据失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [ipcRenderer, startFreshProject]);

  const loadProjectIntoState = useCallback(async (rawProject: any, loadedPath: string) => {
    const sourceVideoPath = rawProject?.sourceVideoPath || rawProject?.timelineSnapshot?.sourceVideoPath || rawProject?.videoInfo?.path || '';
    if (!sourceVideoPath) {
      setStatusText('这个项目里没有可用的源视频路径。');
      return;
    }
    let nextVideoInfo = rawProject?.videoInfo || null;
    if (ipcRenderer) {
      const refreshedVideoInfo = await ipcRenderer.invoke('get-video-info', sourceVideoPath).catch(() => null);
      if (refreshedVideoInfo) nextVideoInfo = { ...(nextVideoInfo || {}), ...refreshedVideoInfo };
    }
    const rawTracks = rawProject?.timelineSnapshot?.tracks?.length ? rawProject.timelineSnapshot.tracks : createTracks(sourceVideoPath, Number(nextVideoInfo?.duration || 0));
    const loadedTracks = normalizeTracksCollection(rawTracks, sourceVideoPath, Number(nextVideoInfo?.duration || 0));
    const uiState = rawProject?.uiState || {};
    setProjectName(rawProject?.name || stripExt(fileName(sourceVideoPath)) || '足球项目');
    setProjectFilePath(rawProject?.projectPath || loadedPath);
    setProjectCreatedAt(rawProject?.createdAt || new Date().toISOString());
    setVideoPath(sourceVideoPath);
    setVideoInfo(nextVideoInfo);
    setTracks(loadedTracks);
    setSelection({ trackId: null, itemId: null });
    setPlayheadTime(0);
    setSeekTime(0);
    setSidebarTab((uiState.sidebarTab as SidebarTab) || 'inspector');
    setSidebarCollapsed(Boolean(uiState.sidebarCollapsed));
    setFocusMonitor(Boolean(uiState.focusMonitor));
    setMonitorView(uiState.monitorView === 'original' ? 'original' : 'fit');
    setEffectControl({ ...clone(DEFAULT_EFFECT), ...(uiState.effectControl || {}), manual: { ...DEFAULT_EFFECT.manual, ...(uiState.effectControl?.manual || {}) }, params: { ...DEFAULT_EFFECT.params, ...(uiState.effectControl?.params || {}) } });
    setAiRuntimeConfig({ ...clone(DEFAULT_AI), ...(uiState.aiRuntimeConfig || {}) });
    setAiRunScope((uiState.aiRunScope as AiRunScope) || 'selection');
    setSelectedAiPreset((uiState.selectedAiPreset as AiPresetId) || 'detect-players');
    setHighlightDuration(Number(uiState.highlightDuration || 10) || 10);
    setMaxHighlights(Number(uiState.maxHighlights || 6) || 6);
    setPreviewTargetBinding(uiState.effectControl?.targetBinding || uiState.effectControl?.targetBindings?.[0] || null);
    setMediaLibrary(Array.isArray(rawProject?.mediaLibrary) && rawProject.mediaLibrary.length ? upsertLibrary(rawProject.mediaLibrary, createSourceItem(sourceVideoPath, nextVideoInfo)) : [createSourceItem(sourceVideoPath, nextVideoInfo)]);
    setAnalysisCache((rawProject?.analysisCache || {}) as AnalysisCache);
    setSummary(rawProject?.analysisCache?.[(uiState.selectedAiPreset as AiPresetId) || 'detect-players']?.summary || null);
    setDraftEffectKeyframes([]);
    setUndoStack([]);
    setRedoStack([]);
    setStatusText(Array.isArray(rawProject?.warnings) && rawProject.warnings.length ? `项目已载入：${rawProject.warnings[0]}` : '项目已载入。');
  }, [ipcRenderer]);

  const buildProjectPayload = useCallback((targetPath: string): EditorProject => ({
    version: PROJECT_VERSION,
    name: projectName || stripExt(fileName(videoPath)),
    sourceVideoPath: videoPath,
    projectPath: targetPath,
    createdAt: projectCreatedAt,
    updatedAt: new Date().toISOString(),
    videoInfo,
    timelineSnapshot: snapshot,
    mediaLibrary,
    analysisCache,
    uiState: {
      sidebarTab,
      sidebarCollapsed,
      selectedAiPreset,
      aiRunScope,
      effectControl,
      aiRuntimeConfig,
      highlightDuration,
      maxHighlights,
      focusMonitor,
      monitorView,
    },
  }), [aiRunScope, aiRuntimeConfig, analysisCache, effectControl, focusMonitor, highlightDuration, maxHighlights, mediaLibrary, monitorView, projectCreatedAt, projectName, selectedAiPreset, sidebarCollapsed, sidebarTab, snapshot, videoInfo, videoPath]);

  const saveProject = useCallback(async () => {
    if (!videoPath || !snapshot || !ipcRenderer) return setStatusText('请先导入源视频，再保存项目。');
    const suggested = `${(projectName || stripExt(fileName(videoPath))).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'football-project'}.json`;
    const target = projectFilePath || (await ipcRenderer.invoke('pick-project-save-path', { title: '保存项目', defaultPath: suggested }).then((value: any) => value?.filePath || null));
    if (!target) return setStatusText('已取消保存。');
    const response = await ipcRenderer.invoke('save-project-data', buildProjectPayload(target)).catch((error: Error) => ({ success: false, error: error.message }));
    if (response?.success) {
      setProjectFilePath(response.path || target);
      setStatusText(`项目已保存到：${response.path || target}`);
    } else {
      setStatusText(`项目保存失败：${response?.error || '未知错误'}`);
    }
  }, [buildProjectPayload, ipcRenderer, projectFilePath, projectName, snapshot, videoPath]);

  const loadProject = useCallback(async () => {
    if (!ipcRenderer) return;
    try {
      const result = await ipcRenderer.invoke('pick-project-open-path');
      if (!result || result.canceled || !result.filePaths?.length) return setStatusText('已取消载入项目。');
      const target = result.filePaths[0];
      const rawProject = await ipcRenderer.invoke('load-project-data', target);
      await loadProjectIntoState(rawProject, target);
    } catch (error) {
      setStatusText(`载入项目失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [ipcRenderer, loadProjectIntoState]);

  const loadRecentProject = useCallback(async () => {
    if (!ipcRenderer) return;
    try {
      const target = await ipcRenderer.invoke('get-last-project-path');
      if (!target) return setStatusText('没有找到最近打开的项目。');
      const rawProject = await ipcRenderer.invoke('load-project-data', target);
      await loadProjectIntoState(rawProject, target);
    } catch (error) {
      setStatusText(`载入最近项目失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [ipcRenderer, loadProjectIntoState]);

  const importReferenceMedia = useCallback(async () => {
    if (!ipcRenderer) return;
    const result = await ipcRenderer.invoke('pick-reference-media-paths');
    if (!result || result.canceled || !Array.isArray(result.filePaths) || !result.filePaths.length) return setStatusText('已取消导入参考素材。');
    for (const path of result.filePaths) await registerMediaItem({ kind: 'reference', label: fileName(path), path, sourceVideoPath: videoPath || undefined });
    openSidebar('library');
    setStatusText(`已导入 ${result.filePaths.length} 个参考素材。`);
  }, [ipcRenderer, openSidebar, registerMediaItem, videoPath]);

  const addOverlayClip = useCallback((clip: HighlightClip, sourceType: ClipItem['sourceType']) => {
    if (!videoPath) return;
    const nextClipId = makeId(sourceType === 'manual' ? 'manual' : 'highlight');
    mutateTracks((prev) => prev.map((track) => {
      if (track.id !== OVERLAY_TRACK_ID) return track;
      const lane = findAvailableLane(track.items, track.type, clip.start, clip.end);
      const nextClip: ClipItem = {
        id: nextClipId,
        kind: 'clip',
        trackId: OVERLAY_TRACK_ID,
        label: clip.title,
        start: clip.start,
        end: clip.end,
        lane,
        enabled: true,
        sourcePath: videoPath,
        sourceStart: clip.start,
        sourceEnd: clip.end,
        sourceType,
        score: clip.score,
      };
      return { ...track, items: [...track.items, nextClip] };
    }));
    setSelection({ trackId: OVERLAY_TRACK_ID, itemId: nextClipId });
  }, [mutateTracks, videoPath]);

  const runAiPreset = useCallback(async (tool: AiPresetId) => {
    if (!selectedEntry?.item && !videoDurationReady) return setStatusText('视频时长还没读取完成，请等待播放器拿到完整时长后再运行 AI。');
    if (!videoPath || !ipcRenderer) return setStatusText('请先导入源视频，再运行 AI。');
    const range = rangeForScope(aiRunScope);
    const binding = previewTargetBinding || effectControl.targetBinding || null;
    const highlightBindings = Array.isArray(effectControl.targetBindings) ? effectControl.targetBindings : [];
    const highlightTrackSamples = Array.isArray(analysisCache['track-players']?.result?.trackSamples)
      ? analysisCache['track-players']?.result?.trackSamples
      : Array.isArray(selectedEffect?.payload?.trackSamples)
        ? selectedEffect?.payload?.trackSamples
        : Array.isArray(analysisCache['player-highlight']?.result?.trackSamples)
          ? analysisCache['player-highlight']?.result?.trackSamples
          : [];
    if (tool === 'player-highlight' && !highlightTrackSamples.length) return setStatusText('请先运行一次片段跟踪，再选择球员做持续高亮。');
    if (tool === 'player-highlight' && !highlightBindings.length) return setStatusText('请先从目标列表里加入至少一名球员到高亮组。');
    const toolCreatesEffect = tool !== 'auto-highlight';
    const payload: Record<string, any> = {
      operation: tool,
      videoPath,
      confidence: aiRuntimeConfig.confidenceThreshold,
      maxFrames: aiRuntimeConfig.maxFrames,
      writeVideo: aiRuntimeConfig.writeVideo,
      focusMode: binding?.class === 'ball' ? 'ball' : aiRuntimeConfig.focusMode,
      modelPreference: aiRuntimeConfig.modelPreference,
      scope: aiRunScope,
      targetBinding: binding,
      focusPlayerId: typeof binding?.trackId === 'number' ? binding.trackId : undefined,
      controlMode: effectControl.controlMode,
      interactionMode: effectControl.interactionMode,
      manualAnchor: effectControl.manual.anchor,
      manualDirectionDeg: effectControl.manual.directionDeg,
      magnifierRadius: effectControl.params.magnifierRadius,
      magnifierZoom: effectControl.params.magnifierZoom,
      magnifierFeather: effectControl.params.magnifierFeather,
      povAngle: effectControl.params.povAngle,
      fovAperture: effectControl.params.fovAperture,
      fovLength: effectControl.params.fovLength,
      fovDim: effectControl.params.fovDim,
      highlightOutlineWidth: effectControl.params.highlightOutlineWidth,
      highlightGlowStrength: effectControl.params.highlightGlowStrength,
      highlightFillOpacity: effectControl.params.highlightFillOpacity,
      highlightShowLabel: effectControl.highlightShowLabel ? 1 : 0,
      highlightDuration,
      maxHighlights,
      maxOutputItems: tool === 'auto-highlight' ? maxHighlights : tool === 'track-players' ? 240 : 120,
      rangeStart: range.start,
      rangeEnd: range.end,
    };
    if (tool === 'player-highlight') {
      payload.targetBindings = clone(highlightBindings);
      payload.trackSamples = highlightTrackSamples;
    }
    if (aiRuntimeConfig.modelPreference === 'custom' && aiRuntimeConfig.customModelPath.trim()) payload.modelPath = aiRuntimeConfig.customModelPath.trim();
    if (effectKeyframes.length) payload.keyframes = effectKeyframes;
    setRunningTool(tool);
    setIsProcessing(true);
    setSelectedAiPreset(tool);
    openSidebar('ai');
    try {
      const result = await ipcRenderer.invoke('run-ai-operation', payload);
      let nextSummary = normalizeSummary(tool, aiRunScope, result);
      setAnalysisCache((prev) => ({ ...prev, [tool]: { operation: tool, result, summary: nextSummary, updatedAt: new Date().toISOString() } }));
      setSummary(nextSummary);
      setPreviewTargetBinding(tool === 'player-highlight' ? (highlightBindings[0] || null) : binding);
      await registerArtifacts(tool, result);
      if (toolCreatesEffect) {
        const start = typeof nextSummary.rangeStart === 'number' ? nextSummary.rangeStart : range.start;
        const end = typeof nextSummary.rangeEnd === 'number' ? nextSummary.rangeEnd : range.end;
        const existing = selectedEffect && selectedEffect.operation === tool ? selectedEffect : null;
        const effectItem: EffectItem = {
          id: existing?.id || makeId('effect'),
          kind: 'effect',
          trackId: EFFECT_TRACK_ID,
          label: existing?.label || `${PRESET_LABEL[tool]} ${formatTime(start)}-${formatTime(end)}`,
          start,
          end: Math.max(end, start + MIN_DURATION),
          lane: existing?.lane ?? 0,
          enabled: true,
          operation: tool,
          effectSource: 'ai',
          resultKey: tool,
          controlMode: tool === 'magnifier-effect' || tool === 'player-pov' ? effectControl.controlMode : undefined,
          manual: tool === 'magnifier-effect' || tool === 'player-pov' ? clone(effectControl.manual) : clone(DEFAULT_EFFECT.manual),
          params: clone(effectControl.params),
          payload: {
            ...(existing?.payload || {}),
            confidence: aiRuntimeConfig.confidenceThreshold,
            maxFrames: aiRuntimeConfig.maxFrames,
            focusMode: binding?.class === 'ball' ? 'ball' : aiRuntimeConfig.focusMode,
            modelPreference: aiRuntimeConfig.modelPreference,
            modelPath: aiRuntimeConfig.modelPreference === 'custom' ? aiRuntimeConfig.customModelPath.trim() : undefined,
            scope: aiRunScope,
            rangeStart: start,
            rangeEnd: Math.max(end, start + MIN_DURATION),
            summary: { ...nextSummary, updatedExistingItem: Boolean(existing) },
            targetBinding: tool === 'player-highlight' ? (highlightBindings[0] || null) : binding,
            targetBindings: tool === 'player-highlight' ? clone(highlightBindings) : [],
            keyframes: tool === 'magnifier-effect' || tool === 'player-pov' ? clone(effectKeyframes) : [],
            interactionMode: tool === 'magnifier-effect' || tool === 'player-pov' ? effectControl.interactionMode : undefined,
            targets: Array.isArray(result?.targets) ? result.targets : availableTargets,
            trackSamples: Array.isArray(result?.trackSamples) ? result.trackSamples : highlightTrackSamples,
            showLabel: tool === 'player-highlight' ? effectControl.highlightShowLabel : undefined,
            previewResult: result,
            analysisUpdatedAt: new Date().toISOString(),
          },
        };
        nextSummary = effectItem.payload?.summary as AiRunSummary;
        setSummary(nextSummary);
        setAnalysisCache((prev) => ({ ...prev, [tool]: { operation: tool, result, summary: nextSummary, updatedAt: new Date().toISOString() } }));
        if (existing) {
          setTracks((prev) => normalizeTracksCollection(prev.map((track) => (
            track.id !== EFFECT_TRACK_ID
              ? track
              : { ...track, items: track.items.map((item) => item.id === effectItem.id ? effectItem : item) }
          )), videoPath, Number(videoInfo?.duration || 0)));
        } else {
          mutateTracks((prev) => prev.map((track) => {
            if (track.id !== EFFECT_TRACK_ID) return track;
            const lane = findAvailableLane(track.items, track.type, effectItem.start, effectItem.end);
            return { ...track, items: [...track.items, { ...effectItem, lane }] };
          }));
          setSelection({ trackId: EFFECT_TRACK_ID, itemId: effectItem.id });
        }
      }
      setStatusText(nextSummary.message || `${PRESET_LABEL[tool]} 已完成。`);
    } catch (error) {
      const failed = { operation: tool, scope: aiRunScope, title: PRESET_LABEL[tool], success: false, framesProcessed: 0, generatedItems: 0, warnings: [], message: error instanceof Error ? error.message : String(error) } as AiRunSummary;
      setSummary(failed);
      setAnalysisCache((prev) => ({ ...prev, [tool]: { operation: tool, result: { success: false }, summary: failed, updatedAt: new Date().toISOString() } }));
      setStatusText(`AI 运行失败：${failed.message}`);
    } finally {
      setRunningTool(null);
      setIsProcessing(false);
    }
  }, [aiRunScope, aiRuntimeConfig, analysisCache, availableTargets, effectControl, effectKeyframes, highlightDuration, ipcRenderer, maxHighlights, mutateTracks, openSidebar, previewTargetBinding, rangeForScope, registerArtifacts, selectedEffect, selectedEntry, videoDurationReady, videoInfo?.duration, videoPath]);

  const handleSelectItem = useCallback((trackId: string, itemId: string) => {
    setSelection({ trackId, itemId });
    const item = tracksRef.current.find((track) => track.id === trackId)?.items.find((entry) => entry.id === itemId);
    if (item) {
      setPlayheadTime(item.start);
      setSeekTime(item.start);
      openSidebar(item.kind === 'effect' ? 'ai' : 'inspector');
    }
  }, [openSidebar]);

  const moveItem = useCallback((trackId: string, itemId: string, start: number, end: number, lane: number) => {
    const safeStart = Math.max(0, start);
    const safeEnd = Math.max(safeStart + MIN_DURATION, end);
    mutateTracks((prev) => prev.map((track) => {
      if (track.id !== trackId) return track;
      const safeLane = track.type === 'video' ? 0 : Math.max(0, lane);
      return { ...track, items: track.items.map((item) => item.id !== itemId ? item : updateEffectRange(item, safeStart, safeEnd, safeLane)) };
    }));
  }, [mutateTracks]);

  const toggleItem = useCallback((trackId: string, itemId: string) => {
    mutateTracks((prev) => prev.map((track) => track.id !== trackId ? track : { ...track, items: track.items.map((item) => item.id !== itemId ? item : { ...item, enabled: !item.enabled }) }));
  }, [mutateTracks]);

  const deleteItem = useCallback((trackId: string, itemId: string) => {
    mutateTracks((prev) => prev.map((track) => track.id !== trackId ? track : { ...track, items: track.items.filter((item) => item.id !== itemId) }));
    if (selection.trackId === trackId && selection.itemId === itemId) setSelection({ trackId: null, itemId: null });
    setStatusText('已删除时间线片段。');
  }, [mutateTracks, selection.itemId, selection.trackId]);

  const splitSelection = useCallback(() => {
    if (!selection.trackId || !selection.itemId || !selectedEntry) return;
    const item = selectedEntry.item;
    if (playheadTime <= item.start + MIN_DURATION || playheadTime >= item.end - MIN_DURATION) return setStatusText('请先把播放头移动到所选片段内部，再执行拆分。');
    const splitPoint = clamp(playheadTime, item.start + MIN_DURATION, item.end - MIN_DURATION);
    mutateTracks((prev) => prev.map((track) => {
      if (track.id !== selection.trackId) return track;
      const index = track.items.findIndex((entry) => entry.id === selection.itemId);
      if (index === -1) return track;
      const current = track.items[index];
      const firstHalf = updateEffectRange(current, current.start, splitPoint, current.lane);
      const secondHalf: TimelineItem = current.kind === 'clip'
        ? { ...(current as ClipItem), id: makeId('clip'), start: splitPoint, lane: current.lane, sourceStart: (current as ClipItem).sourceStart + (((current as ClipItem).sourceEnd - (current as ClipItem).sourceStart) * ((splitPoint - current.start) / Math.max(MIN_DURATION, current.end - current.start))) }
        : current.kind === 'effect'
          ? updateEffectRange({ ...(current as EffectItem), id: makeId('effect'), lane: current.lane }, splitPoint, current.end, current.lane)
          : { ...current, id: makeId('asset'), start: splitPoint, lane: current.lane };
      if (current.kind === 'clip') (firstHalf as ClipItem).sourceEnd = (secondHalf as ClipItem).sourceStart;
      const nextItems = [...track.items];
      nextItems.splice(index, 1, firstHalf, secondHalf);
      return { ...track, items: nextItems };
    }));
    setStatusText('已在播放头位置拆分所选片段。');
  }, [mutateTracks, playheadTime, selectedEntry, selection.itemId, selection.trackId]);

  const createManualClip = useCallback(() => {
    const start = clamp(Math.min(clipDraftStart, clipDraftEnd), 0, Math.max(0, duration));
    const end = Math.max(start + MIN_DURATION, clamp(Math.max(clipDraftStart, clipDraftEnd), 0, Math.max(0, duration)));
    addOverlayClip({ id: makeId('manual-ref'), title: clipDraftLabel.trim() || '手动片段', start, end }, 'manual');
    openSidebar('inspector');
    setStatusText(`已创建手动片段：${clipDraftLabel.trim() || '手动片段'}。`);
  }, [addOverlayClip, clipDraftEnd, clipDraftLabel, clipDraftStart, duration, openSidebar]);

  const addHighlightClip = useCallback((clip: HighlightClip) => {
    const key = clipKey(clip.start, clip.end);
    if (addedHighlightKeys.has(key)) return setStatusText(`${clip.title} 已经在素材轨中了。`);
    addOverlayClip(clip, 'highlight-ai');
    setStatusText(`已将 ${clip.title} 加入素材轨。`);
  }, [addOverlayClip, addedHighlightKeys]);

  const addAllHighlightClips = useCallback(() => {
    const pending = highlightCandidates.filter((clip) => !addedHighlightKeys.has(clipKey(clip.start, clip.end)));
    if (!pending.length) return setStatusText('没有新的高光片段可加入。');
    mutateTracks((prev) => prev.map((track) => {
      if (track.id !== OVERLAY_TRACK_ID) return track;
      const nextItems = [...track.items];
      pending.forEach((clip) => {
        const lane = findAvailableLane(nextItems, track.type, clip.start, clip.end);
        nextItems.push({
          id: makeId('highlight'),
          kind: 'clip',
          trackId: OVERLAY_TRACK_ID,
          label: clip.title,
          start: clip.start,
          end: clip.end,
          lane,
          enabled: true,
          sourcePath: videoPath,
          sourceStart: clip.start,
          sourceEnd: clip.end,
          sourceType: 'highlight-ai',
          score: clip.score,
        } as ClipItem);
      });
      return { ...track, items: nextItems };
    }));
    setStatusText(`已把 ${pending.length} 个高光片段加入素材轨。`);
  }, [addedHighlightKeys, highlightCandidates, mutateTracks, videoPath]);

  const handleExported = useCallback(async (result: any) => {
    if (!result?.success || !result.outputPath) return;
    await registerMediaItem({ kind: 'export', label: fileName(result.outputPath), path: result.outputPath, sourceVideoPath: videoPath || undefined });
    openSidebar('library');
    setStatusText(`导出完成：${result.outputPath}`);
  }, [openSidebar, registerMediaItem, videoPath]);

  useEffect(() => {
    if (!selection.itemId) return;
    const exists = tracks.some((track) => track.id === selection.trackId && track.items.some((item) => item.id === selection.itemId));
    if (!exists) setSelection({ trackId: null, itemId: null });
  }, [selection, tracks]);

  useEffect(() => {
    if (!selectedEffect) return;
    const payload = selectedEffect.payload || {};
    setSelectedAiPreset(selectedEffect.operation as AiPresetId);
    if (selectedEffect.operation === 'magnifier-effect' || selectedEffect.operation === 'player-pov' || selectedEffect.operation === 'player-highlight') {
      setEffectControl(effectStateFromItem(selectedEffect));
      setPreviewTargetBinding(payload.targetBinding || payload.targetBindings?.[0] || null);
      setDraftEffectKeyframes(Array.isArray(payload.keyframes) ? clone(payload.keyframes) : []);
    } else {
      setPreviewTargetBinding(payload.targetBinding || null);
      setDraftEffectKeyframes([]);
    }
    setAiRuntimeConfig(runtimeConfigFromItem(selectedEffect));
    setAiRunScope(payload.scope || 'selection');
    if (payload.summary) setSummary(payload.summary as AiRunSummary);
  }, [selectedEffect]);

  useEffect(() => {
    if (!ipcRenderer) return undefined;
    const openDialog = () => ipcRenderer.send('open-file-dialog');
    const onOpenVideo = (_event: unknown, path: string) => { void openVideo(path); };
    const onDetect = () => { setSelectedAiPreset('detect-players'); openSidebar('ai'); if (videoPath) void runAiPreset('detect-players'); };
    const onTrack = () => { setSelectedAiPreset('track-players'); openSidebar('ai'); if (videoPath) void runAiPreset('track-players'); };
    const onPlayerHighlight = () => { setSelectedAiPreset('player-highlight'); openSidebar('ai'); };
    const onHighlight = () => { setSelectedAiPreset('auto-highlight'); openSidebar('ai'); if (videoPath) void runAiPreset('auto-highlight'); };
    const onExport = () => openSidebar('export');
    ipcRenderer.on('open-file-dialog', openDialog);
    ipcRenderer.on('open-video', onOpenVideo);
    ipcRenderer.on('detect-players', onDetect);
    ipcRenderer.on('track-players', onTrack);
    ipcRenderer.on('player-highlight', onPlayerHighlight);
    ipcRenderer.on('auto-highlight', onHighlight);
    ipcRenderer.on('export-video', onExport);
    return () => {
      ipcRenderer.removeListener('open-file-dialog', openDialog);
      ipcRenderer.removeListener('open-video', onOpenVideo);
      ipcRenderer.removeListener('detect-players', onDetect);
      ipcRenderer.removeListener('track-players', onTrack);
      ipcRenderer.removeListener('player-highlight', onPlayerHighlight);
      ipcRenderer.removeListener('auto-highlight', onHighlight);
      ipcRenderer.removeListener('export-video', onExport);
    };
  }, [ipcRenderer, openSidebar, openVideo, runAiPreset, videoPath]);

  const sidebarContent = sidebarCollapsed ? null : sidebarTab === 'library'
    ? (
      <MediaLibraryPanel
        items={mediaLibrary}
        currentVideoPath={videoPath}
        onImportRequested={importReferenceMedia}
        onOpenItem={(item) => ipcRenderer?.send('open-path', item.path)}
        onRevealItem={(item) => ipcRenderer?.send('open-folder', item.path)}
        onAddToContext={(item) => {
          if (item.kind === 'source-video') return setStatusText('源视频已经在当前项目里了。');
          mutateTracks((prev) => prev.map((track) => {
            if (track.id !== OVERLAY_TRACK_ID) return track;
            const start = playheadTime;
            const end = playheadTime + Math.max(3, Number(item.duration || 6));
            const lane = findAvailableLane(track.items, track.type, start, end);
            return {
              ...track,
              items: [...track.items, { id: makeId('asset'), kind: 'asset' as const, trackId: OVERLAY_TRACK_ID, label: item.label, start, end, lane, enabled: true, assetPath: item.path }],
            };
          }));
          setStatusText(`已将 ${item.label} 加入素材轨。`);
        }}
      />
    )
    : sidebarTab === 'export'
      ? <ExportPanel videoPath={videoPath} videoInfo={videoInfo} timelineSnapshot={snapshot} onExported={handleExported} />
      : sidebarTab === 'ai'
        ? (
          <AIToolsPanel
            videoPath={videoPath}
            videoInfo={videoInfo}
            activePreset={selectedAiPreset}
            runningTool={runningTool}
            aiRunScope={aiRunScope}
            scopeLabel={rangeForScope(aiRunScope).label}
            effectControl={effectControl}
            aiRuntimeConfig={aiRuntimeConfig}
            highlightDuration={highlightDuration}
            maxHighlights={maxHighlights}
            summary={panelSummary}
            result={activeResult}
            targets={availableTargets}
            highlightClips={highlightCandidates}
            addedHighlightKeys={addedHighlightKeys}
            previewTargetBinding={previewTargetBinding}
            highlightTargetBindings={effectControl.targetBindings}
            highlightShowLabel={effectControl.highlightShowLabel}
            onPresetChange={setSelectedAiPreset}
            onRunPreset={runAiPreset}
            onScopeChange={setAiRunScope}
            onSetEffectTool={(tool) => { setEffectControl((prev) => ({ ...prev, activeTool: tool })); setSelectedAiPreset(tool); }}
            onSetControlMode={(mode) => { setEffectControl((prev) => ({ ...prev, controlMode: mode })); patchSelectedEffect((value) => ({ ...value, controlMode: mode })); }}
            onSetInteractionMode={(mode) => { setEffectControl((prev) => ({ ...prev, interactionMode: mode })); patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), interactionMode: mode } })); }}
            onPatchEffectParams={(patch) => { setEffectControl((prev) => ({ ...prev, params: { ...prev.params, ...patch } })); patchSelectedEffect((value) => ({ ...value, params: { ...(value.params || {}), ...patch } })); }}
            onTargetBindingChange={(target) => { setEffectControl((prev) => ({ ...prev, targetBinding: target })); setPreviewTargetBinding(target); patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), targetBinding: target } })); }}
            onPreviewTarget={setPreviewTargetBinding}
            onApplyTarget={(tool, target) => { setSelectedAiPreset(tool); setEffectControl((prev) => ({ ...prev, activeTool: tool, targetBinding: target })); setPreviewTargetBinding(target); if (selectedEffect && selectedEffect.operation === tool) patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), targetBinding: target } })); }}
            onAiRuntimeConfigChange={(nextValue) => { setAiRuntimeConfig(nextValue); patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), confidence: nextValue.confidenceThreshold, maxFrames: nextValue.maxFrames, focusMode: nextValue.focusMode, modelPreference: nextValue.modelPreference, modelPath: nextValue.modelPreference === 'custom' ? nextValue.customModelPath : undefined } })); }}
            onHighlightDurationChange={setHighlightDuration}
            onMaxHighlightsChange={setMaxHighlights}
            onAddHighlightClip={addHighlightClip}
            onAddAllHighlightClips={addAllHighlightClips}
            onHighlightTargetsChange={(targets) => {
              setEffectControl((prev) => ({ ...prev, targetBindings: targets }));
              if (targets.length) setPreviewTargetBinding(targets[targets.length - 1]);
              else if (selectedEffect?.operation === 'player-highlight') setPreviewTargetBinding(null);
              if (selectedEffect?.operation === 'player-highlight') {
                patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), targetBinding: targets[0] || null, targetBindings: targets } }));
              }
            }}
            onHighlightShowLabelChange={(value) => {
              setEffectControl((prev) => ({ ...prev, highlightShowLabel: value }));
              if (selectedEffect?.operation === 'player-highlight') {
                patchSelectedEffect((item) => ({ ...item, payload: { ...(item.payload || {}), showLabel: value } }));
              }
            }}
          />
        )
        : (
          <div className="inspector-panel">
            <section className="inspector-section">
              <h3>项目信息</h3>
              <label>
                项目名称
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <div className="inspector-meta-grid">
                <div><span>视频</span><strong>{videoInfo?.filename || fileName(videoPath)}</strong></div>
                <div><span>时长</span><strong>{formatTime(duration)}</strong></div>
                <div><span>帧率</span><strong>{fps.toFixed(2)}</strong></div>
                <div><span>创建时间</span><strong>{new Date(projectCreatedAt).toLocaleString()}</strong></div>
              </div>
            </section>
            <section className="inspector-section">
              <h3>手动片段</h3>
              <div className="range-row">
                <button className="btn btn-secondary" onClick={() => setClipDraftStart(playheadTime)}>设为入点</button>
                <button className="btn btn-secondary" onClick={() => setClipDraftEnd(playheadTime)}>设为出点</button>
              </div>
              <label>
                标题
                <input value={clipDraftLabel} onChange={(event) => setClipDraftLabel(event.target.value)} />
              </label>
              <div className="inspector-grid-two">
                <label><span>入点</span><input type="number" min="0" step="0.1" value={clipDraftStart} onChange={(event) => setClipDraftStart(Number(event.target.value) || 0)} /></label>
                <label><span>出点</span><input type="number" min="0" step="0.1" value={clipDraftEnd} onChange={(event) => setClipDraftEnd(Number(event.target.value) || 0)} /></label>
              </div>
              <button className="btn btn-primary" onClick={createManualClip}>加入素材轨</button>
            </section>
            {selectedEntry?.item ? (
              <section className="inspector-section">
                <h3>当前选择</h3>
                <div className="inspector-meta-grid">
                  <div><span>名称</span><strong>{selectedEntry.item.label}</strong></div>
                  <div><span>类型</span><strong>{selectedEntry.item.kind}</strong></div>
                  <div><span>开始</span><strong>{formatTime(selectedEntry.item.start)}</strong></div>
                  <div><span>结束</span><strong>{formatTime(selectedEntry.item.end)}</strong></div>
                  <div><span>子轨层</span><strong>{selectedEntry.item.lane + 1}</strong></div>
                  <div><span>轨道</span><strong>{selectedEntry.track.name}</strong></div>
                </div>
              </section>
            ) : (
              <section className="inspector-empty">
                <h3>当前没有选中内容</h3>
                <p>在时间线上点击任意片段或特效，这里会显示它的详细信息。</p>
              </section>
            )}
          </div>
        );

  if (!videoPath) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="header-left"><h1 className="app-title">足球视频编辑器</h1></div>
          <div className="header-right">
            <button className="btn btn-primary" onClick={() => ipcRenderer?.send('open-file-dialog')}>打开视频</button>
            <button className="btn btn-secondary" onClick={() => void loadRecentProject()}>最近项目</button>
          </div>
        </header>
        <div className="app-content">
          <div className="welcome-screen">
            <div className="welcome-content">
              <h2>一场比赛，一个工程，一条完整工作流</h2>
              <p>导入比赛视频，运行 AI 分析，在同一个编辑器里整理高光、叠加特效并完成导出。</p>
              <div className="welcome-actions">
                <button className="btn btn-primary btn-large" onClick={() => ipcRenderer?.send('open-file-dialog')}>打开比赛视频</button>
                <button className="btn btn-secondary btn-large" onClick={() => void loadProject()}>载入项目</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div>
            <h1 className="app-title">足球视频编辑器</h1>
            <div className="project-path">{projectFilePath || '未保存项目'}</div>
          </div>
          <span className="project-name">{projectName}</span>
        </div>
        <div className="header-right">
          <button className="btn btn-primary" onClick={() => ipcRenderer?.send('open-file-dialog')}>重新打开视频</button>
          <button className="btn btn-secondary" onClick={() => void loadProject()}>载入项目</button>
          <button className="btn btn-secondary" onClick={() => void loadRecentProject()}>最近项目</button>
          <button className="btn btn-secondary" onClick={() => void saveProject()}>保存项目</button>
          <button className="btn btn-secondary" onClick={() => void importReferenceMedia()}>导入参考素材</button>
        </div>
      </header>
      <div className="app-content">
        <div className={`editor-layout ${focusMonitor ? 'focus-monitor' : ''} ${effectiveSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <div className="editor-main">
            <section className="monitor-shell">
              <div className="monitor-toolbar">
                <div className="monitor-toolbar-left">
                  <strong className="monitor-file-name">{videoInfo?.filename || fileName(videoPath)}</strong>
                  <span className="monitor-scope-label">{rangeForScope(aiRunScope).label}</span>
                  <span className="monitor-status-text">{statusText}</span>
                </div>
                <div className="monitor-toolbar-right">
                  <button className={`chip-btn ${sidebarTab === 'ai' ? 'active' : ''}`} onClick={() => openSidebar('ai')}>AI 工具</button>
                  <button className={`chip-btn ${sidebarTab === 'library' ? 'active' : ''}`} onClick={() => openSidebar('library')}>素材库</button>
                  <button className={`chip-btn ${sidebarTab === 'export' ? 'active' : ''}`} onClick={() => openSidebar('export')}>导出</button>
                  <button className={`chip-btn ${monitorView === 'original' ? 'active' : ''}`} onClick={() => setMonitorView((prev) => prev === 'fit' ? 'original' : 'fit')}>{monitorView === 'fit' ? '原始尺寸' : '适应窗口'}</button>
                  <button className={`chip-btn ${focusMonitor ? 'active' : ''}`} onClick={() => setFocusMonitor((prev) => !prev)}>{focusMonitor ? '退出专注监看' : '专注监看'}</button>
                </div>
              </div>
              <div className="monitor-stage">
                <VideoPlayer
                  videoPath={videoInfo?.previewPath || videoPath}
                  videoInfo={videoInfo}
                  isProcessing={isProcessing}
                  monitorView={monitorView}
                  focusMonitor={focusMonitor}
                  interactionHintText={editableEffect?.operation === 'magnifier-effect'
                    ? '单击固定放大镜位置，滚轮调整半径，Shift + 滚轮调整缩放。'
                    : editableEffect?.operation === 'player-pov'
                      ? '单击设置锚点，拖动设定方向，滚轮调整视场范围。'
                      : null}
                  externalSeekTime={seekTime}
                  onSeekHandled={() => setSeekTime(null)}
                  onTimeChange={setPlayheadTime}
                  onToggleMonitorView={() => setMonitorView((prev) => prev === 'fit' ? 'original' : 'fit')}
                  onToggleFocusMonitor={() => setFocusMonitor((prev) => !prev)}
                  onMonitorViewFallback={(nextView, reason) => {
                    if (nextView !== 'fit' || reason !== 'viewport-too-small') return;
                    setMonitorView('fit');
                    setStatusText(ORIGINAL_VIEW_FALLBACK_STATUS);
                  }}
                  onMetadata={(meta) => {
                    setVideoInfo((prev: any) => ({
                      ...(prev || {}),
                      ...meta,
                      fps: Number(prev?.fps || 0) || 30,
                      filename: prev?.filename || fileName(videoPath),
                      path: prev?.path || videoPath,
                      metadataSource: 'html5',
                    }));
                    setTracks((prev) => {
                      const baseTracks = prev.some((track) => track.items.length > 0) ? prev : createTracks(videoPath, meta.duration);
                      return normalizeTracksCollection(baseTracks, videoPath, meta.duration);
                    });
                    setClipDraftEnd((prev) => {
                      if (meta.duration <= 0) return prev;
                      if (prev > MIN_DURATION) return clamp(prev, MIN_DURATION, Math.max(MIN_DURATION, meta.duration));
                      return Math.min(10, Math.max(4, meta.duration));
                    });
                    setMediaLibrary((prev) => upsertLibrary(prev, createSourceItem(videoPath, { ...(videoInfo || {}), ...meta, filename: videoInfo?.filename || fileName(videoPath) })));
                  }}
                  onPlayingChange={setIsPlaying}
                  previewEffects={previewEffects}
                  editableEffect={editableEffect}
                  trackingOverlay={trackingOverlay}
                  onSetEffectTool={(tool) => { setEffectControl((prev) => ({ ...prev, activeTool: tool })); setSelectedAiPreset(tool); }}
                  onSetControlMode={(mode) => { setEffectControl((prev) => ({ ...prev, controlMode: mode })); patchSelectedEffect((value) => ({ ...value, controlMode: mode })); }}
                  onSetInteractionMode={(mode) => { setEffectControl((prev) => ({ ...prev, interactionMode: mode })); patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), interactionMode: mode } })); }}
                  onSetManualAnchor={(anchor) => { setEffectControl((prev) => ({ ...prev, manual: { ...prev.manual, anchor } })); patchSelectedEffect((value) => ({ ...value, manual: { ...(value.manual || DEFAULT_EFFECT.manual), anchor } })); }}
                  onSetManualDirectionDeg={(directionDeg) => { setEffectControl((prev) => ({ ...prev, manual: { ...prev.manual, directionDeg } })); patchSelectedEffect((value) => ({ ...value, manual: { ...(value.manual || DEFAULT_EFFECT.manual), directionDeg } })); }}
                  onPatchEffectParams={(patch) => { setEffectControl((prev) => ({ ...prev, params: { ...prev.params, ...patch } })); patchSelectedEffect((value) => ({ ...value, params: { ...(value.params || {}), ...patch } })); }}
                  onPatchEffectKeyframes={(keyframes) => { if (selectedEffect) patchSelectedEffect((value) => ({ ...value, payload: { ...(value.payload || {}), keyframes } })); else setDraftEffectKeyframes(keyframes); }}
                  onClearManualControl={(fallbackMode = 'hybrid') => { setEffectControl((prev) => ({ ...prev, controlMode: fallbackMode, manual: { anchor: null, directionDeg: null } })); patchSelectedEffect((value) => ({ ...value, controlMode: fallbackMode, manual: { anchor: null, directionDeg: null } })); }}
                  command={playerCommand}
                />
              </div>
            </section>
            <section className="edit-strip">
              <div className="edit-strip-left">
                <button className="btn btn-secondary" onClick={() => dispatchPlayerCommand('toggle-play')}>{isPlaying ? '暂停' : '播放'}</button>
                <button className="btn btn-secondary" onClick={() => dispatchPlayerCommand('step-backward')}>上一帧</button>
                <button className="btn btn-secondary" onClick={() => dispatchPlayerCommand('step-forward')}>下一帧</button>
                <button className="btn btn-secondary" onClick={() => setUndoStack((prev) => { if (!prev.length) return prev; const next = [...prev]; const last = next.pop() as Track[]; setRedoStack((redoPrev) => [...redoPrev, clone(tracksRef.current)]); setTracks(last); return next; })} disabled={!undoStack.length}>撤销</button>
                <button className="btn btn-secondary" onClick={() => setRedoStack((prev) => { if (!prev.length) return prev; const next = [...prev]; const last = next.pop() as Track[]; setUndoStack((undoPrev) => [...undoPrev, clone(tracksRef.current)]); setTracks(last); return next; })} disabled={!redoStack.length}>重做</button>
              </div>
              <div className="edit-strip-right">
                <span className="edit-status">播放头 {formatTime(playheadTime)}{selectedEntry?.item ? ` / 已选中：${selectedEntry.item.label}` : ''}</span>
                <button className="btn btn-secondary" onClick={splitSelection} disabled={!selectedEntry}>拆分所选片段</button>
                <button className="btn btn-secondary" onClick={() => selection.trackId && selection.itemId && deleteItem(selection.trackId, selection.itemId)} disabled={!selectedEntry}>删除所选片段</button>
              </div>
            </section>
            <section className="timeline-stage">
              <Timeline tracks={tracks} duration={duration} fps={fps} playheadTime={playheadTime} selection={selection} markers={highlightCandidates} onSeek={(time) => { setPlayheadTime(time); setSeekTime(time); }} onSelectItem={handleSelectItem} onMoveItem={moveItem} onToggleItem={toggleItem} onDeleteItem={deleteItem} />
            </section>
          </div>
          {!focusMonitor ? (
            <aside className={`workspace-sidebar ${effectiveSidebarCollapsed ? 'collapsed' : ''}`}>
              <div className="sidebar-tabs">
                <button className={`sidebar-tab ${sidebarTab === 'inspector' ? 'active' : ''}`} onClick={() => openSidebar('inspector')}>检查器</button>
                <button className={`sidebar-tab ${sidebarTab === 'ai' ? 'active' : ''}`} onClick={() => openSidebar('ai')}>AI</button>
                <button className={`sidebar-tab ${sidebarTab === 'library' ? 'active' : ''}`} onClick={() => openSidebar('library')}>素材库</button>
                <button className={`sidebar-tab ${sidebarTab === 'export' ? 'active' : ''}`} onClick={() => openSidebar('export')}>导出</button>
                <button className="sidebar-collapse-btn" onClick={() => { if (!autoCollapsed) setSidebarCollapsed((prev) => !prev); }}>{effectiveSidebarCollapsed ? '>' : '<'}</button>
              </div>
              {!effectiveSidebarCollapsed ? <div className="sidebar-body">{sidebarContent}</div> : null}
            </aside>
          ) : null}
        </div>
      </div>
      <footer className="app-footer">
        <div className="status-info">
          <span className="status-item">源视频：{videoInfo?.filename || '未加载'}</span>
          <span className="status-item">特效片段：{tracks.filter((track) => track.type === 'effect').reduce((sum, track) => sum + track.items.length, 0)}</span>
          <span className="status-item">素材片段：{tracks.filter((track) => track.type === 'overlay').reduce((sum, track) => sum + track.items.length, 0)}</span>
          <span className="status-item">素材库：{mediaLibrary.length}</span>
        </div>
        <div className="status-indicator">
          <span className="status-item">{statusText}</span>
          {runningTool ? <span className="status-item">正在运行 {PRESET_LABEL[runningTool]}...</span> : null}
        </div>
      </footer>
    </div>
  );
}

export default App;
