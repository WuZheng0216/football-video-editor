export type ClipSource = 'ai' | 'manual';
export type ModelPreference = 'best' | 'balanced' | 'fast' | 'custom';
export type SidebarTab = 'inspector' | 'ai' | 'export';
export type AiPresetId = 'detect-players' | 'track-players' | 'magnifier-effect' | 'player-pov' | 'auto-highlight';
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
export type EffectOperation = EffectTool | 'detect-players' | 'track-players';
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
}

export interface TargetBinding {
  trackId?: number | null;
  class?: 'player' | 'ball';
  label?: string;
  confidence?: number;
  sampleTime?: number;
  bbox?: number[] | null;
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
  enabled: boolean;
  locked?: boolean;
}

export interface ClipItem extends TimelineItemBase {
  kind: 'clip';
  sourcePath: string;
  sourceStart: number;
  sourceEnd: number;
  sourceType: 'original' | 'artifact' | 'manual';
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
    keyframes?: EffectKeyframe[];
    interactionMode?: EffectInteractionMode;
    targets?: AiTarget[];
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
