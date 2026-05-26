import {
  loadTrips, saveTrip, loadTrip, deleteTrip, duplicateTrip,
  saveItinerary, savePackingState, saveRatings, saveCostOverrides,
  saveDestinationTips,
  loadPrefs, savePref,
} from './state.js';
import { generateItinerary, generatePackingList, generateDestinationTips, getDestinationPhotoUrl, parseLooseJson } from './api.js';
import { initDragDrop, refreshDragDrop } from './dragdrop.js';
import { initMap, renderMarkers, focusActivity } from './map.js';
import { initBudget, renderBudget, loadExchangeRates, setCurrency } from './budget.js';
import { printItinerary, exportTripJson, importTripJson, buildShareUrl, parseSharedTrip, renderQrCode } from './export.js';

const PAGE = location.pathname.includes('itinerary') ? 'itinerary' : 'home';

// ── Theme ─────────────────────────────────────────────────

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : '';
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

function initTheme() {
  const prefs = loadPrefs();
  const dark = prefs.dark ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(dark);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    applyTheme(!isDark);
    savePref('dark', !isDark);
  });
}

// ── Vibe config ───────────────────────────────────────────

const VIBES = {
  adventure:  { color: '#f97316', emoji: '🏔️', label: 'Adventure' },
  relaxation: { color: '#14b8a6', emoji: '🌊', label: 'Relaxation' },
  culture:    { color: '#a855f7', emoji: '🏛️', label: 'Culture' },
  foodie:     { color: '#ef4444', emoji: '🍜', label: 'Foodie' },
};

function setVibeColor(vibe) {
  const color = VIBES[vibe]?.color || '#2563eb';
  document.documentElement.style.setProperty('--vibe-color', color);
}

// ════════════════════════════════════════════════════════
// HOME PAGE
// ════════════════════════════════════════════════════════

function initHome() {
  renderTripGrid();
  initNewTripForm();
  initVibeCards();
  initSurpriseBtn();
  initImportBtn();

  // Check for shared trip in URL
  const shared = parseSharedTrip();
  if (shared) handleSharedTrip(shared);
}

function renderTripGrid() {
  const grid = document.getElementById('trip-grid');
  if (!grid) return;
  const trips = Object.values(loadTrips()).sort((a, b) => b.updatedAt - a.updatedAt);

  if (!trips.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="icon">✈️</div>
        <p>No trips yet — plan your first adventure below!</p>
      </div>`;
    return;
  }

  grid.innerHTML = trips.map(trip => {
    const vibe = VIBES[trip.vibe] || VIBES.adventure;
    const nights = Math.round((new Date(trip.endDate) - new Date(trip.startDate)) / 86400000);
    const photoUrl = getDestinationPhotoUrl(trip.destination);
    return `
      <div class="trip-card" data-id="${trip.id}">
        <div class="trip-card-photo">
          <img src="${photoUrl}" alt="${trip.destination}" style="width:100%;height:100%;object-fit:cover"
               onerror="this.style.display='none';this.parentElement.textContent='${vibe.emoji}'">
        </div>
        <div class="trip-card-body">
          <div class="trip-card-name">${trip.name || trip.destination}</div>
          <div class="trip-card-meta">
            <span>📍 ${trip.destination}</span>
            <span>🌙 ${nights} night${nights !== 1 ? 's' : ''}</span>
            <span>👥 ${trip.travelers}</span>
          </div>
          <span class="trip-vibe-badge" style="background:${vibe.color}">${vibe.emoji} ${vibe.label}</span>
          <div class="trip-card-actions">
            <button class="btn-open" onclick="openTrip('${trip.id}')">Open</button>
            <button onclick="dupTrip('${trip.id}')">Duplicate</button>
            <button onclick="delTrip('${trip.id}')">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

window.openTrip = (id) => {
  location.href = `itinerary.html?trip=${id}`;
};

window.dupTrip = (id) => {
  duplicateTrip(id);
  renderTripGrid();
};

window.delTrip = (id) => {
  if (!confirm('Delete this trip?')) return;
  deleteTrip(id);
  renderTripGrid();
};

function initNewTripForm() {
  const form = document.getElementById('new-trip-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(form);
    const trip = {
      id: crypto.randomUUID(),
      name: data.get('name') || data.get('destination'),
      destination: data.get('destination'),
      startDate: data.get('startDate'),
      endDate: data.get('endDate'),
      arrivalTime: data.get('arrivalTime') || '',
      departureTime: data.get('departureTime') || '',
      travelers: parseInt(data.get('travelers')) || 1,
      vibe: data.get('vibe') || 'adventure',
      notes: data.get('notes'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveTrip(trip);
    location.href = `itinerary.html?trip=${trip.id}`;
  });
}

function initVibeCards() {
  document.querySelectorAll('.vibe-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.vibe-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      card.querySelector('input[type="radio"]').checked = true;
    });
  });
  // Select first by default
  document.querySelector('.vibe-card')?.classList.add('selected');
}

