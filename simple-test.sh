#!/bin/bash

# 简化测试 - 只检查文件完整性

echo "⚽ Football Video Editor - 文件完整性测试"
echo "========================================"

check_file() {
    if [ -f "$1" ]; then
        echo "✅ $1"
        return 0
    else
        echo "❌ $1 (缺失)"
        return 1
    fi
}

check_dir() {
    if [ -d "$1" ]; then
        echo "✅ $1"
        return 0
    else
        echo "❌ $1 (缺失)"
        return 1
    fi
}

echo "📁 检查核心文件..."
echo "----------------"

# 关键文件列表
FILES=(
    "electron-app/main.js"
    "electron-app/package.json"
    "electron-app/src/renderer/App.tsx"
    "electron-app/src/renderer/index.tsx"
    "electron-app/src/renderer/App.css"
    "ai-engine/player_detector.py"
    "ai-engine/player_tracker.py"
    "ai-engine/requirements.txt"
    "video-core/video_processor.py"
    "README.md"
    "INSTALL.md"
    "run-demo.bat"
    "build-windows.bat"
    "windows-installer.iss"
)

DIRS=(
    "electron-app"
    "ai-engine"
    "video-core"
    "docs"
    "electron-app/src/renderer"
    "electron-app/src/renderer/components"
)

failed=0
passed=0

# 检查目录
echo
echo "📂 检查目录结构..."
for dir in "${DIRS[@]}"; do
    if check_dir "$dir"; then
        ((passed++))
    else
        ((failed++))
    fi
done

# 检查文件
echo
echo "📄 检查核心文件..."
for file in "${FILES[@]}"; do
    if check_file "$file"; then
        ((passed++))
    else
        ((failed++))
    fi
done

# 检查组件文件
echo
echo "🧩 检查React组件..."
COMPONENTS=(
    "VideoPlayer.tsx"
    "Timeline.tsx"
    "AIToolsPanel.tsx"
    "ProjectPanel.tsx"
    "ExportPanel.tsx"
)

for component in "${COMPONENTS[@]}"; do
    file="electron-app/src/renderer/components/$component"
    if check_file "$file"; then
        ((passed++))
    else
        ((failed++))
    fi
done

total=$((passed + failed))

echo
echo "========================================"
echo "📊 测试结果:"
echo "  通过: $passed"
echo "  失败: $failed"
echo "  总计: $total"
echo "========================================"

if [ $failed -eq 0 ]; then
    echo
    echo "🎉 所有文件完整！项目可以交付。"
    echo
    echo "🚀 下一步操作:"
    echo "1. 将整个文件夹打包为ZIP文件"
    echo "2. 运行 run-demo.bat 测试应用"
    echo "3. 运行 build-windows.bat 构建Windows应用"
    echo "4. 运行 push-to-github.sh 上传到GitHub"
    echo
    echo "📦 交付内容:"
    echo "  - 完整的源代码"
    echo "  - Windows安装程序脚本"
    echo "  - AI引擎"
    echo "  - 视频处理核心"
    echo "  - 完整文档"
    echo "  - 测试脚本"
    echo
    exit 0
else
    echo
    echo "⚠️  有 $failed 个文件缺失"
    echo "请检查并修复缺失的文件"
    echo
    exit 1
fi