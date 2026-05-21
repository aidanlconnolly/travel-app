// Google Maps JS API integration.
// Reads the Maps API key from <meta name="google-maps-key"> on the page.
// Activity lat/lng come from Claude directly (see api.js prompt) — no Geocoding API needed.

let map = null;
let markers = [];
let polyline = null;
let infoWindow = null;
let vibeColor = '#2563eb';

const CATEGORY_COLORS = {
  food: '#f59e0b',
  culture: '#8b5cf6',
  adventure: '#f97316',
  leisure: '#10b981',
  transport: '#6b7280',
};

function formatTime(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return hhmm || '';
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  if (isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mm} ${period}`;
}

function getMapsKey() {
  return document.querySelector('meta[name="google-maps-key"]')?.content || null;
}

function loadMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
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
      zoom: 2,
      center: { lat: 20, lng: 0 },
      styles: getMapStyle(),
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    infoWindow = new google.maps.InfoWindow();
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
 * Render numbered pins for activities using lat/lng provided by Claude.
 * Activities without valid lat/lng are skipped silently.
 * @param {Array} activities — flat list of activities with .lat and .lng
 * @param {Function} onMarkerClick — called with activity id when a pin is clicked
 */
export function renderMarkers(activities, onMarkerClick) {
  if (!map) return;
  clearMap();

  const bounds = new google.maps.LatLngBounds();
  const path = [];

  activities.forEach((activity, index) => {
    const lat = Number(activity.lat);
    const lng = Number(activity.lng);
    if (!isFinite(lat) || !isFinite(lng) || lat === 0 && lng === 0) return;

    const position = { lat, lng };
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

    marker.set('activityId', activity.id);

    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="font-family:system-ui;padding:4px;max-width:200px">
          <strong>${activity.title}</strong>
          <p style="font-size:12px;margin:4px 0;color:#555">${activity.location || ''}</p>
          <p style="font-size:12px;color:#555">${formatTime(activity.time)} · ${activity.duration_minutes}min</p>
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

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds);
    // If only one pin, fitBounds zooms in too far — cap it.
    if (path.length === 1) {
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if (map.getZoom() > 14) map.setZoom(14);
      });
    }
  }
}

/** Pan to and highlight a specific marker by activity id */
export function focusActivity(activityId) {
  if (!map) return;
  const marker = markers.find(m => m.get('activityId') === activityId);
  if (!marker) return;
  map.panTo(marker.getPosition());
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
  return [
    { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#1e293b' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#334155' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  ];
}
