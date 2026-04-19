#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_ANON_KEY,
  displayType: (process.env.DISPLAY_TYPE || 'monitor').split(',').map((type) => type.trim()),
  displayPort: parseInt(process.env.DISPLAY_PORT, 10) || 8080,
  logFile: process.env.LOG_FILE || 'logs/display.log',
  logLevel: process.env.LOG_LEVEL || 'info'
};

const STIB_API_URL = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/rt/WaitingTimes';
const STIB_STOP_DETAILS_URL = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/static/StopDetails';
const USER_TABLE = 'user';
const POLL_INTERVAL_MS = 20_000;
const MAX_DISPLAYED_DEPARTURES = 3;

const logsDir = path.dirname(CONFIG.logFile);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

class Logger {
  log(level, message, data = '') {
    const timestamp = new Date().toISOString();
    const suffix = data ? ` ${data}` : '';
    const logLine = `[${timestamp}] ${level}: ${message}${suffix}`;

    console.log(logLine);

    try {
      fs.appendFileSync(CONFIG.logFile, `${logLine}\n`);
    } catch (err) {
      console.error('Failed to write to log file:', err.message);
    }
  }

  info(msg, data) { this.log('INFO', msg, data); }
  warn(msg, data) { this.log('WARN', msg, data); }
  error(msg, data) { this.log('ERROR', msg, data); }
  debug(msg, data) { if (CONFIG.logLevel === 'debug') this.log('DEBUG', msg, data); }
}

const logger = new Logger();
const displayManager = {};

let supabase;
let pollInterval;
let isPolling = false;
let lastDisplayedText = '';
let selectedUserId = '';
let resolvedUserId = '';
const stopNameCache = new Map();

async function initializeDisplay() {
  logger.info('Initializing display modules...');

  for (const type of CONFIG.displayType) {
    try {
      if (type === 'monitor') {
        displayManager.monitor = require('./displays_monitor.js');
        await displayManager.monitor.init(CONFIG.displayPort, {
          onUserIdSubmit: handleUserSelection,
          getSelectedUserId: () => selectedUserId
        });
        logger.info('Monitor display initialized');
      }

      if (type === 'led') {
        displayManager.led = require('./displays_led.js');
        await displayManager.led.init();
        logger.info('LED display initialized');
      }
    } catch (err) {
      logger.error(`Failed to initialize ${type} display:`, err.message);
    }
  }
}

function normalizeUserId(value) {
  return String(value || '').trim();
}

function getUserLabel(userId) {
  return normalizeUserId(userId).slice(0, 4);
}

function parseJsonMaybe(value, fallback = []) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getDestinationLabel(destination) {
  if (typeof destination === 'string' && destination.trim()) {
    return destination.trim();
  }

  if (!destination || typeof destination !== 'object') {
    return 'Unknown destination';
  }

  return destination.en || destination.fr || destination.nl || 'Unknown destination';
}

function getMinutesUntil(expectedArrivalTime) {
  const arrival = new Date(expectedArrivalTime);

  if (Number.isNaN(arrival.getTime())) {
    return null;
  }

  const diffMs = arrival.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 60000));
}

async function fetchUserSelections(userId) {
  const normalizedUserId = normalizeUserId(userId).toLowerCase();

  if (!normalizedUserId) {
    return {
      resolvedUserId: '',
      selections: []
    };
  }

  const { data, error } = await supabase
    .from(USER_TABLE)
    .select('user_id, source_stop_id, route_short_name')
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data || []).filter((row) =>
    String(row.user_id || '').toLowerCase().startsWith(normalizedUserId)
  );
  const matchingUserIds = [...new Set(rows.map((row) => String(row.user_id || '').trim()).filter(Boolean))];

  if (matchingUserIds.length === 0) {
    return {
      resolvedUserId: '',
      selections: []
    };
  }

  if (matchingUserIds.length > 1) {
    throw new Error('Multiple users match this prefix. Enter more than 4 characters.');
  }

  return {
    resolvedUserId: matchingUserIds[0],
    selections: rows
    .map((row) => ({
      stopId: String(row.source_stop_id || '').trim(),
      routeShortName: String(row.route_short_name || '').trim()
    }))
    .filter((row) => row.stopId && row.routeShortName)
  };
}

