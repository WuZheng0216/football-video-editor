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
  previewTargetBinding: TargetBinding | null;
  onPresetChange: (tool: AiPresetId) => void;
  onRunPreset: (tool: AiPresetId) => void;
  onScopeChange: (scope: AiRunScope) => void;
  onSetEffectTool: (tool: EffectTool) => void;
  onSetControlMode: (mode: EffectControlState['controlMode']) => void;
  onSetInteractionMode: (mode: EffectControlState['interactionMode']) => void;
  onPatchEffectParams: (patch: Partial<EffectControlState['params']>) => void;
  onSetManualAnchor: (anchor: EffectControlState['manual']['anchor']) => void;
  onSetManualDirectionDeg: (deg: number | null) => void;
  onTargetBindingChange: (target: TargetBinding | null) => void;
  onPreviewTarget: (target: TargetBinding | null) => void;
  onApplyTarget: (tool: EffectTool, target: TargetBinding | null) => void;
  onAiRuntimeConfigChange: (next: AiRuntimeConfig) => void;
  onHighlightDurationChange: (value: number) => void;
  onMaxHighlightsChange: (value: number) => void;
  onAddHighlightClip: (clip: HighlightClip) => void;
  onAddAllHighlightClips: () => void;
}

const PRESETS: Record<AiPresetId, { label: string; desc: string }> = {
  'detect-players': { label: '球员检测', desc: '先发现候选目标，再决定绑定对象。' },
  'track-players': { label: '多目标跟踪', desc: '生成球员轨迹与稳定编号。' },
  'magnifier-effect': { label: '放大镜', desc: '支持鼠标跟随、固定点和目标自动跟随。' },
  'player-pov': { label: '球员视角', desc: '绑定目标后自动估计方向，也可手动覆盖。' },
  'auto-highlight': { label: '自动高光', desc: '提取精彩片段卡并加入时间线。' },
};

function toPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function targetBindingOf(target: AiTarget): TargetBinding {
  return {
    trackId: target.trackId ?? null,
    class: target.class,
    label: target.label,
    confidence: target.confidence,
    sampleTime: target.sampleTime ?? target.firstTimestamp,
    bbox: target.latestBBox || null,
  };
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
}) => (
  <div className="ai-tools-panel">
    <div className="ai-panel-header">
      <div>
        <h3>AI 工具</h3>
        <p>{videoInfo?.filename || '未导入视频'} · 当前范围：{scopeLabel}</p>
      </div>
      <button className="run-btn" onClick={() => onRunPreset(activePreset)} disabled={!videoPath || Boolean(runningTool)}>
        {runningTool === activePreset ? '执行中...' : `运行 ${PRESETS[activePreset].label}`}
      </button>
    </div>

    <section className="panel-block">
      <div className="block-title">快速操作</div>
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
      <div className="block-title">作用范围</div>
      <div className="chip-row">
        {(['selection', 'track', 'full'] as AiRunScope[]).map((scope) => (
          <button key={scope} className={`chip ${aiRunScope === scope ? 'active' : ''}`} onClick={() => onScopeChange(scope)}>
            {scope === 'selection' ? '选中片段' : scope === 'track' ? '当前轨道' : '全片'}
          </button>
        ))}
      </div>
      <div className="hint-line">当前设置：{scopeLabel}</div>
    </section>

    <section className="panel-block">
      <div className="block-title">快速设置</div>
      <label>
        置信度阈值：{toPercent(aiRuntimeConfig.confidenceThreshold)}%
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
        模型档位
        <select value={aiRuntimeConfig.modelPreference} onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, modelPreference: event.target.value as AiRuntimeConfig['modelPreference'] })}>
          <option value="best">最佳效果</option>
          <option value="balanced">均衡</option>
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
            placeholder="例如：C:\\models\\best.pt"
          />
        </label>
      ) : null}
      <label>
        最多处理帧数（0 为不限）
        <input type="number" min="0" value={aiRuntimeConfig.maxFrames} onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, maxFrames: Number(event.target.value) || 0 })} />
      </label>
      <label className="checkbox-row compact">
        <input type="checkbox" checked={aiRuntimeConfig.writeVideo} onChange={(event) => onAiRuntimeConfigChange({ ...aiRuntimeConfig, writeVideo: event.target.checked })} />
        输出带效果的视频文件
      </label>
    </section>

    <section className="panel-block">
      <div className="block-title">参数调节</div>
      {(activePreset === 'magnifier-effect' || activePreset === 'player-pov') ? (
        <>
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
                {mode === 'cursor-follow' ? '鼠标跟随' : mode === 'auto-target' ? '目标自动跟随' : '固定点'}
              </button>
            ))}
          </div>
          <div className="hint-line">放大镜可在监看区滚轮调半径，Shift + 滚轮调倍率；POV 支持拖动方向、滚轮调长度。</div>
        </>
      ) : null}

      {activePreset === 'magnifier-effect' ? (
        <>
          <label>
            放大镜半径
            <input type="number" min="20" max="520" value={effectControl.params.magnifierRadius} onChange={(event) => onPatchEffectParams({ magnifierRadius: Number(event.target.value) || 120 })} />
          </label>
          <label>
            放大倍率
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
            视野开角
            <input type="number" min="10" max="170" value={effectControl.params.fovAperture} onChange={(event) => onPatchEffectParams({ fovAperture: Number(event.target.value) || 60 })} />
          </label>
          <label>
            视野长度
            <input type="number" min="40" max="2400" value={effectControl.params.fovLength} onChange={(event) => onPatchEffectParams({ fovLength: Number(event.target.value) || 320 })} />
          </label>
          <label>
            外部暗化
            <input type="number" min="0" max="0.95" step="0.01" value={effectControl.params.fovDim} onChange={(event) => onPatchEffectParams({ fovDim: Number(event.target.value) || 0.5 })} />
          </label>
        </>
      ) : null}

      {activePreset === 'auto-highlight' ? (
        <>
          <label>
            单段高光时长（秒）
            <input type="number" min="4" max="30" value={highlightDuration} onChange={(event) => onHighlightDurationChange(Number(event.target.value) || 10)} />
          </label>
          <label>
            最多高光数量
            <input type="number" min="1" max="20" value={maxHighlights} onChange={(event) => onMaxHighlightsChange(Number(event.target.value) || 6)} />
          </label>
        </>
      ) : null}

      {effectControl.targetBinding?.label ? (
        <div className="hint-line">当前绑定对象：{effectControl.targetBinding.label}</div>
      ) : (
        <div className="hint-line">未绑定对象时，AI 将按默认规则处理。</div>
      )}
      {effectControl.targetBinding ? (
        <div className="inline-actions">
          <button onClick={() => onTargetBindingChange(null)}>清除绑定</button>
        </div>
      ) : null}
    </section>

    <section className="panel-block">
      <div className="block-title">目标选择</div>
      {!targets.length ? (
        <div className="hint-line">先运行球员检测或多目标跟踪，这里会出现可选目标列表。</div>
      ) : (
        <div className="target-list">
          {targets.map((target) => {
            const binding = targetBindingOf(target);
            const previewing = previewTargetBinding?.trackId != null && binding.trackId != null
              ? previewTargetBinding.trackId === binding.trackId
              : previewTargetBinding?.label === binding.label;
            return (
              <div key={target.id} className={`target-card ${previewing ? 'previewing' : ''}`}>
                <div className="target-card-head">
                  <strong>{target.label}</strong>
                  <span>{target.trackId != null ? `#${target.trackId}` : '候选对象'}</span>
                </div>
                <div className="target-meta">
                  <span>{target.class === 'ball' ? '足球' : '球员'}</span>
                  {typeof target.confidence === 'number' ? <span>置信度 {(target.confidence * 100).toFixed(0)}%</span> : null}
                  {typeof target.appearances === 'number' ? <span>出现 {target.appearances} 次</span> : null}
                </div>
                <div className="target-actions">
                  <button onClick={() => onPreviewTarget(binding)}>预览</button>
                  <button onClick={() => onApplyTarget('magnifier-effect', binding)}>设为放大镜目标</button>
                  <button onClick={() => onApplyTarget('player-pov', binding)}>设为 POV 目标</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {previewTargetBinding ? (
        <div className="inline-actions">
          <button onClick={() => onTargetBindingChange(previewTargetBinding)}>使用当前预览目标</button>
          <button onClick={() => onPreviewTarget(null)}>清除预览聚焦</button>
        </div>
      ) : null}
    </section>

    <section className={`summary-card ${summary?.success === false ? 'error' : 'success'}`}>
      <div className="summary-head">
        <strong>{summary?.title || '结果摘要'}</strong>
        <span>{summary?.success === false ? '失败' : '就绪'}</span>
      </div>
      {summary ? (
        <>
          <div className="summary-grid">
            <div><span>处理帧数</span><strong>{summary.framesProcessed}</strong></div>
            <div><span>生成结果</span><strong>{summary.generatedItems}</strong></div>
            <div><span>目标数量</span><strong>{summary.targetsDetected || targets.length}</strong></div>
            <div><span>高光数量</span><strong>{summary.highlightsGenerated || highlightClips.length}</strong></div>
          </div>
          {summary.message ? <div className="hint-line">{summary.message}</div> : null}
          {summary.warnings.length ? <div className="warning-box">{summary.warnings.map((warning, index) => <div key={`${warning}_${index}`}>{warning}</div>)}</div> : null}
          {result ? <details className="result-details"><summary>查看详细数据</summary><pre>{JSON.stringify(result, null, 2)}</pre></details> : null}
        </>
      ) : (
        <div className="hint-line">运行任一 AI 工具后，这里会显示摘要、警告和详细结果。</div>
      )}
    </section>

    {highlightClips.length ? (
      <section className="panel-block">
        <div className="block-title">高光片段</div>
        <div className="inline-actions">
          <button onClick={onAddAllHighlightClips}>全部加入时间线</button>
        </div>
        <div className="highlight-list">
          {highlightClips.map((clip) => (
            <div key={clip.id} className="highlight-card">
              <div>
                <strong>{clip.title}</strong>
                <span>{clip.start.toFixed(2)}s - {clip.end.toFixed(2)}s</span>
              </div>
              <button onClick={() => onAddHighlightClip(clip)}>加入时间线</button>
            </div>
          ))}
        </div>
      </section>
    ) : null}
  </div>
);

export default AIToolsPanel;
