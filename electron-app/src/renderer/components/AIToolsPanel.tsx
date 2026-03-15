import React, { useState } from 'react';
import './AIToolsPanel.css';

interface AIToolsPanelProps {
  videoPath: string;
  videoInfo: any;
}

type ToolId = 'detect-players' | 'track-players' | 'magnifier-effect' | 'player-pov' | 'auto-highlight';

interface AiSettings {
  confidenceThreshold: number;
  maxFrames: number;
  highlightDuration: number;
  maxHighlights: number;
  magnifierZoom: number;
  magnifierRadius: number;
  povAngle: number;
  writeVideo: boolean;
  focusMode: 'player' | 'ball';
}

const toolConfig: Array<{ id: ToolId; name: string; description: string; color: string }> = [
  {
    id: 'detect-players',
    name: 'Player Detection',
    description: 'Detect players and generate frame-level stats.',
    color: '#0ea5e9',
  },
  {
    id: 'track-players',
    name: 'Multi-target Tracking',
    description: 'Assign stable IDs and draw movement trajectories.',
    color: '#22c55e',
  },
  {
    id: 'magnifier-effect',
    name: 'Local Magnifier',
    description: 'Attach a zoom lens to player/ball focus region.',
    color: '#f59e0b',
  },
  {
    id: 'player-pov',
    name: 'Player POV',
    description: 'Render direction vector and field-of-view cone.',
    color: '#ef4444',
  },
  {
    id: 'auto-highlight',
    name: 'Auto Highlights',
    description: 'Recommend highlight segments by motion and events.',
    color: '#8b5cf6',
  },
];

