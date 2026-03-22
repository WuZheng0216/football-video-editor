# 安装说明

这份文件只讲“怎么把环境装起来”。如果你还需要完整的开发和使用流程，请看：

- [完整使用说明](./docs/使用说明-开发部署.md)

## 1. 推荐环境

- Windows 10/11 64 位
- Node.js 20 LTS
- Python 3.10 到 3.12
- Conda 或 Miniconda
- FFmpeg
- FFprobe

## 2. 系统级软件安装

### 方案 A：推荐，命令行安装

使用管理员权限打开 PowerShell，执行：

```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Gyan.FFmpeg -e
```

安装完成后，关闭当前终端，重新打开一个新终端。

验证：

```powershell
node -v
ffmpeg -version
ffprobe -version
```

### 方案 B：手动安装

如果团队成员不熟悉命令行，也可以手动下载安装：

1. 安装 Node.js 20 LTS
2. 安装 FFmpeg
3. 把 FFmpeg 的 `bin` 目录加入系统 `PATH`
4. 重新打开终端

重新验证：

```powershell
node -v
ffmpeg -version
ffprobe -version
```

## 3. Python 环境

建议新建一个独立环境，例如 `tac`：

```powershell
conda create -n tac python=3.10 -y
conda activate tac
```

安装 AI 依赖：

```powershell
cd C:\Wuz\TAC\football-video-editor\ai-engine
pip install -r requirements.txt
```

## 4. 前端与桌面端依赖

先安装 Electron 主程序依赖：

```powershell
cd C:\Wuz\TAC\football-video-editor\electron-app
npm install
```

再安装 React 渲染层依赖：

```powershell
cd C:\Wuz\TAC\football-video-editor\electron-app\src\renderer
npm install
```

## 5. 安装完成后的验证

### 检查主进程语法

```powershell
cd C:\Wuz\TAC\football-video-editor
node -c electron-app\main.js
```

### 检查前端 TypeScript

```powershell
cd C:\Wuz\TAC\football-video-editor
.\electron-app\src\renderer\node_modules\.bin\tsc.cmd --noEmit -p .\electron-app\src\renderer\tsconfig.json
```

### 检查前端打包

```powershell
cd C:\Wuz\TAC\football-video-editor
$env:DISABLE_ESLINT_PLUGIN='true'
npm --prefix electron-app\src\renderer run build
```

## 6. 启动项目

```powershell
conda activate tac
cd C:\Wuz\TAC\football-video-editor\electron-app
npm run dev
```

如果 Electron 没自动弹出：

```powershell
cd C:\Wuz\TAC\football-video-editor\electron-app
npx electron .
```

## 7. 最容易出问题的地方

### `ffprobe` 找不到

说明 FFmpeg 没装好，或者没有加入系统 `PATH`。

### `node:path` 报错

说明 Node 版本太低，请升级到 Node.js 20 LTS。

### 只看到网页，没有桌面窗口

说明 React 开发服务器起来了，但 Electron 没成功启动。此时手动执行：

```powershell
npx electron .
```
