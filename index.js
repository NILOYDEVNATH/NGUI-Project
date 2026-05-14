#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_ANON_KEY,
  supabaseDbKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  edgeFunctionKey: process.env.EDGE_FUNCTION_API_KEY ||
    process.env.SUPABASE_FUNCTION_KEY ||
    process.env.SB_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  routeApiUrl: process.env.ROUTE_API_URL,
  calendarSyncUrl: process.env.SYNC_GOOGLE_CALENDAR_URL,
  syncCalendarOnUserSelect: String(process.env.SYNC_CALENDAR_ON_USER_SELECT || '').toLowerCase() === 'true',
  displayType: (process.env.DISPLAY_TYPE || 'monitor').split(',').map((type) => type.trim()),
  displayPort: parseInt(process.env.DISPLAY_PORT, 10) || 8080,
  logFile: process.env.LOG_FILE || 'logs/display.log',
  logLevel: process.env.LOG_LEVEL || 'info'
};

const STIB_API_URL = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/rt/WaitingTimes';
const STIB_STOP_DETAILS_URL = 'https://api-management-discovery-production.azure-api.net/api/datasets/stibmivb/static/StopDetails';
const USER_TABLE = 'user';
const USER_PLACE_TAGS_TABLE = 'user_place_tags';
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
  let initializedCount = 0;

  for (const type of CONFIG.displayType) {
    try {
      if (type === 'monitor') {
        displayManager.monitor = require('./displays_monitor.js');
        await displayManager.monitor.init(CONFIG.displayPort, {
          onUserIdSubmit: handleUserSelection,
          getSelectedUserId: () => selectedUserId,
          mode: 'monitor'
        });
        logger.info('Monitor display initialized');
        initializedCount += 1;
      }

      if (type === 'kiosk') {
        displayManager.monitor = require('./displays_monitor.js');
        await displayManager.monitor.init(CONFIG.displayPort, {
          onUserIdSubmit: handleUserSelection,
          getSelectedUserId: () => selectedUserId,
          mode: 'kiosk'
        });
        logger.info('Kiosk display initialized');
        initializedCount += 1;
      }

      if (type === 'led') {
        displayManager.led = require('./displays_led.js');
        await displayManager.led.init();
        logger.info('LED display initialized');
        initializedCount += 1;
      }
    } catch (err) {
      logger.error(`Failed to initialize ${type} display:`, err.message);
    }
  }

  if (initializedCount === 0) {
    throw new Error('No display modules initialized successfully. Check port availability and display configuration.');
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

function getExpectedArrivalTime(passingTime) {
  return passingTime.expectedArrivalTime ||
    passingTime.expectedArrival ||
    passingTime.arrivalTime ||
    passingTime.scheduledArrivalTime ||
    passingTime.expectedDepartureTime ||
    passingTime.scheduledDepartureTime ||
    '';
}

function getEdgeFunctionUrl(functionName, configuredUrl) {
  if (configuredUrl) {
    return configuredUrl;
  }

  if (!CONFIG.supabaseUrl) {
    return '';
  }

  return `${CONFIG.supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`;
}

function getFirstValue(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row?.[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return fallback;
}

function normalizeRouteName(value) {
  return String(value || '').trim();
}

function getNumberValue(row, keys) {
  const value = getFirstValue(row, keys, '');
  const number = Number.parseFloat(value);

  return Number.isFinite(number) ? number : null;
}

function getBooleanValue(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function normalizeSelectionRow(row) {
  const stopId = getFirstValue(row, [
    'source_stop_id',
    'stop_id',
    'stib_stop_id',
    'station_id',
    'place_stop_id',
    'registered_stop_id',
    'nearest_stop_id',
    'pointid'
  ]);
  const routeShortName = getFirstValue(row, [
    'route_short_name',
    'route_name',
    'line',
    'line_id',
    'lineid',
    'route',
    'transport_name',
    'transport_line'
  ]);
  const eventTitle = getFirstValue(row, [
    'event_title',
    'event_name',
    'calendar_event_title',
    'calendar_title',
    'title',
    'name',
    'tag',
    'place_tag'
  ]);
  const eventLocation = getFirstValue(row, [
    'event_location',
    'calendar_location',
    'location',
    'place_name',
    'destination_name',
    'address',
    'registered_place'
  ]);
  const eventStartTime = getFirstValue(row, [
    'event_start_time',
    'start_time',
    'starts_at',
    'calendar_start',
    'start',
    'event_time'
  ]);
  const eventEndTime = getFirstValue(row, [
    'event_end_time',
    'end_time',
    'ends_at',
    'calendar_end',
    'end'
  ]);
  const calendarEventId = getFirstValue(row, [
    'calendar_event_id',
    'google_event_id',
    'event_id',
    'id'
  ]);
  const originLat = getNumberValue(row, ['originLat', 'origin_lat', 'source_latitude', 'source_lat']);
  const originLng = getNumberValue(row, ['originLng', 'origin_lng', 'source_longitude', 'source_lng']);
  const destLat = getNumberValue(row, ['destLat', 'dest_lat', 'destination_latitude', 'destination_lat', 'latitude']);
  const destLng = getNumberValue(row, ['destLng', 'dest_lng', 'destination_longitude', 'destination_lng', 'longitude']);

  return {
    userId: String(getFirstValue(row, ['user_id', 'userId', 'owner_id', 'profile_id']) || '').trim(),
    stopId: String(stopId || '').trim(),
    routeShortName: normalizeRouteName(routeShortName),
    eventTitle: String(eventTitle || '').trim(),
    eventLocation: String(eventLocation || '').trim(),
    eventStartTime: String(eventStartTime || '').trim(),
    eventEndTime: String(eventEndTime || '').trim(),
    calendarEventId: String(calendarEventId || '').trim(),
    originLat,
    originLng,
    destLat,
    destLng,
    tagKey: String(row?.tag_key || '').trim(),
    tagName: String(row?.tag_name || '').trim(),
    isRequired: getBooleanValue(row?.is_required),
    sortOrder: Number.parseInt(row?.sort_order, 10) || 0
  };
}

function hasRouteCoordinates(selection) {
  return Number.isFinite(selection.originLat) &&
    Number.isFinite(selection.originLng) &&
    Number.isFinite(selection.destLat) &&
    Number.isFinite(selection.destLng);
}

function buildPlaceTagSelections(rows, resolvedUserId) {
  const userRows = rows
    .filter((row) => String(getFirstValue(row, ['user_id', 'userId', 'owner_id', 'profile_id']) || '').trim() === resolvedUserId)
    .map(normalizeSelectionRow)
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const origin = userRows.find((row) => row.isRequired && Number.isFinite(row.destLat) && Number.isFinite(row.destLng)) ||
    userRows.find((row) => row.tagKey.toLowerCase() === 'home' && Number.isFinite(row.destLat) && Number.isFinite(row.destLng)) ||
    userRows.find((row) => Number.isFinite(row.destLat) && Number.isFinite(row.destLng));

  if (!origin) {
    return [];
  }

  const destinations = userRows.filter((row) =>
    row !== origin &&
    !row.isRequired &&
    Number.isFinite(row.destLat) &&
    Number.isFinite(row.destLng)
  );

  return destinations.map((destination) => ({
    ...destination,
    originLat: origin.destLat,
    originLng: origin.destLng,
    destLat: destination.destLat,
    destLng: destination.destLng,
    eventTitle: destination.eventTitle || destination.tagName || destination.tagKey || 'Calendar Event',
    eventLocation: destination.eventLocation || destination.tagName || destination.tagKey || destination.calendarEventId,
    originLabel: origin.eventTitle || origin.tagName || origin.tagKey || 'Origin'
  }));
}

function isUpcomingSelection(selection) {
  if (!selection.eventEndTime && !selection.eventStartTime) {
    return true;
  }

  const endTime = new Date(selection.eventEndTime || selection.eventStartTime);

  if (Number.isNaN(endTime.getTime())) {
    return true;
  }

  return endTime.getTime() >= Date.now();
}

async function maybeSyncCalendar(userId) {
  if (!CONFIG.syncCalendarOnUserSelect) {
    return;
  }

  const syncUrl = getEdgeFunctionUrl('sync-google-calendar', CONFIG.calendarSyncUrl);

  if (!syncUrl || !CONFIG.edgeFunctionKey) {
    logger.warn('Calendar sync skipped because sync URL or Edge Function key is missing');
    return;
  }

  const response = await fetch(syncUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: CONFIG.edgeFunctionKey,
      Authorization: `Bearer ${CONFIG.edgeFunctionKey}`
    },
    body: JSON.stringify({ userId })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    logger.warn('Calendar sync failed', `${response.status} ${errorText.slice(0, 200)}`);
  }
}

async function fetchRowsByUserPrefix(tableName, normalizedUserId) {
  let query = supabase
    .from(tableName)
    .select('*');

  let { data, error } = await query.order('updated_at', { ascending: false });

  if (error && String(error.message || '').toLowerCase().includes('updated_at')) {
    ({ data, error } = await supabase
      .from(tableName)
      .select('*'));
  }

  if (error) {
    logger.warn(`Unable to read ${tableName}`, error.message);
    return [];
  }

  return (data || []).filter((row) =>
    String(getFirstValue(row, ['user_id', 'userId', 'owner_id', 'profile_id']) || '')
      .toLowerCase()
      .startsWith(normalizedUserId)
  );
}

function normalizeRouteApiResult(payload, baseSelection) {
  const result = payload?.result || payload?.data || payload?.route || payload?.routes?.[0] || payload;

  if (!result || typeof result !== 'object') {
    return baseSelection;
  }

  const directDeparture = normalizeRouteApiDeparture(payload, baseSelection);

  return {
    ...baseSelection,
    ...directDeparture,
    stopId: baseSelection.stopId || String(getFirstValue(result, [
      'source_stop_id',
      'stop_id',
      'stib_stop_id',
      'station_id',
      'registered_stop_id',
      'nearest_stop_id',
      'pointid'
    ]) || '').trim(),
    routeShortName: baseSelection.routeShortName || normalizeRouteName(getFirstValue(result, [
      'route_short_name',
      'route_name',
      'line',
      'line_id',
      'lineid',
      'route',
      'transport_name',
      'transport_line'
    ])),
    eventTitle: baseSelection.eventTitle || String(getFirstValue(result, [
      'event_title',
      'event_name',
      'title',
      'name'
    ]) || '').trim(),
    eventLocation: baseSelection.eventLocation || String(getFirstValue(result, [
      'event_location',
      'location',
      'place_name',
      'destination_name',
      'address'
    ]) || '').trim()
  };
}

function getRouteSeconds(route) {
  const durationSeconds = Number.parseInt(route?.durationSeconds ?? route?.duration_seconds, 10);

  if (Number.isFinite(durationSeconds)) {
    return durationSeconds;
  }

  const durationMatch = String(route?.duration || '').match(/(\d+)s/);
  return durationMatch ? Number.parseInt(durationMatch[1], 10) : null;
}

function getMinutesFromSeconds(seconds) {
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds / 60)) : null;
}

