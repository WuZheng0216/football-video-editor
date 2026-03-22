const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Store = require('electron-store');
const ffmpeg = require('fluent-ffmpeg');

let ffmpegPath = null;
let ffprobePath = null;
try { ffmpegPath = require('ffmpeg-static'); if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath); } catch (_e) {}
try { const mod = require('ffprobe-static'); ffprobePath = mod.path || mod; } catch (_e) { try { ffprobePath = require('@ffprobe-installer/ffprobe').path; } catch (_e2) {} }
if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);

const store = new Store();
const TRACK_IDS = { video: 'track_video_main', effect: 'track_effect_ai', overlay: 'track_overlay_asset' };
const TRACK_META = {
  video: { id: TRACK_IDS.video, type: 'video', name: '主视频轨', order: 0 },
  effect: { id: TRACK_IDS.effect, type: 'effect', name: 'AI 特效轨', order: 1 },
  overlay: { id: TRACK_IDS.overlay, type: 'overlay', name: '素材 / 高光轨', order: 2 },
};
const MIN_SPAN = 1 / 120;
let mainWindow = null;

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function fps(stream) { const [n, d] = String(stream?.r_frame_rate || '0/1').split('/').map((x) => Number(x || 0)); return d > 0 ? n / d : 0; }
function parseDuration(text) { const m = String(text || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; }
function fmtTime(v) { return Number(Number(v || 0).toFixed(6)); }
function sortByStart(items) { return [...items].sort((a, b) => num(a.start) - num(b.start)); }
function overlaps(aStart, aEnd, bStart, bEnd) { return Math.max(aStart, bStart) < Math.min(aEnd, bEnd) - MIN_SPAN; }
function sortTrackItems(trackType, items) {
  return [...items].sort((a, b) => {
    const laneDiff = (trackType === 'video' ? 0 : num(a.lane, 0)) - (trackType === 'video' ? 0 : num(b.lane, 0));
    if (laneDiff !== 0) return laneDiff;
    if (num(a.start) !== num(b.start)) return num(a.start) - num(b.start);
    if (num(a.end) !== num(b.end)) return num(a.end) - num(b.end);
    return String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hans-CN');
  });
}
function renderEffectComparator(a, b) {
  const laneDiff = num(b.lane, 0) - num(a.lane, 0);
  if (laneDiff !== 0) return laneDiff;
  if (num(a.start) !== num(b.start)) return num(a.start) - num(b.start);
  return String(a.label || '').localeCompare(String(b.label || ''), 'zh-Hans-CN');
}
function findAvailableLane(items, trackType, start, end, ignoreItemId) {
  if (trackType === 'video') return 0;
  let lane = 0;
  while (items.some((item) => item.id !== ignoreItemId && num(item.lane, 0) === lane && overlaps(num(item.start, 0), num(item.end, 0), start, end))) lane += 1;
  return lane;
}
function resolutionValue(v) { const map = { '720p': '1280x720', '1080p': '1920x1080', '1440p': '2560x1440', '4K': '3840x2160' }; return map[v] || null; }
function qualityBitrate(v) { const map = { low: '1500k', medium: '4000k', high: '8000k', ultra: '16000k' }; return map[v] || map.high; }
function deepClone(value) { return JSON.parse(JSON.stringify(value)); }

function parseFfmpegMetadata(stderr, filePath) {
  const lines = String(stderr || '').split(/\r?\n/);
  const videoLine = lines.find((line) => /Stream .* Video:/i.test(line)) || '';
  const audioLine = lines.find((line) => /Stream .* Audio:/i.test(line)) || '';
  const inputLine = lines.find((line) => /Input #0,/i.test(line)) || '';
  const sizeMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/i);
  const formatMatch = inputLine.match(/Input #0,\s*([^,]+),/i);
  const streams = [];
  if (sizeMatch) streams.push({ codec_type: 'video', width: Number(sizeMatch[1]), height: Number(sizeMatch[2]), r_frame_rate: fpsMatch ? `${fpsMatch[1]}/1` : '0/1' });
  if (audioLine) streams.push({ codec_type: 'audio' });
  return { format: { duration: parseDuration(stderr), size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0, format_name: formatMatch ? formatMatch[1] : 'unknown' }, streams };
}

function probeWithFfmpeg(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath || 'ffmpeg', ['-i', filePath], { windowsHide: true, env: process.env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', () => stderr.trim() ? resolve(parseFfmpegMetadata(stderr, filePath)) : reject(new Error('\u65e0\u6cd5\u4ece ffmpeg \u83b7\u53d6\u89c6\u9891\u5143\u6570\u636e\u3002')));
  });
}

function ffprobeAsync(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (!err && metadata) { resolve(metadata); return; }
      probeWithFfmpeg(filePath).then(resolve).catch((fallbackError) => { const wrapped = new Error(`\u65e0\u6cd5\u8c03\u7528 ffprobe\uff0c\u4e14 ffmpeg \u5143\u6570\u636e\u56de\u9000\u4e5f\u5931\u8d25\uff1a${fallbackError.message}`); wrapped.code = 'missing_ffprobe'; reject(wrapped); });
    });
  });
}

function basicVideoInfo(filePath, overrides = {}) {
  const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  return {
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    format: 'unknown',
    size: stats?.size || 0,
    filename: path.basename(filePath || ''),
    path: filePath,
    metadataSource: 'pending',
    ...overrides,
  };
}

function previewFriendlyCodec(codecName) {
  const codec = String(codecName || '').toLowerCase();
  if (!codec) return true;
  return ['h264', 'avc1', 'vp8', 'vp9', 'mpeg4'].includes(codec);
}

function previewCacheDir() {
  const dir = path.join(app.getPath('userData'), 'preview-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function previewProxyPath(filePath) {
  const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const signature = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      path: path.resolve(filePath || ''),
      size: stats?.size || 0,
      mtimeMs: stats?.mtimeMs || 0,
    }))
    .digest('hex')
    .slice(0, 16);
  return path.join(previewCacheDir(), `${signature}.preview.mp4`);
}

