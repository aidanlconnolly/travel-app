// All localStorage persistence lives here. Nothing else touches localStorage directly.

const TRIPS_KEY = 'travel_app_trips';
const PREFS_KEY = 'travel_app_prefs';

/** @returns {Object.<string, Trip>} */
export function loadTrips() {
  try {
    return JSON.parse(localStorage.getItem(TRIPS_KEY) || '{}');
  } catch {
    return {};
  }
}

/** @param {Trip} trip */
export function saveTrip(trip) {
  const trips = loadTrips();
  trips[trip.id] = { ...trip, updatedAt: Date.now() };
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
}

/** @param {string} id */
export function loadTrip(id) {
  return loadTrips()[id] || null;
}

/** @param {string} id */
export function deleteTrip(id) {
  const trips = loadTrips();
  delete trips[id];
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
}

/** @param {string} id @returns {Trip} */
export function duplicateTrip(id) {
  const trip = loadTrip(id);
  if (!trip) return null;
  const copy = {
    ...trip,
    id: crypto.randomUUID(),
    name: `${trip.name} (copy)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveTrip(copy);
  return copy;
}

/** @param {string} tripId @param {object} itinerary */
export function saveItinerary(tripId, itinerary) {
  const trip = loadTrip(tripId);
  if (!trip) return;
  saveTrip({ ...trip, itinerary });
}

/** Persist packing checkbox states per trip */
export function savePackingState(tripId, packed) {
  const trip = loadTrip(tripId);
  if (!trip) return;
  saveTrip({ ...trip, packed });
}

/** Persist per-activity ratings per trip */
export function saveRatings(tripId, ratings) {
  const trip = loadTrip(tripId);
  if (!trip) return;
  saveTrip({ ...trip, ratings });
}

/** Persist per-activity cost overrides per trip */
export function saveCostOverrides(tripId, overrides) {
  const trip = loadTrip(tripId);
  if (!trip) return;
  saveTrip({ ...trip, costOverrides: overrides });
}

// ── Prefs (theme, API key session flag) ──────────────────

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePref(key, value) {
  const prefs = loadPrefs();
  prefs[key] = value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/** API key is stored in sessionStorage only — never persisted to disk */
export function getApiKey() {
  return sessionStorage.getItem('anthropic_key') || '';
}

export function setApiKey(key) {
  sessionStorage.setItem('anthropic_key', key.trim());
}

export function hasApiKey() {
  return Boolean(getApiKey());
}

/**
 * @typedef {Object} Trip
 * @property {string} id
 * @property {string} name
 * @property {string} destination
 * @property {string} startDate       ISO date string
 * @property {string} endDate         ISO date string
 * @property {number} travelers
 * @property {string} vibe            adventure | relaxation | culture | foodie
 * @property {string} [notes]
 * @property {number} [budget]
 * @property {object} [itinerary]     parsed Claude JSON response
 * @property {object} [packed]        { categoryName: { itemText: boolean } }
 * @property {object} [ratings]       { activityId: number }
 * @property {object} [costOverrides] { activityId: number }
 * @property {number} createdAt
 * @property {number} updatedAt
 */
