# NGUI Project - Next Generation STIB Departure Interface

This repository contains the source code and run instructions for a next generation user interface that shows personalized Brussels public transport departures on a Raspberry Pi display. A user enters a short user id, the system resolves that user in Supabase, loads saved destinations or calendar events, fetches live STIB/MIVB departures, and renders the next useful departures in a browser-based dashboard.

## Features

- Personalized user-id input screen for shared public displays.
- Real-time STIB/MIVB waiting-time data, refreshed every 20 seconds.
- Supabase-backed user, place-tag, and calendar-event data.
- Optional Supabase Edge Function integration for route calculation and Google Calendar sync.
- Browser display for HDMI monitors and kiosk screens.
- Optional LED matrix output through a Python driver.
- Systemd service file for automatic startup on a Raspberry Pi.

## Project Files

| File | Purpose |
| --- | --- |
| `index.js` | Main Node.js application. It loads configuration, connects to Supabase, resolves users, fetches STIB data, and updates displays. |
| `displays_monitor.js` | Local HTTP server and single-page browser UI for the monitor/kiosk dashboard. |
| `displays_led.js` | Node.js wrapper that sends display text to the Python LED matrix driver. |
| `led_driver.py` | Optional Adafruit RGB LED matrix renderer. |
| `control-panel.html` | Standalone prototype control panel kept for manual display-message experiments. |
| `supabase-display.service` | Example systemd service for running the project on boot. |
| `setup.sh` | Raspberry Pi helper script for installing dependencies and creating basic folders. |
| `RaspberryPi_Supabase_RealTime_Guide.md` | Additional project notes and Raspberry Pi/Supabase background. |

## Required Software

- Node.js 18 or newer.
- npm.
- A Supabase project.
- Raspberry Pi OS or another Linux/macOS/Windows environment for development.
- Chromium or another modern browser for the monitor display.
- Optional for LED output: Python 3, Pillow, and an Adafruit-compatible RGB LED matrix library.

## Hardware

Minimum display setup:

- Raspberry Pi 4 or newer.
- MicroSD card with Raspberry Pi OS.
- Stable network connection.
- HDMI monitor or TV.
- Power supply suitable for the Raspberry Pi.

Optional LED setup:

- RGB LED matrix, for example 32x32 or 64x32.
- Compatible HAT or GPIO wiring.
- Separate 5V power supply sized for the LED matrix.

## Supabase Tables

The code supports flexible column names, but the following schema is a good starting point.

```sql
create table public."user" (
  id text primary key,
  destination_tag_key text,
  updated_at timestamptz default now()
);

create table public.user_place_tags (
  id bigserial primary key,
  user_id text not null,
  tag_key text,
  tag_name text,
  destination_latitude double precision,
  destination_longitude double precision,
  source_stop_id text,
  route_short_name text,
  event_title text,
  event_location text,
  event_start_time timestamptz,
  event_end_time timestamptz,
  is_required boolean default false,
  sort_order integer default 0,
  updated_at timestamptz default now()
);

create table public.calendar_events (
  id text primary key,
  user_id text not null,
  title text,
  location text,
  start_date timestamptz,
  end_date timestamptz,
  updated_at timestamptz default now()
);
```

For a simple STIB-only test, insert a required origin row and a destination row for the same user. The application matches users by prefix, so entering the first four or more characters of `user_id` is enough when that prefix is unique.

```sql
insert into public.user_place_tags
  (user_id, tag_key, tag_name, destination_latitude, destination_longitude, is_required, sort_order)
values
  ('demo-user-001', 'home', 'Home', 50.8466, 4.3528, true, 1);

insert into public.user_place_tags
  (user_id, tag_key, tag_name, source_stop_id, route_short_name, event_title, event_location, sort_order)
values
  ('demo-user-001', 'office', 'Office', '5416', '8', 'Office trip', 'Roodebeek', 2);
```

## Environment Configuration

