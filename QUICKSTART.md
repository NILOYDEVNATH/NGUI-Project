# Quick Start Guide - 15 Minutes to Real-Time Display

## Prerequisites
- Raspberry Pi 4B (2GB+ RAM) running Pi OS Lite
- Network connection (Ethernet preferred)
- HDMI monitor (or LED matrix if using that option)
- Supabase account (free tier works)

## Step 1: Get Supabase Credentials (2 min)

1. Go to [supabase.com](https://supabase.com) and sign up
2. Create a new project
3. Go to **Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **Anon Key** → `SUPABASE_ANON_KEY`

## Step 2: Set Up Database (3 min)

In Supabase SQL Editor, paste this:

```sql
CREATE TABLE public.messages (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  color VARCHAR(7) DEFAULT '#FFFFFF',
  display_duration_ms INTEGER DEFAULT 5000,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

CREATE POLICY "Allow public" ON public.messages 
  FOR SELECT USING (true);

CREATE POLICY "Allow insert" ON public.messages 
  FOR INSERT WITH CHECK (true);
```

Click "Run" ✓

## Step 3: SSH into Raspberry Pi (1 min)

```bash
ssh pi@raspberrypi.local
# password: raspberry (default)
```

## Step 4: Download Project (2 min)

```bash
cd ~
git clone https://github.com/your-username/supabase-display.git
# OR download ZIP and extract

cd supabase-display
ls -la
```

Files you should see:
- `index.js` (main app)
- `displays/` (display modules)
- `.env.example` (configuration template)
- `package.json`

## Step 5: Configure Environment (2 min)

```bash
cp .env.example .env
nano .env
```

Edit these lines:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
DISPLAY_TYPE=monitor
```

Save: `Ctrl+X` → `Y` → `Enter`

## Step 6: Install Dependencies (3 min)

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs npm
npm install
```

## Step 7: Start the Display (1 min)

```bash
npm start
```

You should see:
```
🚀 Starting Supabase Real-Time Display System
Display type: monitor
✓ Supabase client initialized
✓ Monitor display initialized
✓ System ready!
```

## Step 8: Open Display in Browser (1 min)

On any computer on your network:

```
http://raspberrypi.local:8080
```

You should see a black screen with "Waiting for message..."

## Step 9: Test with a Message (1 min)

Open Supabase → **messages** table → **Insert new row**

```
text: "Hello World!"
color: "#00FF00"
```

Click Save.

**Watch your monitor light up!** 🎉

---

## Next: Make It Auto-Start on Boot

```bash
sudo cp supabase-display.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable supabase-display
sudo systemctl start supabase-display
```

Check status:
```bash
sudo systemctl status supabase-display
```

---

## Troubleshooting

### "Cannot find module '@supabase/supabase-js'"
```bash
npm install
```

### Display says "Disconnected"
1. Check internet: `ping 8.8.8.8`
2. Verify `.env` credentials
3. Check Supabase project is running

### Can't access http://raspberrypi.local:8080
- Try IP instead: `http://192.168.1.XXX:8080`
- Find IP: `hostname -I`

### Application crashes
```bash
tail -f logs/display.log
```

---

## API Examples

### Send via CURL
```bash
curl -X POST https://your-project.supabase.co/rest/v1/messages \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Test message",
    "color": "#FF0000"
  }'
```

### Send via Node.js
```javascript
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(URL, KEY);

await supabase.from('messages').insert({
  text: 'Hello from Node!',
  color: '#FF0000'
});
```

### Send via Python
```python
import requests
import json

url = "https://your-project.supabase.co/rest/v1/messages"
headers = {
    "Authorization": "Bearer YOUR_ANON_KEY",
    "Content-Type": "application/json"
}

data = {
    "text": "Hello from Python!",
    "color": "#0000FF"
}

response = requests.post(url, json=data, headers=headers)
print(response.json())
```

---

## Tips

- **Font size** auto-scales to fit screen
- **Colors**: Use hex format `#RRGGBB`
- **Multi-line text**: Just use newlines in the text field
- **No internet?** App will queue and sync when connection returns

---

## Next Steps

1. ✅ Monitor working?
2. 🔧 Add LED matrix support (see LED_SETUP.md)
3. 🌐 Create web dashboard for sending messages
4. 📊 Display sensor data or weather
5. 🔐 Add authentication to restrict who can post

Happy displaying! 🎉
