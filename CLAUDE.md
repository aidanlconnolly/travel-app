# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running locally

```bash
ANTHROPIC_API_KEY=sk-ant-... node server.js   # serves at http://localhost:5400
```

`server.js` is a zero-dependency Node static file server that also proxies `/api/generate` → Anthropic. Open `index.html` via the URL — do not double-click the file because ES module imports (`type="module"`) require HTTP. Without `ANTHROPIC_API_KEY` set, the server starts but itinerary generation fails.

Deployed at: https://travel-app-eta-peach.vercel.app

## Architecture

Two-page vanilla JS app using native ES modules (`type="module"` in HTML). No build step, no bundler, no framework.

### Page flow

- `index.html` — home screen. Renders saved trip cards from localStorage and the new-trip creation form. On form submit, saves the trip object and navigates to `itinerary.html?trip=<id>`.
- `itinerary.html` — itinerary view. Reads `?trip=<id>` from the URL, loads the trip from localStorage, and either renders the saved itinerary or calls the Claude API to generate one.

### Module responsibilities

| File | Owns |
|---|---|
| `js/state.js` | All `localStorage` reads/writes. The `Trip` typedef lives here. |
| `js/api.js` | Claude streaming call (`generateItinerary`), packing list generation, Unsplash photo URL helper. |
| `js/main.js` | Everything else — page init, routing dispatch, DOM rendering for both pages, event wiring. Imports from all other modules. |
| `js/dragdrop.js` | Native HTML5 drag-and-drop. Mutates the live itinerary object, then calls a callback to persist. |
| `js/map.js` | Google Maps JS API — loads the script dynamically, renders pins and polyline. Gracefully degrades to a placeholder when no key is set. |
| `js/budget.js` | Cost aggregation, Canvas pie chart (no Chart.js), inline cost editing, currency conversion via `open.er-api.com`. |
| `js/export.js` | `window.print()` PDF, JSON file import/export, base64 shareable URL, QR code via CDN. |

### State shape

Every trip is stored under its UUID key in `localStorage` as a `Trip` object (see typedef in `js/state.js`). The parsed Claude JSON (`itinerary`) is nested inside the trip — re-generation overwrites it. Packing checkboxes, star ratings, and cost overrides are also sub-keys on the trip object, persisted via `saveTrip()`.

### Claude API

- Model: `claude-sonnet-4-6`
- The frontend calls `/api/generate` (never Anthropic directly) — the key never touches the browser
- In production, `api/generate.js` is a Vercel serverless function that reads `ANTHROPIC_API_KEY` from Vercel environment variables
- Locally, `server.js` proxies `/api/generate` using the same env var
- Streamed via `ReadableStream` (not `EventSource` — the request is a POST)
- Expects strict JSON output — the full schema is in `api.js:buildPrompt()`

### Theme / vibe system

Four vibes (adventure, relaxation, culture, foodie) each have an accent color defined in `css/base.css` as `--color-<vibe>`. When a trip is opened, `main.js` sets `--vibe-color` on `:root` so cards, pins, and polylines all pick up the trip's color.

Dark mode is toggled via `data-theme="dark"` on `<html>`, persisted to localStorage via `state.js:savePref()`.

### Google Maps

The API key lives in `itinerary.html` as `<meta name="google-maps-key" content="...">`. It is restricted in Google Cloud Console to the Vercel domain and localhost. The map degrades silently to a placeholder div when the key is missing or invalid — the rest of the app still works.

### Deployment

- Vercel serves the repo root as static files with no build command
- `api/generate.js` is auto-detected by Vercel as a serverless function
- `ANTHROPIC_API_KEY` must be set in Vercel project environment variables (already configured)
- Push to `main` on GitHub triggers auto-redeploy
