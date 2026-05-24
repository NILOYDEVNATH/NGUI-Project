/**
 * Monitor Display Module
 * Displays text on HDMI monitor via browser
 */

const http = require('http');

let server;
let onUserIdSubmit = async () => {};
let getSelectedUserId = () => '';
let displayMode = 'monitor';
let enableBuiltInKeyboard = false;

let currentState = {
  text: 'Enter your user ID to load departures',
  color: '#FFFFFF',
  timestamp: new Date().toISOString(),
  selectedUserId: '',
  userLabel: '',
  departures: [],
  scheduleEvents: {}
};

function getDisplayLabel() {
  return displayMode === 'kiosk' ? 'Kiosk' : 'Monitor';
}

const logger = {
  info: (msg, data) => console.log(`[${getDisplayLabel()}] ${msg}`, data || ''),
  error: (msg, data) => console.error(`[${getDisplayLabel()}] ${msg}`, data || '')
};

/**
 * Starts the HTTP server that renders the browser-based departure board.
 * The optional callbacks let index.js receive user-id submissions and expose
 * the currently selected user to the browser state endpoint.
 */
async function init(port = 8080, options = {}) {
  onUserIdSubmit = typeof options.onUserIdSubmit === 'function' ? options.onUserIdSubmit : onUserIdSubmit;
  getSelectedUserId = typeof options.getSelectedUserId === 'function' ? options.getSelectedUserId : getSelectedUserId;
  displayMode = options.mode === 'kiosk' ? 'kiosk' : 'monitor';
  enableBuiltInKeyboard = displayMode === 'kiosk';
  currentState.selectedUserId = getSelectedUserId() || '';

  return new Promise((resolve, reject) => {
    server = http.createServer(handleRequest);

    server.listen(port, '0.0.0.0', () => {
      logger.info(`Display server running on http://raspberrypi.local:${port}`);
      resolve();
    });

    server.on('error', reject);
  });
}

/**
 * Routes the small local HTTP API used by the display:
 * `/` serves the UI, `/api/current` exposes the latest state, `/api/user`
 * accepts a selected user id, and `/api/health` supports service checks.
 */
