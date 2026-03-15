#!/bin/bash

# Football Video Editor - GitHub Upload Script
# This script pushes the project to a new GitHub repository

set -e  # Exit on error

echo "⚽ Football Video Editor - GitHub Upload"
echo "======================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function for colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if git is installed
if ! command -v git &> /dev/null; then
    print_error "Git is not installed. Please install git first."
    exit 1
fi

# Get repository name
read -p "Enter GitHub repository name (e.g., football-editor): " REPO_NAME
if [ -z "$REPO_NAME" ]; then
    REPO_NAME="football-video-editor"
fi

# Get repository description
read -p "Enter repository description: " REPO_DESC
if [ -z "$REPO_DESC" ]; then
    REPO_DESC="AI-powered professional football video editing and analysis software"
fi

# Check if user has GitHub credentials
print_info "Checking Git configuration..."
if ! git config --global user.name &> /dev/null; then
    print_warning "Git user.name not set"
    read -p "Enter your name for Git commits: " GIT_NAME
    if [ -n "$GIT_NAME" ]; then
        git config --global user.name "$GIT_NAME"
        print_success "Git user.name set to: $GIT_NAME"
    fi
fi

if ! git config --global user.email &> /dev/null; then
    print_warning "Git user.email not set"
    read -p "Enter your email for Git commits: " GIT_EMAIL

    if [ -n "$GIT_EMAIL" ]; then
        git config --global user.email "$GIT_EMAIL"
        print_success "Git user.email set to: $GIT_EMAIL"
    fi
fi

# Create .gitignore if not exists
if [ ! -f ".gitignore" ]; then
    print_info "Creating .gitignore file..."
    cat > .gitignore << 'EOF'
# Dependencies
node_modules/
*/node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build directories
dist/
build/
out/
release/
*.exe
*.AppImage
*.dmg

# AI models and data
models/
*.pt
*.pth
*.onnx
datasets/
*.mp4
*.avi
*.mov
*.mkv

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Editor directories
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Logs
logs/
*.log

# Temporary files
tmp/
temp/
*.tmp
*.temp

# Project specific
ai-engine/venv/
ai-engine/__pycache__/
*.pyc
*.pyo
*.pyd
.Python
pip-log.txt
pip-delete-this-directory.txt
EOF
    print_success ".gitignore created"
fi

# Initialize git repository
print_info "Initializing Git repository..."
if [ -d ".git" ]; then
    print_warning "Git repository already exists"
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    git init
    print_success "Git repository initialized"
fi

# Add files to git
print_info "Adding files to Git..."
git add .
print_success "Files added to staging area"

# Create initial commit
print_info "Creating initial commit..."
git commit -m "Initial commit: Football Video Editor v0.1.0

AI-powered professional football video editing and analysis software
Features:
- Player detection and tracking
- Semantic segmentation
- Automatic highlight generation
- Tactical analysis
- Professional video editing interface"
print_success "Initial commit created"

# Create GitHub repository
print_info "Creating GitHub repository..."
print_info "Repository name: $REPO_NAME"
print_info "Description: $REPO_DESC"

# Check if GitHub CLI is installed
if command -v gh &> /dev/null; then
    print_info "Using GitHub CLI to create repository..."
    if gh auth status &> /dev/null; then
        gh repo create "$REPO_NAME" --description "$REPO_DESC" --public --source=. --remote=origin --push
        print_success "Repository created and pushed using GitHub CLI"
    else
        print_warning "GitHub CLI not authenticated. Please authenticate with 'gh auth login'"
        print_info "Please create repository manually at: https://github.com/new"
        print_info "Then run the following commands:"
        echo
        echo "  git remote add origin https://github.com/yourusername/$REPO_NAME.git"
        echo "  git push -u origin main"
        echo
        exit 1
    fi
else
    print_warning "GitHub CLI not installed"
    print_info "Please create repository manually at: https://github.com/new"
    print_info "Then run the following commands:"
    echo
    echo "  git remote add origin https://github.com/yourusername/$REPO_NAME.git"
    echo "  git branch -M main"
    echo "  git push -u origin main"
    echo
fi

# Ask if user wants to set up GitHub Actions
read -p "Do you want to set up GitHub Actions for automated builds? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Setting up GitHub Actions..."
    
    # Create workflows directory
    mkdir -p .github/workflows
    
    print_success "GitHub Actions directory created"
    print_info "You can add your workflow files to .github/workflows/"
fi

# Create a release tag
print_info "Creating release tag..."
git tag -a "v0.1.0" -m "Release v0.1.0

First release of Football Video Editor
- Complete video editing interface
- AI-powered player detection
- Professional analysis tools
- Windows/Linux/macOS support"
print_success "Release tag v0.1.0 created"

# Push tags
print_info "Pushing tags to GitHub..."
git push --tags
print_success "Tags pushed to GitHub"

# Summary
echo
echo "======================================"
echo "🎉 GitHub Repository Setup Complete!"
echo "======================================"
echo
echo "Repository URL: https://github.com/yourusername/$REPO_NAME"
echo
echo "Next steps:"
echo "1. Visit your repository: https://github.com/yourusername/$REPO_NAME"
echo "2. Review README.md and update if needed"
echo "3. Set up GitHub Actions for CI/CD"
echo "4. Create releases and distribute your application"
echo
echo "To update the repository in the future:"
echo "  git add ."
echo "  git commit -m 'Your commit message'"
echo "  git push origin main"
echo
print_success "Your Football Video Editor is now on GitHub! 🚀"

# Offer to open the repository in browser
read -p "Do you want to open the repository in your browser? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v xdg-open &> /dev/null; then
        xdg-open "https://github.com/yourusername/$REPO_NAME"
    elif command -v open &> /dev/null; then
        open "https://github.com/yourusername/$REPO_NAME"
    elif command -v start &> /dev/null; then
        start "https://github.com/yourusername/$REPO_NAME"
    else
        print_info "Please visit: https://github.com/yourusername/$REPO_NAME"
    fi
fi

echo
print_info "Thank you for using Football Video Editor! ⚽🎬"