Create a local `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=
DISPLAY_TYPE=monitor
DISPLAY_PORT=8080
LOG_FILE=logs/display.log
LOG_LEVEL=info
ROUTE_API_URL=
SYNC_GOOGLE_CALENDAR_URL=
SYNC_CALENDAR_ON_USER_SELECT=false
EDGE_FUNCTION_API_KEY=
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is optional for local experiments, but useful when row-level security blocks reads. Do not expose it in client-side code or upload real secrets.
- `DISPLAY_TYPE` accepts `monitor`, `kiosk`, `led`, or comma-separated combinations such as `monitor,led`.
- `ROUTE_API_URL` and `SYNC_GOOGLE_CALENDAR_URL` are optional. If omitted, the app falls back to Supabase function URLs based on `SUPABASE_URL`.

## Run Locally

1. Install dependencies.

```bash
npm install
```

2. Start the app.

```bash
npm start
```

3. Open the display in a browser.

```text
http://localhost:8080
```

4. Enter a user id prefix, for example `demo`, and wait for departures to load.

5. Check health or logs when debugging.

```bash
curl http://localhost:8080/api/health
npm run logs
```

## Run on Raspberry Pi

1. Flash Raspberry Pi OS using Raspberry Pi Imager.
2. Boot the Pi and connect it to the network.
3. Install Node.js and Git.

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

4. Copy or clone this project to the Pi.

```bash
cd /home/pi
git clone <your-repository-url> NGUI-Project
cd NGUI-Project
```

5. Install Node dependencies and create the environment file.

```bash
npm install
cp .env.example .env
nano .env
```

6. Run the display server.

```bash
npm start
```

7. Open Chromium on the Pi.

```bash
chromium-browser --kiosk http://localhost:8080
```

## Auto-Start with systemd

The included `supabase-display.service` assumes the project is located at `/home/pi/NGUI-Project`.

```bash
sudo cp supabase-display.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable supabase-display
sudo systemctl start supabase-display
sudo systemctl status supabase-display
```

View logs:

```bash
journalctl -u supabase-display -f
```

## Optional LED Matrix Setup

Install Python dependencies on the Raspberry Pi:

```bash
sudo apt install -y python3 python3-pip python3-dev libgpiod-dev
python3 -m pip install Pillow --break-system-packages
python3 -m pip install adafruit-circuitpython-rpi-rgb-matrix --break-system-packages
```

Enable LED output:

```env
DISPLAY_TYPE=monitor,led
```

Test the driver directly:

```bash
python3 led_driver.py "Next bus in 4 min" 255 255 255
```

## Troubleshooting

- Missing Supabase credentials: confirm `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in `.env`.
- Browser cannot connect: make sure the Node process is running and open `http://<pi-ip-address>:8080`.
- Port already in use: set a different `DISPLAY_PORT` in `.env`.
- No departures shown: confirm the entered user prefix matches exactly one user and that the saved stop id/route pair exists in STIB data.
- Service fails on boot: run `journalctl -u supabase-display -n 100` and verify `WorkingDirectory` in `supabase-display.service`.
- LED output is skipped: confirm `led_driver.py` exists in the project root and the Adafruit library is installed on the Pi.

## Source Code Documentation

Important classes and methods are documented directly in the source:

- `Logger`, `initializeDisplay`, `fetchUserSelections`, `fetchDeparturesForUser`, and `pollWaitingTimes` in `index.js`.
- `init`, `handleRequest`, `displayText`, and `getDisplayHTML` in `displays_monitor.js`.
- `init`, `displayText`, and `runPythonLEDDriver` in `displays_led.js`.
- `LEDDisplay`, `render_text`, `wrap_text`, and `main` in `led_driver.py`.

## External Sources and Citations

This project uses standard APIs and open-source libraries rather than copied tutorial code.

- Supabase JavaScript client and Realtime/Postgres platform: https://supabase.com/docs
- STIB/MIVB open data APIs, especially WaitingTimes and StopDetails datasets: https://data.stib-mivb.brussels/
- Node.js runtime and built-in HTTP module: https://nodejs.org/
- Raspberry Pi OS and Raspberry Pi Imager setup tools: https://www.raspberrypi.com/software/
- Chromium browser kiosk mode: https://www.chromium.org/
- Adafruit RGB matrix ecosystem for optional LED output: https://learn.adafruit.com/
- Pillow Python imaging library used by the LED driver: https://python-pillow.org/

No external tutorial source code was pasted into the project. The interface layout, data normalization, polling flow, and display logic were written specifically for this NGUI project.

## Canvas Submission Checklist

- Upload all source files in this repository.
- Include `README.md` with the submission.
- Do not upload `.env`, `.env.env`, API keys, service-role keys, or other secrets.
- Include `.env.example` so the evaluator knows which variables are required.
- If submitting a ZIP file, include `package.json` and `package-lock.json` so dependencies can be reproduced with `npm install`.
