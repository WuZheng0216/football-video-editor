@echo off
echo ========================================
echo Football Video Editor - Windows Build Script
echo ========================================
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Please run this script as Administrator
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

REM Set error handling
setlocal enabledelayedexpansion
set EXIT_CODE=0

REM Colors for output
set RED=[91m
set GREEN=[92m
set YELLOW=[93m
set BLUE=[94m
set RESET=[0m

REM Function for colored output
:colorPrint
echo %~2%~1%RESET%
exit /b

REM Check prerequisites
echo %BLUE%[INFO] Checking prerequisites...%RESET%
echo.

REM Check Node.js
where node >nul 2>nul
if %errorLevel% neq 0 (
    echo %RED%[ERROR] Node.js not found. Please install Node.js v18 or higher.%RESET%
    echo Download from: https://nodejs.org/
    set EXIT_CODE=1
    goto :error
)
node --version
echo %GREEN%[OK] Node.js detected%RESET%

REM Check npm
where npm >nul 2>nul
if %errorLevel% neq 0 (
    echo %RED%[ERROR] npm not found.%RESET%
    set EXIT_CODE=1
    goto :error
)
npm --version
echo %GREEN%[OK] npm detected%RESET%

REM Check Python
where python >nul 2>nul
if %errorLevel% neq 0 (
    where python3 >nul 2>nul
    if %errorLevel% neq 0 (
        echo %YELLOW%[WARNING] Python not found. AI features may not work.%RESET%
        echo Download from: https://www.python.org/
    ) else (
        echo %GREEN%[OK] Python3 detected%RESET%
    )
) else (
    echo %GREEN%[OK] Python detected%RESET%
)

REM Check FFmpeg
where ffmpeg >nul 2>nul
if %errorLevel% neq 0 (
    echo %YELLOW%[WARNING] FFmpeg not found. Video processing may not work.%RESET%
    echo Download from: https://ffmpeg.org/download.html
    echo.
    set /p INSTALL_FFMPEG="Do you want to install FFmpeg automatically? (Y/N): "
    if /i "!INSTALL_FFMPEG!"=="Y" (
        echo Installing FFmpeg via Chocolatey...
        where choco >nul 2>nul
        if %errorLevel% neq 0 (
            echo Installing Chocolatey...
            powershell -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))"
        )
        choco install ffmpeg -y
        if %errorLevel% neq 0 (
            echo %RED%[ERROR] Failed to install FFmpeg%RESET%
        ) else (
            echo %GREEN%[OK] FFmpeg installed successfully%RESET%
        )
    )
) else (
    ffmpeg -version | findstr "version"
    echo %GREEN%[OK] FFmpeg detected%RESET%
)

if %EXIT_CODE% neq 0 goto :error

echo.
echo %BLUE%[INFO] Starting build process...%RESET%
echo ========================================

REM Install Node.js dependencies
echo.
echo %BLUE%[INFO] Installing Node.js dependencies...%RESET%
cd electron-app
call npm ci
if %errorLevel% neq 0 (
    echo %RED%[ERROR] Failed to install Node.js dependencies%RESET%
    set EXIT_CODE=1
    goto :error
)
echo %GREEN%[OK] Node.js dependencies installed%RESET%

REM Install Python dependencies
echo.
echo %BLUE%[INFO] Installing Python dependencies...%RESET%
cd ..\ai-engine
call python -m pip install --upgrade pip
if %errorLevel% neq 0 (
    echo %YELLOW%[WARNING] Failed to upgrade pip, continuing...%RESET%
)

call pip install -r requirements.txt
if %errorLevel% neq 0 (
    echo %YELLOW%[WARNING] Some Python dependencies may have failed to install%RESET%
) else (
    echo %GREEN%[OK] Python dependencies installed%RESET%
)

REM Install PyTorch with CUDA if available
echo.
echo %BLUE%[INFO] Checking for CUDA...%RESET%
where nvidia-smi >nul 2>nul
if %errorLevel% eq 0 (
    echo CUDA detected, installing PyTorch with CUDA support...
    call pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
    if %errorLevel% eq 0 (
        echo %GREEN%[OK] PyTorch with CUDA installed%RESET%
    )
) else (
    echo Installing PyTorch for CPU...
    call pip install torch torchvision
    if %errorLevel% eq 0 (
        echo %GREEN%[OK] PyTorch for CPU installed%RESET%
    )
)

REM Build React application
echo.
echo %BLUE%[INFO] Building React application...%RESET%
cd ..\electron-app\src\renderer
call npm run build
if %errorLevel% neq 0 (
    echo %RED%[ERROR] Failed to build React application%RESET%
    set EXIT_CODE=1
    goto :error
)
echo %GREEN%[OK] React application built%RESET%

REM Package Electron application
echo.
echo %BLUE%[INFO] Packaging Electron application for Windows...%RESET%
cd ..\..
call npm run package -- --win --x64
if %errorLevel% neq 0 (
    echo %RED%[ERROR] Failed to package Electron application%RESET%
    set EXIT_CODE=1
    goto :error
)
echo %GREEN%[OK] Electron application packaged%RESET%

REM Create installer with Inno Setup (if available)
echo.
echo %BLUE%[INFO] Creating Windows installer...%RESET%
where ISCC.exe >nul 2>nul
if %errorLevel% eq 0 (
    echo Inno Setup detected, creating installer...
    cd ..
    ISCC.exe windows-installer.iss
    if %errorLevel% eq 0 (
        echo %GREEN%[OK] Windows installer created%RESET%
        echo Installer location: dist\FootballVideoEditor_Setup.exe
    ) else (
        echo %YELLOW%[WARNING] Failed to create installer with Inno Setup%RESET%
    )
) else (
    echo %YELLOW%[WARNING] Inno Setup not found. Skipping installer creation.%RESET%
    echo You can create installer manually using Inno Setup Compiler
    echo Download from: https://jrsoftware.org/isdl.php
)

REM Create portable version
echo.
echo %BLUE%[INFO] Creating portable version...%RESET%
cd electron-app
xcopy /E /I /Y dist\win-unpacked ..\dist\FootballVideoEditor_Portable\
if %errorLevel% eq 0 (
    echo %GREEN%[OK] Portable version created%RESET%
    echo Portable location: dist\FootballVideoEditor_Portable\
) else (
    echo %YELLOW%[WARNING] Failed to create portable version%RESET%
)

REM Test the built application
echo.
echo %BLUE%[INFO] Testing built application...%RESET%
if exist "dist\win-unpacked\Football Video Editor.exe" (
    echo %GREEN%[OK] Application executable found%RESET%
    echo Executable: dist\win-unpacked\Football Video Editor.exe
    
    REM Check file size
    for %%I in ("dist\win-unpacked\Football Video Editor.exe") do (
        set FILE_SIZE=%%~zI
        set /a FILE_SIZE_MB=!FILE_SIZE!/1048576
        echo File size: !FILE_SIZE_MB! MB
    )
) else (
    echo %RED%[ERROR] Application executable not found%RESET%
    set EXIT_CODE=1
)

:error
if %EXIT_CODE% neq 0 (
    echo.
    echo %RED%[ERROR] Build failed with exit code %EXIT_CODE%%RESET%
    echo Please check the error messages above.
) else (
    echo.
    echo ========================================
    echo %GREEN%BUILD SUCCESSFUL!%RESET%
    echo ========================================
    echo.
    echo Built files are available in:
    echo 1. Portable version: dist\FootballVideoEditor_Portable\
    echo 2. Installer: dist\FootballVideoEditor_Setup.exe (if created)
    echo 3. Unpacked: electron-app\dist\win-unpacked\
    echo.
    echo Next steps:
    echo 1. Test the application
    echo 2. Distribute the installer or portable version
    echo 3. Check the README.md for usage instructions
    echo.
)

echo.
pause
exit /b %EXIT_CODE%