function ensurePreviewProxy(filePath) {
  return new Promise((resolve, reject) => {
    const outputPath = previewProxyPath(filePath);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      resolve(outputPath);
      return;
    }

    ffmpeg(filePath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset veryfast',
        '-crf 23',
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-map 0:v:0',
        '-map 0:a:0?',
      ])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

function createMenu() {
  const template = [
    { label: '\u6587\u4ef6', submenu: [{ label: '\u6253\u5f00\u89c6\u9891', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('open-file-dialog') }, { label: '\u5bfc\u51fa', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('export-video') }, { type: 'separator' }, { role: 'quit', label: '\u9000\u51fa' }] },
    { label: '\u7f16\u8f91', submenu: [{ role: 'undo', label: '\u64a4\u9500' }, { role: 'redo', label: '\u91cd\u505a' }, { type: 'separator' }, { role: 'cut', label: '\u526a\u5207' }, { role: 'copy', label: '\u590d\u5236' }, { role: 'paste', label: '\u7c98\u8d34' }] },
    { label: 'AI', submenu: [{ label: '\u7403\u5458\u68c0\u6d4b', click: () => mainWindow?.webContents.send('detect-players') }, { label: '\u591a\u76ee\u6807\u8ddf\u8e2a', click: () => mainWindow?.webContents.send('track-players') }, { label: '\u591a\u4eba\u9ad8\u4eae', click: () => mainWindow?.webContents.send('player-highlight') }, { label: '\u81ea\u52a8\u9ad8\u5149', click: () => mainWindow?.webContents.send('auto-highlight') }] },
    { label: '\u89c6\u56fe', submenu: [{ role: 'reload', label: '\u91cd\u65b0\u52a0\u8f7d' }, { role: 'toggleDevTools', label: '\u5f00\u53d1\u8005\u5de5\u5177' }, { type: 'separator' }, { role: 'resetZoom', label: '\u91cd\u7f6e\u7f29\u653e' }, { role: 'zoomIn', label: '\u653e\u5927' }, { role: 'zoomOut', label: '\u7f29\u5c0f' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1500, height: 940, minWidth: 1200, minHeight: 800, webPreferences: { nodeIntegration: true, contextIsolation: false, enableRemoteModule: true, webSecurity: false }, icon: path.join(__dirname, 'assets', 'icon.png'), frame: true });
  const packedIndex = path.join(__dirname, 'dist', 'index.html');
  const devUrl = process.env.ELECTRON_START_URL;
  if (process.env.NODE_ENV === 'development' || devUrl || !fs.existsSync(packedIndex)) mainWindow.loadURL(devUrl || 'http://localhost:3000');
  else mainWindow.loadFile(packedIndex);
  mainWindow.on('closed', () => { mainWindow = null; });
  createMenu();
}

function resolveAiScriptPath() {
  const dev = path.resolve(__dirname, '..', 'ai-engine', 'football_analysis_cli.py');
  const packed = path.join(process.resourcesPath, 'ai-engine', 'football_analysis_cli.py');
  if (fs.existsSync(dev)) return dev;
  if (fs.existsSync(packed)) return packed;
  return dev;
}

function resolveModelPath(payload = {}) {
  const preference = String(payload.modelPreference || 'best');
  const customModel = payload.modelPath ? String(payload.modelPath).trim() : '';
  if (customModel) {
    const abs = path.isAbsolute(customModel) ? customModel : path.resolve(customModel);
    if (fs.existsSync(abs)) return abs;
    if (preference === 'custom') throw new Error(`\u81ea\u5b9a\u4e49\u6a21\u578b\u4e0d\u5b58\u5728\uff1a${customModel}`);
  }
  const candidateFiles = preference === 'fast'
    ? ['yolov8n.pt', 'best.pt', 'last.pt']
    : preference === 'balanced'
      ? ['yolov8m.pt', 'yolov8s.pt', 'yolov8n.pt', 'best.pt', 'last.pt']
      : ['best.pt', 'last.pt', 'yolo11x.pt', 'yolov8x.pt', 'yolov8l.pt', 'yolov8m.pt', 'yolov8s.pt', 'yolov8n.pt'];
  const repoRoot = path.resolve(__dirname, '..', '..');
  const dirs = [...new Set([
    path.dirname(resolveAiScriptPath()),
    path.resolve(__dirname, '..', 'ai-engine'),
    path.resolve(__dirname, '..'),
    process.cwd(),
    path.join(repoRoot, 'TacTech-master', 'weights'),
  ].filter((dir) => dir && fs.existsSync(dir)))];
  for (const dir of dirs) for (const file of candidateFiles) { const full = path.join(dir, file); if (fs.existsSync(full)) return full; }
  return customModel || null;
}

function runPythonJson(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const py = spawn(process.platform === 'win32' ? 'python' : 'python3', [scriptPath, ...args], { windowsHide: true, cwd: path.dirname(scriptPath), env: process.env });
    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => { stdout += d.toString(); });
    py.stderr.on('data', (d) => { stderr += d.toString(); });
    py.on('error', reject);
    py.on('close', (code) => {
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const jsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'));
      if (!jsonLine) { reject(new Error(`AI \u64cd\u4f5c\u672a\u8fd4\u56de\u53ef\u89e3\u6790 JSON\uff0ccode=${code}; stderr=${stderr.slice(0, 400)}`)); return; }
      try { const parsed = JSON.parse(jsonLine); if (code !== 0 && parsed.success !== true) { reject(new Error(parsed.error || stderr || 'AI operation failed')); return; } resolve(parsed); } catch (error) { reject(new Error(`AI JSON \u89e3\u6790\u5931\u8d25\uff1a${error.message}`)); }
    });
  });
}

