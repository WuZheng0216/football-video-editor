# Football Video Editor

足球视频剪辑与 AI 分析工具，主工程位于 `football-video-editor`。

当前项目形态：
- `electron-app`：桌面端主应用，Electron + React
- `ai-engine`：Python AI 引擎，负责检测、跟踪、多人高亮、自动高光等
- `video-core`：视频处理相关辅助模块
- `docs`：部署、开发、使用说明

## 推荐阅读顺序

如果你是第一次接触这个项目，建议按下面顺序看：

1. [完整使用说明](./docs/使用说明-开发部署.md)
2. [安装说明](./INSTALL.md)

## 最低可运行环境

- Windows 10/11 64 位
- Node.js 20 LTS
- Python 3.10 到 3.12
- Conda 或 Miniconda
- FFmpeg 和 FFprobe，并且已经加入系统 `PATH`

## 快速启动

第一次安装依赖：

```powershell
cd C:\Wuz\TAC\football-video-editor\electron-app
npm install

cd C:\Wuz\TAC\football-video-editor\electron-app\src\renderer
npm install

cd C:\Wuz\TAC\football-video-editor\ai-engine
pip install -r requirements.txt
```

开发模式启动：

```powershell
conda activate tac
cd C:\Wuz\TAC\football-video-editor\electron-app
npm run dev
```

如果 React 页面已经起来了，但 Electron 窗口没有自动弹出：

```powershell
cd C:\Wuz\TAC\football-video-editor\electron-app
npx electron .
```

## 当前已接通的主功能

- 单主视频工程编辑
- 项目保存、加载、最近项目
- 主视频轨、AI 特效轨、素材/高光轨
- 子轨分层、拖动、分割、删除、撤销、重做
- 球员检测
- 片段级球员跟踪
- 多选球员持续高亮
- 自动高光候选片段
- 时间线导出
- 素材库管理 AI 产物、导出结果和参考素材

## 常见问题

### 视频时长显示异常

优先检查：

```powershell
ffmpeg -version
ffprobe -version
```

只要这两个命令任何一个找不到，视频元数据、导出、部分 AI 流程都可能异常。

### 启动时报 `node:path`

通常是 Node 版本过低。请升级到 Node.js 20 LTS。

### 打开的是网页，不是桌面应用

请确认你最终是在 Electron 窗口里操作，而不是只在浏览器里打开 `localhost:3000`。
