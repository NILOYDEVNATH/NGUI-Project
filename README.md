# NGUI-Project
Real-time STIB public transport display system using Raspberry Pi, Node.js, and Chromium kiosk mode. Fetches live bus/tram arrival data and displays it in a clean, station-style interface.


# 🚍 Real-Time STIB Display System

A real-time public transport display system for Brussels (STIB/MIVB) built using Raspberry Pi, Node.js, and a Chromium kiosk interface.

## 📌 Overview

This project fetches live waiting-time data from the STIB API and displays upcoming buses/trams for a selected stop in a clean, station-style format.

The system is designed to run on a Raspberry Pi connected to a screen, acting as a smart public transport display.

## ⚙️ Features

- 🔄 Real-time data from STIB Waiting Time API
- ⏱ Updates every 20 seconds
- 📍 Displays next 2–3 arrivals per stop
- 🚌 Shows:
  - Line number
  - Destination
  - Time remaining (minutes)
- 🖥 Fullscreen Chromium kiosk display
- 💡 Optional LED matrix support

## 🏗 Architecture

## 🧰 Tech Stack

- Node.js (backend logic)
- STIB Open Data API
- Raspberry Pi
- Chromium (kiosk mode display)
- HTML/CSS (display UI)

## 🚀 How It Works

1. The system polls the STIB API every 20 seconds
2. Extracts upcoming departures for a selected stop
3. Formats data into readable text
4. Displays it in real-time on screen

## 📺 Example Output
8 → ROODEBEEK → 3 min
25 → BOONDAEL GARE → 4 min
8 → ROODEBEEK → 15 min


## 🔧 Setup

```bash
npm install
npm start

## Then open
http://localhost:8080