function pickBestRouteApiRoute(payload) {
  const routes = Array.isArray(payload?.routes) ? payload.routes : [];

  if (!routes.length) {
    return payload;
  }

  const transitRoutes = routes.filter((route) => route.isTransitRoute || (route.lineSummaries || []).length);
  const candidates = transitRoutes.length ? transitRoutes : routes;

  return candidates
    .slice()
    .sort((left, right) => (getRouteSeconds(left) || Infinity) - (getRouteSeconds(right) || Infinity))[0];
}

function getFirstTransitSummary(route) {
  const lineSummaries = Array.isArray(route?.lineSummaries) ? route.lineSummaries : [];

  if (lineSummaries.length) {
    return lineSummaries[0];
  }

  const transitStep = (route?.steps || []).find((step) => step?.transitDetails);
  const details = transitStep?.transitDetails;

  if (!details) {
    return null;
  }

  return {
    vehicleType: details.transitLine?.vehicleType || route.primaryTransitVehicle || '',
    lineName: details.transitLine?.nameShort || details.transitLine?.name || '',
    headsign: details.headsign || '',
    departureTime: details.departureTime || details.stopDetails?.departureTime || '',
    arrivalTime: details.arrivalTime || details.stopDetails?.arrivalTime || '',
    departureStop: details.departureStop?.name || details.stopDetails?.departureStop?.name || ''
  };
}

