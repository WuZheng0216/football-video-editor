import React, { useState } from 'react';
import './ExportPanel.css';

interface ExportPanelProps {
  videoPath: string;
  videoInfo: any;
}

const ExportPanel: React.FC<ExportPanelProps> = ({ videoPath, videoInfo }) => {
  const [exportSettings, setExportSettings] = useState({
    format: 'mp4',
    quality: 'high',
    resolution: '1080p',
    fps: 30,
    includeAudio: true,
    includeSubtitles: false,
    watermark: false,
    fileName: 'football_highlight',
    outputPath: '',
    clips: [] as Array<{start: number, end: number}>,
    preset: 'youtube'
  });

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportResult, setExportResult] = useState<any>(null);

  const { ipcRenderer } = window.require('electron');

  // 导出预设
  const exportPresets = {
    youtube: {
      format: 'mp4',
      resolution: '1080p',
      fps: 30,
      bitrate: '8M',
      codec: 'h264',
      audio: 'aac',
      description: 'YouTube optimized settings'
    },
    instagram: {
      format: 'mp4',
      resolution: '1080x1350',
      fps: 30,
      bitrate: '4M',
      codec: 'h264',
      audio: 'aac',
      description: 'Instagram Reels/Stories format'
    },
    twitter: {
      format: 'mp4',
      resolution: '1280x720',
      fps: 30,
      bitrate: '5M',
      codec: 'h264',
      audio: 'aac',
      description: 'Twitter/X optimized'
    },
    broadcast: {
      format: 'mov',
      resolution: '4K',
      fps: 60,
      bitrate: '50M',
      codec: 'prores',
      audio: 'pcm',
      description: 'Professional broadcast quality'
    },
    mobile: {
      format: 'mp4',
      resolution: '720p',
      fps: 30,
      bitrate: '2M',
      codec: 'h264',
      audio: 'aac',
      description: 'Mobile optimized'
    }
  };

  // 分辨率选项
  const resolutionOptions = [
    { value: '360p', label: '360p (640x360)', aspect: '16:9' },
    { value: '480p', label: '480p (854x480)', aspect: '16:9' },
    { value: '720p', label: '720p HD (1280x720)', aspect: '16:9' },
    { value: '1080p', label: '1080p Full HD (1920x1080)', aspect: '16:9' },
    { value: '1440p', label: '1440p 2K (2560x1440)', aspect: '16:9' },
    { value: '4K', label: '4K Ultra HD (3840x2160)', aspect: '16:9' },
    { value: 'instagram', label: 'Instagram (1080x1350)', aspect: '4:5' },
    { value: 'square', label: 'Square (1080x1080)', aspect: '1:1' },
    { value: 'portrait', label: 'Portrait (1080x1920)', aspect: '9:16' }
  ];

  // 格式选项
  const formatOptions = [
    { value: 'mp4', label: 'MP4 (H.264)', description: 'Most compatible, good quality' },
    { value: 'mov', label: 'MOV (ProRes)', description: 'Professional editing, large file' },
    { value: 'avi', label: 'AVI', description: 'Legacy format, uncompressed' },
    { value: 'mkv', label: 'MKV', description: 'Open format, supports multiple audio tracks' },
    { value: 'webm', label: 'WebM', description: 'Web optimized, small file size' },
    { value: 'gif', label: 'GIF', description: 'Animated image, no audio' }
  ];

  // 质量预设
  const qualityOptions = [
    { value: 'low', label: 'Low', bitrate: '1M', description: 'Small file, fast upload' },
    { value: 'medium', label: 'Medium', bitrate: '4M', description: 'Good balance' },
    { value: 'high', label: 'High', bitrate: '8M', description: 'High quality' },
    { value: 'ultra', label: 'Ultra', bitrate: '20M', description: 'Best quality, large file' },
    { value: 'lossless', label: 'Lossless', bitrate: '50M+', description: 'Professional editing' }
  ];

  const handleSettingChange = (key: string, value: any) => {
    setExportSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handlePresetChange = (presetKey: string) => {
    const preset = exportPresets[presetKey as keyof typeof exportPresets];
    if (preset) {
      setExportSettings(prev => ({
        ...prev,
        format: preset.format,
        resolution: preset.resolution,
        fps: preset.fps,
        preset: presetKey
      }));
    }
  };

  const handleBrowseOutput = async () => {
    try {
      const result = await ipcRenderer.invoke('open-save-dialog', {
        defaultPath: `${exportSettings.fileName}.${exportSettings.format}`,
        filters: [
          { name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (result && !result.canceled) {
        handleSettingChange('outputPath', result.filePath);
      }
    } catch (error) {
      console.error('Error browsing for output:', error);
    }
  };

  const startExport = async () => {
    if (!exportSettings.outputPath) {
      alert('Please select an output path');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportResult(null);

    try {
      // 模拟导出进度
      const interval = setInterval(() => {
        setExportProgress(prev => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 2;
        });
      }, 100);

      // 调用导出函数
      const result = await ipcRenderer.invoke('export-video', {
        inputPath: videoPath,
        outputPath: exportSettings.outputPath,
        settings: exportSettings
      });

      clearInterval(interval);
      setExportProgress(100);
      setExportResult(result);

      // 重置进度
      setTimeout(() => {
        setExportProgress(0);
      }, 2000);

    } catch (error: any) {
      setExportResult({ error: error.message });
    } finally {
      setIsExporting(false);
    }
  };

  const calculateFileSize = () => {
    // 简单的文件大小估算
    const duration = videoInfo?.duration || 60; // 默认60秒
    const bitrateMap: Record<string, number> = {
      'low': 1 * 1024 * 1024, // 1 Mbps
      'medium': 4 * 1024 * 1024, // 4 Mbps
      'high': 8 * 1024 * 1024, // 8 Mbps
      'ultra': 20 * 1024 * 1024, // 20 Mbps
      'lossless': 50 * 1024 * 1024 // 50 Mbps
    };

    const bitrate = bitrateMap[exportSettings.quality] || bitrateMap.medium;
    const sizeMB = (bitrate * duration) / (8 * 1024 * 1024);
    
    return {
      estimated: sizeMB.toFixed(1),
      formatted: sizeMB > 1024 
        ? `${(sizeMB / 1024).toFixed(1)} GB`
        : `${sizeMB.toFixed(1)} MB`
    };
  };

  const fileSize = calculateFileSize();

  return (
    <div className="export-panel">
      <div className="panel-header">
        <h3>📤 Export Video</h3>
        <p className="panel-subtitle">Export your edited football video with custom settings</p>
      </div>

      {/* 导出预设 */}
      <div className="presets-section">
        <h4>🚀 Quick Presets</h4>
        <div className="presets-grid">
          {Object.entries(exportPresets).map(([key, preset]) => (
            <button
              key={key}
              className={`preset-btn ${exportSettings.preset === key ? 'active' : ''}`}
              onClick={() => handlePresetChange(key)}
            >
              <div className="preset-icon">
                {key === 'youtube' && '📺'}
                {key === 'instagram' && '📱'}
                {key === 'twitter' && '🐦'}
                {key === 'broadcast' && '📡'}
                {key === 'mobile' && '📲'}
              </div>
              <div className="preset-info">
                <div className="preset-name">{key.charAt(0).toUpperCase() + key.slice(1)}</div>
                <div className="preset-desc">{preset.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 导出设置 */}
      <div className="settings-section">
        <h4>⚙️ Export Settings</h4>
        
        <div className="settings-grid">
          {/* 格式选择 */}
          <div className="setting-group">
            <label>Format</label>
            <div className="format-options">
              {formatOptions.map(format => (
                <button
                  key={format.value}
                  className={`format-btn ${exportSettings.format === format.value ? 'active' : ''}`}
                  onClick={() => handleSettingChange('format', format.value)}
                  title={format.description}
                >
                  {format.label}
                </button>
              ))}
            </div>
          </div>

          {/* 分辨率选择 */}
          <div className="setting-group">
            <label>Resolution</label>
            <select
              value={exportSettings.resolution}
              onChange={(e) => handleSettingChange('resolution', e.target.value)}
            >
              {resolutionOptions.map(res => (
                <option key={res.value} value={res.value}>
                  {res.label}
                </option>
              ))}
            </select>
          </div>

          {/* 质量选择 */}
          <div className="setting-group">
            <label>Quality</label>
            <div className="quality-slider">
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={['low', 'medium', 'high', 'ultra', 'lossless'].indexOf(exportSettings.quality)}
                onChange={(e) => {
                  const qualities = ['low', 'medium', 'high', 'ultra', 'lossless'];
                  handleSettingChange('quality', qualities[parseInt(e.target.value)]);
                }}
              />
              <div className="quality-labels">
                <span>Low</span>
                <span>Medium</span>
                <span>High</span>
                <span>Ultra</span>
                <span>Lossless</span>
              </div>
            </div>
            <div className="quality-description">
              {qualityOptions.find(q => q.value === exportSettings.quality)?.description}
            </div>
          </div>

          {/* FPS设置 */}
          <div className="setting-group">
            <label>Frame Rate (FPS)</label>
            <div className="fps-options">
              {[24, 25, 30, 50, 60].map(fps => (
                <button
                  key={fps}
                  className={`fps-btn ${exportSettings.fps === fps ? 'active' : ''}`}
                  onClick={() => handleSettingChange('fps', fps)}
                >
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>

          {/* 音频选项 */}
          <div className="setting-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={exportSettings.includeAudio}
                onChange={(e) => handleSettingChange('includeAudio', e.target.checked)}
              />
              Include Audio
            </label>
            <label>
              <input
                type="checkbox"
                checked={exportSettings.includeSubtitles}
                onChange={(e) => handleSettingChange('includeSubtitles', e.target.checked)}
              />
              Add Subtitles
            </label>
            <label>
              <input
                type="checkbox"
                checked={exportSettings.watermark}
                onChange={(e) => handleSettingChange('watermark', e.target.checked)}
              />
              Add Watermark
            </label>
          </div>

          {/* 文件名和路径 */}
          <div className="setting-group">
            <label>File Name</label>
            <input
              type="text"
              value={exportSettings.fileName}
              onChange={(e) => handleSettingChange('fileName', e.target.value)}
              placeholder="Enter file name"
            />
          </div>

          <div className="setting-group">
            <label>Output Path</label>
            <div className="path-input">
              <input
                type="text"
                value={exportSettings.outputPath}
                onChange={(e) => handleSettingChange('outputPath', e.target.value)}
                placeholder="Select output location"
                readOnly
              />
              <button onClick={handleBrowseOutput}>Browse</button>
            </div>
          </div>
        </div>
      </div>

      {/* 文件信息预览 */}
      <div className="preview-section">
        <h4>📊 Export Preview</h4>
        <div className="preview-info">
          <div className="info-row">
            <span className="info-label">Original Video:</span>
            <span className="info-value">{videoInfo?.filename || 'Unknown'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Original Resolution:</span>
            <span className="info-value">
              {videoInfo?.width || 0}x{videoInfo?.height || 0}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Export Resolution:</span>
            <span className="info-value">
              {resolutionOptions.find(r => r.value === exportSettings.resolution)?.label}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Format:</span>
            <span className="info-value">
              {formatOptions.find(f => f.value === exportSettings.format)?.label}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Estimated File Size:</span>
            <span className="info-value">{fileSize.formatted}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Output File:</span>
            <span className="info-value">
              {exportSettings.outputPath || 'Not selected'}
            </span>
          </div>
        </div>
      </div>

      {/* 导出按钮 */}
      <div className="export-controls">
        <button
          className={`export-btn ${isExporting ? 'exporting' : ''}`}
          onClick={startExport}
          disabled={isExporting || !exportSettings.outputPath}
        >
          {isExporting ? (
            <>
              <div className="export-spinner"></div>
              Exporting... {exportProgress}%
            </>
          ) : (
            '🚀 Start Export'
          )}
        </button>

        {isExporting && (
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${exportProgress}%` }}
              ></div>
            </div>
            <div className="progress-text">
              {exportProgress < 100 ? 'Processing...' : 'Export complete!'}
            </div>
          </div>
        )}
      </div>

      {/* 导出结果 */}
      {exportResult && (
        <div className={`export-result ${exportResult.error ? 'error' : 'success'}`}>
          <h4>
            {exportResult.error ? '❌ Export Failed' : '✅ Export Successful'}
          </h4>
          {exportResult.error ? (
            <p className="error-message">{exportResult.error}</p>
          ) : (
            <div className="success-details">
              <p>Video exported successfully!</p>
              <div className="result-info">
                <div className="result-row">
                  <span>Output File:</span>
                  <span>{exportResult.outputPath}</span>
                </div>
                <div className="result-row">
                  <span>File Size:</span>
                  <span>{exportResult.fileSize}</span>
                </div>
                <div className="result-row">
                  <span>Duration:</span>
                  <span>{exportResult.duration}</span>
                </div>
              </div>
              <button 
                className="open-folder-btn"
                onClick={() => {
                  if (exportResult.outputPath) {
                    ipcRenderer.send('open-folder', exportResult.outputPath);
                  }
                }}
              >
                📁 Open Containing Folder
              </button>
            </div>
          )}
        </div>
      )}

      {/* 导出提示 */}
      <div className="export-tips">
        <h4>💡 Export Tips</h4>
        <ul className="tips-list">
          <li>Use MP4 format for maximum compatibility</li>
          <li>Higher resolution = larger file size</li>
          <li>60 FPS is great for slow motion replays</li>
          <li>Check output path has enough free space</li>
          <li>Export may take longer for high quality settings</li>
        </ul>
      </div>
    </div>
  );
};

export default ExportPanel;