async function fetchWaitingTimesForStop(stopId) {
  const url = new URL(STIB_API_URL);
  url.searchParams.set('where', `pointid=${stopId}`);
  url.searchParams.set('limit', '20');

  logger.debug('Fetching STIB waiting times', url.toString());

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`STIB API returned ${response.status} for stop ${stopId}`);
  }

  return response.json();
}

function getStopNameLabel(name) {
  if (typeof name === 'string') {
    const parsed = parseJsonMaybe(name, null);
    if (parsed && typeof parsed === 'object') {
      return parsed.fr || parsed.en || parsed.nl || 'Unknown stop';
    }

    return name.trim() || 'Unknown stop';
  }

  if (!name || typeof name !== 'object') {
    return 'Unknown stop';
  }

  return name.fr || name.en || name.nl || 'Unknown stop';
}

async function fetchStopName(stopId) {
  if (stopNameCache.has(stopId)) {
    return stopNameCache.get(stopId);
  }

  const url = new URL(STIB_STOP_DETAILS_URL);
  url.searchParams.set('where', `id=${stopId}`);
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`STIB StopDetails returned ${response.status} for stop ${stopId}`);
  }

  const payload = await response.json();
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  const stopName = getStopNameLabel(result?.name);

  stopNameCache.set(stopId, stopName);
  return stopName;
}

function isBlockedDeparture(destination, message) {
  const normalizedDestination = String(destination || '').trim().toUpperCase();
  const messageValues = message && typeof message === 'object'
    ? Object.values(message).map((value) => String(value || '').trim().toLowerCase())
    : [];

  if (!normalizedDestination || normalizedDestination === 'UNKNOWN DESTINATION') {
    return true;
  }

  if (normalizedDestination === 'RESERVE' || normalizedDestination === 'GEEN DIENST') {
    return true;
  }

  return messageValues.some((value) => (
    value.includes('last departure') ||
    value.includes('dernier passage') ||
    value.includes('laatste vertrek') ||
    value.includes('end of service') ||
    value.includes('service terminé') ||
    value.includes('einde dienst') ||
    value.includes('do not embark') ||
    value.includes('ne pas embarquer') ||
    value.includes('niet instappen')
  ));
}

