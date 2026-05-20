// Budget tracker: aggregates costs, renders Canvas pie chart, handles inline edits,
// optionally converts currency via exchangerate-api.com (free tier).

const CATEGORY_COLORS = {
  food: '#f59e0b',
  culture: '#8b5cf6',
  adventure: '#f97316',
  leisure: '#10b981',
  transport: '#6b7280',
};

let currentCurrency = 'USD';
let exchangeRates = {}; // { EUR: 0.92, ... }
let costOverrides = {}; // { activityId: number }
let onOverrideChange = null;

/**
 * Initialize the budget panel with trip itinerary data.
 * @param {object} itinerary — parsed Claude JSON
 * @param {object} savedOverrides — persisted cost edits
 * @param {(overrides: object) => void} onSave — called when a cost is edited
 */
export function initBudget(itinerary, savedOverrides = {}, onSave) {
  costOverrides = { ...savedOverrides };
  onOverrideChange = onSave;
  renderBudget(itinerary);
  attachBudgetToggle();
}

function getAllActivities(itinerary) {
  return (itinerary?.days || []).flatMap(day => day.activities || []);
}

function getActivityCost(activity) {
  return costOverrides[activity.id] ?? activity.estimated_cost_usd ?? 0;
}

function groupByCategory(activities) {
  const totals = {};
  for (const a of activities) {
    const cat = a.category || 'misc';
    totals[cat] = (totals[cat] || 0) + getActivityCost(a);
  }
  return totals;
}

export function renderBudget(itinerary) {
  const activities = getAllActivities(itinerary);
  const totalCost = activities.reduce((sum, a) => sum + getActivityCost(a), 0);
  const budgetInput = document.getElementById('trip-budget-input');
  const budget = parseFloat(budgetInput?.value) || 0;

  // Update total display
  const totalDisplay = document.querySelector('.budget-total-display');
  if (totalDisplay) {
    const rate = exchangeRates[currentCurrency] || 1;
    const converted = (totalCost * rate).toFixed(0);
    totalDisplay.textContent = `${currencySymbol(currentCurrency)}${converted} spent`;
    if (budget > 0) {
      const diff = budget - totalCost;
      const diffConverted = Math.abs(diff * rate).toFixed(0);
      totalDisplay.textContent += diff >= 0
        ? ` · ${currencySymbol(currentCurrency)}${diffConverted} under`
        : ` · ${currencySymbol(currentCurrency)}${diffConverted} over`;
      totalDisplay.className = 'budget-total-display ' + (diff >= 0 ? 'under' : 'over');
    }
  }

  // Draw pie chart
  const canvas = document.getElementById('budget-chart');
  if (canvas) drawPieChart(canvas, groupByCategory(activities));

  // Render breakdown rows
  const breakdown = document.querySelector('.budget-breakdown');
  if (!breakdown) return;

  breakdown.innerHTML = '';
  const byCategory = groupByCategory(activities);
  for (const [cat, total] of Object.entries(byCategory)) {
    const rate = exchangeRates[currentCurrency] || 1;
    const row = document.createElement('div');
    row.className = 'budget-row';
    row.innerHTML = `
      <span class="budget-row-dot" style="background:${CATEGORY_COLORS[cat] || '#ccc'}"></span>
      <span class="budget-row-label">${capitalize(cat)}</span>
      <span class="budget-row-cost">${currencySymbol(currentCurrency)}${(total * rate).toFixed(0)}</span>`;
    breakdown.appendChild(row);
  }

  // Per-activity editable rows
  if (activities.length) {
    const separator = document.createElement('div');
    separator.style.cssText = 'height:1px;background:var(--border);margin:8px 0';
    breakdown.appendChild(separator);

    for (const a of activities) {
      const rate = exchangeRates[currentCurrency] || 1;
      const cost = getActivityCost(a) * rate;
      const row = document.createElement('div');
      row.className = 'budget-row';
      row.innerHTML = `
        <span class="budget-row-label" style="font-size:.75rem;color:var(--text-muted)">${a.title}</span>
        <span class="budget-row-cost" contenteditable="true" data-id="${a.id}" data-base="${getActivityCost(a)}">${currencySymbol(currentCurrency)}${cost.toFixed(0)}</span>`;
      breakdown.appendChild(row);
    }

    // Inline edit listeners
    breakdown.querySelectorAll('[contenteditable]').forEach(el => {
      el.addEventListener('blur', () => {
        const raw = el.textContent.replace(/[^0-9.]/g, '');
        const valueUSD = parseFloat(raw) / (exchangeRates[currentCurrency] || 1);
        if (!isNaN(valueUSD)) {
          costOverrides[el.dataset.id] = valueUSD;
          onOverrideChange?.(costOverrides);
          renderBudget(itinerary);
        }
      });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    });
  }
}

/** Canvas pie chart — no external libraries */
function drawPieChart(canvas, data) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  if (!entries.length) return;

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const size = 120;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  let angle = -Math.PI / 2;
  for (const [cat, value] of entries) {
    const slice = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = CATEGORY_COLORS[cat] || '#ccc';
    ctx.fill();
    angle += slice;
  }

  // Donut hole
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#fff';
  ctx.fill();
}

function attachBudgetToggle() {
  const header = document.querySelector('.budget-header');
  const panel = document.getElementById('budget-panel');
  if (!header || !panel) return;
  header.addEventListener('click', () => panel.classList.toggle('collapsed'));
}

/**
 * Fetch exchange rates from exchangerate-api.com (free, no key needed for USD base).
 * Caches result in memory for the session.
 */
export async function loadExchangeRates() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data.rates) exchangeRates = data.rates;
  } catch {
    // silently fail — stay in USD
  }
}

export function setCurrency(currency) {
  currentCurrency = currency;
}

function currencySymbol(code) {
  const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'Fr', INR: '₹' };
  return symbols[code] || code + ' ';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
