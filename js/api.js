const CLAUDE_MODEL = 'claude-sonnet-4-6';
const CLAUDE_API = '/api/generate';

const SYSTEM_PROMPT = `You are an expert travel planner with deep knowledge of local hidden gems, optimal timing, and logistics for destinations worldwide. You craft personalized itineraries that balance must-see highlights with off-the-beaten-path experiences. You always consider realistic travel times between locations, opening hours, and crowd patterns.

Your itineraries feel curated, not generic — you recommend specific cafes over "find a local cafe", specific viewpoints over "enjoy the scenery". For each activity you include an insider tip that most tourists miss.

You MUST respond with ONLY valid JSON matching the schema provided. No markdown, no explanation, no preamble — raw JSON only.`;

/**
 * Build the user prompt from trip data.
 * @param {import('./state.js').Trip} trip
 */
function buildPrompt(trip) {
  const start = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  const days = Math.round((end - start) / 86400000) + 1;
  const activitiesPerDay = days > 7 ? '3-4' : days > 4 ? '4-5' : '4-6';
  const arrivalLine = trip.arrivalTime
    ? `Arrival: traveler lands on ${trip.startDate} at ${trip.arrivalTime} local time. Do NOT schedule any activity on day 1 before ${trip.arrivalTime}; the first activity should start at least 60 minutes after arrival to allow for immigration, baggage, and transfer to lodging.`
    : `Arrival: not specified — assume traveler is settled by 11:00 on day 1.`;
  const departureLine = trip.departureTime
    ? `Departure: traveler leaves on ${trip.endDate} at ${trip.departureTime} local time. Do NOT schedule any activity on the final day that ends within 3 hours of ${trip.departureTime}; wrap the day so the traveler can reach the airport/station with that buffer.`
    : `Departure: not specified — assume traveler leaves after dinner on the final day.`;

  return `Plan a ${days}-day ${trip.vibe} trip to ${trip.destination} for ${trip.travelers} traveler(s).
Trip name: "${trip.name}"
Start date: ${trip.startDate}
End date: ${trip.endDate}
${arrivalLine}
${departureLine}
Vibe: ${trip.vibe}
Additional notes: ${trip.notes || 'none'}

Return ONLY this JSON schema (no markdown, raw JSON):
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "theme": "Short evocative day theme",
      "activities": [
        {
          "id": "unique-string-id",
          "time": "HH:MM",
          "period": "morning|afternoon|evening",
          "title": "Specific activity name",
          "description": "1 short sentence (max 20 words)",
          "location": "Specific landmark or street name",
          "lat": 36.4612,
          "lng": 25.3756,
          "category": "food|culture|adventure|leisure|transport",
          "duration_minutes": 60,
          "estimated_cost_usd": 25,
          "tips": "One insider tip (max 15 words)"
        }
      ]
    }
  ],
  "packing_suggestions": {
    "Clothing": ["item1", "item2"],
    "Tech": ["item1"],
    "Documents": ["item1"],
    "Health": ["item1"],
    "Misc": ["item1"]
  },
  "local_phrases": [
    { "phrase": "local phrase", "meaning": "English meaning", "pronunciation": "phonetic" }
  ],
  "destination_tips": [
    "5-6 highest-impact insider tips for visiting ${trip.destination} — money, etiquette, transport, safety, timing, or scams. Each tip is one sentence, max 25 words, specific (not 'be respectful')."
  ]
}

HARD REQUIREMENTS:
1. Generate exactly ${days} day objects — one per calendar day from ${trip.startDate} through ${trip.endDate} inclusive. Day ${days} (the FINAL/departure day) must be fully populated with ${activitiesPerDay} activities — do not run out of budget before finishing it. If you need to be terse to fit, be terse uniformly across all days.
2. EVERY day has ${activitiesPerDay} activities. Mix morning/afternoon/evening.
3. Every activity MUST include accurate "lat" and "lng" numbers (decimal degrees, ~4 decimal precision) for its real-world location. These are critical — the map uses them directly.
4. All text fields ("title", "description", "location", "tips", "theme") must be plain English using ASCII/Latin characters only. Do NOT insert CJK, Cyrillic, emoji, or stray non-Latin glyphs. Greek/local names are fine in Latin transliteration (e.g. "Oia", not "Οία").
5. Use 24-hour HH:MM for "time" — the UI formats it for display.
6. Be specific and local. Real place names, not "find a local cafe".
7. DISTANCE/LOGISTICS — this is critical, do NOT skip:
   - Before placing activity N+1 after activity N on the same day, estimate the real travel time between their lat/lng (driving, walking, ferry, or transit as appropriate).
   - The gap between activity N's end (its "time" + duration_minutes) and activity N+1's start must be ≥ that travel time PLUS at least 15 min buffer.
   - Group same-day activities by neighborhood/region. Do NOT bounce across the destination (e.g. Fira → Oia → Fira → Akrotiri in one day). One side of the island/city per day, or chain them in a single loop.
   - If two activities are >45 minutes of travel apart, they belong on different days unless the trip explicitly requires the long transit (e.g. a day-trip excursion). In that case, the long transit IS the activity — give it a "transport" entry with realistic duration.
   - For activities that include the transit (e.g. an ATV ride from Oia to Perissa), the duration_minutes must cover BOTH the ride and time spent at the destination.
8. "destination_tips" is a flat array of 5-6 strings — the most useful, non-obvious advice for visiting this place. Practical (transport hacks, payment tips, when to book, what to avoid). Not generic ("try the local food").`;
}

