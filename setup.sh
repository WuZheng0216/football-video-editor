#!/bin/bash

# Football Video Editor Setup Script
# This script sets up the development environment for the Football Video Editor

set -e  # Exit on error

echo "⚽ Football Video Editor - Setup Script"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
    print_warning "Running as root is not recommended. Continue? (y/N)"
    read -r response
    if [[ ! $response =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Detect operating system
detect_os() {
    case "$(uname -s)" in
        Linux*)     OS=Linux;;
        Darwin*)    OS=macOS;;
        CYGWIN*)    OS=Windows;;
        MINGW*)     OS=Windows;;
        *)          OS=UNKNOWN;;
    esac
    print_info "Detected OS: $OS"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Node.js if not present
install_nodejs() {
    if command_exists node; then
        NODE_VERSION=$(node --version | cut -d'v' -f2)
        print_info "Node.js $NODE_VERSION is already installed"
        
        # Check if Node.js version is sufficient
        REQUIRED_NODE=18
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
        if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE" ]; then
            print_warning "Node.js version $NODE_VERSION is below required version $REQUIRED_NODE"
            print_info "Please update Node.js to version $REQUIRED_NODE or higher"
            exit 1
        fi
    else
        print_info "Installing Node.js..."
        
        if [ "$OS" = "Linux" ]; then
            # For Ubuntu/Debian
            curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
            sudo apt-get install -y nodejs
        elif [ "$OS" = "macOS" ]; then
            # For macOS using Homebrew
            if command_exists brew; then
                brew install node@18
                brew link node@18
            else
                print_error "Homebrew not found. Please install Node.js manually"
                exit 1
            fi
        elif [ "$OS" = "Windows" ]; then
            print_info "Please download and install Node.js from https://nodejs.org/"
            exit 1
        else
            print_error "Unsupported OS for automatic Node.js installation"
            exit 1
        fi
        
        print_info "Node.js installed successfully"
    fi
}

# Install Python if not present
install_python() {
    if command_exists python3; then
        PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
        print_info "Python $PYTHON_VERSION is already installed"
        
        # Check if Python version is sufficient
        REQUIRED_PYTHON=3.8
        PYTHON_MAJOR=$(echo $PYTHON_VERSION | cut -d'.' -f1)
        PYTHON_MINOR=$(echo $PYTHON_VERSION | cut -d'.' -f2)
        
        if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 8 ]; }; then
            print_warning "Python version $PYTHON_VERSION is below required version $REQUIRED_PYTHON"
            print_info "Please update Python to version $REQUIRED_PYTHON or higher"
            exit 1
        fi
    else
        print_info "Installing Python..."
        
        if [ "$OS" = "Linux" ]; then
            sudo apt-get update
            sudo apt-get install -y python3 python3-pip python3-venv
        elif [ "$OS" = "macOS" ]; then
            if command_exists brew; then
                brew install python@3.10
            else
                print_error "Homebrew not found. Please install Python manually"
                exit 1
            fi
        elif [ "$OS" = "Windows" ]; then
            print_info "Please download and install Python from https://www.python.org/"
            exit 1
        else
            print_error "Unsupported OS for automatic Python installation"
            exit 1
        fi
        
        print_info "Python installed successfully"
    fi
}

# Install FFmpeg if not present
install_ffmpeg() {
    if command_exists ffmpeg; then
        print_info "FFmpeg is already installed"
    else
        print_info "Installing FFmpeg..."
        
        if [ "$OS" = "Linux" ]; then
            sudo apt-get update
            sudo apt-get install -y ffmpeg
        elif [ "$OS" = "macOS" ]; then
            if command_exists brew; then
                brew install ffmpeg
            else
                print_error "Homebrew not found. Please install FFmpeg manually"
                exit 1
            fi
        elif [ "$OS" = "Windows" ]; then
            print_info "Please download FFmpeg from https://ffmpeg.org/download.html"
            print_info "Add FFmpeg to your PATH environment variable"
            exit 1
        else
            print_error "Unsupported OS for automatic FFmpeg installation"
            exit 1
        fi
        
        print_info "FFmpeg installed successfully"
    fi
}

# Install system dependencies
install_system_deps() {
    print_info "Installing system dependencies..."
    
    if [ "$OS" = "Linux" ]; then
        sudo apt-get update
        sudo apt-get install -y \
            build-essential \
            libgtk-3-dev \
            libnotify-dev \
            libgconf-2-4 \
            libnss3 \
            libxss1 \
            libasound2 \
            libxtst6 \
            xauth \
            xvfb \
            libgbm-dev
    elif [ "$OS" = "macOS" ]; then
        if command_exists brew; then
            brew install libnotify
        fi
    fi
}

# Install Node.js dependencies
install_node_deps() {
    print_info "Installing Node.js dependencies..."
    
    cd electron-app
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        print_error "package.json not found in electron-app directory"
        exit 1
    fi
    
    # Install dependencies
    npm ci
    
    print_info "Node.js dependencies installed successfully"
    cd ..
}