function writeJsonSidecar(outputDir, prefix, payload) {
  const safePrefix = String(prefix || 'payload').replace(/[^a-z0-9_-]+/gi, '_');
  const filePath = path.join(outputDir, `${safePrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

function buildAiArgs(payload, outputDir) {
  if (!payload || !payload.operation || !payload.videoPath) throw new Error('运行 AI 时缺少 operation 或 videoPath。');
  const args = ['--operation', String(payload.operation), '--video-path', String(payload.videoPath), '--output-dir', outputDir, '--confidence', String(payload.confidence ?? 0.35), '--max-output-items', String(payload.maxOutputItems ?? 120)];
  if (payload.maxFrames && payload.maxFrames > 0) args.push('--max-frames', String(payload.maxFrames));
  if (payload.writeVideo) args.push('--write-video');
  if (payload.focusMode) args.push('--focus-mode', String(payload.focusMode));
  if (payload.scope) args.push('--scope', String(payload.scope));
  if (typeof payload.focusPlayerId === 'number') args.push('--focus-player-id', String(payload.focusPlayerId));
  if (payload.controlMode) args.push('--control-mode', String(payload.controlMode));
  if (payload.interactionMode) args.push('--interaction-mode', String(payload.interactionMode));
  if (payload.rangeStart !== undefined && payload.rangeStart !== null) args.push('--start-time', String(payload.rangeStart));
  if (payload.rangeEnd !== undefined && payload.rangeEnd !== null) args.push('--end-time', String(payload.rangeEnd));
  if (payload.manualAnchor && typeof payload.manualAnchor.x === 'number' && typeof payload.manualAnchor.y === 'number') args.push('--manual-anchor', `${payload.manualAnchor.x},${payload.manualAnchor.y}`);
  if (typeof payload.manualDirectionDeg === 'number' && Number.isFinite(payload.manualDirectionDeg)) args.push('--manual-direction', String(payload.manualDirectionDeg));
  if (payload.magnifierRadius !== undefined && payload.magnifierRadius !== null) args.push('--magnifier-radius', String(payload.magnifierRadius));
  if (payload.magnifierZoom !== undefined && payload.magnifierZoom !== null) args.push('--magnifier-zoom', String(payload.magnifierZoom));
  if (payload.magnifierFeather !== undefined && payload.magnifierFeather !== null) args.push('--magnifier-feather', String(payload.magnifierFeather));
  if (payload.povAngle !== undefined && payload.povAngle !== null) args.push('--pov-angle', String(payload.povAngle));
  if (payload.fovAperture !== undefined && payload.fovAperture !== null) args.push('--fov-aperture', String(payload.fovAperture));
  if (payload.fovLength !== undefined && payload.fovLength !== null) args.push('--fov-length', String(payload.fovLength));
  if (payload.fovDim !== undefined && payload.fovDim !== null) args.push('--fov-dim', String(payload.fovDim));
  if (payload.highlightOutlineWidth !== undefined && payload.highlightOutlineWidth !== null) args.push('--highlight-outline-width', String(payload.highlightOutlineWidth));
  if (payload.highlightGlowStrength !== undefined && payload.highlightGlowStrength !== null) args.push('--highlight-glow-strength', String(payload.highlightGlowStrength));
  if (payload.highlightFillOpacity !== undefined && payload.highlightFillOpacity !== null) args.push('--highlight-fill-opacity', String(payload.highlightFillOpacity));
  if (payload.highlightShowLabel !== undefined && payload.highlightShowLabel !== null) args.push('--highlight-show-label', String(payload.highlightShowLabel));
  if (payload.highlightDuration) args.push('--highlight-duration', String(payload.highlightDuration));
  if (payload.maxHighlights) args.push('--max-highlights', String(payload.maxHighlights));
  if (payload.modelPath) args.push('--model-path', String(payload.modelPath));
  if (payload.targetBindingsPath) args.push('--target-bindings-path', String(payload.targetBindingsPath));
  else if (payload.targetBindingsJson) args.push('--target-bindings-json', String(payload.targetBindingsJson));
  else if (Array.isArray(payload.targetBindings) && payload.targetBindings.length > 0) args.push('--target-bindings-path', writeJsonSidecar(outputDir, 'target_bindings', payload.targetBindings));
  if (payload.trackSamplesPath) args.push('--track-samples-path', String(payload.trackSamplesPath));
  else if (payload.trackSamplesJson) args.push('--track-samples-json', String(payload.trackSamplesJson));
  else if (Array.isArray(payload.trackSamples) && payload.trackSamples.length > 0) args.push('--track-samples-path', writeJsonSidecar(outputDir, 'track_samples', payload.trackSamples));
  if (payload.keyframesJson) args.push('--keyframes-json', String(payload.keyframesJson));
  else if (Array.isArray(payload.keyframes) && payload.keyframes.length > 0) args.push('--keyframes-json', JSON.stringify(payload.keyframes));
  return args;
}

function sanitizeTimelineSnapshot(rawSnapshot, inputPath, sourceDuration, fpsHint) {
  const warnings = [];
  const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? JSON.parse(JSON.stringify(rawSnapshot)) : { version: 4, sourceVideoPath: inputPath, duration: sourceDuration, fps: fpsHint, tracks: [] };
  snapshot.version = Number(snapshot.version || 4);
  snapshot.sourceVideoPath = snapshot.sourceVideoPath || inputPath;
  snapshot.duration = Math.max(sourceDuration, num(snapshot.duration, 0));
  snapshot.fps = Math.max(1, num(snapshot.fps, fpsHint));
  snapshot.tracks = Array.isArray(snapshot.tracks) ? snapshot.tracks : [];
  let videoTrack = snapshot.tracks.find((track) => track.type === 'video');
  if (!videoTrack) { videoTrack = { id: TRACK_IDS.video, type: 'video', name: '\u4e3b\u89c6\u9891\u8f68', order: 0, enabled: true, items: [] }; snapshot.tracks.unshift(videoTrack); warnings.push('\u68c0\u6d4b\u5230\u7f3a\u5c11\u4e3b\u89c6\u9891\u8f68\uff0c\u5df2\u81ea\u52a8\u8865\u9f50\u3002'); }
  const originalIndex = videoTrack.items.findIndex((item) => item.kind === 'clip' && item.sourceType === 'original');
  if (sourceDuration > 0) {
    const originalClip = { id: 'clip_full', kind: 'clip', trackId: TRACK_IDS.video, label: '\u539f\u59cb\u7d20\u6750', start: 0, end: sourceDuration, enabled: true, sourcePath: inputPath, sourceStart: 0, sourceEnd: sourceDuration, sourceType: 'original' };
    if (originalIndex === -1) { videoTrack.items.unshift(originalClip); warnings.push('\u4e3b\u89c6\u9891\u8f68\u7f3a\u5c11\u5b8c\u6574\u539f\u59cb\u7d20\u6750\uff0c\u5df2\u81ea\u52a8\u8865\u9f50\u3002'); }
    else Object.assign(videoTrack.items[originalIndex], originalClip);
  }
  if (!snapshot.tracks.some((track) => track.id === TRACK_IDS.effect)) snapshot.tracks.push({ id: TRACK_IDS.effect, type: 'effect', name: 'AI \u6548\u679c\u8f68', order: 1, enabled: true, items: [] });
  if (!snapshot.tracks.some((track) => track.id === TRACK_IDS.overlay)) snapshot.tracks.push({ id: TRACK_IDS.overlay, type: 'overlay', name: '\u7d20\u6750 / \u8986\u76d6\u8f68', order: 2, enabled: true, items: [] });
  snapshot.tracks = snapshot.tracks.map((track, idx) => ({ ...track, id: track.id || `${track.type || 'track'}_${idx}`, order: Number.isFinite(track.order) ? track.order : idx, enabled: track.enabled !== false, items: Array.isArray(track.items) ? track.items.filter((item) => num(item.end, 0) - num(item.start, 0) >= 1 / 120) : [] })).sort((a, b) => a.order - b.order);
  return { snapshot, warnings };
}

function pickEffect(effects, time) { const candidates = effects.filter((item) => item.enabled && time >= item.start && time < item.end); return candidates.length ? candidates.sort((a, b) => b.start - a.start)[0] : null; }

function buildSegmentsFromSnapshot(snapshot, sourceDuration, warnings) {
  const videoTrack = snapshot.tracks.filter((track) => track.type === 'video' && track.enabled !== false).sort((a, b) => a.order - b.order)[0];
  if (!videoTrack) { warnings.push('\u672a\u627e\u5230\u4e3b\u89c6\u9891\u8f68\uff0c\u5df2\u56de\u9000\u4e3a\u6574\u7247\u5bfc\u51fa\u3002'); return [{ timelineStart: 0, timelineEnd: sourceDuration, sourceStart: 0, sourceEnd: sourceDuration, effectItem: null }]; }
  const clips = sortByStart(videoTrack.items.filter((item) => item.kind === 'clip' && item.enabled));
  if (!clips.length) { warnings.push('\u4e3b\u89c6\u9891\u8f68\u6ca1\u6709\u53ef\u7528\u7247\u6bb5\uff0c\u5df2\u56de\u9000\u4e3a\u6574\u7247\u5bfc\u51fa\u3002'); return [{ timelineStart: 0, timelineEnd: sourceDuration, sourceStart: 0, sourceEnd: sourceDuration, effectItem: null }]; }
  const effectTrack = snapshot.tracks.filter((track) => track.type === 'effect' && track.enabled !== false).sort((a, b) => a.order - b.order)[0];
  const effects = effectTrack ? sortByStart(effectTrack.items.filter((item) => item.kind === 'effect' && item.enabled)) : [];
  const segments = [];
  clips.forEach((clip) => {
    const clipStart = Math.max(0, num(clip.start, 0));
    const clipEnd = Math.max(clipStart, num(clip.end, clipStart));
    if (clipEnd - clipStart < 1 / 120) return;
    const boundaries = [clipStart, clipEnd];
    effects.forEach((effect) => { const s = Math.max(clipStart, effect.start); const e = Math.min(clipEnd, effect.end); if (e - s > 1 / 120) boundaries.push(s, e); });
    const unique = [...new Set(boundaries.map((v) => Number(v.toFixed(6))))].sort((a, b) => a - b);
    for (let i = 0; i < unique.length - 1; i += 1) {
      const a = unique[i]; const b = unique[i + 1]; if (b - a < 1 / 120) continue;
      const sourceOffset = a - clipStart;
      const sourceStart = Math.max(0, Math.min(sourceDuration, num(clip.sourceStart, 0) + sourceOffset));
      const sourceEnd = Math.max(sourceStart, Math.min(sourceDuration, sourceStart + (b - a)));
      segments.push({ timelineStart: a, timelineEnd: b, sourceStart, sourceEnd, effectItem: pickEffect(effects, (a + b) / 2) });
    }
  });
  if (!segments.length) { warnings.push('\u65f6\u95f4\u7ebf\u672a\u751f\u6210\u6709\u6548\u5206\u6bb5\uff0c\u5df2\u56de\u9000\u4e3a\u6574\u7247\u5bfc\u51fa\u3002'); return [{ timelineStart: 0, timelineEnd: sourceDuration, sourceStart: 0, sourceEnd: sourceDuration, effectItem: null }]; }
  return segments.sort((a, b) => a.timelineStart - b.timelineStart);
}

function buildClipModeSnapshot(snapshot, inputPath, warnings) {
  const cloned = deepClone(snapshot);
  const overlayTrack = cloned.tracks.find((track) => track.type === 'overlay');
  const effectTrack = cloned.tracks.find((track) => track.type === 'effect');
  const selectedClips = overlayTrack ? sortByStart(overlayTrack.items.filter((item) => item.kind === 'clip' && item.enabled)) : [];
  if (!selectedClips.length) { warnings.push('\u7d20\u6750\u8f68\u4e2d\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684 clip \u5019\u9009\uff0c\u5df2\u56de\u9000\u5230 timeline \u5bfc\u51fa\u3002'); return cloned; }
  const originalEffects = effectTrack ? sortByStart(effectTrack.items.filter((item) => item.kind === 'effect' && item.enabled)) : [];
  let cursor = 0;
  const nextVideoItems = [];
  const nextEffectItems = [];
  selectedClips.forEach((clip, clipIndex) => {
    const sourceStart = num(clip.sourceStart, num(clip.start, 0));
    const sourceEnd = Math.max(sourceStart + 1 / 120, num(clip.sourceEnd, num(clip.end, sourceStart)));
    const clipDuration = sourceEnd - sourceStart;
    const originalClipStart = num(clip.start, sourceStart);
    const originalClipEnd = Math.max(originalClipStart + 1 / 120, num(clip.end, originalClipStart + clipDuration));
    nextVideoItems.push({ ...clip, id: `clip_export_${clip.id || clipIndex}`, trackId: TRACK_IDS.video, start: cursor, end: cursor + clipDuration, enabled: true, sourcePath: clip.sourcePath || inputPath, sourceStart, sourceEnd });
    originalEffects.forEach((effect) => {
      const overlapStart = Math.max(num(effect.start, 0), originalClipStart);
      const overlapEnd = Math.min(num(effect.end, 0), originalClipEnd);
      if (overlapEnd - overlapStart < 1 / 120) return;
      const shiftedStart = cursor + (overlapStart - originalClipStart);
      const shiftedEnd = cursor + (overlapEnd - originalClipStart);
      nextEffectItems.push({
        ...effect,
        id: `clip_effect_${clipIndex}_${effect.id}`,
        trackId: TRACK_IDS.effect,
        start: shiftedStart,
        end: shiftedEnd,
        payload: {
          ...(effect.payload || {}),
          rangeStart: overlapStart,
          rangeEnd: overlapEnd,
        },
      });
    });
    cursor += clipDuration;
  });
  cloned.duration = cursor;
  cloned.tracks = cloned.tracks.map((track) => {
    if (track.type === 'video') return { ...track, id: TRACK_IDS.video, items: nextVideoItems };
    if (track.type === 'effect') return { ...track, id: TRACK_IDS.effect, items: nextEffectItems };
    if (track.type === 'overlay') return { ...track, id: TRACK_IDS.overlay, items: selectedClips };
    return track;
  });
  return cloned;
}

function normalizeTrackItemsV2(trackType, items, warnings) {
  const ordered = sortByStart(Array.isArray(items) ? items : []);
  const placed = [];
  let migratedLane = false;
  ordered.forEach((rawItem, index) => {
    const start = Math.max(0, num(rawItem?.start, 0));
    const end = Math.max(start, num(rawItem?.end, start));
    if (end - start < MIN_SPAN) return;
    const hasLane = Number.isFinite(Number(rawItem?.lane));
    const lane = trackType === 'video'
      ? 0
      : hasLane
        ? Math.max(0, Math.round(num(rawItem?.lane, 0)))
        : findAvailableLane(placed, trackType, start, end, rawItem?.id);
    if (trackType !== 'video' && !hasLane) migratedLane = true;
    const nextItem = {
      ...(rawItem || {}),
      id: rawItem?.id || `${TRACK_META[trackType].id}_item_${index}`,
      trackId: TRACK_META[trackType].id,
      start,
      end,
      enabled: rawItem?.enabled !== false,
      lane,
    };
    if (nextItem.kind === 'clip') {
      nextItem.sourceStart = Number.isFinite(Number(nextItem.sourceStart)) ? num(nextItem.sourceStart, start) : start;
      nextItem.sourceEnd = Number.isFinite(Number(nextItem.sourceEnd)) ? num(nextItem.sourceEnd, end) : end;
    }
    placed.push(nextItem);
  });
  if (migratedLane) warnings.push(`${TRACK_META[trackType].name}里检测到旧片段缺少子轨层级，已按时间自动分层。`);
  return sortTrackItems(trackType, placed);
}

function sanitizeTimelineSnapshotV2(rawSnapshot, inputPath, sourceDuration, fpsHint) {
  const warnings = [];
  const snapshot = rawSnapshot && typeof rawSnapshot === 'object'
    ? deepClone(rawSnapshot)
    : { version: 2, sourceVideoPath: inputPath, duration: sourceDuration, fps: fpsHint, tracks: [] };

  snapshot.version = Math.max(2, num(snapshot.version, 2));
  snapshot.sourceVideoPath = snapshot.sourceVideoPath || inputPath;
  snapshot.duration = Math.max(sourceDuration, num(snapshot.duration, 0));
  snapshot.fps = Math.max(1, num(snapshot.fps, fpsHint));

  const groupedTracks = { video: [], effect: [], overlay: [] };
  (Array.isArray(snapshot.tracks) ? snapshot.tracks : []).forEach((track, index) => {
    const type = track?.type;
    if (type === 'video' || type === 'effect' || type === 'overlay') {
      groupedTracks[type].push({ ...(track || {}), order: Number.isFinite(track?.order) ? track.order : index });
    } else if (track) {
      warnings.push(`已忽略不支持的轨道类型：${track.type || `track_${index + 1}`}`);
    }
  });

  if (groupedTracks.video.length > 1) warnings.push('检测到多个主视频轨，已合并为一个主视频轨。');
  if (groupedTracks.effect.length > 1) warnings.push('检测到多个特效轨，已合并为一个 AI 特效轨。');
  if (groupedTracks.overlay.length > 1) warnings.push('检测到多个素材轨，已合并为一个素材 / 高光轨。');

  snapshot.tracks = ['video', 'effect', 'overlay'].map((trackType) => {
    const sourceTracks = groupedTracks[trackType].sort((a, b) => num(a.order, 0) - num(b.order, 0));
    return {
      ...TRACK_META[trackType],
      enabled: sourceTracks.length ? sourceTracks.some((track) => track.enabled !== false) : true,
      items: normalizeTrackItemsV2(trackType, sourceTracks.flatMap((track) => (Array.isArray(track.items) ? track.items : [])), warnings),
    };
  });

  const videoTrack = snapshot.tracks.find((track) => track.type === 'video');
  const originalIndex = videoTrack.items.findIndex((item) => item.kind === 'clip' && item.sourceType === 'original');
  if (sourceDuration > 0) {
    const originalClip = {
      id: originalIndex >= 0 ? videoTrack.items[originalIndex].id : 'clip_full',
      kind: 'clip',
      trackId: TRACK_IDS.video,
      label: '原始素材',
      start: 0,
      end: sourceDuration,
      lane: 0,
      enabled: true,
      sourcePath: inputPath,
      sourceStart: 0,
      sourceEnd: sourceDuration,
      sourceType: 'original',
    };
    if (originalIndex === -1) {
      videoTrack.items.unshift(originalClip);
      warnings.push('主视频轨缺少完整原始素材，已自动补齐。');
    } else {
      videoTrack.items[originalIndex] = originalClip;
    }
    videoTrack.items = sortTrackItems('video', videoTrack.items);
  }

  return { snapshot, warnings };
}

function activeEffectsAtTimeV2(effects, time) {
  return effects
    .filter((item) => item.enabled !== false && time >= num(item.start, 0) && time < num(item.end, 0))
    .sort(renderEffectComparator);
}

function buildSegmentsFromSnapshotV2(snapshot, sourceDuration, warnings) {
  const videoTrack = snapshot.tracks.find((track) => track.type === 'video' && track.enabled !== false);
  if (!videoTrack) {
    warnings.push('未找到主视频轨，已回退为整片导出。');
    return [{ timelineStart: 0, timelineEnd: sourceDuration, sourceStart: 0, sourceEnd: sourceDuration, effectItems: [] }];
  }

  const clips = sortByStart(videoTrack.items.filter((item) => item.kind === 'clip' && item.enabled !== false));
  if (!clips.length) {
    warnings.push('主视频轨没有可用片段，已回退为整片导出。');
    return [{ timelineStart: 0, timelineEnd: sourceDuration, sourceStart: 0, sourceEnd: sourceDuration, effectItems: [] }];
  }

  const effects = snapshot.tracks
    .filter((track) => track.type === 'effect' && track.enabled !== false)
    .flatMap((track) => (Array.isArray(track.items) ? track.items : []))
    .filter((item) => item.kind === 'effect' && item.enabled !== false)
    .map((item) => ({ ...item, lane: Math.max(0, num(item.lane, 0)) }))
    .sort(renderEffectComparator);

  const segments = [];
  clips.forEach((clip) => {
    const clipStart = Math.max(0, num(clip.start, 0));
    const clipEnd = Math.max(clipStart, num(clip.end, clipStart));
    if (clipEnd - clipStart < MIN_SPAN) return;
    const boundaries = [clipStart, clipEnd];
    effects.forEach((effect) => {
      const overlapStart = Math.max(clipStart, num(effect.start, 0));
      const overlapEnd = Math.min(clipEnd, num(effect.end, clipEnd));
      if (overlapEnd - overlapStart > MIN_SPAN) boundaries.push(overlapStart, overlapEnd);
    });
    const unique = [...new Set(boundaries.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b);
    for (let i = 0; i < unique.length - 1; i += 1) {
      const start = unique[i];
      const end = unique[i + 1];
      if (end - start < MIN_SPAN) continue;
      const sourceOffset = start - clipStart;
      const sourceStart = Math.max(0, Math.min(sourceDuration, num(clip.sourceStart, 0) + sourceOffset));
      const sourceEnd = Math.max(sourceStart, Math.min(sourceDuration, sourceStart + (end - start)));
      const effectItems = activeEffectsAtTimeV2(effects, (start + end) / 2);
      segments.push({
        timelineStart: start,
        timelineEnd: end,
        sourceStart,
        sourceEnd,
        effectItems,
        effectItem: effectItems[0] || null,
      });
    }
  });

  if (!segments.length) {
    warnings.push('时间线未生成有效分段，已回退为整片导出。');
    return [{ timelineStart: 0, timelineEnd: sourceDuration, sourceStart: 0, sourceEnd: sourceDuration, effectItems: [] }];
  }
  return segments.sort((a, b) => a.timelineStart - b.timelineStart);
}

function buildClipModeSnapshotV2(snapshot, inputPath, warnings) {
  const cloned = deepClone(snapshot);
  const overlayTrack = cloned.tracks.find((track) => track.type === 'overlay');
  const selectedClips = overlayTrack ? sortByStart(overlayTrack.items.filter((item) => item.kind === 'clip' && item.enabled !== false)) : [];
  if (!selectedClips.length) {
    warnings.push('素材轨里没有可导出的片段，已回退到时间线导出。');
    return cloned;
  }

  const originalEffects = cloned.tracks
    .filter((track) => track.type === 'effect' && track.enabled !== false)
    .flatMap((track) => (Array.isArray(track.items) ? track.items : []))
    .filter((item) => item.kind === 'effect' && item.enabled !== false)
    .sort(renderEffectComparator);

  let cursor = 0;
  const nextVideoItems = [];
  const nextEffectItems = [];
  selectedClips.forEach((clip, clipIndex) => {
    const sourceStart = num(clip.sourceStart, num(clip.start, 0));
    const sourceEnd = Math.max(sourceStart + MIN_SPAN, num(clip.sourceEnd, num(clip.end, sourceStart)));
    const clipDuration = sourceEnd - sourceStart;
    const originalClipStart = num(clip.start, sourceStart);
    const originalClipEnd = Math.max(originalClipStart + MIN_SPAN, num(clip.end, originalClipStart + clipDuration));
    nextVideoItems.push({ ...clip, id: `clip_export_${clip.id || clipIndex}`, trackId: TRACK_IDS.video, start: cursor, end: cursor + clipDuration, lane: 0, enabled: true, sourcePath: clip.sourcePath || inputPath, sourceStart, sourceEnd });
    originalEffects.forEach((effect) => {
      const overlapStart = Math.max(num(effect.start, 0), originalClipStart);
      const overlapEnd = Math.min(num(effect.end, 0), originalClipEnd);
      if (overlapEnd - overlapStart < MIN_SPAN) return;
      const shiftedStart = cursor + (overlapStart - originalClipStart);
      const shiftedEnd = cursor + (overlapEnd - originalClipStart);
      nextEffectItems.push({
        ...effect,
        id: `clip_effect_${clipIndex}_${effect.id}`,
        trackId: TRACK_IDS.effect,
        start: shiftedStart,
        end: shiftedEnd,
        lane: Math.max(0, num(effect.lane, 0)),
        payload: {
          ...(effect.payload || {}),
          rangeStart: overlapStart,
          rangeEnd: overlapEnd,
        },
      });
    });
    cursor += clipDuration;
  });

  cloned.duration = cursor;
  cloned.tracks = [
    { ...TRACK_META.video, enabled: true, items: sortTrackItems('video', nextVideoItems) },
    { ...TRACK_META.effect, enabled: true, items: sortTrackItems('effect', nextEffectItems) },
    { ...TRACK_META.overlay, enabled: overlayTrack ? overlayTrack.enabled !== false : true, items: sortTrackItems('overlay', selectedClips) },
  ];
  return cloned;
}

function effectConfigKey(effectItem) {
  if (!effectItem) return 'none';
  const trackSamples = Array.isArray(effectItem.payload?.trackSamples) ? effectItem.payload.trackSamples : [];
  const firstTrackSample = trackSamples[0] || null;
  const lastTrackSample = trackSamples[trackSamples.length - 1] || null;
  return JSON.stringify({ operation: effectItem.operation, controlMode: effectItem.controlMode || 'hybrid', manual: effectItem.manual || null, params: effectItem.params || null, interactionMode: effectItem.payload?.interactionMode || 'pinned', targetBinding: effectItem.payload?.targetBinding || null, targetBindings: effectItem.payload?.targetBindings || [], keyframes: effectItem.payload?.keyframes || null, modelPreference: effectItem.payload?.modelPreference || 'best', modelPath: effectItem.payload?.modelPath || '', confidence: effectItem.payload?.confidence, maxFrames: effectItem.payload?.maxFrames, focusMode: effectItem.payload?.focusMode, focusPlayerId: effectItem.payload?.focusPlayerId, scope: effectItem.payload?.scope || 'selection', rangeStart: effectItem.payload?.rangeStart, rangeEnd: effectItem.payload?.rangeEnd, showLabel: effectItem.payload?.showLabel !== false, trackSamplesMeta: trackSamples.length ? { count: trackSamples.length, first: { trackId: firstTrackSample?.trackId, time: firstTrackSample?.timestamp }, last: { trackId: lastTrackSample?.trackId, time: lastTrackSample?.timestamp } } : null });
}

function buildEffectPayload(effectItem, inputPath) {
  return { operation: effectItem.operation, videoPath: inputPath, writeVideo: true, confidence: effectItem.payload?.confidence ?? 0.35, maxFrames: effectItem.payload?.maxFrames, focusMode: effectItem.payload?.targetBinding?.class === 'ball' ? 'ball' : (effectItem.payload?.focusMode || 'player'), focusPlayerId: typeof effectItem.payload?.targetBinding?.trackId === 'number' ? effectItem.payload.targetBinding.trackId : effectItem.payload?.focusPlayerId, controlMode: effectItem.controlMode || 'hybrid', interactionMode: effectItem.payload?.interactionMode || 'pinned', manualAnchor: effectItem.manual?.anchor || null, manualDirectionDeg: effectItem.manual?.directionDeg, magnifierRadius: effectItem.params?.magnifierRadius, magnifierZoom: effectItem.params?.magnifierZoom, magnifierFeather: effectItem.params?.magnifierFeather, povAngle: effectItem.params?.povAngle, fovAperture: effectItem.params?.fovAperture, fovLength: effectItem.params?.fovLength, fovDim: effectItem.params?.fovDim, highlightOutlineWidth: effectItem.params?.highlightOutlineWidth, highlightGlowStrength: effectItem.params?.highlightGlowStrength, highlightFillOpacity: effectItem.params?.highlightFillOpacity, highlightShowLabel: effectItem.payload?.showLabel !== false ? 1 : 0, modelPreference: effectItem.payload?.modelPreference || 'best', modelPath: effectItem.payload?.modelPath, scope: effectItem.payload?.scope, rangeStart: effectItem.payload?.rangeStart, rangeEnd: effectItem.payload?.rangeEnd, targetBinding: effectItem.payload?.targetBinding || null, targetBindings: effectItem.payload?.targetBindings || [], trackSamples: effectItem.payload?.trackSamples || [], keyframesJson: Array.isArray(effectItem.payload?.keyframes) && effectItem.payload.keyframes.length > 0 ? JSON.stringify(effectItem.payload.keyframes) : null };
}

async function renderEffectSources(effectItems, inputPath, outputDir, warnings) {
  const rendered = new Map();
  for (const effectItem of effectItems) {
    if (!effectItem || !effectItem.operation) continue;
    const key = effectConfigKey(effectItem);
    if (rendered.has(key)) continue;
    try {
      const payload = buildEffectPayload(effectItem, inputPath);
      if (effectItem.operation !== 'player-highlight') {
        const modelPath = resolveModelPath(payload);
        if (modelPath) payload.modelPath = modelPath;
      }
      const result = await runPythonJson(resolveAiScriptPath(), buildAiArgs(payload, outputDir));
      const artifactKey = effectItem.operation === 'magnifier-effect' ? 'magnifierVideo' : effectItem.operation === 'player-pov' ? 'povVideo' : effectItem.operation === 'track-players' ? 'trackedVideo' : effectItem.operation === 'player-highlight' ? 'highlightVideo' : 'annotatedVideo';
      const renderedPath = result?.artifacts?.[artifactKey];
      if (renderedPath && fs.existsSync(renderedPath)) rendered.set(key, renderedPath);
      else warnings.push(`\u6548\u679c ${effectItem.label || effectItem.operation} \u672a\u751f\u6210\u53ef\u7528\u89c6\u9891\uff0c\u5df2\u56de\u9000\u5230\u539f\u89c6\u9891\u3002`);
      if (Array.isArray(result?.warnings) && result.warnings.length > 0) warnings.push(...result.warnings);
    } catch (error) {
      warnings.push(`\u6548\u679c ${effectItem.label || effectItem.operation} \u6e32\u67d3\u5931\u8d25\uff1a${error.message}`);
    }
  }
  return rendered;
}

function effectChainKey(effectItems) {
  if (!Array.isArray(effectItems) || !effectItems.length) return 'none';
  return JSON.stringify(effectItems.map((effectItem) => ({ lane: Math.max(0, num(effectItem?.lane, 0)), config: effectConfigKey(effectItem) })));
}

function artifactKeyForOperation(operation) {
  if (operation === 'magnifier-effect') return 'magnifierVideo';
  if (operation === 'player-pov') return 'povVideo';
  if (operation === 'track-players') return 'trackedVideo';
  if (operation === 'player-highlight') return 'highlightVideo';
  return 'annotatedVideo';
}

async function renderEffectChainsV2(effectChains, inputPath, outputDir, warnings) {
  const rendered = new Map([['none', inputPath]]);
  for (const chain of effectChains) {
    const normalizedChain = Array.isArray(chain) ? chain.filter((item) => item && item.operation) : [];
    if (!normalizedChain.length) {
      rendered.set('none', inputPath);
      continue;
    }

    let currentInput = inputPath;
    const prefix = [];
    for (const effectItem of normalizedChain) {
      prefix.push(effectItem);
      const prefixKey = effectChainKey(prefix);
      if (rendered.has(prefixKey)) {
        currentInput = rendered.get(prefixKey) || inputPath;
        continue;
      }

      try {
        const payload = buildEffectPayload(effectItem, currentInput);
        if (effectItem.operation !== 'player-highlight') {
          const modelPath = resolveModelPath(payload);
          if (modelPath) payload.modelPath = modelPath;
        }
        const result = await runPythonJson(resolveAiScriptPath(), buildAiArgs(payload, outputDir));
        const renderedPath = result?.artifacts?.[artifactKeyForOperation(effectItem.operation)];
        if (Array.isArray(result?.warnings) && result.warnings.length > 0) warnings.push(...result.warnings);
        if (renderedPath && fs.existsSync(renderedPath)) {
          currentInput = renderedPath;
        } else {
          warnings.push(`效果 ${effectItem.label || effectItem.operation} 没有生成可用视频，已跳过这一层。`);
        }
      } catch (error) {
        warnings.push(`效果 ${effectItem.label || effectItem.operation} 渲染失败：${error.message}，已跳过这一层。`);
      }

      rendered.set(prefixKey, currentInput);
    }

    rendered.set(effectChainKey(normalizedChain), currentInput);
  }
  return rendered;
}

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({ title: '选择比赛视频', properties: ['openFile'], filters: [{ name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] }, { name: '全部文件', extensions: ['*'] }] });
  if (!result.canceled && result.filePaths.length > 0 && mainWindow) mainWindow.webContents.send('open-video', result.filePaths[0]);
});

ipcMain.handle('get-video-info', async (_event, filePath) => {
  if (!fs.existsSync(filePath)) return basicVideoInfo(filePath, { infoWarning: '\u89c6\u9891\u6587\u4ef6\u4e0d\u5b58\u5728\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u3002', metadataSource: 'missing-file' });
  try {
    const metadata = await ffprobeAsync(filePath);
    const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video') || {};
    const codecName = String(videoStream.codec_name || '').toLowerCase();
    let previewPath = null;
    let previewMode = 'original';
    let infoWarning = null;
    if (!previewFriendlyCodec(codecName)) {
      try {
        previewPath = await ensurePreviewProxy(filePath);
        previewMode = 'proxy';
        infoWarning = `检测到当前视频编码为 ${codecName || 'unknown'}，已自动生成兼容预览代理。播放器预览使用代理文件，AI 和导出仍使用原视频。`;
      } catch (proxyError) {
        infoWarning = `当前视频编码为 ${codecName || 'unknown'}，Electron 可能无法直接预览；兼容预览生成失败：${proxyError.message}`;
      }
    }
    return basicVideoInfo(filePath, {
      duration: num(metadata?.format?.duration, 0),
      width: num(videoStream.width, 0),
      height: num(videoStream.height, 0),
      fps: fps(videoStream),
      format: metadata?.format?.format_name || 'unknown',
      size: num(metadata?.format?.size, 0),
      videoCodec: codecName || null,
      previewPath,
      previewMode,
      infoWarning,
      metadataSource: 'ffprobe',
    });
  } catch (_error) {
    return basicVideoInfo(filePath, {
      infoWarning: '\u672a\u80fd\u901a\u8fc7 ffprobe/ffmpeg \u8bfb\u53d6\u5b8c\u6574\u5143\u6570\u636e\uff0c\u5c06\u6539\u7531\u64ad\u653e\u5668\u7ee7\u7eed\u8bfb\u53d6\u89c6\u9891\u65f6\u957f\u3002',
      metadataSource: 'html5-pending',
    });
  }
});

ipcMain.handle('run-ai-operation', async (_event, payload) => {
  const outputDir = path.join(app.getPath('userData'), 'ai-output');
  fs.mkdirSync(outputDir, { recursive: true });
  const effective = { ...(payload || {}) };
  if (!effective.focusMode && effective.targetBinding?.class === 'ball') effective.focusMode = 'ball';
  if (typeof effective.focusPlayerId !== 'number' && typeof effective.targetBinding?.trackId === 'number') effective.focusPlayerId = effective.targetBinding.trackId;
  const modelPath = effective.operation === 'player-highlight' ? null : resolveModelPath(effective);
  if (modelPath) effective.modelPath = modelPath;
  const result = await runPythonJson(resolveAiScriptPath(), buildAiArgs(effective, outputDir));
  return { ...result, modelPreference: effective.modelPreference || 'best', modelResolved: modelPath || result.modelResolved || null };
});

ipcMain.handle('open-save-dialog', async (_event, options = {}) => dialog.showSaveDialog({ title: options.title || '\u9009\u62e9\u5bfc\u51fa\u89c6\u9891', defaultPath: options.defaultPath, filters: options.filters || [{ name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] }));
ipcMain.handle('pick-project-save-path', async (_event, options = {}) => dialog.showSaveDialog({ title: options.title || '\u4fdd\u5b58\u9879\u76ee', defaultPath: options.defaultPath, filters: [{ name: 'Project Files', extensions: ['json'] }] }));
ipcMain.handle('pick-project-open-path', async () => dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Project Files', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }] }));
ipcMain.handle('pick-reference-media-paths', async () => dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'png', 'jpg', 'jpeg'] }, { name: 'All Files', extensions: ['*'] }] }));
ipcMain.removeHandler('open-save-dialog');
ipcMain.handle('open-save-dialog', async (_event, options = {}) => dialog.showSaveDialog({ title: options.title || '选择导出视频', defaultPath: options.defaultPath, filters: options.filters || [{ name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] }));
ipcMain.removeHandler('pick-project-save-path');
ipcMain.handle('pick-project-save-path', async (_event, options = {}) => dialog.showSaveDialog({ title: options.title || '保存项目', defaultPath: options.defaultPath, filters: [{ name: '项目文件', extensions: ['json'] }] }));
ipcMain.removeHandler('pick-project-open-path');
ipcMain.handle('pick-project-open-path', async () => dialog.showOpenDialog({ title: '打开项目', properties: ['openFile'], filters: [{ name: '项目文件', extensions: ['json'] }, { name: '全部文件', extensions: ['*'] }] }));
ipcMain.removeHandler('pick-reference-media-paths');
ipcMain.handle('pick-reference-media-paths', async () => dialog.showOpenDialog({ title: '导入参考素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '媒体文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'png', 'jpg', 'jpeg'] }, { name: '全部文件', extensions: ['*'] }] }));
ipcMain.handle('get-last-project-path', async () => {
  const lastProjectPath = store.get('lastProjectPath');
  return lastProjectPath && fs.existsSync(lastProjectPath) ? lastProjectPath : null;
});

ipcMain.handle('export-video', async (_event, payload) => {
  const { inputPath, outputPath, settings = {} } = payload || {};
  if (!inputPath || !outputPath) { const error = new Error('\u7f3a\u5c11\u8f93\u5165\u89c6\u9891\u6216\u8f93\u51fa\u8def\u5f84\u3002'); error.code = 'invalid_output_path'; throw error; }
  if (!fs.existsSync(inputPath)) { const error = new Error(`\u8f93\u5165\u89c6\u9891\u4e0d\u5b58\u5728\uff1a${inputPath}`); error.code = 'invalid_video_metadata'; throw error; }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let sourceMeta;
  try { sourceMeta = await ffprobeAsync(inputPath); } catch (error) { const wrapped = new Error(`\u65e0\u6cd5\u8bfb\u53d6\u89c6\u9891\u5143\u6570\u636e\uff1a${error.message}`); wrapped.code = error.code || 'missing_ffprobe'; throw wrapped; }
  const sourceDuration = Math.max(0, num(sourceMeta?.format?.duration, 0));
  if (sourceDuration <= 0) { const error = new Error('\u65e0\u6cd5\u786e\u5b9a\u89c6\u9891\u65f6\u957f\uff0c\u8bf7\u5148\u4fee\u590d ffprobe \u6216 ffmpeg \u5143\u6570\u636e\u8bfb\u53d6\u80fd\u529b\u3002'); error.code = 'invalid_video_metadata'; throw error; }
  const sourceHasAudio = Array.isArray(sourceMeta?.streams) && sourceMeta.streams.some((stream) => stream.codec_type === 'audio');
  const normalized = sanitizeTimelineSnapshotV2(settings.timelineSnapshot, inputPath, sourceDuration, fps(sourceMeta.streams.find((stream) => stream.codec_type === 'video')) || 30);
  const warnings = [...normalized.warnings];
  const exportSnapshot = settings.mode === 'clips' ? buildClipModeSnapshotV2(normalized.snapshot, inputPath, warnings) : normalized.snapshot;
  const segments = buildSegmentsFromSnapshotV2(exportSnapshot, sourceDuration, warnings);
  if (!segments.length) { const error = new Error('\u5f53\u524d\u65f6\u95f4\u7ebf\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6709\u6548\u5185\u5bb9\u3002'); error.code = 'empty_timeline'; throw error; }
  const outputDir = path.join(app.getPath('userData'), 'ai-output'); fs.mkdirSync(outputDir, { recursive: true });
  const renderedMap = await renderEffectChainsV2(segments.map((segment) => segment.effectItems || []), inputPath, outputDir, warnings);
  const composedSegments = segments.map((segment) => {
    const chainKey = effectChainKey(segment.effectItems || []);
    const renderedPath = renderedMap.get(chainKey) || inputPath;
    if (!renderedPath || !fs.existsSync(renderedPath)) { warnings.push(`\u6548\u679c\u7247\u6bb5 ${segment.effectItem.label} \u6ca1\u6709\u53ef\u7528\u7684\u6e32\u67d3\u89c6\u9891\uff0c\u5df2\u56de\u9000\u5230\u539f\u89c6\u9891\u3002`); return { ...segment, sourcePath: inputPath }; }
    return { ...segment, sourcePath: renderedPath };
  });
  const sourcePaths = [inputPath, ...new Set(composedSegments.map((item) => item.sourcePath).filter((item) => item && item !== inputPath))];
  const sourceIndex = new Map(sourcePaths.map((item, idx) => [item, idx]));
  const useAudio = settings.includeAudio !== false && sourceHasAudio;
  await new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    sourcePaths.forEach((source) => cmd.input(source));
    cmd.output(outputPath).outputOptions('-y');
    const size = resolutionValue(settings.resolution); if (size) cmd.size(size); if (settings.fps) cmd.fps(Number(settings.fps)); cmd.videoBitrate(qualityBitrate(settings.quality));
    const filters = []; const concatInputs = [];
    composedSegments.forEach((segment, idx) => {
      const vIdx = sourceIndex.get(segment.sourcePath) || 0; const start = fmtTime(segment.sourceStart); const end = fmtTime(segment.sourceEnd);
      filters.push(`[${vIdx}:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${idx}]`); concatInputs.push(`[v${idx}]`);
      if (useAudio) { filters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${idx}]`); concatInputs.push(`[a${idx}]`); }
    });
    filters.push(`${concatInputs.join('')}concat=n=${composedSegments.length}:v=1:a=${useAudio ? 1 : 0}[outv]${useAudio ? '[outa]' : ''}`);
    cmd.complexFilter(filters); cmd.outputOptions('-map [outv]'); if (useAudio) cmd.outputOptions('-map [outa]'); else cmd.noAudio(); if (settings.format) cmd.format(String(settings.format));
    cmd.on('end', () => resolve(true)); cmd.on('error', reject); cmd.run();
  }).catch((error) => { throw new Error(`\u5bfc\u51fa\u6267\u884c\u5931\u8d25\uff1a${error.message}`); });
  return { success: true, outputPath, warnings, message: `\u5bfc\u51fa\u5b8c\u6210\uff0c\u5171\u751f\u6210 ${composedSegments.length} \u4e2a\u65f6\u95f4\u6bb5\u3002` };
});

