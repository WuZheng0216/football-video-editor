@echo off
echo ========================================
echo Football Video Editor - Demo Launcher
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorLevel% neq 0 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js from: https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm is installed
where npm >nul 2>nul
if %errorLevel% neq 0 (
    echo [ERROR] npm not found!
    pause
    exit /b 1
)

echo [INFO] Starting Football Video Editor Demo...
echo.

REM Install dependencies if needed
if not exist "electron-app\node_modules" (
    echo [INFO] Installing dependencies...
    cd electron-app
    call npm install
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
    cd ..
)

REM Check if React app is built
if not exist "electron-app\src\renderer\build" (
    echo [INFO] Building React application...
    cd electron-app\src\renderer
    call npm run build
    if %errorLevel% neq 0 (
        echo [WARNING] React build may have issues, continuing...
    )
    cd ..\..\..
)

REM Create a test video if none exists
if not exist "test-video.mp4" (
    echo [INFO] Creating test video...
    python ai-engine\test_detection.py --generate-test
    if %errorLevel% neq 0 (
        echo [WARNING] Could not create test video, using placeholder
    )
)

REM Start the application
echo [INFO] Launching Football Video Editor...
echo.
echo ========================================
echo IMPORTANT: 
echo 1. Application will open in development mode
echo 2. Press Ctrl+Shift+I to open developer tools
echo 3. Use test-video.mp4 for testing
echo ========================================
echo.

cd electron-app
call npm start

echo.
echo [INFO] Demo completed.
echo.
pause