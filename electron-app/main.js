const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
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
let mainWindow = null;

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function fps(stream) { const [n, d] = String(stream?.r_frame_rate || '0/1').split('/').map((x) => Number(x || 0)); return d > 0 ? n / d : 0; }
function parseDuration(text) { const m = String(text || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0; }
function fmtTime(v) { return Number(Number(v || 0).toFixed(6)); }
function sortByStart(items) { return [...items].sort((a, b) => num(a.start) - num(b.start)); }
function resolutionValue(v) { const map = { '720p': '1280x720', '1080p': '1920x1080', '1440p': '2560x1440', '4K': '3840x2160' }; return map[v] || null; }
function qualityBitrate(v) { const map = { low: '1500k', medium: '4000k', high: '8000k', ultra: '16000k' }; return map[v] || map.high; }

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

function createMenu() {
  const template = [
    { label: '\u6587\u4ef6', submenu: [{ label: '\u6253\u5f00\u89c6\u9891', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('open-file-dialog') }, { label: '\u5bfc\u51fa', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('export-video') }, { type: 'separator' }, { role: 'quit', label: '\u9000\u51fa' }] },
    { label: '\u7f16\u8f91', submenu: [{ role: 'undo', label: '\u64a4\u9500' }, { role: 'redo', label: '\u91cd\u505a' }, { type: 'separator' }, { role: 'cut', label: '\u526a\u5207' }, { role: 'copy', label: '\u590d\u5236' }, { role: 'paste', label: '\u7c98\u8d34' }] },
    { label: 'AI', submenu: [{ label: '\u7403\u5458\u68c0\u6d4b', click: () => mainWindow?.webContents.send('detect-players') }, { label: '\u591a\u76ee\u6807\u8ddf\u8e2a', click: () => mainWindow?.webContents.send('track-players') }, { label: '\u81ea\u52a8\u9ad8\u5149', click: () => mainWindow?.webContents.send('auto-highlight') }] },
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
  const candidates = (preference === 'fast' ? ['yolov8n.pt'] : preference === 'balanced' ? ['yolov8m.pt', 'yolov8s.pt', 'yolov8n.pt'] : ['yolo11x.pt', 'yolov8x.pt', 'yolov8l.pt', 'yolov8m.pt', 'yolov8s.pt', 'yolov8n.pt']);
  const dirs = [...new Set([path.dirname(resolveAiScriptPath()), path.resolve(__dirname, '..', 'ai-engine'), path.resolve(__dirname, '..'), process.cwd()].filter((dir) => dir && fs.existsSync(dir)))];
  for (const dir of dirs) for (const file of candidates) { const full = path.join(dir, file); if (fs.existsSync(full)) return full; }
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

function buildAiArgs(payload, outputDir) {
  if (!payload || !payload.operation || !payload.videoPath) throw new Error('run-ai-operation requires operation and videoPath');
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
  if (payload.highlightDuration) args.push('--highlight-duration', String(payload.highlightDuration));
  if (payload.maxHighlights) args.push('--max-highlights', String(payload.maxHighlights));
  if (payload.modelPath) args.push('--model-path', String(payload.modelPath));
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

function effectConfigKey(effectItem) {
  if (!effectItem) return 'none';
  return JSON.stringify({ operation: effectItem.operation, controlMode: effectItem.controlMode || 'hybrid', manual: effectItem.manual || null, params: effectItem.params || null, interactionMode: effectItem.payload?.interactionMode || 'pinned', targetBinding: effectItem.payload?.targetBinding || null, keyframes: effectItem.payload?.keyframes || null, modelPreference: effectItem.payload?.modelPreference || 'best', modelPath: effectItem.payload?.modelPath || '', confidence: effectItem.payload?.confidence, maxFrames: effectItem.payload?.maxFrames, focusMode: effectItem.payload?.focusMode, focusPlayerId: effectItem.payload?.focusPlayerId, scope: effectItem.payload?.scope || 'selection', rangeStart: effectItem.payload?.rangeStart, rangeEnd: effectItem.payload?.rangeEnd });
}

function buildEffectPayload(effectItem, inputPath) {
  return { operation: effectItem.operation, videoPath: inputPath, writeVideo: true, confidence: effectItem.payload?.confidence ?? 0.35, maxFrames: effectItem.payload?.maxFrames, focusMode: effectItem.payload?.targetBinding?.class === 'ball' ? 'ball' : (effectItem.payload?.focusMode || 'player'), focusPlayerId: typeof effectItem.payload?.targetBinding?.trackId === 'number' ? effectItem.payload.targetBinding.trackId : effectItem.payload?.focusPlayerId, controlMode: effectItem.controlMode || 'hybrid', interactionMode: effectItem.payload?.interactionMode || 'pinned', manualAnchor: effectItem.manual?.anchor || null, manualDirectionDeg: effectItem.manual?.directionDeg, magnifierRadius: effectItem.params?.magnifierRadius, magnifierZoom: effectItem.params?.magnifierZoom, magnifierFeather: effectItem.params?.magnifierFeather, povAngle: effectItem.params?.povAngle, fovAperture: effectItem.params?.fovAperture, fovLength: effectItem.params?.fovLength, fovDim: effectItem.params?.fovDim, modelPreference: effectItem.payload?.modelPreference || 'best', modelPath: effectItem.payload?.modelPath, scope: effectItem.payload?.scope, rangeStart: effectItem.payload?.rangeStart, rangeEnd: effectItem.payload?.rangeEnd, targetBinding: effectItem.payload?.targetBinding || null, keyframesJson: Array.isArray(effectItem.payload?.keyframes) && effectItem.payload.keyframes.length > 0 ? JSON.stringify(effectItem.payload.keyframes) : null };
}

async function renderEffectSources(effectItems, inputPath, outputDir, warnings) {
  const rendered = new Map();
  for (const effectItem of effectItems) {
    if (!effectItem || !effectItem.operation) continue;
    const key = effectConfigKey(effectItem);
    if (rendered.has(key)) continue;
    try {
      const payload = buildEffectPayload(effectItem, inputPath);
      const modelPath = resolveModelPath(payload);
      if (modelPath) payload.modelPath = modelPath;
      const result = await runPythonJson(resolveAiScriptPath(), buildAiArgs(payload, outputDir));
      const artifactKey = effectItem.operation === 'magnifier-effect' ? 'magnifierVideo' : effectItem.operation === 'player-pov' ? 'povVideo' : effectItem.operation === 'track-players' ? 'trackedVideo' : 'annotatedVideo';
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

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.on('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'webm'] }, { name: 'All Files', extensions: ['*'] }] });
  if (!result.canceled && result.filePaths.length > 0 && mainWindow) mainWindow.webContents.send('open-video', result.filePaths[0]);
});

ipcMain.handle('get-video-info', async (_event, filePath) => {
  if (!fs.existsSync(filePath)) return { duration: 0, width: 0, height: 0, fps: 0, format: 'unknown', size: 0, filename: path.basename(filePath || ''), path: filePath, infoWarning: '\u89c6\u9891\u6587\u4ef6\u4e0d\u5b58\u5728\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u3002' };
  try {
    const metadata = await ffprobeAsync(filePath);
    const videoStream = metadata.streams.find((stream) => stream.codec_type === 'video') || {};
    return { duration: num(metadata?.format?.duration, 0), width: num(videoStream.width, 0), height: num(videoStream.height, 0), fps: fps(videoStream), format: metadata?.format?.format_name || 'unknown', size: num(metadata?.format?.size, 0), filename: path.basename(filePath), path: filePath };
  } catch (_error) {
    return { duration: 0, width: 0, height: 0, fps: 0, format: 'unknown', size: fs.statSync(filePath).size, filename: path.basename(filePath), path: filePath, infoWarning: '\u89c6\u9891\u5143\u6570\u636e\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u786e\u8ba4 ffprobe \u6216 ffmpeg \u662f\u5426\u53ef\u7528\u3002' };
  }
});

ipcMain.handle('run-ai-operation', async (_event, payload) => {
  const outputDir = path.join(app.getPath('userData'), 'ai-output');
  fs.mkdirSync(outputDir, { recursive: true });
  const effective = { ...(payload || {}) };
  if (!effective.focusMode && effective.targetBinding?.class === 'ball') effective.focusMode = 'ball';
  if (typeof effective.focusPlayerId !== 'number' && typeof effective.targetBinding?.trackId === 'number') effective.focusPlayerId = effective.targetBinding.trackId;
  const modelPath = resolveModelPath(effective); if (modelPath) effective.modelPath = modelPath;
  const result = await runPythonJson(resolveAiScriptPath(), buildAiArgs(effective, outputDir));
  return { ...result, modelPreference: effective.modelPreference || 'best', modelResolved: modelPath || result.modelResolved || null };
});

ipcMain.handle('open-save-dialog', async (_event, options = {}) => dialog.showSaveDialog({ title: options.title || '\u9009\u62e9\u5bfc\u51fa\u89c6\u9891', defaultPath: options.defaultPath, filters: options.filters || [{ name: 'Video Files', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }] }));

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
  const normalized = sanitizeTimelineSnapshot(settings.timelineSnapshot, inputPath, sourceDuration, fps(sourceMeta.streams.find((stream) => stream.codec_type === 'video')) || 30);
  const warnings = [...normalized.warnings];
  const segments = buildSegmentsFromSnapshot(normalized.snapshot, sourceDuration, warnings);
  if (!segments.length) { const error = new Error('\u5f53\u524d\u65f6\u95f4\u7ebf\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u6709\u6548\u5185\u5bb9\u3002'); error.code = 'empty_timeline'; throw error; }
  const outputDir = path.join(app.getPath('userData'), 'ai-output'); fs.mkdirSync(outputDir, { recursive: true });
  const renderedMap = await renderEffectSources(segments.map((segment) => segment.effectItem).filter(Boolean), inputPath, outputDir, warnings);
  const composedSegments = segments.map((segment) => {
    if (!segment.effectItem) return { ...segment, sourcePath: inputPath };
    const renderedPath = renderedMap.get(effectConfigKey(segment.effectItem));
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

ipcMain.handle('save-project-data', async (_event, projectData) => {
  const timestamp = Date.now();
  const projectPath = path.join(app.getPath('userData'), 'projects', `project_${timestamp}.json`);
  fs.mkdirSync(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, JSON.stringify(projectData, null, 2));
  store.set('lastProjectPath', projectPath);
  return { success: true, path: projectPath };
});

ipcMain.handle('load-project-data', async (_event, projectPath) => {
  try {
    const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    if (!data.timelineSnapshot && Array.isArray(data.clips)) {
      const duration = Number(data.videoInfo?.duration || 0);
      const videoPath = data.videoInfo?.path || '';
      return { ...data, timelineSnapshot: { version: 4, sourceVideoPath: videoPath, duration, fps: Number(data.videoInfo?.fps || 30), tracks: [{ id: TRACK_IDS.video, type: 'video', name: '\u4e3b\u89c6\u9891\u8f68', order: 0, enabled: true, items: duration > 0 ? [{ id: 'clip_full', kind: 'clip', trackId: TRACK_IDS.video, label: '\u539f\u59cb\u7d20\u6750', start: 0, end: duration, enabled: true, sourcePath: videoPath, sourceStart: 0, sourceEnd: duration, sourceType: 'original' }] : [] }, { id: TRACK_IDS.effect, type: 'effect', name: 'AI \u6548\u679c\u8f68', order: 1, enabled: true, items: [] }, { id: TRACK_IDS.overlay, type: 'overlay', name: '\u7d20\u6750 / \u8986\u76d6\u8f68', order: 2, enabled: true, items: data.clips.map((clip, idx) => ({ id: clip.id || `legacy_clip_${idx}`, kind: 'clip', trackId: TRACK_IDS.overlay, label: clip.label || `\u7247\u6bb5 ${idx + 1}`, start: Number(clip.start || 0), end: Number(clip.end || 0), enabled: clip.enabled !== false, sourcePath: videoPath, sourceStart: Number(clip.start || 0), sourceEnd: Number(clip.end || 0), sourceType: 'manual' })) }] }, warnings: ['\u65e7\u9879\u76ee\u5df2\u81ea\u52a8\u8fc1\u79fb\u5230\u65b0\u7684\u591a\u8f68\u65f6\u95f4\u7ebf\u7ed3\u6784\u3002'] };
    }
    return data;
  } catch (error) {
    throw new Error(`Failed to load project: ${error.message}`);
  }
});
