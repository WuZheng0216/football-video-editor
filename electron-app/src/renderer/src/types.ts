export type ClipSource = 'ai' | 'manual';
export type ModelPreference = 'best' | 'balanced' | 'fast' | 'custom';
export type SidebarTab = 'inspector' | 'library' | 'ai' | 'export';
export type AiPresetId = 'detect-players' | 'track-players' | 'magnifier-effect' | 'player-pov' | 'player-highlight' | 'auto-highlight';
export type AiRunScope = 'selection' | 'track' | 'full';

export interface TimelineClip {
  id: string;
  start: number;
  end: number;
  label: string;
  source: ClipSource;
  score?: number;
  enabled: boolean;
  trackId?: string;
  sourcePath?: string;
}

export type MarkerType = 'goal' | 'shot' | 'foul' | 'save' | 'corner' | 'note';

export interface TimelineMarker {
  id: string;
  time: number;
  type: MarkerType;
  label: string;
}

export type EffectTool = 'magnifier-effect' | 'player-pov';
export type EffectOperation = EffectTool | 'detect-players' | 'track-players' | 'player-highlight';
export type EffectControlMode = 'auto' | 'manual' | 'hybrid';
export type EffectSource = 'ai' | 'manual';
export type EffectInteractionMode = 'cursor-follow' | 'pinned' | 'auto-target';

export interface Point2D {
  x: number;
  y: number;
}

export interface ManualEffectState {
  anchor: Point2D | null;
  directionDeg: number | null;
}

export interface EffectParams {
  magnifierRadius: number;
  magnifierZoom: number;
  magnifierFeather: number;
  povAngle: number;
  fovAperture: number;
  fovLength: number;
  fovDim: number;
  highlightOutlineWidth: number;
  highlightGlowStrength: number;
  highlightFillOpacity: number;
}

export interface TargetBinding {
  trackId?: number | null;
  class?: 'player' | 'ball';
  label?: string;
  confidence?: number;
  sampleTime?: number;
  bbox?: number[] | null;
  teamCluster?: number | null;
  teamLabel?: string | null;
  displayColor?: string | null;
}

export interface EffectKeyframe {
  time: number;
  x: number;
  y: number;
  directionDeg?: number;
  source?: EffectSource;
}

export interface EffectControlState {
  activeTool: EffectTool;
  controlMode: EffectControlMode;
  interactionMode: EffectInteractionMode;
  manual: ManualEffectState;
  params: EffectParams;
  targetBinding: TargetBinding | null;
  targetBindings: TargetBinding[];
  highlightShowLabel: boolean;
}

export interface AiRuntimeConfig {
  confidenceThreshold: number;
  maxFrames: number;
  writeVideo: boolean;
  focusMode: 'player' | 'ball';
  modelPreference: ModelPreference;
  customModelPath: string;
}

export interface AiRunSummary {
  operation: AiPresetId;
  scope: AiRunScope;
  title: string;
  success: boolean;
  framesProcessed: number;
  generatedItems: number;
  warnings: string[];
  outputPath?: string | null;
  modelResolved?: string | null;
  rangeStart?: number;
  rangeEnd?: number;
  message?: string;
  targetsDetected?: number;
  highlightsGenerated?: number;
  updatedExistingItem?: boolean;
}

export interface EffectFrameMeta {
  frame: number;
  timestamp: number;
  x: number;
  y: number;
  source?: EffectSource;
  directionDeg?: number;
  directionSource?: EffectSource;
  radius?: number;
  zoom?: number;
  feather?: number;
  aperture?: number;
  length?: number;
  dim?: number;
  targetClass?: string | null;
  targetTrackId?: number | null;
}

export interface AiTarget {
  id: string;
  label: string;
  class: 'player' | 'ball';
  confidence?: number;
  trackId?: number | null;
  appearances?: number;
  firstTimestamp?: number;
  lastTimestamp?: number;
  latestBBox?: number[] | null;
  sampleTime?: number;
  source: 'detect' | 'track';
  teamCluster?: number | null;
  teamLabel?: string | null;
  displayColor?: string | null;
  jerseyColor?: number[] | null;
  trackSpan?: number;
  visibleRatio?: number;
  avgConfidence?: number;
}

export interface HighlightClip {
  id: string;
  title: string;
  start: number;
  end: number;
  score?: number;
  confidence?: number;
}