/**
 * Stream an itinerary from the Claude API.
 * Calls onChunk(text) for each streamed text delta, then resolves with the full parsed JSON.
 *
 * @param {import('./state.js').Trip} trip
 * @param {(text: string) => void} onChunk
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} parsed itinerary JSON
 */
export async function generateItinerary(trip, onChunk, signal) {
  const response = await fetch(CLAUDE_API, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 20000,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(trip) }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }

  let fullText = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text;
          fullText += text;
          onChunk(text);
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }

  const parsed = parseLooseJson(fullText);
  if (!parsed || !Array.isArray(parsed.days) || !parsed.days.length) {
    throw new Error('Claude returned invalid JSON. Please try again.');
  }
  // Drop activities that the repair step left half-written (missing title).
  parsed.days = parsed.days.map(d => ({
    ...d,
    activities: (d.activities || []).filter(a => a && typeof a.title === 'string' && a.title.trim()),
  }));
  return parsed;
}

/**
 * Parse JSON that may be wrapped in markdown fences, prefixed with prose,
 * or truncated mid-stream. Returns null if unrecoverable.
 */
export function parseLooseJson(text) {
  let s = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const firstBrace = s.indexOf('{');
  if (firstBrace > 0) s = s.slice(firstBrace);

  try { return JSON.parse(s); } catch {}

  // Repair: walk the string tracking strings/escapes/brackets, then close anything still open.
  let inString = false;
  let escape = false;
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }

  let repaired = s;
  if (inString) {
    // Drop the partial string entirely so we don't keep a half-written field.
    const lastQuote = repaired.lastIndexOf('"');
    repaired = repaired.slice(0, lastQuote);
  }
  // Drop a trailing partial token (e.g. `"time":` or `"morn`)
  repaired = repaired.replace(/,?\s*"[^"]*"\s*:\s*[^,{\[\]}]*$/, '');
  // Drop dangling comma
  repaired = repaired.replace(/,\s*$/, '');
  while (stack.length) {
    repaired += stack.pop() === '{' ? '}' : ']';
  }

  try { return JSON.parse(repaired); } catch { return null; }
}

/**
 * Generate a packing list by sending the existing itinerary back to Claude.
 * @param {import('./state.js').Trip} trip
 * @param {object} itinerary
 * @returns {Promise<object>} { Clothing: [], Tech: [], Documents: [], Health: [], Misc: [] }
 */
export async function generatePackingList(trip, itinerary) {
  const response = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: 'You generate practical packing lists. Respond with ONLY valid JSON, no markdown.',
      messages: [{
        role: 'user',
        content: `Generate a packing list for this ${trip.vibe} trip to ${trip.destination} (${trip.startDate} to ${trip.endDate}).
Itinerary summary: ${JSON.stringify(itinerary.days?.map(d => d.theme))}

Return ONLY this JSON:
{ "Clothing": [], "Tech": [], "Documents": [], "Health": [], "Misc": [] }

Each array contains strings. Be specific to this destination and vibe. 8-12 items per category.`,
      }],
    }),
  });

  if (!response.ok) throw new Error(`API error ${response.status}`);
  const msg = await response.json();
  return JSON.parse(msg.content[0].text);
}

// ── Google Maps helpers ───────────────────────────────────

/**
 * Geocode an address string using the Maps Geocoding API.
 * Returns { lat, lng } or null.
 * @param {string} address
 * @param {string} mapsApiKey
 */
export async function geocodeAddress(address, mapsApiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsApiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results?.[0]) {
    return data.results[0].geometry.location;
  }
  return null;
}

/**
 * Fetch a Unsplash-style destination photo (uses Unsplash Source CDN — no key needed).
 * @param {string} destination
 * @returns {string} image URL
 */
export function getDestinationPhotoUrl(destination) {
  const encoded = encodeURIComponent(destination.split(',')[0].trim());
  return `https://source.unsplash.com/400x280/?${encoded},travel,city`;
}
