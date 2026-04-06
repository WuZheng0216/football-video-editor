import React from 'react';
import './AIToolsPanel.css';
import {
  AiPresetId,
  AiRunScope,
  AiRunSummary,
  AiRuntimeConfig,
  AiTarget,
  EffectControlState,
  EffectOperation,
  EffectTool,
  HighlightClip,
  TargetBinding,
} from '../types';

type TimelineEffectPreset = 'magnifier-effect' | 'player-pov' | 'player-highlight';

interface AIToolsPanelProps {
  videoPath: string;
  videoInfo: any;
  activePreset: AiPresetId;
  runningTool: AiPresetId | null;
  aiRunScope: AiRunScope;
  scopeLabel: string;
  effectControl: EffectControlState;
  aiRuntimeConfig: AiRuntimeConfig;
  highlightDuration: number;
  maxHighlights: number;
  summary: AiRunSummary | null;
  result: any;
  targets: AiTarget[];
  highlightClips: HighlightClip[];
  addedHighlightKeys: ReadonlySet<string>;
  previewTargetBinding: TargetBinding | null;
  highlightTargetBindings: TargetBinding[];
  highlightShowLabel: boolean;
  selectedEffectLabel: string | null;
  selectedEffectOperation: EffectOperation | null;
  onPresetChange: (tool: AiPresetId) => void;
  onRunPreset: (tool: AiPresetId) => void;
  onScopeChange: (scope: AiRunScope) => void;
  onSetEffectTool: (tool: EffectTool) => void;
  onSetControlMode: (mode: EffectControlState['controlMode']) => void;
  onSetInteractionMode: (mode: EffectControlState['interactionMode']) => void;
  onPatchEffectParams: (patch: Partial<EffectControlState['params']>) => void;
  onTargetBindingChange: (target: TargetBinding | null) => void;
  onPreviewTarget: (target: TargetBinding | null) => void;
  onApplyTarget: (tool: EffectTool, target: TargetBinding | null) => void;
  onAiRuntimeConfigChange: (next: AiRuntimeConfig) => void;
  onHighlightDurationChange: (value: number) => void;
  onMaxHighlightsChange: (value: number) => void;
  onAddHighlightClip: (clip: HighlightClip) => void;
  onAddAllHighlightClips: () => void;
  onHighlightTargetsChange: (targets: TargetBinding[]) => void;
  onHighlightShowLabelChange: (value: boolean) => void;
  onCreateEffectClip: (tool: TimelineEffectPreset) => void;
  onApplyToSelectedEffect: () => void;
  onResetToAutoTarget: () => void;
}

const PRESETS: Record<AiPresetId, { label: string; desc: string }> = {
  'detect-players': { label: '目标检测', desc: '逐帧检测球员或足球，生成检测框结果。' },
  'track-players': { label: '片段跟踪', desc: '对整段视频进行多目标跟踪，生成稳定轨迹与目标列表。' },
  'magnifier-effect': { label: '放大镜', desc: '在时间线片段上叠加放大镜特效，支持手动或自动跟随。' },
  'player-pov': { label: '球员视角', desc: '生成球员 POV 扇形视野遮罩，可在画布上直接拖拽编辑。' },
  'player-highlight': { label: '多人高亮', desc: '对选中的多个球员持续加描边与光晕高亮。' },
  'auto-highlight': { label: '自动高光', desc: '自动评分比赛片段，生成可加入素材轨的候选高光。' },
};

const ANALYSIS_PRESETS: AiPresetId[] = ['detect-players', 'track-players', 'auto-highlight'];
const TIMELINE_PRESETS: TimelineEffectPreset[] = ['magnifier-effect', 'player-pov', 'player-highlight'];

const clipSignature = (start: number, end: number) => `${start.toFixed(3)}_${end.toFixed(3)}`;

function targetBindingOf(target: AiTarget): TargetBinding {
  return {
    trackId: target.trackId ?? null,
    class: target.class,
    label: target.label,
    confidence: target.confidence,
    sampleTime: target.sampleTime ?? target.firstTimestamp,
    bbox: target.latestBBox || null,
    teamCluster: target.teamCluster ?? null,
    teamLabel: target.teamLabel ?? null,
    displayColor: target.displayColor ?? null,
  };
}

