# 安装说明

## 1. 适用范围
当前安装与运行说明以 Windows + Electron 桌面端为主。

## 2. 基础要求
- Windows 10/11
- Node.js 18.17+
- Python 3.10+
- Anaconda 或 Miniconda
- 建议可用的 `ffmpeg` / `ffprobe`

## 3. Python 环境
建议使用你已有的 `tac` 环境：
```powershell
conda activate tac
```

如果需要手动安装 Python 依赖：
```powershell
cd C:\Wuz\TAC\football-video-editor\ai-engine
pip install -r requirements.txt
```

## 4. 前端与桌面端依赖
进入 Electron 项目目录：
```powershell
cd C:\Wuz\TAC\football-video-editor\electron-app
```

安装依赖：
```powershell
npm install
```

如果你的环境用的是 pnpm，也可以使用 pnpm，但当前项目主要按 npm 脚本组织。

## 5. 启动项目
```powershell
conda activate tac
cd C:\Wuz\TAC\football-video-editor\electron-app
npm run dev
```

如果没有自动弹出 Electron 桌面窗口，再执行：
```powershell
npx electron .
```

## 6. 运行方式说明
- `npm run dev` 会启动 React 开发服务，并尝试拉起 Electron。
- 真正可操作的是 Electron 桌面窗口。
- 浏览器页面主要用于前端开发调试，不能视为完整产品界面。

## 7. FFmpeg / ffprobe 说明
当前项目依赖本地 FFmpeg / ffprobe 读取视频元数据和导出视频。

如果出现以下问题，优先检查 FFmpeg / ffprobe：
- 视频总时长读取为 0
- 时间线只有极短一段
- 导出失败
- 报错里出现 `ffprobe`、`metadata`、`duration`

建议确认以下命令可运行：
```powershell
ffmpeg -version
ffprobe -version
```

## 8. 常见安装问题
### 8.1 `node:path` 相关报错
这通常与 Node.js 版本或前端依赖环境有关。建议：
- 使用 Node.js 18.17+ 或 20.x
- 重新安装前端依赖

### 8.2 Electron 未正确安装
如果执行 `npx electron .` 提示 Electron 安装损坏，进入 `electron-app` 目录重新安装依赖：
```powershell
npm install
```

### 8.3 OpenCV / Python 依赖安装慢
这通常与网络环境有关，尤其是首次安装模型或大型依赖时。建议：
- 保持网络稳定
- 分开安装 Node 与 Python 依赖
- 避免把 `node_modules` 提交到 Git 仓库

### 8.4 导出时报 `Cannot find ffprobe`
说明当前系统或项目环境缺少可用的 `ffprobe`。需要优先修复本机 FFmpeg / ffprobe 环境，再继续导出。

## 9. 当前版本能力边界
安装成功不代表所有宣传型 AI 功能都已经完整接入。当前已知情况：
- 基础播放、时间线编辑、导出：可用
- 检测、跟踪、放大镜、POV、高光：可运行，但部分仍处于预览或半闭环状态
- 高级字幕贴纸、项目管理、复杂素材管理：尚未完成

## 10. 后续参考
更详细的使用方式，请查看：
- [中文使用说明](./docs/使用说明-足球视频剪辑器.md)