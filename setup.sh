#!/bin/bash
# setup.sh - Automated setup script for Supabase Display on Raspberry Pi

set -e

echo "🚀 Supabase Real-Time Display Setup"
echo "===================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Create project structure
echo "Creating project structure..."
mkdir -p displays
mkdir -p logs

# Initialize npm project if needed
if [ ! -f "package.json" ]; then
    npm init -y
fi

# Install dependencies
echo "Installing dependencies..."
npm install @supabase/supabase-js dotenv

# Create .env template if it doesn't exist
if [ ! -f ".env" ]; then
    cat > .env << 'EOF'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
DISPLAY_TYPE=monitor
DISPLAY_PORT=8080
TEXT_REFRESH_RATE=100
EOF
    echo "✓ Created .env file - please edit with your Supabase credentials"
fi

# Create main index.js if it doesn't exist
if [ ! -f "index.js" ]; then
    cp index.js.template index.js 2>/dev/null || echo "Please copy index.js from template"
fi

echo ""
echo "✓ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your Supabase credentials"
echo "2. Run: node index.js"
echo ""
echo "To make display persist on reboot:"
echo "  sudo cp supabase-display.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable supabase-display"
echo "  sudo systemctl start supabase-display"
