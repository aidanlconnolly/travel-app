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
| `js/main.js` | Everything else — page init, routing dispatch, DOM rendering for both pages, generation progress UI, click-to-expand description handler. Imports from all other modules. |
| `js/dragdrop.js` | Native HTML5 drag-and-drop. Mutates the live itinerary object, then calls a callback to persist. |
| `js/map.js` | Google Maps JS API — loads the script dynamically, renders pins and polyline. Gracefully degrades to a placeholder when no key is set. |
| `js/budget.js` | Cost aggregation, Canvas pie chart (no Chart.js), inline cost editing, currency conversion via `open.er-api.com`. |
| `js/export.js` | `window.print()` PDF, JSON file import/export, base64 shareable URL, QR code via CDN. |

### State shape

Every trip is stored under its UUID key in `localStorage` as a `Trip` object (see typedef in `js/state.js`). The parsed Claude JSON (`itinerary`) is nested inside the trip — re-generation overwrites it. Packing checkboxes, star ratings, and cost overrides are also sub-keys on the trip object, persisted via `saveTrip()`.

### Claude API

- Model: `claude-sonnet-4-6`, `max_tokens: 20000`
- The frontend calls `/api/generate` (never Anthropic directly) — the key never touches the browser
- In production, `api/generate.js` is a Vercel serverless function that reads `ANTHROPIC_API_KEY` from Vercel environment variables. It declares `export const config = { maxDuration: 60 }` because long-trip generations exceed Vercel's default 10s function timeout.
- Locally, `server.js` proxies `/api/generate` using the same env var
- Streamed via `ReadableStream` (not `EventSource` — the request is a POST)
- The full schema is in `api.js:buildPrompt()`. The prompt scales activities-per-day with trip length (3-4 for >7 days, 4-6 for short trips) to keep output bounded.
- **JSON parsing is forgiving**: `parseLooseJson()` in `api.js` strips markdown code fences, skips any prose preamble, and repairs truncated streams by tracking bracket/string state and closing what's still open. The final-parse path also drops activities missing a title (artifacts from repair). When editing the prompt or output schema, prefer changes that keep the repair logic working — partial activities are fine to drop, but a missing top-level `days` array will surface as "Claude returned invalid JSON".
- **Progress UI** in `main.js:startGeneration` shows `Day N of M · X%`, using the count of `"theme":` markers in the accumulating stream as a stronger signal than raw char count.

### Cost reference

Per generation, roughly: $0.10 for a 4-day trip, $0.20 for a 10-day trip (Sonnet 4.6 at $3 in / $15 out per MTok). A second smaller call generates the packing list (~$0.015).

### Theme / vibe system

Four vibes (adventure, relaxation, culture, foodie) each have an accent color defined in `css/base.css` as `--color-<vibe>`. When a trip is opened, `main.js` sets `--vibe-color` on `:root` so cards, pins, and polylines all pick up the trip's color.

Dark mode is toggled via `data-theme="dark"` on `<html>`, persisted to localStorage via `state.js:savePref()`.

### Google Maps

The API key lives in `itinerary.html` as `<meta name="google-maps-key" content="...">`. It is restricted in Google Cloud Console to the Vercel domain and localhost. The map degrades silently to a placeholder div when the key is missing or invalid — the rest of the app still works.

Activity addresses are resolved at render time via `google.maps.Geocoder` (not the REST Geocoding API — the JS API's geocoder works under the same key restriction). `map.js:geocodeOne()` queries `${activity.location}, ${destination}` to bias results to the right city, mutates `activity._latLng` so subsequent renders skip the lookup, and caches results in a module-level `Map`. Concurrency is capped at 5 to stay under per-second quotas. Until geocoding resolves, `renderMarkers` leaves the map at its default Paris center — if you see Paris on a non-Paris trip, geocoding either hasn't finished or silently failed.

### Deployment

- Vercel serves the repo root as static files with no build command
- `api/generate.js` is auto-detected by Vercel as a serverless function
- `ANTHROPIC_API_KEY` must be set in Vercel project environment variables (already configured)
- Push to `main` on GitHub triggers auto-redeploy