const SURPRISE_CITIES = [
  'Kyoto, Japan', 'Lisbon, Portugal', 'Cartagena, Colombia', 'Tbilisi, Georgia',
  'Chiang Mai, Thailand', 'Ljubljana, Slovenia', 'Medellín, Colombia', 'Porto, Portugal',
  'Oaxaca, Mexico', 'Kotor, Montenegro', 'Hoi An, Vietnam', 'Plovdiv, Bulgaria',
  'Valparaíso, Chile', 'Ghent, Belgium', 'Zanzibar, Tanzania', 'Luang Prabang, Laos',
  'Matera, Italy', 'Crete, Greece', 'Queenstown, New Zealand', 'Marrakech, Morocco',
];

function initSurpriseBtn() {
  document.getElementById('surprise-btn')?.addEventListener('click', () => {
    const dest = SURPRISE_CITIES[Math.floor(Math.random() * SURPRISE_CITIES.length)];
    const destInput = document.querySelector('[name="destination"]');
    if (destInput) destInput.value = dest;
  });
}

function initImportBtn() {
  document.getElementById('import-btn')?.addEventListener('click', async () => {
    try {
      const trip = await importTripJson();
      saveTrip(trip);
      renderTripGrid();
    } catch (err) {
      alert(err.message);
    }
  });
}

function handleSharedTrip(trip) {
  if (confirm(`You received a shared trip: "${trip.name || trip.destination}". Save it to your trips?`)) {
    trip.id = crypto.randomUUID();
    saveTrip(trip);
    renderTripGrid();
    history.replaceState({}, '', location.pathname);
  }
}

// ════════════════════════════════════════════════════════
// ITINERARY PAGE
// ════════════════════════════════════════════════════════

let currentTrip = null;
let currentItinerary = null;
let abortController = null;

async function initItinerary() {
  const tripId = new URLSearchParams(location.search).get('trip');
  currentTrip = loadTrip(tripId);
  if (!currentTrip) { location.href = 'index.html'; return; }

  setVibeColor(currentTrip.vibe);
  renderTripHeader();
  const mapReady = initMap(VIBES[currentTrip.vibe]?.color);
  loadExchangeRates();
  initBudgetPanel();
  attachItineraryActions();
  initCurrencySelector();

  await mapReady;

  if (currentTrip.itinerary) {
    currentItinerary = currentTrip.itinerary;
    renderItinerary(currentItinerary);
  } else {
    startGeneration();
  }
}

function renderTripHeader() {
  const t = currentTrip;
  const vibe = VIBES[t.vibe] || VIBES.adventure;
  const nights = Math.round((new Date(t.endDate) - new Date(t.startDate)) / 86400000);
  const arrivalPill = t.arrivalTime ? `<span class="pill">🛬 Lands ${formatTime(t.arrivalTime)}</span>` : '';
  const departurePill = t.departureTime ? `<span class="pill">🛫 Leaves ${formatTime(t.departureTime)}</span>` : '';

  document.querySelector('.trip-title').textContent = t.name || t.destination;
  document.querySelector('.trip-meta-pills').innerHTML = `
    <span class="pill">📍 ${t.destination}</span>
    <span class="pill">📅 ${formatDate(t.startDate)} – ${formatDate(t.endDate)}</span>
    ${arrivalPill}
    ${departurePill}
    <span class="pill">🌙 ${nights} night${nights !== 1 ? 's' : ''}</span>
    <span class="pill">👥 ${t.travelers} traveler${t.travelers !== 1 ? 's' : ''}</span>
    <span class="pill" style="background:${vibe.color};color:#fff;border-color:${vibe.color}">${vibe.emoji} ${vibe.label}</span>`;

  // Print header
  const ph = document.querySelector('.print-header');
  if (ph) {
    ph.innerHTML = `<h1>${t.name || t.destination}</h1>
      <p>${formatDate(t.startDate)} – ${formatDate(t.endDate)} · ${t.travelers} traveler(s) · ${vibe.label} vibe</p>`;
  }
}