export type TrackType = 'video' | 'effect' | 'overlay';
export type TimelineItemKind = 'clip' | 'effect' | 'asset';

export interface TimelineItemBase {
  id: string;
  kind: TimelineItemKind;
  trackId: string;
  label: string;
  start: number;
  end: number;
  lane: number;
  enabled: boolean;
  locked?: boolean;
}

export interface ClipItem extends TimelineItemBase {
  kind: 'clip';
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  sourceType: 'original' | 'artifact' | 'manual' | 'highlight-ai' | 'reference';
  score?: number;
}

export interface EffectItem extends TimelineItemBase {
  kind: 'effect';
  operation: EffectOperation;
  effectSource: EffectSource;
  resultKey?: string;
  controlMode?: EffectControlMode;
  manual?: ManualEffectState;
  params?: Partial<EffectParams>;
  payload?: {
    confidence?: number;
    maxFrames?: number;
    focusMode?: 'player' | 'ball';
    modelPreference?: ModelPreference;
    modelPath?: string;
    scope?: AiRunScope;
    rangeStart?: number;
    rangeEnd?: number;
    summary?: AiRunSummary;
    targetBinding?: TargetBinding | null;
    targetBindings?: TargetBinding[];
    keyframes?: EffectKeyframe[];
    interactionMode?: EffectInteractionMode;
    targets?: AiTarget[];
    trackSamples?: any[];
    showLabel?: boolean;
    previewResult?: any;
    analysisUpdatedAt?: string;
    [key: string]: any;
  };
}

export interface AssetItem extends TimelineItemBase {
  kind: 'asset';
  assetPath: string;
}

export type TimelineItem = ClipItem | EffectItem | AssetItem;

export interface Track {
  id: string;
  type: TrackType;
  name: string;
  order: number;
  enabled: boolean;
  items: TimelineItem[];
}

export interface TimelineSnapshot {
  version: number;
  sourceVideoPath: string;
  duration: number;
  fps: number;
  tracks: Track[];
}

export interface AnalysisCacheEntry {
  operation: AiPresetId;
  result: any;
  summary?: AiRunSummary | null;
  updatedAt: string;
}

export type AnalysisCache = Partial<Record<AiPresetId, AnalysisCacheEntry>>;

export interface MediaLibraryItem {
  id: string;
  kind: 'source-video' | 'ai-artifact' | 'export' | 'reference';
  label: string;
  path: string;
  createdAt: string;
  sourceVideoPath?: string;
  operation?: AiPresetId;
  artifactKey?: string;
  duration?: number;
  fps?: number;
  width?: number;
  height?: number;
  size?: number;
  metadata?: Record<string, any>;
}

export interface PreviewEffectLayer {
  id: string;
  label: string;
  operation: EffectOperation;
  lane: number;
  result: any;
  controlMode?: EffectControlMode;
  interactionMode?: EffectInteractionMode;
  manual?: ManualEffectState;
  params?: Partial<EffectParams>;
  targetBinding?: TargetBinding | null;
  targetBindings?: TargetBinding[];
  keyframes?: EffectKeyframe[];
  showLabel?: boolean;
  editable?: boolean;
  draft?: boolean;
}

export interface EditorProjectUiState {
  sidebarTab: SidebarTab;
  sidebarCollapsed: boolean;
  selectedAiPreset: AiPresetId;
  aiRunScope: AiRunScope;
  effectControl: EffectControlState;
  aiRuntimeConfig: AiRuntimeConfig;
  highlightDuration: number;
  maxHighlights: number;
  focusMonitor: boolean;
  monitorView: 'fit' | 'original';
}

export interface EditorProject {
  version: number;
  name: string;
  sourceVideoPath: string;
  projectPath?: string | null;
  createdAt: string;
  updatedAt: string;
  videoInfo?: any;
  timelineSnapshot: TimelineSnapshot | null;
  mediaLibrary: MediaLibraryItem[];
  analysisCache: AnalysisCache;
  uiState: EditorProjectUiState;
  warnings?: string[];
}

export interface PlayheadState {
  time: number;
  isPlaying: boolean;
  fps: number;
}

export interface SelectionState {
  trackId: string | null;
  itemId: string | null;
}

export interface EditCommand {
  type: 'add' | 'update' | 'delete' | 'split' | 'move' | 'resize' | 'toggle';
  trackId?: string;
  itemId?: string;
  timestamp: number;
}