async function handleRequest(req, res) {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const html = getDisplayHTML();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/current') {
      currentState.selectedUserId = getSelectedUserId() || currentState.selectedUserId || '';
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      });
      res.end(JSON.stringify(currentState));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/user') {
      const body = await readJsonBody(req);
      const userId = String(body.userId || '').trim();

      currentState.selectedUserId = userId;
      await onUserIdSubmit(userId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, selectedUserId: userId }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (error) {
    logger.error('Request handler error:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

/**
 * Reads and parses a JSON request body from Node's raw HTTP stream.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Updates the in-memory state consumed by the browser polling loop.
 * The state includes the plain text fallback, structured departures, schedule
 * events, selected user, and visual metadata.
 */
async function displayText(text, options = {}) {
  currentState.text = text;
  currentState.color = options.color || '#FFFFFF';
  currentState.timestamp = new Date().toISOString();
  currentState.selectedUserId = getSelectedUserId() || currentState.selectedUserId || '';
  currentState.userLabel = options.userLabel || currentState.userLabel || '';
  currentState.departures = Array.isArray(options.departures) ? options.departures : [];
  currentState.scheduleEvents = options.scheduleEvents && typeof options.scheduleEvents === 'object'
    ? options.scheduleEvents
    : {};

  logger.info(`Displaying: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" (${options.color})`);
}

/**
 * Generates the complete single-page display application.
 * Keeping the HTML, CSS, and browser JavaScript in one response makes the
 * Raspberry Pi kiosk setup simple because no asset build step is required.
 */
function getDisplayHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>STIB Live Departures</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg-top: #09111c;
      --bg-bottom: #02050a;
      --panel-bg: rgba(10, 18, 28, 0.88);
      --panel-strong: rgba(8, 14, 24, 0.96);
      --panel-soft: rgba(20, 30, 45, 0.84);
      --panel-border: rgba(148, 163, 184, 0.16);
      --row-border: rgba(255, 255, 255, 0.08);
      --route-bg-pink: linear-gradient(135deg, #d94fb2 0%, #b83280 100%);
      --route-bg-yellow: linear-gradient(135deg, #ffd84c 0%, #ffb400 100%);
      --route-text: #14181f;
      --text-main: #f8fafc;
      --text-soft: #a5b4c7;
      --time-accent: #8df7a5;
      --shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
      --keyboard-bg: linear-gradient(180deg, rgba(12, 19, 30, 0.98), rgba(6, 11, 20, 0.98));
      --keyboard-key: linear-gradient(180deg, #1a2637 0%, #111b28 100%);
      --keyboard-key-alt: linear-gradient(180deg, #24354b 0%, #172434 100%);
      --keyboard-key-submit: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
      --keyboard-gap: 16px;
      --keyboard-reserved-space: clamp(176px, 36vh, 226px);
      --form-shell-width: min(620px, 100%);
      --focus-ring: 0 0 0 3px rgba(14, 165, 233, 0.22);
    }

    html, body {
      width: 100%;
      height: 100%;
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.22), transparent 30%),
        radial-gradient(circle at bottom right, rgba(16, 185, 129, 0.14), transparent 28%),
        linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
      font-family: 'Avenir Next Condensed', 'DIN Alternate', 'Franklin Gothic Medium', 'Segoe UI', sans-serif;
      color: var(--text-main);
    }

    body {
      overflow: hidden;
      padding: clamp(10px, 2.2vw, 18px);
    }

    .display-container {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: stretch center;
      transition: padding-bottom 0.24s ease, padding-top 0.24s ease;
    }

    .display-container.form-screen-mode {
      place-items: center;
    }

    body.keyboard-visible .display-container.form-screen-mode {
      padding-bottom: calc(var(--keyboard-reserved-space) + var(--keyboard-gap));
    }

    .message-text {
      width: min(1280px, 100%);
      height: 100%;
      min-height: 0;
      padding: clamp(12px, 1.4vw, 18px);
      border: 1px solid var(--panel-border);
      border-radius: 28px;
      background: linear-gradient(180deg, rgba(15, 23, 35, 0.96), var(--panel-bg));
      box-shadow: var(--shadow);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 10px;
      overflow: hidden;
      transition: width 0.24s ease, min-height 0.24s ease, padding 0.24s ease, transform 0.24s ease, box-shadow 0.24s ease;
    }

    .message-text.form-screen {
      width: var(--form-shell-width);
      height: auto;
      min-height: min(318px, 100%);
      max-height: 100%;
      padding: clamp(16px, 3vw, 24px);
      border-radius: 26px;
      background: linear-gradient(180deg, rgba(13, 20, 31, 0.98), rgba(7, 12, 20, 0.96));
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.42);
      animation: panelLift 0.32s ease-out;
    }

    body.keyboard-visible .message-text.form-screen {
      transform: translateY(-2px);
    }

    .board-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--row-border);
    }

    .form-screen .board-header {
      padding-bottom: 12px;
      margin-bottom: 2px;
    }

    .board-clock {
      font-size: clamp(1.2rem, 2vw, 1.9rem);
      font-weight: 500;
      color: var(--text-main);
      letter-spacing: 0.08em;
      white-space: nowrap;
    }

    .stop-groups {
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-self: stretch;
      min-height: 0;
      height: 100%;
      overflow-y: auto;
      padding-right: 6px;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    .stop-groups::-webkit-scrollbar {
      display: none;
    }

    .stop-card {
      border: 1px solid var(--row-border);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.035);
      overflow: hidden;
      animation: rowFadeIn 0.35s ease-out;
    }

    .stop-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .stop-card-title {
      font-size: clamp(0.92rem, 1.2vw, 1.12rem);
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .stop-card-arrow {
      color: rgba(255, 255, 255, 0.55);
      font-size: 1.1em;
    }

    .stop-card-dots {
      color: rgba(255, 255, 255, 0.4);
      font-size: 1.05rem;
      letter-spacing: 0.15em;
    }

    .arrival-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 14px;
      padding: 8px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .route-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: clamp(30px, 3vw, 36px);
      height: clamp(30px, 3vw, 36px);
      border-radius: 50%;
      color: #fff;
      font-size: clamp(0.78rem, 0.95vw, 0.9rem);
      font-weight: 500;
      line-height: 1;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
    }

    .route-pill.route-odd {
      background: var(--route-bg-pink);
    }

    .route-pill.route-even {
      background: var(--route-bg-yellow);
      color: #1b1f27;
    }

    .arrival-main {
      min-width: 0;
    }

    .destination {
      min-width: 0;
      font-size: clamp(0.85rem, 1vw, 0.98rem);
      font-weight: 500;
      line-height: 1.15;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .arrival-time {
      margin-top: 3px;
      font-size: clamp(0.72rem, 0.82vw, 0.82rem);
      color: rgba(255, 255, 255, 0.62);
    }

    .minutes {
      display: grid;
      justify-items: end;
      gap: 2px;
      white-space: nowrap;
    }

    .minutes-label {
      font-size: clamp(0.62rem, 0.72vw, 0.72rem);
      color: rgba(255, 255, 255, 0.65);
    }

    .minutes-value {
      font-size: clamp(1.35rem, 2.3vw, 2rem);
      font-weight: 500;
      line-height: 0.95;
      color: var(--text-main);
    }

    .minutes-unit {
      font-size: clamp(0.62rem, 0.72vw, 0.72rem);
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: rgba(141, 247, 165, 0.78);
    }

    .empty-state,
    .user-form-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      min-height: 0;
    }

    .user-form-card,
    .empty-card {
      width: 100%;
      padding: clamp(18px, 3.5vw, 28px);
      border-radius: 22px;
      border: 1px solid var(--row-border);
      background: linear-gradient(180deg, rgba(17, 27, 41, 0.82), rgba(10, 16, 27, 0.9));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      text-align: center;
    }

    .user-form-title,
    .empty-title {
      font-size: clamp(1.8rem, 5vw, 2.9rem);
      font-weight: 500;
      line-height: 0.96;
      letter-spacing: 0.02em;
      color: var(--text-main);
    }

    .user-form-help,
    .empty-help {
      margin-top: 12px;
      font-size: clamp(0.98rem, 2.1vw, 1.14rem);
      color: rgba(255, 255, 255, 0.74);
      line-height: 1.38;
    }

    .user-form {
      margin-top: 18px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: stretch;
    }

    .user-input {
      min-width: 0;
      min-height: 68px;
      padding: 0 22px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 18px;
      background: linear-gradient(180deg, rgba(5, 10, 18, 0.94), rgba(13, 22, 35, 0.84));
      color: var(--text-main);
      font-size: clamp(1.14rem, 2.5vw, 1.45rem);
      font-weight: 500;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      outline: none;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .user-input:focus {
      border-color: rgba(56, 189, 248, 0.62);
      box-shadow: var(--focus-ring);
    }

    .user-input::placeholder {
      color: rgba(255, 255, 255, 0.32);
      letter-spacing: 0.08em;
    }

    .user-submit {
      min-width: 210px;
      min-height: 68px;
      padding: 0 28px;
      border: 0;
      border-radius: 18px;
      background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%);
      color: white;
      font-size: clamp(1.02rem, 2vw, 1.18rem);
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
    }

    .user-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 16px 34px rgba(37, 99, 235, 0.28);
    }

    .user-submit:disabled {
      opacity: 0.55;
      cursor: wait;
      transform: none;
      box-shadow: none;
    }

    .form-feedback {
      min-height: 24px;
      margin-top: 12px;
      font-size: clamp(0.92rem, 1.8vw, 1rem);
      color: #fca5a5;
    }

    .keyboard-caption {
      margin-top: 12px;
      font-size: clamp(0.78rem, 1.5vw, 0.9rem);
      color: rgba(165, 180, 199, 0.82);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .keyboard-host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      display: none;
      padding: 0 10px 10px;
      z-index: 950;
    }

    .keyboard-host.visible {
      display: block;
    }

    .keyboard-shell {
      width: min(620px, calc(100vw - 20px));
      margin: 0 auto;
      padding: 10px;
      border: 1px solid var(--panel-border);
      border-radius: 22px;
      background: var(--keyboard-bg);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(8px);
    }

    .keyboard-grid {
      display: grid;
      gap: 8px;
    }

    .keyboard-row {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 8px;
    }

    .keyboard-row.keyboard-row-actions {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .keyboard-key {
      min-height: 42px;
      border: 0;
      border-radius: 12px;
      background: var(--keyboard-key);
      color: var(--text-main);
      font-size: clamp(0.92rem, 1.8vw, 1rem);
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      cursor: pointer;
      transition: transform 0.12s ease, background 0.12s ease;
    }

    .keyboard-key:active {
      background: var(--keyboard-key-alt);
      transform: translateY(1px);
    }

    .keyboard-key.keyboard-key-action {
      background: rgba(34, 50, 71, 0.95);
    }

    .keyboard-key.keyboard-key-submit {
      background: var(--keyboard-key-submit);
      color: white;
    }

    .current-user {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.84);
      font-size: clamp(0.72rem, 0.82vw, 0.82rem);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .status {
      position: fixed;
      top: 14px;
      right: 22px;
      font-size: clamp(10px, 1.2vw, 14px);
      color: #7ddc91;
      font-family: 'Courier New', monospace;
      z-index: 1000;
    }

    .status.connected {
      color: #7ddc91;
    }

    .status.disconnected {
      color: #ff6b6b;
      animation: pulse 1s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 8px;
      background: currentColor;
    }

    @keyframes rowFadeIn {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes panelLift {
      from {
        opacity: 0;
        transform: translateY(12px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 900px) {
      .message-text {
        padding: 12px;
        border-radius: 20px;
      }

      .board-header {
        align-items: center;
      }

      .arrival-row {
        grid-template-columns: auto 1fr;
        align-items: start;
      }

      .minutes {
        grid-column: 2;
        justify-items: start;
      }

      .keyboard-row {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .keyboard-row.keyboard-row-actions {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .display-container.form-screen-mode .message-text {
        width: min(100%, 600px);
      }

      .status {
        right: 16px;
      }
    }

    @media (max-width: 560px), (max-height: 540px) {
      body {
        padding: 8px;
      }

      .message-text {
        padding: 10px;
        gap: 8px;
      }

      .message-text.form-screen {
        min-height: min(284px, 100%);
        padding: 14px;
      }

      .board-header {
        gap: 8px;
        padding-bottom: 8px;
      }

      .current-user,
      .board-clock {
        font-size: 0.8rem;
      }

      .user-form-card,
      .empty-card {
        padding: 16px;
      }

      .user-form-title,
      .empty-title {
        font-size: clamp(1.6rem, 5.2vw, 2.2rem);
      }

      .user-form-help,
      .empty-help {
        margin-top: 10px;
        font-size: 0.94rem;
        line-height: 1.32;
      }

      .user-form {
        margin-top: 14px;
        grid-template-columns: minmax(0, 1fr) 190px;
        gap: 10px;
      }

      .user-input,
      .user-submit {
        min-height: 58px;
      }

      .user-input {
        padding: 0 18px;
        font-size: clamp(1rem, 2.6vw, 1.2rem);
      }

      .user-submit {
        min-width: 0;
        padding: 0 18px;
        font-size: 0.96rem;
      }

      .form-feedback {
        margin-top: 10px;
        min-height: 20px;
      }

      .keyboard-caption {
        margin-top: 10px;
        font-size: 0.76rem;
      }

      .keyboard-host {
        padding: 0 8px 8px;
      }

      .keyboard-shell {
        width: min(620px, calc(100vw - 16px));
        padding: 8px;
      }

      .keyboard-grid,
      .keyboard-row {
        gap: 6px;
      }

      .keyboard-key {
        min-height: 36px;
        border-radius: 10px;
        font-size: 0.9rem;
      }

      body.keyboard-visible .display-container.form-screen-mode {
        padding-bottom: calc(var(--keyboard-reserved-space) + 10px);
      }

      .status {
        top: 10px;
        right: 12px;
      }
    }

    html, body {
      background: #f7f7f4;
      color: #050505;
      font-family: 'Inter', 'Avenir Next', 'Segoe UI', Arial, sans-serif;
    }

    .display-container.board-screen-mode {
      place-items: center;
      overflow: hidden;
      padding: clamp(6px, 1.5vw, 18px);
    }

    .message-text.board-screen {
      width: min(1840px, 100%);
      height: min(820px, calc(100vh - clamp(12px, 3vw, 36px)));
      min-height: 0;
      max-height: calc(100vh - clamp(12px, 3vw, 36px));
      display: block;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      overflow: visible;
      color: #050505;
    }

    .departure-dashboard {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
      gap: clamp(12px, 1.8vw, 28px);
      width: 100%;
      height: 100%;
      min-height: 0;
    }

    .preview-card {
      display: grid;
      grid-template-columns: minmax(0, 1.05fr) minmax(230px, 0.95fr);
      gap: clamp(14px, 2.4vw, 28px);
      align-items: stretch;
      width: 100%;
      height: 100%;
      min-height: 0;
      max-height: none;
      padding: clamp(12px, 2vw, 22px);
      border: 0;
      border-radius: 16px;
      background: #ffffff;
    }

    .primary-panel {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 8px 0;
      overflow: hidden;
    }

    .result-title {
      max-width: 100%;
      font-size: clamp(1.15rem, 2.7vw, 2.25rem);
      font-weight: 500;
      line-height: 1.08;
      overflow-wrap: anywhere;
    }

    .result-location {
      margin-top: 6px;
      max-width: min(430px, 100%);
      font-size: clamp(0.76rem, 1.05vw, 0.96rem);
      font-weight: 400;
      line-height: 1.16;
      overflow-wrap: anywhere;
    }

    .leave-label {
      margin-top: clamp(10px, 2.4vh, 24px);
      font-size: clamp(0.9rem, 1.45vw, 1.18rem);
      font-weight: 400;
      line-height: 1;
    }

    .leave-value {
      margin-top: 2px;
      font-size: clamp(1.65rem, 3.8vw, 3rem);
      font-weight: 500;
      line-height: 1;
    }

    .arrival-copy {
      max-width: 100%;
      margin-top: clamp(14px, 2.8vh, 26px);
      font-size: clamp(0.76rem, 1.15vw, 1rem);
      font-weight: 400;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }

    .arrival-copy strong {
      font-weight: 400;
    }

    .skip-button {
      width: min(330px, 92%);
      margin-top: clamp(18px, 3.2vh, 34px);
      min-height: 54px;
      border: 0;
      border-radius: 14px;
      background: #dcffb0;
      color: #050505;
      font-size: clamp(1rem, 1.9vw, 1.35rem);
      font-weight: 500;
      box-shadow: 4px 7px 0 #d4d4d4;
      cursor: pointer;
    }

    .schedule-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 16px;
      min-width: 0;
      min-height: 0;
      padding: clamp(14px, 2vw, 20px);
      border-radius: 16px;
      background: #d6d6d6;
    }

    .schedule-dates,
    .schedule-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .schedule-date {
      text-align: center;
      font-size: clamp(0.8rem, 1.25vw, 1rem);
      font-weight: 500;
    }

    .schedule-grid {
      grid-template-rows: repeat(3, minmax(86px, 1fr));
    }

    .schedule-slot {
      display: grid;
      place-items: center;
      min-height: 86px;
      min-width: 0;
      padding: 8px;
      border-radius: 14px;
      background: #ffffff;
      text-align: center;
      overflow: hidden;
    }

    .schedule-slot.is-active {
      background: #dcffb0;
    }

    .slot-route {
      font-size: clamp(0.62rem, 0.84vw, 0.78rem);
      font-weight: 500;
      line-height: 1.08;
      overflow-wrap: anywhere;
    }

    .slot-destination {
      margin-top: 2px;
      font-size: clamp(0.54rem, 0.68vw, 0.66rem);
      font-weight: 400;
      line-height: 1.08;
      overflow-wrap: anywhere;
    }

    .slot-time {
      margin-top: 6px;
      font-size: clamp(0.72rem, 1vw, 0.92rem);
      font-weight: 500;
      line-height: 1;
    }

    .urgent-card {
      width: 100%;
      height: 100%;
      min-height: 0;
      max-height: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: clamp(16px, 3vw, 36px);
      border: 0;
      border-radius: 16px;
      background: #ff904d;
      text-align: center;
      color: #050505;
    }

    .urgent-card .result-title {
      font-size: clamp(1.8rem, 3.5vw, 4rem);
      font-weight: 500;
    }

    .urgent-card .leave-label {
      margin-top: clamp(18px, 3vh, 34px);
      font-size: clamp(1.2rem, 2.1vw, 2.6rem);
      font-weight: 400;
    }

    .urgent-card .leave-value {
      font-size: clamp(2.8rem, 5.4vw, 6rem);
      font-weight: 500;
    }

    .urgent-card .arrival-copy {
      font-size: clamp(0.86rem, 1.25vw, 1.45rem);
    }

    .message-text.board-screen,
    .message-text.board-screen * {
      font-weight: 400 !important;
      letter-spacing: 0 !important;
    }

    .message-text.board-screen {
      font-size: 16px;
    }

    .primary-panel {
      gap: 8px;
      overflow: visible;
    }

    .result-title,
    .urgent-card .result-title {
      font-size: clamp(1.15rem, 2.1vw, 1.9rem) !important;
      line-height: 1.18 !important;
    }

    .no-event-title {
      font-size: clamp(3rem, 7vw, 6rem) !important;
    }

    .result-location {
      font-size: clamp(0.72rem, 0.95vw, 0.88rem) !important;
      line-height: 1.18 !important;
    }

    .leave-label,
    .urgent-card .leave-label {
      margin-top: 8px !important;
      font-size: clamp(0.86rem, 1.2vw, 1rem) !important;
    }

    .leave-value,
    .urgent-card .leave-value {
      font-size: clamp(1.45rem, 3vw, 2.6rem) !important;
      line-height: 1.05 !important;
    }

    .arrival-copy,
    .urgent-card .arrival-copy {
      margin-top: 10px !important;
      font-size: clamp(0.72rem, 1vw, 0.92rem) !important;
      line-height: 1.22 !important;
    }

    .schedule-date {
      font-size: clamp(0.86rem, 1.2vw, 1rem) !important;
    }

    .slot-route {
      font-size: clamp(0.6rem, 0.76vw, 0.72rem) !important;
    }

    .slot-destination {
      font-size: clamp(0.52rem, 0.64vw, 0.6rem) !important;
    }

    .slot-time {
      font-size: clamp(0.64rem, 0.84vw, 0.78rem) !important;
    }

    .skip-button {
      font-size: clamp(0.82rem, 1.15vw, 1rem) !important;
    }

    @media (max-width: 1280px) {
      .message-text.board-screen {
        width: min(1180px, 100%);
      }

      .departure-dashboard {
        gap: 22px;
      }

      .preview-card,
      .urgent-card {
        min-height: 0;
        max-height: none;
      }

      .preview-card {
        grid-template-columns: minmax(0, 1fr) minmax(210px, 0.82fr);
        gap: 20px;
      }
    }

    @media (max-width: 900px) {
      .message-text.board-screen {
        width: min(640px, 100%);
      }

      .departure-dashboard {
        grid-template-columns: 1fr;
      }

      .preview-card,
      .urgent-card {
        height: auto;
        min-height: auto;
      }

      .preview-card {
        grid-template-columns: 1fr;
        width: min(640px, 100%);
      }

      .schedule-grid {
        grid-template-rows: repeat(3, minmax(78px, 1fr));
      }
    }

    @media (max-width: 560px) {
      .display-container.board-screen-mode {
        padding: 12px;
      }

      .preview-card,
      .urgent-card {
        border-width: 2px;
      }

      .preview-card {
        padding: 16px;
      }

      .schedule-panel {
        padding: 12px;
        gap: 12px;
      }

      .schedule-dates,
      .schedule-grid {
        gap: 10px;
      }

      .skip-button {
        min-height: 52px;
      }
    }
  </style>
</head>
<body>
  <div class="display-container">
    <div class="message-text" id="message"></div>
  </div>
  ${enableBuiltInKeyboard ? `
  <div class="keyboard-host" id="keyboard-host">
    <div class="keyboard-shell">
      <div class="keyboard-grid" id="keyboard"></div>
    </div>
  </div>` : ''}
  <div class="status" id="status">
    <span class="dot"></span>
    <span id="statusText">Connecting...</span>
  </div>

  <script>
    const isKioskMode = ${JSON.stringify(enableBuiltInKeyboard)};
    const messageEl = document.getElementById('message');
    const displayContainer = document.querySelector('.display-container');
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const keyboardHost = isKioskMode ? document.getElementById('keyboard-host') : null;
    const keyboardEl = isKioskMode ? document.getElementById('keyboard') : null;

    if (isKioskMode) {
      document.body.classList.add('kiosk-mode');
    }

    let lastText = '';
    let lastUserId = '';
    let lastScheduleKey = '';
    let updateInterval;
    let autoScrollInterval;
    let isSubmitting = false;
    let activeInput = null;
    let skippedDepartureKeys = new Set();
    const NEWLINE = String.fromCharCode(10);
    const keyboardRows = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
      ['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
      ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
      ['{clear}', '{bksp}', '{close}']
    ];

    function getKeyboardLabel(key) {
      if (key === '{bksp}') return 'Backspace';
      if (key === '{clear}') return 'Clear';
      if (key === '{close}') return 'Close';
      return key;
    }

    function getKeyboardButtonClass(key) {
      if (key.startsWith('{')) return 'keyboard-key keyboard-key-action';
      return 'keyboard-key';
    }

    function renderKeyboard() {
      if (!isKioskMode || !keyboardEl) {
        return;
      }

      keyboardEl.innerHTML = keyboardRows.map((row) => {
        const rowClass = row.some((key) => key.startsWith('{'))
          ? 'keyboard-row keyboard-row-actions'
          : 'keyboard-row';
        const rowStyle = ' style="grid-template-columns: repeat(' + row.length + ', minmax(0, 1fr));"';

        return '<div class="' + rowClass + '"' + rowStyle + '>' + row.map((key) => (
          '<button type="button" class="' + getKeyboardButtonClass(key) + '" data-key="' + key + '">' +
            escapeHtml(getKeyboardLabel(key)) +
          '</button>'
        )).join('') + '</div>';
      }).join('');

      keyboardEl.addEventListener('click', (event) => {
        const keyButton = event.target.closest('[data-key]');

        if (!keyButton) {
          return;
        }

        pressKeyboardKey(keyButton.getAttribute('data-key'));
      });
    }

    function showKeyboard(inputEl) {
      if (!isKioskMode || !keyboardHost) {
        return;
      }

      activeInput = inputEl;
      document.body.classList.add('keyboard-visible');
      keyboardHost.classList.add('visible');
      inputEl.focus();
    }

    function hideKeyboard() {
      if (!keyboardHost) {
        return;
      }

      document.body.classList.remove('keyboard-visible');
      keyboardHost.classList.remove('visible');
      activeInput = null;
    }

    function pressKeyboardKey(key) {
      if (!activeInput) {
        return;
      }

      if (key === '{bksp}') {
        activeInput.value = activeInput.value.slice(0, -1);
        return;
      }

      if (key === '{clear}') {
        activeInput.value = '';
        return;
      }

      if (key === '{close}') {
        hideKeyboard();
        return;
      }

      const normalizedKey = String(key || '').toUpperCase();

      if (!/^[0-9A-Z]$/.test(normalizedKey)) {
        return;
      }

      activeInput.value = (activeInput.value + normalizedKey).slice(0, 8);
    }

    function normalizeDisplayText(text) {
      return String(text || 'Waiting...')
        .replaceAll('\\\\n', NEWLINE)
        .replaceAll(String.fromCharCode(13), '');
    }

    function setScreenMode(mode) {
      const isFormMode = mode === 'form';

      displayContainer.classList.toggle('form-screen-mode', isFormMode);
      displayContainer.classList.toggle('board-screen-mode', !isFormMode);
      messageEl.classList.toggle('form-screen', isFormMode);
      messageEl.classList.toggle('board-screen', !isFormMode);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function getClockLabel() {
      return new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function parseArrivalLine(line) {
      const normalizedLine = String(line || '').trim();

      if (!normalizedLine) {
        return null;
      }

      const parts = normalizedLine
        .split(/\\s*[→]\\s*/)
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length >= 3) {
        return {
          line: parts[0],
          route: parts[0],
          destination: parts[1],
          minutes: parts.slice(2).join(' ').trim()
        };
      }

      return {
        route: '',
        destination: normalizedLine,
        minutes: ''
      };
    }

    function getDepartureLine(item) {
      return String(item.line || item.route || '').trim();
    }

    function getMinuteValue(item) {
      const eventMinutes = getEventMinuteValue(item);

      if (eventMinutes) {
        return eventMinutes;
      }

      return String(item.minutes ?? '').replace(/\s*min$/i, '').trim() || '--';
    }

    function getTrainTitle(item) {
      const line = getDepartureLine(item);
      return String(item.transportName || item.transport_name || item.mode || (line ? 'Line ' + line : 'Transport')).trim();
    }

    function getEventTitle(item) {
      return String(item.eventTitle || item.title || 'Calendar Event').trim() || 'Calendar Event';
    }

    function getEventLocation(item) {
      return String(item.displayLocation || item.locationLabel || item.destinationTagKey || item.eventLocation || item.location || '').trim();
    }

    function getCalendarEventLocation(item) {
      return String(item.eventLocation || item.location || '').trim();
    }

    function getTimeLabelFromValue(value) {
      const label = String(value || '').trim();
      const match = label.match(/(\d{1,2}:\d{2})/);

      if (match) {
        return match[1];
      }

      const date = new Date(label);

      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      return '';
    }

    function isCalendarEvent(item) {
      return Boolean(item && (item.eventStartTime || item.startDate || item.start_date || item.startsAt || item.starts_at));
    }

    function isConfirmedCalendarEvent(item) {
      return Boolean(item && item.sourceType === 'calendar_event' && isCalendarEvent(item));
    }

    function getEventStartValue(item) {
      return item.eventStartTime || item.startDate || item.start_date || item.startsAt || item.starts_at || '';
    }

    function getEventEndValue(item) {
      return item.eventEndTime || item.endDate || item.end_date || item.endsAt || item.ends_at || '';
    }

    function getEventMinuteValue(item) {
      if (!isCalendarEvent(item)) {
        return '';
      }

      const startDate = new Date(getEventStartValue(item));

      if (Number.isNaN(startDate.getTime())) {
        return '';
      }

      return String(Math.max(0, Math.ceil((startDate.getTime() - Date.now()) / 60000)));
    }

    function isFutureCalendarEvent(item) {
      if (!isCalendarEvent(item)) {
        return true;
      }

      const startDate = new Date(getEventStartValue(item));

      if (Number.isNaN(startDate.getTime())) {
        return true;
      }

      return startDate.getTime() > Date.now();
    }

    function getArrivalHour(item) {
      const label = getTimeLabelFromValue(item.arrivalLabel);

      if (label) {
        return label;
      }

      const minutes = Number.parseInt(getMinuteValue(item), 10);

      if (!Number.isNaN(minutes)) {
        const fallbackArrival = new Date(Date.now() + (minutes * 60000));
        return fallbackArrival.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
      }

      return '--:--';
    }

    function getEventHour(item) {
      const startLabel = getTimeLabelFromValue(getEventStartValue(item));
      const endLabel = getTimeLabelFromValue(getEventEndValue(item));

      if (startLabel && endLabel) {
        return startLabel + '-' + endLabel;
      }

      return startLabel || getArrivalHour(item);
    }

    function getDepartureKey(item) {
      if (isCalendarEvent(item)) {
        return [
          'event',
          item.calendarEventId || item.id || getEventTitle(item),
          getEventStartValue(item),
          getEventEndValue(item)
        ].join('|');
      }

      return [
        'departure',
        item.calendarEventId || item.id || '',
        getEventStartValue(item),
        getDepartureLine(item),
        item.destination || '',
        item.stopId || item.stopLabel || '',
        item.arrivalLabel || '',
        item.minutes || ''
      ].join('|');
    }

    function getDayLabel(offsetDays) {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);
      return date.toLocaleDateString([], {
        day: 'numeric',
        month: 'short'
      });
    }

    function getDayKey(offsetDays) {
      const date = new Date();
      date.setDate(date.getDate() + offsetDays);

      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');
    }

    function getItemDayKey(item) {
      const date = new Date(getEventStartValue(item));

      if (Number.isNaN(date.getTime())) {
        return '';
      }

      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');
    }

    function buildScheduleSlot(item, isActive) {
      if (!item) {
        return '<div class="schedule-slot" aria-hidden="true"></div>';
      }

      return '<div class="schedule-slot' + (isActive ? ' is-active' : '') + '">' +
        '<div>' +
          '<div class="slot-route">' + escapeHtml(getEventTitle(item)) + '</div>' +
          (getCalendarEventLocation(item) ? '<div class="slot-destination">' + escapeHtml(getCalendarEventLocation(item)) + '</div>' : '') +
          '<div class="slot-time">' + escapeHtml(getEventHour(item)) + '</div>' +
        '</div>' +
      '</div>';
    }

    function buildSchedulePanel(arrivals) {
      const todayKey = getDayKey(0);
      const tomorrowKey = getDayKey(1);
      const visibleScheduleArrivals = arrivals.filter((item) => !skippedDepartureKeys.has(getDepartureKey(item)));
      const todayEvents = visibleScheduleArrivals
        .filter((item) => getItemDayKey(item) === todayKey)
        .slice(0, 3);
      const tomorrowEvents = visibleScheduleArrivals
        .filter((item) => getItemDayKey(item) === tomorrowKey)
        .slice(0, 3);

      while (todayEvents.length < 3) {
        todayEvents.push(null);
      }

      while (tomorrowEvents.length < 3) {
        tomorrowEvents.push(null);
      }

      const gridSlots = todayEvents
        .map((item, index) => buildScheduleSlot(item, index === 0) + buildScheduleSlot(tomorrowEvents[index], false))
        .join('');

      return '<aside class="schedule-panel">' +
        '<div class="schedule-dates">' +
          '<div class="schedule-date">' + escapeHtml(getDayLabel(0)) + '</div>' +
          '<div class="schedule-date">' + escapeHtml(getDayLabel(1)) + '</div>' +
        '</div>' +
        '<div class="schedule-grid">' + gridSlots + '</div>' +
      '</aside>';
    }

    function buildArrivalCopy(item, liveDeparture) {
      const transitItem = isCalendarEvent(item) && liveDeparture ? liveDeparture : item;
      const transportLabel = getTrainTitle(transitItem);
      const destination = String(transitItem.destination || '').trim();
      const destinationCopy = destination ? ' to ' + escapeHtml(destination) : '';

      if (isCalendarEvent(item) && liveDeparture) {
        return '<div class="arrival-copy">' + escapeHtml(transportLabel) + destinationCopy +
          ' arrives at Station at: ' + escapeHtml(getArrivalHour(liveDeparture)) + '</div>';
      }

      if (isCalendarEvent(item)) {
        return '<div class="arrival-copy">Starts at: ' +
          escapeHtml(getEventHour(item)) + '</div>';
      }

      return '<div class="arrival-copy">' + escapeHtml(transportLabel) + destinationCopy + ' arrives at Station at: ' +
        escapeHtml(getArrivalHour(item)) + '</div>';
    }

    function shouldShowUrgentDetails(item) {
      const minutes = Number.parseInt(getMinuteValue(item), 10);
      return Number.isFinite(minutes) && minutes > 0 && minutes <= 5;
    }

    function buildDepartureDashboard(arrivals, departures, hasScheduleArrivals) {
      if (!hasScheduleArrivals) {
        return '<div class="departure-dashboard">' +
          '<section class="preview-card">' +
            '<div class="primary-panel">' +
              '<h1 class="result-title no-event-title">No event</h1>' +
            '</div>' +
            buildSchedulePanel([]) +
          '</section>' +
        '</div>';
      }

      const primary = arrivals[0];
      const liveDeparture = Array.isArray(departures) ? departures[0] : null;
      const minutes = getMinuteValue(primary);
      const title = getEventTitle(primary);
      const location = getEventLocation(primary);
      const showUrgent = shouldShowUrgentDetails(primary);
      const urgentDetails = showUrgent
        ? '<h1 class="result-title">' + escapeHtml(title) + '</h1>' +
          '<div class="leave-label">Leave In:</div>' +
          '<div class="leave-value">' + escapeHtml(minutes) + ' Min</div>' +
          buildArrivalCopy(primary, liveDeparture)
        : '';

      if (showUrgent) {
        return '<div class="departure-dashboard has-urgent">' +
          '<section class="urgent-card">' + urgentDetails + '</section>' +
        '</div>';
      }

      return '<div class="departure-dashboard">' +
        '<section class="preview-card">' +
          '<div class="primary-panel">' +
            '<h1 class="result-title">' + escapeHtml(title) + '</h1>' +
            (location ? '<div class="result-location">' + escapeHtml(location) + '</div>' : '') +
            '<div class="leave-label">Leave In:</div>' +
            '<div class="leave-value">' + escapeHtml(minutes) + ' Min</div>' +
            buildArrivalCopy(primary, liveDeparture) +
            '<button class="skip-button" type="button">Skip Event</button>' +
          '</div>' +
          buildSchedulePanel(arrivals) +
        '</section>' +
      '</div>';
    }

    function buildHeader(subtitle, userLabel) {
      const userBadge = userLabel
        ? '<div class="current-user">User: ' + escapeHtml(userLabel) + '</div>'
        : '';

      return '<div class="board-header">' +
        '<div>' + userBadge + '</div>' +
        '<div class="board-clock">' + escapeHtml(getClockLabel()) + '</div>' +
      '</div>';
    }

    function renderUserForm(userId, feedback) {
      setScreenMode('form');
      messageEl.innerHTML =
        buildHeader('Enter User ID', userId ? userId.slice(0, 4) : '') +
        '<div class="user-form-wrap">' +
          '<div class="user-form-card">' +
            '<div class="user-form-title">Load Your Stops</div>' +
            '<div class="user-form-help">Enter the first 4 characters of your user ID to fetch your saved stops and routes.</div>' +
            '<form class="user-form" id="userForm">' +
              '<input class="user-input" id="userIdInput" maxlength="8" placeholder="Example: 952C" value="' + escapeHtml(userId || '') + '" autocomplete="off" autocapitalize="characters" spellcheck="false"' + (isKioskMode ? ' readonly inputmode="none"' : '') + '>' +
              '<button class="user-submit" id="userSubmit" type="submit">' + (isSubmitting ? 'Loading...' : 'Load Departures') + '</button>' +
            '</form>' +
            '<div class="form-feedback" id="formFeedback">' + escapeHtml(feedback || '') + '</div>' +
            (isKioskMode ? '<div class="keyboard-caption">Touch keyboard docked below</div>' : '') +
          '</div>' +
        '</div>';

      const formEl = document.getElementById('userForm');
      const inputEl = document.getElementById('userIdInput');
      const submitEl = document.getElementById('userSubmit');

      submitEl.disabled = isSubmitting;

      if (isKioskMode) {
        showKeyboard(inputEl);
        inputEl.addEventListener('focus', () => showKeyboard(inputEl));
        inputEl.addEventListener('click', () => showKeyboard(inputEl));
      }

      formEl.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = inputEl.value.trim();

        if (!value) {
          renderUserForm('', 'Please enter a valid user ID.');
          return;
        }

        isSubmitting = true;
        renderUserForm(value, '');
        hideKeyboard();

        try {
          const response = await fetch('/api/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: value })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Unable to load user data');
          }

          lastUserId = value;
          lastText = '';
          skippedDepartureKeys = new Set();
          await updateDisplay();
        } catch (error) {
          renderUserForm(value, error.message || 'Unable to load user data');
        } finally {
          isSubmitting = false;
        }
      });
    }

    function renderEmptyState(text, userLabel) {
      setScreenMode('form');
      messageEl.innerHTML =
        buildHeader('STIB Waiting Times', userLabel) +
        '<div class="empty-state">' +
          '<div class="empty-card">' +
            '<div class="empty-title">' + escapeHtml(text) + '</div>' +
            '<div class="empty-help">No live matches were found for the saved stops and routes of this user.</div>' +
          '</div>' +
        '</div>';

      hideKeyboard();
    }

    function stopAutoScroll() {
      if (autoScrollInterval) {
        clearInterval(autoScrollInterval);
        autoScrollInterval = null;
      }
    }

    function startAutoScroll() {
      stopAutoScroll();

      const container = document.querySelector('.stop-groups');
      if (!container) {
        return;
      }

      const maxScrollTop = container.scrollHeight - container.clientHeight;
      if (maxScrollTop <= 4) {
        container.scrollTop = 0;
        return;
      }

      let direction = 1;
      let pauseTicks = 30;

      autoScrollInterval = setInterval(() => {
        if (pauseTicks > 0) {
          pauseTicks -= 1;
          return;
        }

        container.scrollTop += direction;

        if (container.scrollTop >= maxScrollTop) {
          container.scrollTop = maxScrollTop;
          direction = -1;
          pauseTicks = 45;
        } else if (container.scrollTop <= 0) {
          container.scrollTop = 0;
          direction = 1;
          pauseTicks = 30;
        }
      }, 35);
    }

    function renderMessage(data) {
      const normalizedText = normalizeDisplayText(data.text);
      const selectedUserId = String(data.selectedUserId || '').trim();
      const userLabel = String(data.userLabel || '').trim();
      const departures = Array.isArray(data.departures) ? data.departures : [];
      const scheduleEvents = data.scheduleEvents && typeof data.scheduleEvents === 'object' ? data.scheduleEvents : {};
      const scheduleArrivals = Object.values(scheduleEvents)
        .filter(Array.isArray)
        .flat()
        .filter(isConfirmedCalendarEvent)
        .filter(isFutureCalendarEvent)
        .sort((left, right) => {
          const leftTime = new Date(getEventStartValue(left)).getTime();
          const rightTime = new Date(getEventStartValue(right)).getTime();

          if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) {
            return 0;
          }

          if (Number.isNaN(leftTime)) {
            return 1;
          }

          if (Number.isNaN(rightTime)) {
            return -1;
          }

          return leftTime - rightTime;
        });
      const lines = normalizedText.split(NEWLINE).map((line) => line.trim()).filter(Boolean);
      const arrivals = scheduleArrivals.length
        ? scheduleArrivals
        : (departures.length ? departures : lines.map(parseArrivalLine).filter(Boolean));
      const hasScheduleArrivals = scheduleArrivals.length > 0;

      if (!selectedUserId) {
        stopAutoScroll();
        renderUserForm('', '');
        lastUserId = '';
        lastText = data.text || '';
        lastScheduleKey = JSON.stringify(data.scheduleEvents || {});
        return;
      }

      if ((!arrivals.length && !hasScheduleArrivals) ||
        (!hasScheduleArrivals && (normalizedText === 'No live departures right now' || normalizedText === 'Unable to load departures'))) {
        stopAutoScroll();
        renderEmptyState(normalizedText || 'No live departures right now', userLabel || selectedUserId.slice(0, 4));
        lastUserId = selectedUserId;
        lastText = data.text || '';
        lastScheduleKey = JSON.stringify(scheduleEvents || {});
        return;
      }

      let visibleArrivals = arrivals.filter((arrival) =>
        isFutureCalendarEvent(arrival) && !skippedDepartureKeys.has(getDepartureKey(arrival))
      );

      if (!visibleArrivals.length && !hasScheduleArrivals) {
        skippedDepartureKeys = new Set();
        visibleArrivals = arrivals;
      }

      if (!visibleArrivals.length) {
        stopAutoScroll();
        renderEmptyState('No more events right now', userLabel || selectedUserId.slice(0, 4));
        lastUserId = selectedUserId;
        lastText = data.text || '';
        lastScheduleKey = JSON.stringify(scheduleEvents || {});
        return;
      }

      setScreenMode('board');

      messageEl.innerHTML = buildDepartureDashboard(visibleArrivals, departures, hasScheduleArrivals);

      messageEl.style.color = '';
      hideKeyboard();
      stopAutoScroll();
      const skipButton = messageEl.querySelector('.skip-button');

      if (skipButton) {
        skipButton.addEventListener('click', () => {
          skippedDepartureKeys.add(getDepartureKey(visibleArrivals[0]));
          renderMessage(data);
        });
      }

      lastUserId = selectedUserId;
      lastText = data.text || '';
      lastScheduleKey = JSON.stringify(scheduleEvents || {});
    }

    async function updateDisplay() {
      try {
        const response = await fetch('/api/current', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        });

        if (!response.ok) throw new Error('HTTP ' + response.status);

        const data = await response.json();

        const scheduleKey = JSON.stringify(data.scheduleEvents || {});

        if (data.text !== lastText || String(data.selectedUserId || '') !== lastUserId || scheduleKey !== lastScheduleKey) {
          renderMessage(data);
        }

        statusEl.classList.add('connected');
        statusEl.classList.remove('disconnected');
        statusText.textContent = '✓ Connected';
      } catch (error) {
        console.error('Update error:', error);
        statusEl.classList.remove('connected');
        statusEl.classList.add('disconnected');
        statusText.textContent = '✗ Disconnected';
      }
    }

    renderKeyboard();
    updateDisplay();
    updateInterval = setInterval(updateDisplay, 1000);

    window.addEventListener('beforeunload', () => {
      clearInterval(updateInterval);
      stopAutoScroll();
      hideKeyboard();
    });

    document.addEventListener('mousemove', () => {
      document.body.style.cursor = 'none';
    });
  </script>
</body>
</html>`;
}

/**
 * Stops the HTTP server during process shutdown.
 */
async function cleanup() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        logger.info('Display server closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = { init, displayText, cleanup };