function formatArrivalLabel(expectedArrivalTime) {
  const arrival = new Date(expectedArrivalTime);

  if (Number.isNaN(arrival.getTime())) {
    return '--:--:--';
  }

  return arrival.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function extractDeparturesForStop(stopId, payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const departures = [];

  for (const result of results) {
    const passingTimes = parseJsonMaybe(result.passingtimes, []);

    for (const passingTime of passingTimes) {
      const minutes = getMinutesUntil(passingTime.expectedArrivalTime);
      const destination = getDestinationLabel(passingTime.destination);

      if (minutes === null) {
        continue;
      }

      if (isBlockedDeparture(destination, passingTime.message)) {
        continue;
      }

      departures.push({
        stopId,
        line: String(result.lineid || passingTime.lineId || '').trim(),
        destination,
        minutes,
        arrivalLabel: formatArrivalLabel(passingTime.expectedArrivalTime)
      });
    }
  }

  return departures;
}

async function fetchDeparturesForUser(userId) {
  const userSelection = await fetchUserSelections(userId);
  const selections = userSelection.selections;

  if (selections.length === 0) {
    return {
      resolvedUserId: userSelection.resolvedUserId,
      departures: []
    };
  }

  const allowedByStop = new Map();

  for (const selection of selections) {
    if (!allowedByStop.has(selection.stopId)) {
      allowedByStop.set(selection.stopId, new Set());
    }

    allowedByStop.get(selection.stopId).add(selection.routeShortName);
  }

  const stopIds = [...allowedByStop.keys()];
  const payloads = await Promise.all(stopIds.map((stopId) => fetchWaitingTimesForStop(stopId)));
  const stopNames = await Promise.all(
    stopIds.map(async (stopId) => [stopId, await fetchStopName(stopId)])
  );
  const stopNameMap = new Map(stopNames);

  const matchedDepartures = [];

  for (let index = 0; index < stopIds.length; index += 1) {
    const stopId = stopIds[index];
    const allowedRoutes = allowedByStop.get(stopId);
    const departures = extractDeparturesForStop(stopId, payloads[index]);

    for (const departure of departures) {
      if (allowedRoutes.has(departure.line)) {
        matchedDepartures.push(departure);
      }
    }
  }

  matchedDepartures.sort((left, right) => left.minutes - right.minutes);
  return {
    resolvedUserId: userSelection.resolvedUserId,
    departures: matchedDepartures.slice(0, MAX_DISPLAYED_DEPARTURES).map((departure) => ({
      ...departure,
      stopLabel: stopNameMap.get(departure.stopId) || `Stop ${departure.stopId}`
    }))
  };
}

function formatDepartureText(departures, userId) {
  if (!normalizeUserId(userId)) {
    return 'Enter your user ID to load departures';
  }

  if (!departures || departures.length === 0) {
    return 'No live departures right now';
  }

  return departures
    .map((departure) => `${departure.line} → ${departure.destination} → ${departure.minutes} min`)
    .join('\n');
}

async function updateMonitorText(text, options = {}) {
  if (!displayManager.monitor) {
    logger.warn('Monitor display is not initialized');
    return;
  }

  if (text === lastDisplayedText) {
    logger.debug('Display text unchanged');
    return;
  }

  await displayManager.monitor.displayText(text, {
    color: '#FFFFFF',
    timestamp: new Date().toISOString(),
    departures: options.departures || [],
    userLabel: options.userLabel || getUserLabel(resolvedUserId || selectedUserId)
  });

  lastDisplayedText = text;
  logger.info('Updated monitor text', text);
}

async function pollWaitingTimes() {
  if (isPolling) {
    logger.warn('Previous polling cycle still running, skipping this tick');
    return;
  }

  isPolling = true;

  try {
    if (!normalizeUserId(selectedUserId)) {
      await updateMonitorText(formatDepartureText([], ''), {
        departures: [],
        userLabel: ''
      });
      return;
    }

    const result = await fetchDeparturesForUser(selectedUserId);
    resolvedUserId = result.resolvedUserId || '';
    await updateMonitorText(formatDepartureText(result.departures, selectedUserId), {
      departures: result.departures,
      userLabel: getUserLabel(resolvedUserId || selectedUserId)
    });
  } catch (error) {
    logger.error('Failed to fetch waiting times:', error.message);
    await updateMonitorText('Unable to load departures', {
      departures: [],
      userLabel: getUserLabel(resolvedUserId || selectedUserId)
    });
  } finally {
    isPolling = false;
  }
}

async function handleUserSelection(userId) {
  const normalizedUserId = normalizeUserId(userId).toLowerCase();
  selectedUserId = normalizedUserId;
  resolvedUserId = '';
  lastDisplayedText = '';

  logger.info('Selected user ID', normalizedUserId || '(empty)');

  await pollWaitingTimes();
}

async function main() {
  try {
    logger.info('Starting user-based STIB waiting-time display system');
    logger.info(`Display type: ${CONFIG.displayType.join(', ')}`);

    if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
    }

    supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    logger.info('Supabase client initialized');

    await initializeDisplay();
    await updateMonitorText(formatDepartureText([], ''), {
      departures: [],
      userLabel: ''
    });

    pollInterval = setInterval(() => {
      pollWaitingTimes();
    }, POLL_INTERVAL_MS);

    logger.info(`Polling STIB API every ${POLL_INTERVAL_MS / 1000} seconds`);
  } catch (error) {
    logger.error('Fatal error:', error.message);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');

  clearInterval(pollInterval);

  try {
    if (displayManager.monitor?.cleanup) {
      await displayManager.monitor.cleanup();
    }

    if (displayManager.led?.cleanup) {
      await displayManager.led.cleanup();
    }

    logger.info('Cleanup complete');
  } catch (err) {
    logger.error('Error during shutdown:', err.message);
  }

  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason instanceof Error ? reason.message : String(reason));
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error.message);
  process.exit(1);
});

main();
