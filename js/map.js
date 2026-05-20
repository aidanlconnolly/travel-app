// Google Maps JS API integration.
// Reads the Maps API key from <meta name="google-maps-key"> on the page.
// Falls back to a placeholder when no key is present.

let map = null;
let markers = [];
let polyline = null;
let infoWindow = null;
let vibeColor = '#2563eb';
let geocoder = null;
const geocodeCache = new Map();

const CATEGORY_COLORS = {
  food: '#f59e0b',
  culture: '#8b5cf6',
  adventure: '#f97316',
  leisure: '#10b981',
  transport: '#6b7280',
};

/** @returns {string|null} */
function getMapsKey() {
  return document.querySelector('meta[name="google-maps-key"]')?.content || null;
}

/**
 * Load the Google Maps JS API script dynamically.
 * @returns {Promise<void>}
 */
function loadMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Initialize the map inside #map. If no API key, show placeholder.
 * @param {string} color — vibe accent color
 */
export async function initMap(color) {
  vibeColor = color || vibeColor;
  const container = document.getElementById('map');
  if (!container) return;

  const apiKey = getMapsKey();
  if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY') {
    showMapPlaceholder(container);
    return;
  }

  try {
    await loadMapsScript(apiKey);
    map = new google.maps.Map(container, {
      zoom: 12,
      center: { lat: 48.8566, lng: 2.3522 }, // default Paris; will be overridden
      styles: getMapStyle(),
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    infoWindow = new google.maps.InfoWindow();
    geocoder = new google.maps.Geocoder();
    container.querySelector('.map-placeholder')?.remove();
  } catch (err) {
    console.warn('Google Maps failed to load:', err);
    showMapPlaceholder(container);
  }
}

function showMapPlaceholder(container) {
  container.innerHTML = `
    <div class="map-placeholder">
      <span style="font-size:2rem">🗺️</span>
      <p>Add a Google Maps API key to see the interactive map</p>
    </div>`;
}

/**
 * Geocode an activity's location string to lat/lng using the JS Maps Geocoder.
 * Caches results, biases search by the destination, and stores the result on
 * activity._latLng so subsequent renders skip the lookup.
 */
function geocodeOne(activity, destination) {
  if (activity._latLng) return Promise.resolve(activity._latLng);
  const query = `${activity.location || activity.title}, ${destination}`;
  if (geocodeCache.has(query)) {
    activity._latLng = geocodeCache.get(query);
    return Promise.resolve(activity._latLng);
  }
  return new Promise(resolve => {
    geocoder.geocode({ address: query }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        const latLng = { lat: loc.lat(), lng: loc.lng() };
        geocodeCache.set(query, latLng);
        activity._latLng = latLng;
        resolve(latLng);
      } else {
        resolve(null);
      }
    });
  });
}

/**
 * Render numbered pins for all activities and draw a route polyline.
 * Geocodes any activity without a cached lat/lng, then draws pins as they resolve.
 * @param {Array} activities — flat list of activity objects with .location
 * @param {Function} onMarkerClick — called with activity id when a pin is clicked
 * @param {string} destination — used to bias geocoding (e.g. "Santorini, Greece")
 */
export async function renderMarkers(activities, onMarkerClick, destination = '') {
  if (!map || !geocoder) return;
  clearMap();

  // Kick off geocoding in parallel, with a small concurrency cap to avoid rate limits.
  const CONCURRENCY = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < activities.length) {
      const idx = cursor++;
      await geocodeOne(activities[idx], destination);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, activities.length) }, worker));

  const bounds = new google.maps.LatLngBounds();
  const path = [];

  activities.forEach((activity, index) => {
    if (!activity._latLng) return;

    const position = activity._latLng;
    bounds.extend(position);
    path.push(position);

    const marker = new google.maps.Marker({
      position,
      map,
      label: {
        text: String(index + 1),
        color: '#fff',
        fontSize: '11px',
        fontWeight: 'bold',
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 16,
        fillColor: CATEGORY_COLORS[activity.category] || vibeColor,
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
      title: activity.title,
    });

    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="font-family:system-ui;padding:4px;max-width:200px">
          <strong>${activity.title}</strong>
          <p style="font-size:12px;margin:4px 0;color:#555">${activity.location}</p>
          <p style="font-size:12px;color:#555">${activity.time} · ${activity.duration_minutes}min</p>
        </div>`);
      infoWindow.open(map, marker);
      onMarkerClick?.(activity.id);
    });

    markers.push(marker);
  });

  if (path.length > 1) {
    polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: vibeColor,
      strokeOpacity: 0.5,
      strokeWeight: 2,
      map,
    });
  }

  if (!bounds.isEmpty()) map.fitBounds(bounds);
}

/** Pan to and highlight a specific marker by activity id */
export function focusActivity(activityId) {
  if (!map) return;
  const idx = markers.findIndex(m => m.get('activityId') === activityId);
  if (idx === -1) return;
  map.panTo(markers[idx].getPosition());
  map.setZoom(15);
}

export function clearMap() {
  markers.forEach(m => m.setMap(null));
  markers = [];
  polyline?.setMap(null);
  polyline = null;
  infoWindow?.close();
}

function getMapStyle() {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (!dark) return [];
  // Minimal dark style
  return [
    { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1e293b' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#334155' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  ];
}