function normalizeVehicleLabel(summary, route) {
  const vehicleType = String(summary?.vehicleType || route?.primaryTransitVehicle || 'Transport')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
  const lineName = String(summary?.lineName || '').trim();

  return lineName ? `${vehicleType} ${lineName}` : vehicleType;
}

function normalizeRouteApiDeparture(payload, baseSelection) {
  const route = pickBestRouteApiRoute(payload);

  if (!route || typeof route !== 'object') {
    return {};
  }

  const summary = getFirstTransitSummary(route);
  const departureTime = summary?.departureTime || route.departureTime || '';
  const routeSeconds = getRouteSeconds(route);
  const departureMinutes = departureTime ? getMinutesUntil(departureTime) : null;
  const minutes = departureMinutes !== null ? departureMinutes : getMinutesFromSeconds(routeSeconds);
  const arrivalLabel = departureTime
    ? formatArrivalLabel(departureTime, minutes)
    : formatArrivalLabel('', minutes);

  if (minutes === null) {
    return {};
  }

  return {
    directRoute: true,
    line: String(summary?.lineName || '').trim(),
    routeShortName: String(summary?.lineName || '').trim(),
    transportName: normalizeVehicleLabel(summary, route),
    destination: String(summary?.headsign || baseSelection.eventTitle || baseSelection.eventLocation || '').trim(),
    minutes,
    arrivalLabel,
    stopLabel: String(summary?.departureStop || baseSelection.originLabel || '').trim(),
    routeDurationMinutes: getMinutesFromSeconds(routeSeconds),
    routeDistanceLabel: route.localizedDistance || payload.localizedDistance || '',
    eventTitle: baseSelection.eventTitle,
    eventLocation: baseSelection.eventLocation
  };
}