const AIToolsPanel: React.FC<AIToolsPanelProps> = ({ videoPath, videoInfo }) => {
  const { ipcRenderer } = window.require('electron');

  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [settings, setSettings] = useState<AiSettings>({
    confidenceThreshold: 0.35,
    maxFrames: 0,
    highlightDuration: 10,
    maxHighlights: 6,
    magnifierZoom: 2,
    magnifierRadius: 120,
    povAngle: 48,
    writeVideo: true,
    focusMode: 'player',
  });

  const runTool = async (tool: ToolId) => {
    if (isProcessing) {
      return;
    }

    setIsProcessing(true);
    setActiveTool(tool);
    setResults(null);

    try {
      const payload: any = {
        operation: tool,
        videoPath,
        confidence: settings.confidenceThreshold,
        maxFrames: settings.maxFrames > 0 ? settings.maxFrames : undefined,
        writeVideo: settings.writeVideo,
        highlightDuration: settings.highlightDuration,
        maxHighlights: settings.maxHighlights,
        magnifierZoom: settings.magnifierZoom,
        magnifierRadius: settings.magnifierRadius,
        povAngle: settings.povAngle,
        focusMode: settings.focusMode,
      };

      const response = await ipcRenderer.invoke('run-ai-operation', payload);
      setResults(response);
    } catch (error: any) {
      setResults({
        success: false,
        error: error?.message || 'AI processing failed',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const renderResultSummary = () => {
    if (!results) {
      return null;
    }

    if (!results.success) {
      return (
        <div className="results-error">
          <h4>Execution Failed</h4>
          <p>{results.error || 'Unknown error'}</p>
        </div>
      );
    }

    const operation = results.operation;

    if (operation === 'detect-players') {
      return (
        <div className="results-grid">
          <div className="result-item"><span>Frames</span><strong>{results.framesProcessed ?? 0}</strong></div>
          <div className="result-item"><span>Players</span><strong>{results.playersTotal ?? 0}</strong></div>
          <div className="result-item"><span>Avg Conf</span><strong>{Math.round((results.averageConfidence ?? 0) * 100)}%</strong></div>
          <div className="result-item"><span>Video</span><strong>{results.artifacts?.annotatedVideo ? 'Generated' : 'Disabled'}</strong></div>
        </div>
      );
    }

    if (operation === 'track-players') {
      return (
        <div className="results-grid">
          <div className="result-item"><span>Frames</span><strong>{results.framesProcessed ?? 0}</strong></div>
          <div className="result-item"><span>Tracks</span><strong>{results.tracksTotal ?? 0}</strong></div>
          <div className="result-item"><span>Top Track</span><strong>{results.tracks?.[0]?.trackId ?? 'N/A'}</strong></div>
          <div className="result-item"><span>Video</span><strong>{results.artifacts?.trackedVideo ? 'Generated' : 'Disabled'}</strong></div>
        </div>
      );
    }

    if (operation === 'magnifier-effect') {
      return (
        <div className="results-grid">
          <div className="result-item"><span>Frames</span><strong>{results.framesProcessed ?? 0}</strong></div>
          <div className="result-item"><span>Focus Samples</span><strong>{results.focusSamplesTotal ?? 0}</strong></div>
          <div className="result-item"><span>Focus Mode</span><strong>{settings.focusMode}</strong></div>
          <div className="result-item"><span>Video</span><strong>{results.artifacts?.magnifierVideo ? 'Generated' : 'Disabled'}</strong></div>
        </div>
      );
    }

    if (operation === 'player-pov') {
      return (
        <div className="results-grid">
          <div className="result-item"><span>Frames</span><strong>{results.framesProcessed ?? 0}</strong></div>
          <div className="result-item"><span>POV Samples</span><strong>{results.povSamplesTotal ?? 0}</strong></div>
          <div className="result-item"><span>POV Angle</span><strong>{settings.povAngle}deg</strong></div>
          <div className="result-item"><span>Video</span><strong>{results.artifacts?.povVideo ? 'Generated' : 'Disabled'}</strong></div>
        </div>
      );
    }

    if (operation === 'auto-highlight') {
      return (
        <div className="results-grid">
          <div className="result-item"><span>Frames</span><strong>{results.framesProcessed ?? 0}</strong></div>
          <div className="result-item"><span>Highlights</span><strong>{results.segmentsTotal ?? 0}</strong></div>
          <div className="result-item"><span>Duration</span><strong>{settings.highlightDuration}s</strong></div>
          <div className="result-item"><span>JSON</span><strong>{results.artifacts?.highlightsJson ? 'Generated' : 'No'}</strong></div>
        </div>
      );
    }

    return (
      <pre className="raw-json">{JSON.stringify(results, null, 2)}</pre>
    );
  };

  return (
    <div className="ai-tools-panel">
      <div className="ai-header">
        <h3>Football AI Suite</h3>
        <p>Run specialized analysis and effect generation on this match video.</p>
        <div className="video-meta">
          <span>{videoInfo?.filename || 'video'}</span>
          <span>{Math.round(videoInfo?.duration || 0)}s</span>
          <span>{videoInfo?.width || 0}x{videoInfo?.height || 0}</span>
        </div>
      </div>

      <div className="tools-grid">
        {toolConfig.map((tool) => (
          <button
            key={tool.id}
            className={`tool-card ${activeTool === tool.id ? 'active' : ''}`}
            style={{ borderColor: tool.color }}
            onClick={() => runTool(tool.id)}
            disabled={isProcessing}
          >
            <div className="tool-title-row">
              <h4>{tool.name}</h4>
              <span className="tool-dot" style={{ backgroundColor: tool.color }} />
            </div>
            <p>{tool.description}</p>
          </button>
        ))}
      </div>

      <div className="settings-grid">
        <label>
          Confidence: {Math.round(settings.confidenceThreshold * 100)}%
          <input
            type="range"
            min="0.1"
            max="0.9"
            step="0.05"
            value={settings.confidenceThreshold}
            onChange={(e) => setSettings((prev) => ({ ...prev, confidenceThreshold: Number(e.target.value) }))}
          />
        </label>

        <label>
          Max Frames (0 = full)
          <input
            type="number"
            min="0"
            value={settings.maxFrames}
            onChange={(e) => setSettings((prev) => ({ ...prev, maxFrames: Number(e.target.value) || 0 }))}
          />
        </label>

        <label>
          Highlight Duration
          <input
            type="number"
            min="4"
            max="30"
            value={settings.highlightDuration}
            onChange={(e) => setSettings((prev) => ({ ...prev, highlightDuration: Number(e.target.value) || 10 }))}
          />
        </label>

        <label>
          Max Highlights
          <input
            type="number"
            min="1"
            max="20"
            value={settings.maxHighlights}
            onChange={(e) => setSettings((prev) => ({ ...prev, maxHighlights: Number(e.target.value) || 6 }))}
          />
        </label>

        <label>
          Magnifier Zoom
          <input
            type="number"
            min="1.2"
            max="5"
            step="0.1"
            value={settings.magnifierZoom}
            onChange={(e) => setSettings((prev) => ({ ...prev, magnifierZoom: Number(e.target.value) || 2 }))}
          />
        </label>

        <label>
          Magnifier Radius
          <input
            type="number"
            min="40"
            max="260"
            value={settings.magnifierRadius}
            onChange={(e) => setSettings((prev) => ({ ...prev, magnifierRadius: Number(e.target.value) || 120 }))}
          />
        </label>

        <label>
          POV Angle
          <input
            type="number"
            min="20"
            max="120"
            value={settings.povAngle}
            onChange={(e) => setSettings((prev) => ({ ...prev, povAngle: Number(e.target.value) || 48 }))}
          />
        </label>

        <label>
          Focus Mode
          <select
            value={settings.focusMode}
            onChange={(e) => setSettings((prev) => ({ ...prev, focusMode: e.target.value as 'player' | 'ball' }))}
          >
            <option value="player">Player</option>
            <option value="ball">Ball</option>
          </select>
        </label>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.writeVideo}
            onChange={(e) => setSettings((prev) => ({ ...prev, writeVideo: e.target.checked }))}
          />
          Render output video artifacts
        </label>
      </div>

      {isProcessing && (
        <div className="processing-banner">AI processing in progress...</div>
      )}

      {results && (
        <div className="results-panel">
          <div className="results-head">
            <h4>Results</h4>
            <button onClick={() => setResults(null)}>Clear</button>
          </div>
          {renderResultSummary()}
          <pre className="raw-json">{JSON.stringify(results, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default AIToolsPanel;
