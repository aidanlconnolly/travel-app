// Export functionality: PDF via window.print(), JSON import/export, QR code.

/**
 * Trigger browser print dialog (PDF export).
 * print.css handles the layout transformation.
 */
export function printItinerary() {
  window.print();
}

/**
 * Export a trip as a downloadable .json file.
 * @param {import('./state.js').Trip} trip
 */
export function exportTripJson(trip) {
  const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(trip.name || trip.destination)}-itinerary.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Import a trip from a .json file.
 * @returns {Promise<import('./state.js').Trip>}
 */
export function importTripJson() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) { reject(new Error('No file selected')); return; }
      try {
        const text = await file.text();
        const trip = JSON.parse(text);
        trip.id = crypto.randomUUID(); // give it a fresh ID to avoid collision
        resolve(trip);
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    input.click();
  });
}

/**
 * Build a shareable URL encoding the trip as base64 in the hash.
 * @param {import('./state.js').Trip} trip
 * @returns {{ url: string, tooLarge: boolean }}
 */
export function buildShareUrl(trip) {
  try {
    const json = JSON.stringify(trip);
    const encoded = btoa(encodeURIComponent(json));
    const url = `${location.origin}${location.pathname.replace('itinerary.html', 'index.html')}?shared=${encoded}`;
    return { url, tooLarge: encoded.length > 8000 };
  } catch {
    return { url: '', tooLarge: true };
  }
}

/**
 * Parse a shared trip from the current URL's ?shared= param.
 * @returns {import('./state.js').Trip|null}
 */
export function parseSharedTrip() {
  const params = new URLSearchParams(location.search);
  const encoded = params.get('shared');
  if (!encoded) return null;
  try {
    return JSON.parse(decodeURIComponent(atob(encoded)));
  } catch {
    return null;
  }
}

/**
 * Render a QR code SVG for a URL using the qrcode.js CDN.
 * Injects qrcode.js dynamically if not already loaded.
 * @param {string} url
 * @param {HTMLElement} container
 */
export async function renderQrCode(url, container) {
  if (!window.QRCode) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
  }
  container.innerHTML = '';
  new QRCode(container, {
    text: url,
    width: 160,
    height: 160,
    colorDark: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#000',
    colorLight: 'transparent',
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