function sameTarget(a: TargetBinding | null | undefined, b: TargetBinding | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.trackId != null && b.trackId != null) return Number(a.trackId) === Number(b.trackId);
  return String(a.label || '') === String(b.label || '');
}

function isTimelineEffectPreset(preset: AiPresetId): preset is TimelineEffectPreset {
  return TIMELINE_PRESETS.includes(preset as TimelineEffectPreset);
}

const AIToolsPanel: React.FC<AIToolsPanelProps> = ({
  videoPath,
  videoInfo,
  activePreset,
  runningTool,
  aiRunScope,
  scopeLabel,
  effectControl,
  aiRuntimeConfig,
  highlightDuration,
  maxHighlights,
  summary,
  result,
  targets,
  highlightClips,
  addedHighlightKeys,
  previewTargetBinding,
  highlightTargetBindings,
  highlightShowLabel,
  selectedEffectLabel,
  selectedEffectOperation,
  onPresetChange,
  onRunPreset,
  onScopeChange,
  onSetEffectTool,
  onSetControlMode,
  onSetInteractionMode,
  onPatchEffectParams,
  onTargetBindingChange,
  onPreviewTarget,
  onApplyTarget,
  onAiRuntimeConfigChange,
  onHighlightDurationChange,
  onMaxHighlightsChange,
  onAddHighlightClip,
  onAddAllHighlightClips,
  onHighlightTargetsChange,
  onHighlightShowLabelChange,
  onCreateEffectClip,
  onApplyToSelectedEffect,
  onResetToAutoTarget,
}) => {
  const showEffectControls = activePreset === 'magnifier-effect' || activePreset === 'player-pov';
  const showPlayerHighlightControls = activePreset === 'player-highlight';
  const isTimelinePreset = isTimelineEffectPreset(activePreset);
  const canApplyToSelectedEffect = Boolean(selectedEffectLabel && selectedEffectOperation === activePreset && isTimelinePreset);
  const canResetToAutoTarget = Boolean(selectedEffectLabel && selectedEffectOperation === activePreset && showEffectControls);

  const toggleHighlightTarget = (target: TargetBinding) => {
    const exists = highlightTargetBindings.some((item) => sameTarget(item, target));
    if (exists) {
      onHighlightTargetsChange(highlightTargetBindings.filter((item) => !sameTarget(item, target)));
      return;
    }
    onHighlightTargetsChange([...highlightTargetBindings, target]);
  };

  const effectStatusText = canApplyToSelectedEffect
    ? `当前正在编辑：${selectedEffectLabel}`
    : selectedEffectLabel
      ? `当前选中的是其它特效：${selectedEffectLabel}。可以继续配置参数，或先切回对应片段。`
      : '当前未选中特效。右侧参数会作为待创建片段的草稿保存，不会直接叠加到播放器。';

  return (
    <div className="ai-tools-panel">
      <div className="ai-panel-header">
        <div>
          <h3>AI 工具</h3>
          <p>{videoInfo?.filename || '未打开视频'} | {scopeLabel}</p>
        </div>
        <button className="run-btn" onClick={() => onRunPreset(activePreset)} disabled={!videoPath || Boolean(runningTool)}>
          {runningTool === activePreset ? '运行中...' : `运行 ${PRESETS[activePreset].label}`}
        </button>
      </div>

      <section className="panel-block">
        <div className="block-title">分析工具</div>
        <div className="preset-grid">
          {ANALYSIS_PRESETS.map((preset) => (
            <button key={preset} className={`preset-card ${activePreset === preset ? 'active' : ''}`} onClick={() => onPresetChange(preset)}>
              <strong>{PRESETS[preset].label}</strong>
              <span>{PRESETS[preset].desc}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-block">
        <div className="block-title">时间线特效</div>
        <div className="preset-grid">
          {TIMELINE_PRESETS.map((preset) => (
            <button
              key={preset}
              className={`preset-card ${activePreset === preset ? 'active' : ''}`}
              onClick={() => {
                onPresetChange(preset);
                if (preset === 'magnifier-effect' || preset === 'player-pov') onSetEffectTool(preset);
              }}
            >
              <strong>{PRESETS[preset].label}</strong>
              <span>{PRESETS[preset].desc}</span>
            </button>
          ))}
        </div>
        {isTimelinePreset ? (
          <>
            <div className="effect-editor-status">{effectStatusText}</div>
            <div className="inline-actions">
              <button onClick={() => onCreateEffectClip(activePreset as TimelineEffectPreset)} disabled={!videoPath}>创建特效片段并进入编辑</button>
              <button onClick={onApplyToSelectedEffect} disabled={!canApplyToSelectedEffect}>应用到当前选中特效</button>
              {showEffectControls ? (
                <button onClick={onResetToAutoTarget} disabled={!canResetToAutoTarget}>重置为自动跟随</button>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      <section className="panel-block">
        <div className="block-title">运行范围</div>
        <div className="chip-row">
          {(['selection', 'track', 'full'] as AiRunScope[]).map((scope) => (
            <button key={scope} className={`chip ${aiRunScope === scope ? 'active' : ''}`} onClick={() => onScopeChange(scope)}>
              {scope === 'selection' ? '当前选中片段' : scope === 'track' ? '当前轨道范围' : '整段视频'}
            </button>
          ))}
        </div>
        <div className="hint-line">{scopeLabel}</div>
      </section>

      <section className="panel-block">
        <div className="block-title">运行参数</div>
        <label>
          置信度阈值 {Math.round(aiRuntimeConfig.confidenceThreshold * 100)}%
          <input
            type="range"
            min="0.1"
            max="0.9"
            step="0.05"
            value={aiRuntimeConfig.confidenceThreshold}
            onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, confidenceThreshold: Number(event.target.value) })}
          />
        </label>
        <label>
          关注对象
          <select value={aiRuntimeConfig.focusMode} onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, focusMode: event.target.value as 'player' | 'ball' })}>
            <option value="player">球员</option>
            <option value="ball">足球</option>
          </select>
        </label>
        <label>
          模型偏好
          <select value={aiRuntimeConfig.modelPreference} onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, modelPreference: event.target.value as AiRuntimeConfig['modelPreference'] })}>
            <option value="best">最优质量</option>
            <option value="balanced">平衡模式</option>
            <option value="fast">快速模式</option>
            <option value="custom">自定义模型</option>
          </select>
        </label>
        {aiRuntimeConfig.modelPreference === 'custom' ? (
          <label>
            自定义模型路径
            <input
              type="text"
              value={aiRuntimeConfig.customModelPath}
              onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, customModelPath: event.target.value })}
              placeholder="C:\\models\\best.pt"
            />
          </label>
        ) : null}
        <label>
          最大处理帧数
          <input
            type="number"
            min="0"
            value={aiRuntimeConfig.maxFrames}
            onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, maxFrames: Number(event.target.value) || 0 })}
          />
        </label>
      </section>

      {showEffectControls ? (
        <section className="panel-block">
          <div className="block-title">画布编辑方式</div>
          <div className="chip-row">
            {(['auto', 'hybrid', 'manual'] as const).map((mode) => (
              <button key={mode} className={`chip ${effectControl.controlMode === mode ? 'active' : ''}`} onClick={() => onSetControlMode(mode)}>
                {mode === 'auto' ? '自动' : mode === 'hybrid' ? '混合' : '手动'}
              </button>
            ))}
          </div>
          <div className="chip-row">
            {(['cursor-follow', 'auto-target', 'pinned'] as const).map((mode) => (
              <button key={mode} className={`chip ${effectControl.interactionMode === mode ? 'active' : ''}`} onClick={() => onSetInteractionMode(mode)}>
                {mode === 'cursor-follow' ? '鼠标跟随' : mode === 'auto-target' ? '自动跟随目标' : '固定锚点'}
              </button>
            ))}
          </div>

          {activePreset === 'magnifier-effect' ? (
            <>
              <label>
                放大镜半径
                <input type="number" min="20" max="520" value={effectControl.params.magnifierRadius} onChange={(event) => onPatchEffectParams({ magnifierRadius: Number(event.target.value) || 120 })} />
              </label>
              <label>
                放大倍数
                <input type="number" min="1" max="8" step="0.1" value={effectControl.params.magnifierZoom} onChange={(event) => onPatchEffectParams({ magnifierZoom: Number(event.target.value) || 2 })} />
              </label>
              <label>
                羽化强度
                <input type="number" min="0" max="64" step="0.5" value={effectControl.params.magnifierFeather} onChange={(event) => onPatchEffectParams({ magnifierFeather: Number(event.target.value) || 10 })} />
              </label>
            </>
          ) : null}

          {activePreset === 'player-pov' ? (
            <>
              <label>
                视场角
                <input type="number" min="10" max="170" value={effectControl.params.fovAperture} onChange={(event) => onPatchEffectParams({ fovAperture: Number(event.target.value) || 60 })} />
              </label>
              <label>
                视距长度
                <input type="number" min="40" max="2400" value={effectControl.params.fovLength} onChange={(event) => onPatchEffectParams({ fovLength: Number(event.target.value) || 320 })} />
              </label>
              <label>
                遮罩强度
                <input type="number" min="0" max="0.95" step="0.01" value={effectControl.params.fovDim} onChange={(event) => onPatchEffectParams({ fovDim: Number(event.target.value) || 0.5 })} />
              </label>
            </>
          ) : null}

          <div className="hint-line">
            {effectControl.targetBinding?.label
              ? `当前单目标绑定：${effectControl.targetBinding.label}`
              : '可以先在下方目标列表中选择球员，再创建或编辑放大镜 / POV 片段。'}
          </div>
          {effectControl.targetBinding ? (
            <div className="inline-actions">
              <button onClick={() => onTargetBindingChange(null)}>清除单目标绑定</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {showPlayerHighlightControls ? (
        <section className="panel-block">
          <div className="block-title">多人高亮参数</div>
          <label>
            描边宽度
            <input type="number" min="1" max="12" step="0.5" value={effectControl.params.highlightOutlineWidth} onChange={(event) => onPatchEffectParams({ highlightOutlineWidth: Number(event.target.value) || 3 })} />
          </label>
          <label>
            发光强度
            <input type="number" min="0" max="8" step="0.1" value={effectControl.params.highlightGlowStrength} onChange={(event) => onPatchEffectParams({ highlightGlowStrength: Number(event.target.value) || 1.8 })} />
          </label>
          <label>
            填充透明度
            <input type="number" min="0" max="0.85" step="0.01" value={effectControl.params.highlightFillOpacity} onChange={(event) => onPatchEffectParams({ highlightFillOpacity: Number(event.target.value) || 0.18 })} />
          </label>
          <label className="checkbox-row compact">
            <input type="checkbox" checked={highlightShowLabel} onChange={(event) => onHighlightShowLabelChange(event.target.checked)} />
            <span>显示标签</span>
          </label>
          <div className="hint-line">
            已选中 {highlightTargetBindings.length} 名球员，用于创建或更新多人高亮片段。
          </div>
          <div className="inline-actions">
            <button onClick={() => onHighlightTargetsChange([])} disabled={!highlightTargetBindings.length}>清空高亮组</button>
          </div>
        </section>
      ) : null}

      {activePreset === 'auto-highlight' ? (
        <section className="panel-block">
          <div className="block-title">自动高光参数</div>
          <label>
            片段时长（秒）
            <input type="number" min="4" max="30" value={highlightDuration} onChange={(event) => onHighlightDurationChange(Number(event.target.value) || 10)} />
          </label>
          <label>
            最多生成条数
            <input type="number" min="1" max="20" value={maxHighlights} onChange={(event) => onMaxHighlightsChange(Number(event.target.value) || 6)} />
          </label>
        </section>
      ) : null}

      <section className="panel-block">
        <div className="block-title">目标列表</div>
        {!targets.length ? (
          <div className="hint-line">先运行目标检测或片段跟踪，生成稳定的球员目标后再绑定特效。</div>
        ) : (
          <div className="target-list">
            {targets.map((target) => {
              const binding = targetBindingOf(target);
              const previewing = sameTarget(previewTargetBinding, binding);
              const selectedForHighlight = highlightTargetBindings.some((item) => sameTarget(item, binding));
              return (
                <div key={target.id} className={`target-card ${previewing ? 'previewing' : ''} ${selectedForHighlight ? 'selected' : ''}`}>
                  <div className="target-card-head">
                    <div className="target-title">
                      {target.displayColor ? <span className="team-dot" style={{ backgroundColor: target.displayColor }} /> : null}
                      <strong>{target.label}</strong>
                    </div>
                    <span>{target.trackId != null ? `#${target.trackId}` : '无轨迹 ID'}</span>
                  </div>
                  <div className="target-meta">
                    <span>{target.class === 'player' ? '球员' : '足球'}</span>
                    {typeof target.confidence === 'number' ? <span>{(target.confidence * 100).toFixed(0)}%</span> : null}
                    {target.teamLabel ? <span>{target.teamLabel}</span> : null}
                    {typeof target.appearances === 'number' ? <span>{target.appearances} 帧</span> : null}
                    {typeof target.trackSpan === 'number' ? <span>{target.trackSpan.toFixed(1)}s</span> : null}
                    {typeof target.visibleRatio === 'number' ? <span>可见 {(target.visibleRatio * 100).toFixed(0)}%</span> : null}
                  </div>
                  <div className="target-actions">
                    <button onClick={() => onPreviewTarget(binding)}>聚焦</button>
                    <button onClick={() => onApplyTarget('magnifier-effect', binding)}>用于放大镜</button>
                    <button onClick={() => onApplyTarget('player-pov', binding)}>用于 POV</button>
                    <button onClick={() => toggleHighlightTarget(binding)}>
                      {selectedForHighlight ? '移出高亮组' : '加入高亮组'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={`summary-card ${summary?.success === false ? 'error' : 'success'}`}>
        <div className="summary-head">
          <strong>{summary?.title || '运行结果'}</strong>
          <span>{summary?.success === false ? '失败' : '已就绪'}</span>
        </div>
        {summary ? (
          <>
            <div className="summary-grid">
              <div><span>处理帧数</span><strong>{summary.framesProcessed}</strong></div>
              <div><span>生成条目</span><strong>{summary.generatedItems}</strong></div>
              <div><span>目标数量</span><strong>{summary.targetsDetected || targets.length}</strong></div>
              <div><span>高光片段</span><strong>{summary.highlightsGenerated || highlightClips.length}</strong></div>
            </div>
            {summary.message ? <div className="hint-line">{summary.message}</div> : null}
            {summary.modelResolved ? <div className="hint-line">实际模型：{summary.modelResolved}</div> : null}
            {summary.warnings.length ? <div className="warning-box">{summary.warnings.map((warning, index) => <div key={`${warning}_${index}`}>{warning}</div>)}</div> : null}
            {result ? <details className="result-details"><summary>查看原始结果 JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details> : null}
          </>
        ) : (
          <div className="hint-line">选择一个工具并运行后，这里会展示模型、告警和结果摘要。</div>
        )}
      </section>

      {highlightClips.length ? (
        <section className="panel-block">
          <div className="block-title">自动高光候选</div>
          <div className="inline-actions">
            <button onClick={onAddAllHighlightClips}>全部加入时间线</button>
          </div>
          <div className="highlight-list">
            {highlightClips.map((clip) => {
              const alreadyAdded = addedHighlightKeys.has(clipSignature(clip.start, clip.end));
              return (
                <div key={clip.id} className="highlight-card">
                  <div>
                    <strong>{clip.title}</strong>
                    <span>{clip.start.toFixed(2)}s - {clip.end.toFixed(2)}s</span>
                  </div>
                  <button onClick={() => onAddHighlightClip(clip)} disabled={alreadyAdded}>
                    {alreadyAdded ? '已在时间线中' : '加入时间线'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
};

export default AIToolsPanel;
