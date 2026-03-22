import React from 'react';
import './AIToolsPanel.css';
import {
  AiPresetId,
  AiRunScope,
  AiRunSummary,
  AiRuntimeConfig,
  AiTarget,
  EffectControlState,
  EffectTool,
  HighlightClip,
  TargetBinding,
} from '../types';

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
  highlightTargetBindings: TargetBinding[];
  highlightShowLabel: boolean;
  onHighlightTargetsChange: (targets: TargetBinding[]) => void;
  onHighlightShowLabelChange: (value: boolean) => void;
}

const PRESETS: Record<AiPresetId, { label: string; desc: string }> = {
  'detect-players': { label: '球员检测', desc: '检测当前范围内的球员和足球候选框。' },
  'track-players': { label: '片段跟踪', desc: '基于整段视频做多目标跟踪，并输出稳定轨迹。' },
  'magnifier-effect': { label: '放大镜', desc: '把跟踪目标或手动锚点做成放大镜特效。' },
  'player-pov': { label: '球员视角', desc: '围绕选中球员或手动方向生成 POV 视角特效。' },
  'player-highlight': { label: '多选高亮', desc: '从稳定轨迹中多选球员，持续描边高亮。' },
  'auto-highlight': { label: '自动高光', desc: '根据比赛节奏自动挑出值得剪辑的片段。' },
};

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
  highlightTargetBindings,
  highlightShowLabel,
  onHighlightTargetsChange,
  onHighlightShowLabelChange,
}) => {
  const showEffectControls = activePreset === 'magnifier-effect' || activePreset === 'player-pov';
  const showPlayerHighlightControls = activePreset === 'player-highlight';

  const toggleHighlightTarget = (target: TargetBinding) => {
    const exists = highlightTargetBindings.some((item) => sameTarget(item, target));
    if (exists) {
      onHighlightTargetsChange(highlightTargetBindings.filter((item) => !sameTarget(item, target)));
      return;
    }
    onHighlightTargetsChange([...highlightTargetBindings, target]);
  };

  return (
    <div className="ai-tools-panel">
      <div className="ai-panel-header">
        <div>
          <h3>AI 工具</h3>
          <p>{videoInfo?.filename || '未加载视频'} | {scopeLabel}</p>
        </div>
        <button className="run-btn" onClick={() => onRunPreset(activePreset)} disabled={!videoPath || Boolean(runningTool)}>
          {runningTool === activePreset ? '处理中...' : `运行 ${PRESETS[activePreset].label}`}
        </button>
      </div>

      <section className="panel-block">
        <div className="block-title">工具选择</div>
        <div className="preset-grid">
          {(Object.keys(PRESETS) as AiPresetId[]).map((preset) => (
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
      </section>

      <section className="panel-block">
        <div className="block-title">运行范围</div>
        <div className="chip-row">
          {(['selection', 'track', 'full'] as AiRunScope[]).map((scope) => (
            <button key={scope} className={`chip ${aiRunScope === scope ? 'active' : ''}`} onClick={() => onScopeChange(scope)}>
              {scope === 'selection' ? '当前选中片段' : scope === 'track' ? '当前轨道片段' : '整段视频'}
            </button>
          ))}
        </div>
        <div className="hint-line">{scopeLabel}</div>
      </section>

      <section className="panel-block">
        <div className="block-title">模型与阈值</div>
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
            <option value="best">最佳质量</option>
            <option value="balanced">平衡</option>
            <option value="fast">快速</option>
            <option value="custom">自定义</option>
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
          最多处理帧数
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
          <div className="block-title">交互模式</div>
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
                {mode === 'cursor-follow' ? '鼠标跟随' : mode === 'auto-target' ? '跟踪目标' : '固定锚点'}
              </button>
            ))}
          </div>

          {activePreset === 'magnifier-effect' ? (
            <>
              <label>
                半径
                <input type="number" min="20" max="520" value={effectControl.params.magnifierRadius} onChange={(event) => onPatchEffectParams({ magnifierRadius: Number(event.target.value) || 120 })} />
              </label>
              <label>
                放大倍数
                <input type="number" min="1" max="8" step="0.1" value={effectControl.params.magnifierZoom} onChange={(event) => onPatchEffectParams({ magnifierZoom: Number(event.target.value) || 2 })} />
              </label>
              <label>
                羽化
                <input type="number" min="0" max="64" step="0.5" value={effectControl.params.magnifierFeather} onChange={(event) => onPatchEffectParams({ magnifierFeather: Number(event.target.value) || 10 })} />
              </label>
            </>
          ) : null}

          {activePreset === 'player-pov' ? (
            <>
              <label>
                视野角度
                <input type="number" min="10" max="170" value={effectControl.params.fovAperture} onChange={(event) => onPatchEffectParams({ fovAperture: Number(event.target.value) || 60 })} />
              </label>
              <label>
                视野长度
                <input type="number" min="40" max="2400" value={effectControl.params.fovLength} onChange={(event) => onPatchEffectParams({ fovLength: Number(event.target.value) || 320 })} />
              </label>
              <label>
                外围压暗
                <input type="number" min="0" max="0.95" step="0.01" value={effectControl.params.fovDim} onChange={(event) => onPatchEffectParams({ fovDim: Number(event.target.value) || 0.5 })} />
              </label>
            </>
          ) : null}

          <div className="hint-line">
            {effectControl.targetBinding?.label ? `当前绑定：${effectControl.targetBinding.label}` : '可以先从下面的目标卡片里选一个球员，再应用到放大镜或 POV。'}
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
          <div className="block-title">持续高亮参数</div>
          <label>
            描边宽度
            <input type="number" min="1" max="12" step="0.5" value={effectControl.params.highlightOutlineWidth} onChange={(event) => onPatchEffectParams({ highlightOutlineWidth: Number(event.target.value) || 3 })} />
          </label>
          <label>
            外发光强度
            <input type="number" min="0" max="8" step="0.1" value={effectControl.params.highlightGlowStrength} onChange={(event) => onPatchEffectParams({ highlightGlowStrength: Number(event.target.value) || 1.8 })} />
          </label>
          <label>
            填充透明度
            <input type="number" min="0" max="0.85" step="0.01" value={effectControl.params.highlightFillOpacity} onChange={(event) => onPatchEffectParams({ highlightFillOpacity: Number(event.target.value) || 0.18 })} />
          </label>
          <label className="checkbox-row compact">
            <input type="checkbox" checked={highlightShowLabel} onChange={(event) => onHighlightShowLabelChange(event.target.checked)} />
            <span>显示球员标签</span>
          </label>
          <div className="hint-line">
            已选择 {highlightTargetBindings.length} 名球员。建议先运行一次“片段跟踪”，再从下方列表多选目标。
          </div>
          <div className="inline-actions">
            <button onClick={() => onHighlightTargetsChange([])} disabled={!highlightTargetBindings.length}>清空多选</button>
          </div>
        </section>
      ) : null}

      {activePreset === 'auto-highlight' ? (
        <section className="panel-block">
          <div className="block-title">自动高光参数</div>
          <label>
            单段时长（秒）
            <input type="number" min="4" max="30" value={highlightDuration} onChange={(event) => onHighlightDurationChange(Number(event.target.value) || 10)} />
          </label>
          <label>
            最多片段数
            <input type="number" min="1" max="20" value={maxHighlights} onChange={(event) => onMaxHighlightsChange(Number(event.target.value) || 6)} />
          </label>
        </section>
      ) : null}

      <section className="panel-block">
        <div className="block-title">目标列表</div>
        {!targets.length ? (
          <div className="hint-line">先运行“片段跟踪”或“球员检测”，这里才会出现可选择的球员目标。</div>
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
                    <span>{target.trackId != null ? `#${target.trackId}` : '未分配 ID'}</span>
                  </div>
                  <div className="target-meta">
                    <span>{target.class === 'player' ? '球员' : '足球'}</span>
                    {typeof target.confidence === 'number' ? <span>{(target.confidence * 100).toFixed(0)}%</span> : null}
                    {target.teamLabel ? <span>{target.teamLabel}</span> : null}
                    {typeof target.appearances === 'number' ? <span>{target.appearances} 帧</span> : null}
                    {typeof target.trackSpan === 'number' ? <span>{target.trackSpan.toFixed(1)}s</span> : null}
                    {typeof target.visibleRatio === 'number' ? <span>可见率 {(target.visibleRatio * 100).toFixed(0)}%</span> : null}
                  </div>
                  <div className="target-actions">
                    <button onClick={() => onPreviewTarget(binding)}>预览</button>
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
          <span>{summary?.success === false ? '失败' : '成功'}</span>
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
            {result ? <details className="result-details"><summary>查看原始返回结果</summary><pre>{JSON.stringify(result, null, 2)}</pre></details> : null}
          </>
        ) : (
          <div className="hint-line">运行一个 AI 工具后，这里会显示摘要、警告和返回结果。</div>
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
                    {alreadyAdded ? '已加入时间线' : '加入时间线'}
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