function normalizeRouteApiSelections(payload) {
  const results = payload?.results ||
    payload?.selections ||
    payload?.departures ||
    payload?.routes ||
    payload?.data ||
    payload?.result ||
    [];
  const rows = Array.isArray(results) ? results : [results];

  return rows
    .filter((row) => row && typeof row === 'object')
    .map(normalizeSelectionRow);
}

async function fetchSelectionsFromRouteApi(userId) {
  const routeApiUrl = getEdgeFunctionUrl('route-api', CONFIG.routeApiUrl);

  if (!routeApiUrl || !CONFIG.edgeFunctionKey) {
    return [];
  }

  try {
    const response = await fetch(routeApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: CONFIG.edgeFunctionKey,
        Authorization: `Bearer ${CONFIG.edgeFunctionKey}`
      },
      body: JSON.stringify({ userId })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.warn('Route API user lookup failed', `${response.status} ${errorText.slice(0, 200)}`);
      return [];
    }

    return normalizeRouteApiSelections(await response.json());
  } catch (error) {
    logger.warn('Route API user lookup error', error.message);
    return [];
  }
}

async function enrichSelectionWithRouteApi(selection, userId) {
  if (selection.stopId && selection.routeShortName) {
    return selection;
  }

  const routeApiUrl = getEdgeFunctionUrl('route-api', CONFIG.routeApiUrl);

  if (!routeApiUrl || !CONFIG.edgeFunctionKey) {
    return selection;
  }

  try {
    const response = await fetch(routeApiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: CONFIG.edgeFunctionKey,
        Authorization: `Bearer ${CONFIG.edgeFunctionKey}`
      },
      body: JSON.stringify({
        userId,
        eventTitle: selection.eventTitle,
        eventLocation: selection.eventLocation,
        eventStartTime: selection.eventStartTime,
        eventEndTime: selection.eventEndTime,
        calendarEventId: selection.calendarEventId,
        originLat: selection.originLat,
        originLng: selection.originLng,
        destLat: selection.destLat,
        destLng: selection.destLng,
        travelMode: hasRouteCoordinates(selection) ? 'TRANSIT' : undefined
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.warn('Route API enrichment failed', `${response.status} ${errorText.slice(0, 200)}`);
      return selection;
    }

    return normalizeRouteApiResult(await response.json(), selection);
  } catch (error) {
    logger.warn('Route API enrichment error', error.message);
    return selection;
  }
}

async function fetchUserSelections(userId) {
  const normalizedUserId = normalizeUserId(userId).toLowerCase();

  if (!normalizedUserId) {
    return {
      resolvedUserId: '',
      selections: []
    };
  }

  await maybeSyncCalendar(normalizedUserId);

  const placeTagRows = await fetchRowsByUserPrefix(USER_PLACE_TAGS_TABLE, normalizedUserId);
  const userRows = await fetchRowsByUserPrefix(USER_TABLE, normalizedUserId);
  const sourceRows = placeTagRows.length ? placeTagRows : userRows;
  const apiSelections = sourceRows.length ? [] : await fetchSelectionsFromRouteApi(normalizedUserId);
  const matchingUserIds = [...new Set(sourceRows
    .map((row) => String(getFirstValue(row, ['user_id', 'userId', 'owner_id', 'profile_id']) || '').trim())
    .filter(Boolean))];
  const resolvedRouteApiUserId = sourceRows.length ? '' : normalizedUserId;

  if (matchingUserIds.length === 0 && apiSelections.length === 0) {
    return {
      resolvedUserId: '',
      selections: []
    };
  }

  if (matchingUserIds.length > 1) {
    throw new Error('Multiple users match this prefix. Enter more than 4 characters.');
  }

  const resolvedUser = matchingUserIds[0] || resolvedRouteApiUserId;
  const selections = placeTagRows.length
    ? buildPlaceTagSelections(placeTagRows, resolvedUser)
    : (sourceRows.length ? sourceRows.map(normalizeSelectionRow) : apiSelections);

  return {
    resolvedUserId: resolvedUser,
    selections: (await Promise.all(selections
      .filter(isUpcomingSelection)
      .map((selection) => enrichSelectionWithRouteApi(selection, resolvedUser))))
      .filter((row) => row.directRoute || (row.stopId && row.routeShortName))
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

function formatArrivalLabel(expectedArrivalTime, fallbackMinutes = null) {
  const arrival = new Date(expectedArrivalTime);

  if (!Number.isNaN(arrival.getTime())) {
    return arrival.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  if (Number.isFinite(fallbackMinutes)) {
    const fallbackArrival = new Date(Date.now() + (fallbackMinutes * 60000));
    return fallbackArrival.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  return '--:--:--';
}

function extractDeparturesForStop(stopId, payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const departures = [];

  for (const result of results) {
    const passingTimes = parseJsonMaybe(result.passingtimes, []);

    for (const passingTime of passingTimes) {
      const expectedArrivalTime = getExpectedArrivalTime(passingTime);
      const minutes = getMinutesUntil(expectedArrivalTime);
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
        arrivalLabel: formatArrivalLabel(expectedArrivalTime, minutes)
      });
    }
  }

  return departures;
}

async function fetchDeparturesForUser(userId) {
  const userSelection = await fetchUserSelections(userId);
  const selections = userSelection.selections;
  const directDepartures = selections
    .filter((selection) => selection.directRoute)
    .map((selection) => ({
      stopId: selection.stopId || '',
      line: selection.line || selection.routeShortName || '',
      destination: selection.destination || selection.eventTitle || selection.eventLocation || '',
      minutes: selection.minutes,
      arrivalLabel: selection.arrivalLabel,
      stopLabel: selection.stopLabel || selection.originLabel || '',
      transportName: selection.transportName,
      routeDurationMinutes: selection.routeDurationMinutes,
      routeDistanceLabel: selection.routeDistanceLabel,
      eventTitle: selection.eventTitle,
      eventLocation: selection.eventLocation,
      eventStartTime: selection.eventStartTime,
      eventEndTime: selection.eventEndTime,
      calendarEventId: selection.calendarEventId
    }))
    .filter((departure) => Number.isFinite(departure.minutes));
  const stibSelections = selections.filter((selection) => !selection.directRoute && selection.stopId && selection.routeShortName);

  if (selections.length === 0) {
    return {
      resolvedUserId: userSelection.resolvedUserId,
      departures: []
    };
  }

  if (stibSelections.length === 0) {
    directDepartures.sort((left, right) => left.minutes - right.minutes);
    return {
      resolvedUserId: userSelection.resolvedUserId,
      departures: directDepartures.slice(0, MAX_DISPLAYED_DEPARTURES)
    };
  }

  const allowedByStop = new Map();

  for (const selection of stibSelections) {
    if (!allowedByStop.has(selection.stopId)) {
      allowedByStop.set(selection.stopId, new Map());
    }

    allowedByStop.get(selection.stopId).set(selection.routeShortName, selection);
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
      const selection = allowedRoutes.get(departure.line);

      if (selection) {
        matchedDepartures.push({
          ...departure,
          eventTitle: selection.eventTitle,
          eventLocation: selection.eventLocation,
          eventStartTime: selection.eventStartTime,
          eventEndTime: selection.eventEndTime,
          calendarEventId: selection.calendarEventId
        });
      }
    }
  }

  matchedDepartures.sort((left, right) => left.minutes - right.minutes);
  const departures = directDepartures.concat(matchedDepartures);
  departures.sort((left, right) => left.minutes - right.minutes);

  return {
    resolvedUserId: userSelection.resolvedUserId,
    departures: departures.slice(0, MAX_DISPLAYED_DEPARTURES).map((departure) => ({
      ...departure,
      stopLabel: departure.stopLabel || stopNameMap.get(departure.stopId) || `Stop ${departure.stopId}`
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

    supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseDbKey);
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
