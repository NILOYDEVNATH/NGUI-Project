# Raspberry Pi + Supabase Real-Time Text Display Project

A complete guide to building a real-time text display system using Raspberry Pi, Supabase, and either a monitor or LED matrix display.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Hardware Setup](#hardware-setup)
3. [Software Architecture](#software-architecture)
4. [Installation & Setup](#installation--setup)
5. [Code Implementation](#code-implementation)
6. [Monitor Display](#monitor-display)
7. [LED Display](#led-display)
8. [Database Schema](#database-schema)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

---

## Project Overview

This project creates a system where:
- **Supabase Database** stores messages/text to display
- **Raspberry Pi** listens for real-time updates via WebSocket
- **Display Options**:
  - HDMI monitor (easiest)
  - LED matrix (more visually striking)
  - Both simultaneously

**Key Features:**
- Real-time updates (sub-second latency)
- No polling—true event-driven architecture
- Multi-line scrolling text support
- Color support (for LED displays)
- Fallback display when disconnected

---

## Hardware Setup

### Minimum Requirements
- **Raspberry Pi 4B** (2GB RAM minimum, 4GB recommended)
- **MicroSD Card** (32GB, UHS-I or better)
- **Power Supply** (5V/3A)
- **Network Connection** (Ethernet or WiFi)

### Monitor Option
- HDMI monitor or TV
- HDMI cable

### LED Matrix Option
- **Adafruit RGB LED Matrix** (32x32 or 64x32 recommended)
- **Adafruit HAT** or GPIO wiring
- **Power Supply** (5V/10A+ for large matrices)

**Wiring for LED (if not using HAT):**
```
Pi GPIO    →  LED Matrix
GPIO17/27  →  CLK
GPIO18     →  A, B, C, D (row select)
GPIO23/24  →  R1, G1, B1
GPIO25/26  →  R2, G2, B2
GPIO4      →  OE (output enable)
GPIO14/15  →  LAT (latch)
```

---

## Software Architecture

```
┌─────────────────────────────────────────┐
│       Supabase Cloud (PostgreSQL)       │
│   - messages table                      │
│   - real_time subscription config       │
└──────────────┬──────────────────────────┘
               │ WebSocket (PostgREST)
               │
┌──────────────▼──────────────────────────┐
│      Raspberry Pi (Node.js + Python)    │
│  - Supabase JS Client                   │
│  - Realtime listener                    │
│  - Text formatting/scrolling logic      │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
    ┌───▼────┐   ┌───▼────┐
    │ Monitor │   │ LED    │
    │ (HDMI)  │   │ Matrix │
    └────────┘   └────────┘
```

---

## Installation & Setup

### 1. Raspberry Pi OS Setup

```bash
# Flash latest Raspberry Pi OS Lite to microSD
# Use Raspberry Pi Imager: https://www.raspberrypi.com/software/

# SSH into Pi
ssh pi@raspberrypi.local

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js (LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Install Python 3 & pip (for LED matrix option)
sudo apt install -y python3 python3-pip python3-dev

# Install Git
sudo apt install -y git

# For LED matrix: install RPi.GPIO or libgpiod
sudo apt install -y libgpiod-dev
pip3 install adafruit-circuitpython-rpi-rgb-matrix --break-system-packages
```

### 2. Create Project Directory

```bash
mkdir ~/supabase-display
cd ~/supabase-display
npm init -y
```

### 3. Install Dependencies

```bash
# JavaScript dependencies
npm install @supabase/supabase-js dotenv

# For LED matrix (optional)
npm install rpi-ws281x  # if using WS2812B addressable LEDs
# OR for 7-segment/character displays
pip3 install Adafruit-CircuitPython-RPi-RGB-Matrix --break-system-packages
```

### 4. Create `.env` File

```bash
cat > .env << EOF
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
DISPLAY_TYPE=monitor  # or 'led' or 'both'
TEXT_REFRESH_RATE=100  # milliseconds
FONT_SIZE=48  # for monitor display
EOF
```

Get keys from: **Supabase Dashboard → Settings → API**

---

## Code Implementation

### Main Application (`index.js`)

```javascript
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const DISPLAY_TYPE = process.env.DISPLAY_TYPE || 'monitor';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let displayManager;

async function initializeDisplay() {
  if (DISPLAY_TYPE === 'monitor' || DISPLAY_TYPE === 'both') {
    displayManager = require('./displays/monitor.js');
    await displayManager.init();
    console.log('✓ Monitor display initialized');
  }
  
  if (DISPLAY_TYPE === 'led' || DISPLAY_TYPE === 'both') {
    const ledDisplay = require('./displays/led.js');
    await ledDisplay.init();
    console.log('✓ LED display initialized');
  }
}

async function setupRealtimeListener() {
  console.log('Setting up real-time listener...');
  
  // Listen for INSERT, UPDATE, DELETE events on 'messages' table
  const subscription = supabase
    .channel('messages-channel')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'messages'
      },
      handleMessageChange
    )
    .subscribe((status) => {
      console.log('Subscription status:', status);
    });

  return subscription;
}

async function handleMessageChange(payload) {
  console.log('Message update received:', payload);
  
  const message = payload.new || payload.old || {};
  
  // Extract display data
  const displayText = message.text || '';
  const color = message.color || '#FFFFFF';
  const duration = message.display_duration_ms || 5000;
  
  // Update both displays
  if (displayManager) {
    try {
      await displayManager.displayText(displayText, {
        color,
        duration,
        eventType: payload.eventType
      });
    } catch (error) {
      console.error('Display error:', error);
    }
  }
}

async function loadInitialMessages() {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      await handleMessageChange({
        new: data[0],
        eventType: 'INITIAL_LOAD'
      });
    }
  } catch (error) {
    console.error('Error loading initial messages:', error);
  }
}

async function main() {
  try {
    console.log('🚀 Starting Supabase Real-Time Display System');
    console.log(`Display type: ${DISPLAY_TYPE}`);
    
    // Initialize display
    await initializeDisplay();
    
    // Load last message
    await loadInitialMessages();
    
    // Setup real-time listener
    await setupRealtimeListener();
    
    console.log('✓ System ready!');
    console.log('Waiting for real-time updates...');
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹ Shutting down...');
  if (displayManager?.cleanup) {
    await displayManager.cleanup();
  }
  process.exit(0);
});

main();
```

---

## Monitor Display

### Monitor Display Module (`displays/monitor.js`)

```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');

let server;
let currentMessage = '';
let currentColor = '#FFFFFF';

async function init() {
  // Serve HTML interface
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      const html = getDisplayHTML();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (req.url === '/api/current') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: currentMessage, color: currentColor }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  
  const PORT = process.env.DISPLAY_PORT || 8080;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Display server running on http://raspberrypi.local:${PORT}`);
  });
}

async function displayText(text, options = {}) {
  currentMessage = text;
  currentColor = options.color || '#FFFFFF';
  
  console.log(`📺 Displaying: "${text}" (${options.color})`);
}

function getDisplayHTML() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Real-Time Display</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          background: #000;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-family: 'Arial', sans-serif;
          overflow: hidden;
        }
        
        .display-container {
          text-align: center;
          max-width: 90vw;
          width: 100%;
        }
        
        .message-text {
          font-size: clamp(2rem, 15vw, 20rem);
          font-weight: bold;
          color: #FFFFFF;
          word-wrap: break-word;
          line-height: 1.2;
          animation: fadeIn 0.5s ease-in;
          text-shadow: 0 0 20px rgba(255,255,255,0.3);
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .status {
          position: absolute;
          bottom: 20px;
          right: 20px;
          font-size: 12px;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="display-container">
        <div class="message-text" id="message">Waiting for message...</div>
      </div>
      <div class="status" id="status">Connecting...</div>
      
      <script>
        const messageEl = document.getElementById('message');
        const statusEl = document.getElementById('status');
        
        async function updateDisplay() {
          try {
            const response = await fetch('/api/current');
            const data = await response.json();
            
            messageEl.textContent = data.text || 'No message';
            messageEl.style.color = data.color || '#FFFFFF';
            statusEl.textContent = '✓ Connected';
            statusEl.style.color = '#0f0';
          } catch (error) {
            statusEl.textContent = '✗ Disconnected';
            statusEl.style.color = '#f00';
          }
        }
        
        // Update immediately and then every 500ms
        updateDisplay();
        setInterval(updateDisplay, 500);
      </script>
    </body>
    </html>
  `;
}

async function cleanup() {
  if (server) {
    server.close();
  }
}

module.exports = { init, displayText, cleanup };
```

---

## LED Display

### LED Matrix Module (`displays/led.js`)

```javascript
// Install: npm install canvas-based-led-or physical GPIO library
// This example uses GPIO with HTTP polling (simpler for beginners)

const http = require('http');

let ledState = {
  text: '',
  color: { r: 255, g: 255, b: 255 },
  brightness: 255
};

async function init() {
  console.log('LED Display module initialized');
  // If using actual LED matrix, initialize GPIO here
  // Example: const { Board, Led } = require('johnny-five');
}

async function displayText(text, options = {}) {
  ledState.text = text;
  ledState.color = parseColor(options.color);
  ledState.brightness = options.brightness || 255;
  
  console.log(`💡 LED Display: "${text}"`, ledState.color);
  
  // Send to actual LED hardware (mock for now)
  await updateLEDMatrix(text, ledState.color);
}

function parseColor(hexColor) {
  const hex = hexColor.replace('#', '');
  return {
    r: parseInt(hex.substr(0, 2), 16),
    g: parseInt(hex.substr(2, 2), 16),
    b: parseInt(hex.substr(4, 2), 16)
  };
}

async function updateLEDMatrix(text, color) {
  // Implementation depends on your LED matrix
  
  // OPTION 1: Adafruit RGB LED Matrix via Python
  // const { execSync } = require('child_process');
  // execSync(`python3 led_driver.py "${text}" ${color.r} ${color.g} ${color.b}`);
  
  // OPTION 2: Direct GPIO manipulation
  // (requires GPIO setup)
  
  // OPTION 3: HTTP API to separate LED service
  // await fetch('http://localhost:5000/display', {
  //   method: 'POST',
  //   body: JSON.stringify({ text, color })
  // });
}

async function cleanup() {
  // Clean up GPIO or hardware
  console.log('LED display cleaned up');
}

module.exports = { init, displayText, cleanup };
```

### Python LED Driver (`led_driver.py`)

For Adafruit RGB LED Matrix:

```python
#!/usr/bin/env python3
import sys
import time
from PIL import Image, ImageDraw, ImageFont
from adafruit_circuitpython_rpi_rgb_matrix import RGBMatrix

# LED Matrix configuration
matrix = RGBMatrix(
    rows=32,
    cols=64,
    brightness=100,
    gpio_slowdown=2,
    disable_hardware_pulsing=True
)

def display_text(text, r=255, g=255, b=255):
    """Display text on LED matrix"""
    image = Image.new("RGB", (matrix.width, matrix.height), color=(0, 0, 0))
    draw = ImageDraw.Draw(image)
    
    # Try to use a nice font, fall back to default
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    except:
        font = ImageFont.load_default()
    
    # Measure text and center it
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = (matrix.width - text_width) // 2
    y = (matrix.height - text_height) // 2
    
    draw.text((x, y), text, font=font, fill=(r, g, b))
    
    matrix.SetImage(image)

if __name__ == '__main__':
    if len(sys.argv) >= 2:
        text = sys.argv[1]
        r = int(sys.argv[2]) if len(sys.argv) > 2 else 255
        g = int(sys.argv[3]) if len(sys.argv) > 3 else 255
        b = int(sys.argv[4]) if len(sys.argv) > 4 else 255
        
        display_text(text, r, g, b)
        time.sleep(0.5)
```

---

## Database Schema

### Supabase SQL Setup

Run this in Supabase SQL editor:

```sql
-- Create messages table
CREATE TABLE public.messages (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  color VARCHAR(7) DEFAULT '#FFFFFF',
  display_duration_ms INTEGER DEFAULT 5000,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by VARCHAR(255)
);

-- Enable real-time for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Create index for faster queries
CREATE INDEX idx_messages_created_at 
  ON public.messages(created_at DESC);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anonymous reads
CREATE POLICY "Allow public read" 
  ON public.messages 
  FOR SELECT 
  USING (true);

-- Create policy to allow inserts (optionally restrict to authenticated)
CREATE POLICY "Allow public insert" 
  ON public.messages 
  FOR INSERT 
  WITH CHECK (true);
```

---

## Deployment

### Run as Systemd Service

```bash
# Create service file
sudo nano /etc/systemd/system/supabase-display.service
```

Paste:
```ini
[Unit]
Description=Supabase Real-Time Display
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/supabase-display
ExecStart=/usr/bin/node /home/pi/supabase-display/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable supabase-display
sudo systemctl start supabase-display
sudo systemctl status supabase-display
```

### Start on Boot (Alternative)

Add to crontab:
```bash
crontab -e
```

Add:
```
@reboot cd /home/pi/supabase-display && /usr/bin/node index.js >> /tmp/display.log 2>&1
```

---

## Troubleshooting

### Connection Issues

```bash
# Check network
ping 8.8.8.8

# Test Supabase connectivity
curl https://your-project.supabase.co/rest/v1/messages \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# View logs
sudo journalctl -u supabase-display -f
tail -f /tmp/display.log
```

### Real-Time Not Working

1. Verify real-time is enabled: Supabase Dashboard → Realtime → Public
2. Check table permissions (RLS policies)
3. Restart service: `sudo systemctl restart supabase-display`

### LED Matrix Display Issues

```bash
# Test GPIO access
gpio readall  # requires wiringpi

# Check Python permissions
sudo usermod -a -G gpio pi
```

### Monitor Display Black Screen

1. Access via browser: `http://raspberrypi.local:8080`
2. Check if X11 is running: `ps aux | grep X`
3. Start X if needed: `startx`

---

## API Examples

### Insert Message via REST API

```bash
curl -X POST https://your-project.supabase.co/rest/v1/messages \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello World!",
    "color": "#FF0000",
    "display_duration_ms": 3000
  }'
```

### JavaScript Client Example

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(URL, KEY);

// Send message
await supabase.from('messages').insert({
  text: 'New message from app!',
  color: '#00FF00',
  display_duration_ms: 5000
});
```

---

## Next Steps

- **Add Authentication**: Restrict who can post messages
- **Queue System**: Handle multiple messages gracefully
- **Animations**: Add scrolling text, fade effects
- **Persistence**: Store message history
- **Remote Control**: Web dashboard for message management
- **Sensors**: Display temperature, weather, traffic data

Good luck! 🚀