async function startGeneration() {
  abortController = new AbortController();
  const cols = document.getElementById('day-columns');
  cols.innerHTML = buildSkeletons(currentTrip);

  const start = new Date(currentTrip.startDate);
  const end = new Date(currentTrip.endDate);
  const days = Math.round((end - start) / 86400000) + 1;
  const perDay = days > 7 ? 1500 : days > 4 ? 1900 : 2400;
  const estimatedChars = days * perDay + 1500;

  let accum = '';
  const statusEl = document.querySelector('.gen-status');

  function updateProgress() {
    if (!statusEl) return;
    // Count completed days via "theme": markers — a stronger signal than raw char count.
    const dayMarkers = (accum.match(/"theme":/g) || []).length;
    const charPct = (accum.length / estimatedChars) * 100;
    const dayPct = (dayMarkers / days) * 100;
    const pct = Math.min(Math.round(Math.max(charPct, dayPct)), 98);
    const label = dayMarkers > 0 ? `Day ${Math.min(dayMarkers, days)} of ${days}` : 'Generating…';
    statusEl.innerHTML = `
      <span style="display:flex;align-items:center;gap:8px;white-space:nowrap">
        ${label} · ${pct}%
        <span style="display:inline-block;width:80px;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
          <span style="display:block;height:100%;width:${pct}%;background:var(--vibe-color);transition:width .3s"></span>
        </span>
      </span>`;
  }

  updateProgress();

  try {
    const result = await generateItinerary(currentTrip, chunk => {
      accum += chunk;
      updateProgress();
      // Attempt progressive render once we have a parseable chunk
      tryProgressiveRender(accum);
    }, abortController.signal);

    currentItinerary = result;
    saveItinerary(currentTrip.id, result);
    renderItinerary(result);
    if (statusEl) statusEl.innerHTML = '';

    // Kick off packing list generation in the background
    generatePackingList(currentTrip, result)
      .then(packing => renderPackingList(packing, currentTrip.packed || {}))
      .catch(() => {});

  } catch (err) {
    if (err.name === 'AbortError') return;
    cols.innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--text-secondary)">
        <p style="font-size:1.2rem;margin-bottom:12px">😕 ${err.message}</p>
        <button class="btn btn-primary" onclick="window.__retryGeneration()">Retry</button>
      </div>`;
  }
}

window.__retryGeneration = () => startGeneration();

function buildSkeletons(trip) {
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  const days = Math.round((end - start) / 86400000) + 1;

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);
    return `
      <div class="day-column" data-day-index="${i}">
        <div class="day-column-header">
          <div class="day-label">Day ${i + 1} · ${date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
          <div class="day-theme"><span class="skeleton skeleton-line" style="width:70%;height:14px;display:inline-block"></span></div>
        </div>
        <div class="activity-list">
          ${Array.from({ length: 4 }, () => `
            <div class="skeleton-card">
              <div class="skeleton skeleton-line" style="width:35%;height:10px"></div>
              <div class="skeleton skeleton-line" style="width:85%;height:13px"></div>
              <div class="skeleton skeleton-line" style="width:100%;height:10px"></div>
              <div class="skeleton skeleton-line" style="width:60%;height:10px"></div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');
}

let lastRenderedDays = 0;
function tryProgressiveRender(text) {
  const dayMatches = text.match(/"theme":/g);
  const count = dayMatches ? dayMatches.length : 0;
  if (count <= lastRenderedDays) return;
  lastRenderedDays = count;
  const parsed = parseLooseJson(text);
  if (parsed?.days?.length) renderItinerary(parsed, true);
}

function renderItinerary(itinerary, partial = false) {
  lastRenderedDays = 0;
  const cols = document.getElementById('day-columns');
  if (!cols) return;

  let globalIdx = 0;
  cols.innerHTML = (itinerary.days || []).map((day, dayIndex) => {
    const date = new Date(day.date || currentTrip.startDate);
    const dayTotal = (day.activities || []).reduce((s, a) => s + (a.estimated_cost_usd || 0), 0);
    return `
      <div class="day-column" data-day-index="${dayIndex}">
        <div class="day-column-header">
          <div class="day-label">Day ${dayIndex + 1} · ${date.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</div>
          <div class="day-theme">${day.theme || ''}</div>
          <div class="day-total">~$${dayTotal} est.</div>
        </div>
        <div class="activity-list">
          <div class="drop-indicator"></div>
          ${(day.activities || []).map((activity, actIndex) => {
            globalIdx += 1;
            return renderActivityCard(activity, dayIndex, actIndex, globalIdx);
          }).join('<div class="drop-indicator"></div>')}
          <div class="drop-indicator"></div>
        </div>
      </div>`;
  }).join('');

  if (!partial) {
    initDragDrop(itinerary, onDrop);
    initBudget(itinerary, currentTrip.costOverrides || {}, overrides => saveCostOverrides(currentTrip.id, overrides));
    initActivityRatings();
    initExpandableDescriptions();
    initActivityNumberClicks();
    renderMarkers(
      (itinerary.days || []).flatMap(d => d.activities || []),
      focusActivity
    );
    renderLocalPhrases(itinerary.local_phrases);
    ensureDestinationTips(itinerary.destination_tips);
  }
}

function initActivityNumberClicks() {
  document.querySelectorAll('.activity-number').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const card = el.closest('.activity-card');
      const activityId = card?.dataset.id;
      if (activityId) focusActivity(activityId);
    });
    // Prevent the parent card from starting a drag when grabbing the badge.
    el.addEventListener('mousedown', e => e.stopPropagation());
  });
}

function ensureDestinationTips(tipsFromItinerary) {
  if (Array.isArray(tipsFromItinerary) && tipsFromItinerary.length) {
    renderDestinationTips(tipsFromItinerary);
    return;
  }
  if (Array.isArray(currentTrip.destinationTips) && currentTrip.destinationTips.length) {
    renderDestinationTips(currentTrip.destinationTips);
    return;
  }
  // Fetch separately — main itinerary call sometimes truncates this section.
  renderDestinationTips(null, { loading: true });
  generateDestinationTips(currentTrip)
    .then(tips => {
      if (!tips?.length) { renderDestinationTips([]); return; }
      currentTrip.destinationTips = tips;
      saveDestinationTips(currentTrip.id, tips);
      renderDestinationTips(tips);
    })
    .catch(() => renderDestinationTips([]));
}

function renderActivityCard(activity, dayIndex, actIndex, pinNumber) {
  const ratings = currentTrip.ratings || {};
  const stars = ratings[activity.id] || 0;
  const catColor = { food: '#f59e0b', culture: '#8b5cf6', adventure: '#f97316', leisure: '#10b981', transport: '#6b7280' }[activity.category] || '#ccc';

  return `
    <div class="activity-card" draggable="true"
         data-id="${activity.id}" data-day-index="${dayIndex}" data-activity-index="${actIndex}" data-pin="${pinNumber}">
      ${pinNumber ? `<span class="activity-number" style="background:${catColor}">${pinNumber}</span>` : ''}
      <div class="activity-card-top">
        <span class="activity-time">${formatTime(activity.time)}</span>
        <div class="activity-content">
          <div class="activity-title">${activity.title}</div>
          <div class="activity-desc">${activity.description || ''}</div>
        </div>
        <span class="activity-category-dot" style="background:${catColor}"></span>
      </div>
      ${activity.tips ? `<div class="activity-tip">💡 ${activity.tips}</div>` : ''}
      <div class="activity-card-footer">
        <span class="activity-duration">${activity.duration_minutes || '?'} min</span>
        <span style="color:var(--text-muted);font-size:.75rem">📍 ${(activity.location || '').split(',')[0]}</span>
        <span class="activity-cost">${activity.estimated_cost_usd ?? '?'}</span>
      </div>
      <div class="activity-stars" data-id="${activity.id}">
        ${[1,2,3,4,5].map(n => `<button class="star-btn ${n <= stars ? 'filled' : ''}" data-star="${n}" aria-label="${n} star">★</button>`).join('')}
      </div>
    </div>`;
}

function initExpandableDescriptions() {
  document.querySelectorAll('.activity-desc').forEach(el => {
    // Tag descriptions whose content actually overflows so the "more" hint only shows when relevant.
    if (el.scrollHeight > el.clientHeight + 1) el.classList.add('clamped');
    el.addEventListener('click', e => {
      e.stopPropagation();
      el.classList.toggle('expanded');
    });
  });
}

function initActivityRatings() {
  document.querySelectorAll('.activity-stars').forEach(container => {
    container.addEventListener('click', e => {
      const btn = e.target.closest('.star-btn');
      if (!btn) return;
      const actId = container.dataset.id;
      const val = parseInt(btn.dataset.star, 10);
      const ratings = currentTrip.ratings || {};
      ratings[actId] = val;
      currentTrip.ratings = ratings;
      saveRatings(currentTrip.id, ratings);
      container.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('filled', i < val));
    });
  });
}

function onDrop(itinerary) {
  currentItinerary = itinerary;
  saveItinerary(currentTrip.id, itinerary);
  refreshDragDrop();
  if (currentItinerary) renderBudget(currentItinerary);
}

function renderPackingList(packingData, savedState) {
  const container = document.querySelector('.packing-categories');
  if (!container) return;
  container.innerHTML = '';

  for (const [category, items] of Object.entries(packingData)) {
    const section = document.createElement('div');
    section.className = 'packing-category';
    section.innerHTML = `<div class="packing-category-title">${category}</div>`;

    const savedCat = savedState[category] || {};
    items.forEach(item => {
      const id = `pack-${Math.random().toString(36).slice(2)}`;
      const checked = savedCat[item] || false;
      const row = document.createElement('div');
      row.className = `packing-item ${checked ? 'checked' : ''}`;
      row.innerHTML = `
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
        <label for="${id}">${item}</label>`;
      row.querySelector('input').addEventListener('change', e => {
        row.classList.toggle('checked', e.target.checked);
        const packed = currentTrip.packed || {};
        if (!packed[category]) packed[category] = {};
        packed[category][item] = e.target.checked;
        currentTrip.packed = packed;
        savePackingState(currentTrip.id, packed);
      });
      section.appendChild(row);
    });

    // "Add custom item" input
    const addRow = document.createElement('div');
    addRow.className = 'packing-add-input';
    addRow.innerHTML = `<input type="text" placeholder="Add item…"><button>+</button>`;
    addRow.querySelector('button').addEventListener('click', () => {
      const input = addRow.querySelector('input');
      const val = input.value.trim();
      if (!val) return;
      input.value = '';
      const newItem = { [val]: false };
      const id2 = `pack-${Math.random().toString(36).slice(2)}`;
      const newRow = document.createElement('div');
      newRow.className = 'packing-item';
      newRow.innerHTML = `<input type="checkbox" id="${id2}"><label for="${id2}">${val}</label>`;
      section.insertBefore(newRow, addRow);
    });
    section.appendChild(addRow);
    container.appendChild(section);
  }
}

function renderDestinationTips(tips, opts = {}) {
  const container = document.querySelector('#sidebar-tips .tips-list');
  if (!container) return;
  if (opts.loading) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:.875rem">Loading tips…</div>`;
    return;
  }
  if (!Array.isArray(tips) || !tips.length) {
    container.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:.875rem">No tips available for this trip.</div>`;
    return;
  }
  container.innerHTML = tips.map((tip, i) => `
    <div class="tip-item">
      <span class="tip-num">${i + 1}</span>
      <span>${tip}</span>
    </div>`).join('');
}

function renderLocalPhrases(phrases) {
  if (!phrases?.length) return;
  const sidebar = document.getElementById('packing-panel');
  if (!sidebar) return;
  const section = document.createElement('div');
  section.style.cssText = 'padding:12px;border-top:1px solid var(--border)';
  section.innerHTML = `<div class="packing-category-title" style="padding:0 0 8px">Local Phrases</div>` +
    phrases.map(p => `
      <div style="margin-bottom:10px;font-size:.8125rem">
        <strong>${p.phrase}</strong> <em style="color:var(--text-muted)">${p.pronunciation}</em>
        <div style="color:var(--text-secondary)">${p.meaning}</div>
      </div>`).join('');
  sidebar.appendChild(section);
}

function initBudgetPanel() {
  document.getElementById('trip-budget-input')?.addEventListener('input', () => {
    if (currentItinerary) renderBudget(currentItinerary);
  });
}

function initCurrencySelector() {
  document.getElementById('currency-select')?.addEventListener('change', e => {
    setCurrency(e.target.value);
    if (currentItinerary) renderBudget(currentItinerary);
  });
}

function attachItineraryActions() {
  document.getElementById('btn-print')?.addEventListener('click', printItinerary);
  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (currentTrip) exportTripJson(currentTrip);
  });
  document.getElementById('btn-share')?.addEventListener('click', async () => {
    if (!currentTrip) return;
    const { url, tooLarge } = buildShareUrl(currentTrip);
    if (tooLarge) { alert('Trip data too large for a shareable URL. Use JSON export instead.'); return; }
    const modal = document.getElementById('share-modal');
    if (modal) {
      modal.classList.add('open');
      document.getElementById('share-url-input').value = url;
      renderQrCode(url, document.getElementById('qr-container'));
      document.getElementById('share-url-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => alert('Copied!'));
      }, { once: true });
      document.getElementById('share-modal-close')?.addEventListener('click', () => modal.classList.remove('open'), { once: true });
    }
  });
  document.getElementById('btn-regenerate')?.addEventListener('click', () => {
    if (!confirm('Regenerate the itinerary? This will replace the current one.')) return;
    startGeneration();
  });

  const page = document.querySelector('.itinerary-page');
  document.getElementById('btn-toggle-map')?.addEventListener('click', e => {
    page?.classList.toggle('map-hidden');
    e.currentTarget.classList.toggle('btn-primary', page?.classList.contains('map-hidden'));
  });
  document.getElementById('btn-toggle-sidebar')?.addEventListener('click', e => {
    page?.classList.toggle('sidebar-hidden');
    e.currentTarget.classList.toggle('btn-primary', page?.classList.contains('sidebar-hidden'));
  });
  document.getElementById('btn-fullscreen')?.addEventListener('click', e => {
    const isFull = page?.classList.contains('map-hidden') && page?.classList.contains('sidebar-hidden');
    page?.classList.toggle('map-hidden', !isFull);
    page?.classList.toggle('sidebar-hidden', !isFull);
    e.currentTarget.classList.toggle('btn-primary', !isFull);
    document.getElementById('btn-toggle-map')?.classList.toggle('btn-primary', !isFull);
    document.getElementById('btn-toggle-sidebar')?.classList.toggle('btn-primary', !isFull);
  });

  document.getElementById('btn-mobile-more')?.addEventListener('click', e => {
    const header = document.querySelector('.itinerary-header');
    header?.classList.toggle('show-more');
    e.currentTarget.classList.toggle('btn-primary', header?.classList.contains('show-more'));
  });

  initResizers(page);
}