ipcMain.on('open-folder', (_event, targetPath) => { const folder = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath || ''); if (folder) shell.openPath(folder); });
ipcMain.on('open-path', (_event, targetPath) => { if (targetPath) shell.openPath(String(targetPath)); });

ipcMain.handle('save-project-data', async (_event, projectData) => {
  const timestamp = Date.now();
  const requestedPath = projectData?.projectPath ? String(projectData.projectPath) : '';
  const projectPath = requestedPath || path.join(app.getPath('userData'), 'projects', `project_${timestamp}.json`);
  fs.mkdirSync(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, JSON.stringify({ ...(projectData || {}), projectPath, updatedAt: new Date().toISOString() }, null, 2));
  store.set('lastProjectPath', projectPath);
  return { success: true, path: projectPath };
});

ipcMain.handle('load-project-data', async (_event, projectPath) => {
  try {
    store.set('lastProjectPath', projectPath);
    const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    const legacySnapshot = !data.timelineSnapshot && Array.isArray(data.clips)
      ? {
          version: 2,
          sourceVideoPath: data.videoInfo?.path || '',
          duration: Number(data.videoInfo?.duration || 0),
          fps: Number(data.videoInfo?.fps || 30),
          tracks: [
            {
              ...TRACK_META.video,
              enabled: true,
              items: Number(data.videoInfo?.duration || 0) > 0 ? [{
                id: 'clip_full',
                kind: 'clip',
                trackId: TRACK_IDS.video,
                label: '原始素材',
                start: 0,
                end: Number(data.videoInfo?.duration || 0),
                lane: 0,
                enabled: true,
                sourcePath: data.videoInfo?.path || '',
                sourceStart: 0,
                sourceEnd: Number(data.videoInfo?.duration || 0),
                sourceType: 'original',
              }] : [],
            },
            { ...TRACK_META.effect, enabled: true, items: [] },
            {
              ...TRACK_META.overlay,
              enabled: true,
              items: data.clips.map((clip, idx) => ({
                id: clip.id || `legacy_clip_${idx}`,
                kind: 'clip',
                trackId: TRACK_IDS.overlay,
                label: clip.label || `片段 ${idx + 1}`,
                start: Number(clip.start || 0),
                end: Number(clip.end || 0),
                enabled: clip.enabled !== false,
                sourcePath: data.videoInfo?.path || '',
                sourceStart: Number(clip.start || 0),
                sourceEnd: Number(clip.end || 0),
                sourceType: 'manual',
              })),
            },
          ],
        }
      : data.timelineSnapshot;
    const sourceVideoPath = data.sourceVideoPath || legacySnapshot?.sourceVideoPath || data.videoInfo?.path || '';
    const normalized = sanitizeTimelineSnapshotV2(legacySnapshot, sourceVideoPath, Number(data.videoInfo?.duration || legacySnapshot?.duration || 0), Number(data.videoInfo?.fps || legacySnapshot?.fps || 30));
    const warnings = [
      ...(Array.isArray(data.warnings) ? data.warnings : []),
      ...(!data.timelineSnapshot && Array.isArray(data.clips) ? ['旧项目已自动迁移到新的分组轨 / 子轨结构。'] : []),
      ...normalized.warnings,
    ];
    return { ...data, projectPath: data.projectPath || projectPath, timelineSnapshot: normalized.snapshot, warnings };
    if (!data.timelineSnapshot && Array.isArray(data.clips)) {
      const duration = Number(data.videoInfo?.duration || 0);
      const videoPath = data.videoInfo?.path || '';
      return { ...data, projectPath, timelineSnapshot: { version: 4, sourceVideoPath: videoPath, duration, fps: Number(data.videoInfo?.fps || 30), tracks: [{ id: TRACK_IDS.video, type: 'video', name: '\u4e3b\u89c6\u9891\u8f68', order: 0, enabled: true, items: duration > 0 ? [{ id: 'clip_full', kind: 'clip', trackId: TRACK_IDS.video, label: '\u539f\u59cb\u7d20\u6750', start: 0, end: duration, enabled: true, sourcePath: videoPath, sourceStart: 0, sourceEnd: duration, sourceType: 'original' }] : [] }, { id: TRACK_IDS.effect, type: 'effect', name: 'AI \u6548\u679c\u8f68', order: 1, enabled: true, items: [] }, { id: TRACK_IDS.overlay, type: 'overlay', name: '\u7d20\u6750 / \u8986\u76d6\u8f68', order: 2, enabled: true, items: data.clips.map((clip, idx) => ({ id: clip.id || `legacy_clip_${idx}`, kind: 'clip', trackId: TRACK_IDS.overlay, label: clip.label || `\u7247\u6bb5 ${idx + 1}`, start: Number(clip.start || 0), end: Number(clip.end || 0), enabled: clip.enabled !== false, sourcePath: videoPath, sourceStart: Number(clip.start || 0), sourceEnd: Number(clip.end || 0), sourceType: 'manual' })) }] }, warnings: ['\u65e7\u9879\u76ee\u5df2\u81ea\u52a8\u8fc1\u79fb\u5230\u65b0\u7684\u591a\u8f68\u65f6\u95f4\u7ebf\u7ed3\u6784\u3002'] };
    }
    return { ...data, projectPath: data.projectPath || projectPath };
  } catch (error) {
    throw new Error(`读取项目失败：${error.message}`);
  }
});
