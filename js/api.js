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

  return `Plan a ${days}-day ${trip.vibe} trip to ${trip.destination} for ${trip.travelers} traveler(s).
Trip name: "${trip.name}"
Start date: ${trip.startDate}
End date: ${trip.endDate}
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
          "description": "2-3 sentence vivid description",
          "location": "Full address or landmark name",
          "category": "food|culture|adventure|leisure|transport",
          "duration_minutes": 60,
          "estimated_cost_usd": 25,
          "tips": "One insider tip most tourists miss"
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
  ]
}

Generate exactly ${days} day objects. Include ${activitiesPerDay} activities per day (mix of morning, afternoon, evening). Keep descriptions concise (2 sentences max) and tips to one short sentence. Be specific and local.`;
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