function initResizers(page) {
  if (!page) return;
  const prefs = loadPrefs();
  if (prefs.sidebarWidth) page.style.setProperty('--sidebar-width', prefs.sidebarWidth + 'px');
  if (prefs.mapHeight) page.style.setProperty('--map-height', prefs.mapHeight + 'px');

  const sidebarEl = document.getElementById('resizer-sidebar');
  const mapEl = document.getElementById('resizer-map');

  attachResize(sidebarEl, {
    axis: 'v',
    min: 220,
    max: () => Math.min(640, window.innerWidth - 360),
    getStart: () => parseInt(getComputedStyle(page).getPropertyValue('--sidebar-width')) || 320,
    set: w => page.style.setProperty('--sidebar-width', w + 'px'),
    save: w => savePref('sidebarWidth', w),
  });

  attachResize(mapEl, {
    axis: 'h',
    min: 120,
    max: () => Math.min(640, window.innerHeight - 240),
    getStart: () => parseInt(getComputedStyle(page).getPropertyValue('--map-height')) || 220,
    set: h => page.style.setProperty('--map-height', h + 'px'),
    save: h => savePref('mapHeight', h),
  });
}

function attachResize(el, cfg) {
  if (!el) return;
  el.addEventListener('mousedown', startDrag);
  el.addEventListener('touchstart', startDrag, { passive: false });

  function startDrag(e) {
    e.preventDefault();
    const startVal = cfg.getStart();
    const point = e.touches ? e.touches[0] : e;
    const startX = point.clientX;
    const startY = point.clientY;
    el.classList.add('dragging');
    document.body.classList.add('resizing', cfg.axis === 'v' ? 'resizing-v' : 'resizing-h');

    let current = startVal;
    function onMove(ev) {
      const p = ev.touches ? ev.touches[0] : ev;
      const delta = cfg.axis === 'v' ? (startX - p.clientX) : (p.clientY - startY);
      const max = typeof cfg.max === 'function' ? cfg.max() : cfg.max;
      current = Math.max(cfg.min, Math.min(max, startVal + delta));
      cfg.set(current);
    }
    function onUp() {
      el.classList.remove('dragging');
      document.body.classList.remove('resizing', 'resizing-v', 'resizing-h');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      cfg.save(current);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }
}

// ── Utils ─────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

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

// ── Init ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (PAGE === 'home') initHome();
  else initItinerary();
});
