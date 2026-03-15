import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import VideoPlayer from './components/VideoPlayer';
import Timeline from './components/Timeline';
import AIToolsPanel from './components/AIToolsPanel';
import ProjectPanel from './components/ProjectPanel';
import ExportPanel from './components/ExportPanel';

const { ipcRenderer } = window.require('electron');

function App() {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [projectName, setProjectName] = useState('Untitled Project');
  const [activeTab, setActiveTab] = useState<'edit' | 'ai' | 'export'>('edit');

  // 鍒濆鍖?
  useEffect(() => {
    // 鐩戝惉鏉ヨ嚜涓昏繘绋嬬殑娑堟伅
    ipcRenderer.on('open-video', (event: any, path: string) => {
      handleOpenVideo(path);
    });

    ipcRenderer.on('detect-players', () => {
      setActiveTab('ai');
      // 瑙﹀彂AI妫€娴?
    });

    return () => {
      ipcRenderer.removeAllListeners('open-video');
      ipcRenderer.removeAllListeners('detect-players');
    };
  }, []);

    const handleOpenVideo = async (path: string) => {
    const fileName = path.split(/[/\\]/).pop() || 'Unknown';
    const name = fileName.split('.')[0] || 'New Project';

    setVideoPath(path);
    setProjectName(name);

    try {
      setIsProcessing(true);
      const info = await ipcRenderer.invoke('get-video-info', path);
      setVideoInfo(info);
    } catch (error) {
      console.error('Error opening video metadata:', error);
      setVideoInfo({
        filename: fileName,
        path,
        duration: 0,
        width: 0,
        height: 0,
        fps: 0,
        format: 'unknown'
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileOpen = () => {
    // 瑙﹀彂涓昏繘绋嬫墦寮€鏂囦欢瀵硅瘽妗?
    ipcRenderer.send('open-file-dialog');
  };

  const handleSaveProject = () => {
    ipcRenderer.send('save-project');
  };

  const handleExport = () => {
    setActiveTab('export');
  };

  return (
    <div className="app">
      {/* 椤堕儴瀵艰埅鏍?*/}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">鈿?Football Video Editor</h1>
          <span className="project-name">{projectName}</span>
        </div>
        
        <div className="header-right">
          <button 
            className="btn btn-primary"
            onClick={handleFileOpen}
            disabled={isProcessing}
          >
            {videoPath ? 'Open Another Video' : 'Open Video'}
          </button>
          
          {videoPath && (
            <>
              <button 
                className="btn btn-secondary"
                onClick={handleSaveProject}
                disabled={isProcessing}
              >
                Save Project
              </button>
              
              <button 
                className="btn btn-success"
                onClick={handleExport}
                disabled={isProcessing}
              >
                Export
              </button>
            </>
          )}
        </div>
      </header>

      {/* 涓诲唴瀹瑰尯 */}
      <div className="app-content">
        {!videoPath ? (
          // 娆㈣繋鐣岄潰
          <div className="welcome-screen">
            <div className="welcome-content">
              <h2>Welcome to Football Video Editor</h2>
              <p>AI-powered video editing for football analysis and highlights</p>
              
              <div className="welcome-features">
                <div className="feature-card">
                  <div className="feature-icon">馃幀</div>
                  <h3>Video Editing</h3>
                  <p>Cut, merge, and edit football videos with precision</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon">馃</div>
                  <h3>AI Analysis</h3>
                  <p>Detect players, track movements, and analyze tactics</p>
                </div>
                
                <div className="feature-card">
                  <div className="feature-icon">鈿?/div>
                  <h3>Smart Highlights</h3>
                  <p>Automatically generate match highlights</p>
                </div>
              </div>
              
              <button 
                className="btn btn-primary btn-large"
                onClick={handleFileOpen}
                disabled={isProcessing}
              >
                {isProcessing ? 'Loading...' : 'Start by Opening a Video'}
              </button>
            </div>
          </div>
        ) : (
          // 缂栬緫鐣岄潰
          <>
            {/* 鏍囩椤?*/}
            <div className="tab-container">
              <button 
                className={`tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
                onClick={() => setActiveTab('edit')}
              >
                馃幀 Edit
              </button>
              <button 
                className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
                onClick={() => setActiveTab('ai')}
              >
                馃 AI Tools
              </button>
              <button 
                className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`}
                onClick={() => setActiveTab('export')}
              >
                馃摛 Export
              </button>
            </div>

            {/* 瑙嗛鎾斁鍣ㄥ尯鍩?*/}
            <div className="video-section">
              <VideoPlayer 
                videoPath={videoPath}
                videoInfo={videoInfo}
                isProcessing={isProcessing}
              />
            </div>

            {/* 鏃堕棿绾?*/}
            <div className="timeline-section">
              <Timeline 
                videoPath={videoPath}
                videoInfo={videoInfo}
              />
            </div>

            {/* 鍙充晶闈㈡澘 */}
            <div className="right-panel">
              {activeTab === 'edit' && (
                <ProjectPanel 
                  videoInfo={videoInfo}
                  projectName={projectName}
                  onProjectNameChange={setProjectName}
                />
              )}
              
              {activeTab === 'ai' && (
                <AIToolsPanel 
                  videoPath={videoPath}
                  videoInfo={videoInfo}
                />
              )}
              
              {activeTab === 'export' && (
                <ExportPanel 
                  videoPath={videoPath}
                  videoInfo={videoInfo}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* 鐘舵€佹爮 */}
      <footer className="app-footer">
        <div className="status-info">
          {videoPath ? (
            <>
              <span className="status-item">
                馃搧 {videoInfo?.filename || 'Unknown'}
              </span>
              <span className="status-item">
                鈴憋笍 {videoInfo?.duration ? Math.round(videoInfo.duration) : 0}s
              </span>
              <span className="status-item">
                馃搹 {videoInfo?.width || 0}x{videoInfo?.height || 0}
              </span>
              <span className="status-item">
                馃帪锔?{videoInfo?.fps ? Math.round(videoInfo.fps) : 0} FPS
              </span>
            </>
          ) : (
            <span>Ready - Open a video to start editing</span>
          )}
        </div>
        
        <div className="status-indicator">
          {isProcessing && (
            <span className="processing-indicator">馃攧 Processing...</span>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;