# Install Python dependencies
install_python_deps() {
    print_info "Installing Python dependencies..."
    
    cd ai-engine
    
    # Check if requirements.txt exists
    if [ ! -f "requirements.txt" ]; then
        print_error "requirements.txt not found in ai-engine directory"
        exit 1
    fi
    
    # Create virtual environment
    if [ ! -d "venv" ]; then
        python3 -m venv venv
    fi
    
    # Activate virtual environment and install dependencies
    if [ "$OS" = "Windows" ]; then
        source venv/Scripts/activate
    else
        source venv/bin/activate
    fi
    
    pip install --upgrade pip
    pip install -r requirements.txt
    
    # Install PyTorch with CUDA support if available
    if command_exists nvidia-smi; then
        print_info "CUDA detected, installing PyTorch with CUDA support..."
        pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
    else
        print_info "Installing PyTorch for CPU..."
        pip install torch torchvision
    fi
    
    deactivate
    
    print_info "Python dependencies installed successfully"
    cd ..
}

# Download AI models
download_models() {
    print_info "Downloading AI models..."
    
    cd ai-engine
    
    # Create models directory
    mkdir -p models
    
    # Check if models already exist
    if [ -f "models/yolov8x.pt" ]; then
        print_info "Models already downloaded"
    else
        print_info "Downloading YOLOv8 model..."
        
        # Download YOLOv8 model
        wget -O models/yolov8x.pt https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8x.pt
        
        # Check if download was successful
        if [ $? -eq 0 ]; then
            print_info "YOLOv8 model downloaded successfully"
        else
            print_warning "Failed to download YOLOv8 model. You can download it manually later."
        fi
    fi
    
    cd ..
}

# Create configuration files
create_config() {
    print_info "Creating configuration files..."
    
    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        cat > .env << EOF
# Football Video Editor Configuration

# Application settings
APP_NAME="Football Video Editor"
APP_VERSION="0.1.0"
APP_ENV=development

# Video processing settings
FFMPEG_PATH=$(which ffmpeg)
MAX_VIDEO_RESOLUTION=3840x2160
DEFAULT_FPS=30

# AI settings
AI_MODEL_PATH=ai-engine/models/
USE_GPU=true
CONFIDENCE_THRESHOLD=0.5

# Export settings
EXPORT_FORMAT=mp4
EXPORT_QUALITY=high
EXPORT_RESOLUTION=1920x1080

# Database settings
DB_PATH=~/.football-editor/database.sqlite
EOF
        print_info ".env file created"
    fi
    
    # Create data directories
    mkdir -p data/videos
    mkdir -p data/exports
    mkdir -p data/projects
    mkdir -p logs
    
    print_info "Configuration files created successfully"
}

# Run tests
run_tests() {
    print_info "Running tests..."
    
    # Test Node.js setup
    cd electron-app
    if npm test 2>/dev/null; then
        print_info "Node.js tests passed"
    else
        print_warning "Node.js tests skipped or failed"
    fi
    cd ..
    
    # Test Python setup
    cd ai-engine
    source venv/bin/activate
    if python -c "import torch; import cv2; print('Python imports successful')" 2>/dev/null; then
        print_info "Python setup verified"
    else
        print_warning "Python setup verification failed"
    fi
    deactivate
    cd ..
    
    # Test FFmpeg
    if ffmpeg -version &>/dev/null; then
        print_info "FFmpeg is working correctly"
    else
        print_warning "FFmpeg test failed"
    fi
}

# Display setup summary
display_summary() {
    echo ""
    echo "======================================"
    echo "⚽ Setup Complete!"
    echo "======================================"
    echo ""
    echo "Football Video Editor has been successfully set up."
    echo ""
    echo "Next steps:"
    echo "1. Start the development server:"
    echo "   cd electron-app && npm run dev"
    echo ""
    echo "2. Build the application:"
    echo "   cd electron-app && npm run build"
    echo ""
    echo "3. Package for distribution:"
    echo "   cd electron-app && npm run package"
    echo ""
    echo "4. Run AI tests:"
    echo "   cd ai-engine && python test_detection.py"
    echo ""
    echo "For more information, see the README.md file."
    echo ""
}

# Main setup function
main() {
    print_info "Starting Football Video Editor setup..."
    
    # Detect OS
    detect_os
    
    # Install dependencies
    install_nodejs
    install_python
    install_ffmpeg
    install_system_deps
    
    # Install project dependencies
    install_node_deps
    install_python_deps
    
    # Download AI models
    download_models
    
    # Create configuration
    create_config
    
    # Run tests
    run_tests
    
    # Display summary
    display_summary
    
    print_info "Setup completed successfully! 🎉"
}

# Run main function
main "$@"