import React, { useMemo } from 'react';
import './MediaLibraryPanel.css';
import { MediaLibraryItem } from '../types';

interface MediaLibraryPanelProps {
  items: MediaLibraryItem[];
  currentVideoPath: string;
  onImportRequested: () => void;
  onOpenItem: (item: MediaLibraryItem) => void;
  onRevealItem: (item: MediaLibraryItem) => void;
  onAddToContext: (item: MediaLibraryItem) => void;
}

function kindLabel(kind: MediaLibraryItem['kind']): string {
  if (kind === 'source-video') return '源视频';
  if (kind === 'ai-artifact') return 'AI 产物';
  if (kind === 'export') return '导出结果';
  return '参考素材';
}

const MediaLibraryPanel: React.FC<MediaLibraryPanelProps> = ({
  items,
  currentVideoPath,
  onImportRequested,
  onOpenItem,
  onRevealItem,
  onAddToContext,
}) => {
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [items],
  );

  return (
    <div className="media-library-panel">
      <div className="media-library-header">
        <div>
          <h3>素材库</h3>
          <p>这里会收集源视频、AI 产物、导出结果和手动导入的参考素材。</p>
        </div>
        <button className="library-btn primary" onClick={onImportRequested}>导入参考素材</button>
      </div>

      {sortedItems.length ? (
        <div className="media-library-list">
          {sortedItems.map((item) => {
            const isCurrentSource = item.kind === 'source-video' && item.path === currentVideoPath;
            return (
              <article key={item.id} className="media-card">
                <div className="media-card-head">
                  <div className="media-badges">
                    <span className={`media-kind ${item.kind}`}>{kindLabel(item.kind)}</span>
                    {item.operation ? <span className="media-op">{item.operation}</span> : null}
                    {item.artifactKey ? <span className="media-op">{item.artifactKey}</span> : null}
                  </div>
                  <span className="media-date">{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <div className="media-card-body">
                  <strong>{item.label}</strong>
                  <span className="media-path">{item.path}</span>
                </div>
                <div className="media-card-meta">
                  <span>{item.duration ? `${item.duration.toFixed(2)}s` : '-'}</span>
                  <span>{item.width && item.height ? `${item.width}x${item.height}` : '-'}</span>
                  <span>{item.fps ? `${item.fps.toFixed(2)} FPS` : '-'}</span>
                </div>
                <div className="media-card-actions">
                  <button className="library-btn" onClick={() => onOpenItem(item)}>打开</button>
                  <button className="library-btn" onClick={() => onRevealItem(item)}>定位</button>
                  <button className="library-btn" onClick={() => onAddToContext(item)} disabled={isCurrentSource}>
                    {isCurrentSource ? '已在项目中' : '加入素材轨'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="media-library-empty">
          <h4>还没有收集到素材</h4>
          <p>AI 输出和导出结果会自动登记在这里，你也可以手动导入参考文件。</p>
        </div>
      )}
    </div>
  );
};

export default MediaLibraryPanel;
