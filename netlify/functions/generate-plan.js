// netlify/functions/generate-plan.js
// GET ?test=1 returns a valid fallback (for browser testing).
// POST uses Chat Completions JSON mode with a 9s timeout; on any issue, returns fallback.

const MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return res(204, '', cors());
  }

  try {
    const url = new URL(event.rawUrl || `https://x${event.path}`);

    // ---- GET test path so you can visit it in Safari ----
    if (event.httpMethod === 'GET') {
      if (url.searchParams.get('test') === '1') {
        return json(planFallback({}, { reason: 'get_test' }));
      }
      // For any other GET, keep prior behavior:
      return json({ error: 'Use POST' }, 405);
    }

    if (event.httpMethod !== 'POST') {
      return json({ error: 'Use POST' }, 405);
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const profile = JSON.parse(event.body || '{}');

    // If no key, always return a valid demo plan so UI renders
    if (!OPENAI_API_KEY) {
      return json(planFallback(profile, { reason: 'missing_api_key' }));
    }

    // ----- Prompts -----
    const systemPrompt = `
You are Evolve.AI, an expert coach and sports nutritionist.
Reply ONLY with a single JSON object matching this schema. No extra text. No markdown.
{
  "week": [
    {
      "day": 1-7,
      "focus": "upper|lower|full|recovery|conditioning|hypertrophy|power|mobility",
      "workouts": [
        {"exercise":"...", "sets": number, "reps": "x-y or seconds", "rest_sec": number, "notes":"optional coaching cue"}
      ],
      "meals": [
        {"name":"...", "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number,
         "ingredients": ["..."], "instructions": ["..."]}
      ]
    }
  ],
  "notes": "short overall guidance for the week (max 2 sentences)"
}
Rules:
- Training days: 6–7 movements; compounds first; honor session_length & training_time.
- Respect injuries/medical; add safe substitutions in per-exercise "notes" if needed.
- Match equipment_access & equipment list; reflect listed sports when relevant.
- Balance across days_per_week; include recovery/mobility/conditioning if stress/sleep suggest.
- Meals follow diet_style; avoid allergies/dislikes; hit calorie_target ±10% with practical macros.
`.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'User profile JSON:\n' + JSON.stringify(profile, null, 2) + '\nReturn ONLY the JSON object.' }
    ];

    // ----- OpenAI call with 9s timeout; strict JSON; retry once -----
    const out1 = await chatJSON(OPENAI_API_KEY, MODEL, messages, 0.6, 9000);
    const parsed1 = tryParseJSON(out1.text);
    if (parsed1.ok) {
      parsed1.value._meta = { model: MODEL, retry: false };
      return json(parsed1.value);
    }

    const out2 = await chatJSON(
      OPENAI_API_KEY,
      MODEL,
      [{ role: 'system', content: systemPrompt + '\nSTRICT: Reply must be only a single JSON object.' }, messages[1]],
      0.4,
      9000
    );
    const parsed2 = tryParseJSON(out2.text);
    if (parsed2.ok) {
      parsed2.value._meta = { model: MODEL, retry: true };
      return json(parsed2.value);
    }

    // If both fail or timeout, return a valid fallback so UI still renders
    return json(
      planFallback(profile, { reason: 'bad_json_or_timeout', model: MODEL, raw: out2.text || out1.text || null })
    );

  } catch (e) {
    return json(planFallback({}, { reason: 'exception', error: String(e) }));
  }
};

/* ---------------- helpers ---------------- */
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET'
  };
}
function res(statusCode, body, headers = {}) {
  return { statusCode, headers: { 'Content-Type': 'application/json', ...headers }, body };
}
function json(obj, code = 200) {
  return res(code, JSON.stringify(obj), cors());
}

async function chatJSON(key, model, messages, temperature, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 9000);

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages,
        temperature,
        max_tokens: 1800
      }),
      signal: controller.signal
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`OpenAI ${r.status}: ${t}`);
    }
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return { text, data };
  } finally {
    clearTimeout(timeout);
  }
}

function tryParseJSON(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch {
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try { return { ok: true, value: JSON.parse(text.slice(first, last + 1)) }; } catch {}
    }
    return { ok: false, raw: text };
  }
}

function planFallback(profile, meta = {}) {
  const kcal = Number(profile?.calorie_target || 2200);
  const diet = profile?.diet_style || 'balanced';
  return {
    week: [{
      day: 1, focus: 'full',
      workouts: [
        { exercise:'Back Squat', sets:5, reps:'5', rest_sec:120, notes:'Neutral spine; brace.' },
        { exercise:'Bench Press', sets:5, reps:'5', rest_sec:120, notes:'Scapula retracted.' },
        { exercise:'Romanian Deadlift', sets:3, reps:'8-10', rest_sec:90 },
        { exercise:'DB Row', sets:3, reps:'10-12', rest_sec:75 },
        { exercise:'Walking Lunge', sets:3, reps:'12/leg', rest_sec:60 },
        { exercise:'Plank', sets:3, reps:'60s', rest_sec:45 }
      ],
      meals: [
        { name:'Greek Yogurt Bowl', kcal: Math.round(kcal*0.25), protein_g:35, carbs_g:40, fat_g:10,
          ingredients:['Greek yogurt','berries','honey','granola'],
          instructions:['Mix yogurt + honey','Top with berries + granola'] },
        { name:'Chicken Burrito Bowl', kcal: Math.round(kcal*0.40), protein_g:45, carbs_g:60, fat_g:18,
          ingredients:['chicken','rice','black beans','corn','salsa','greens'],
          instructions:['Cook chicken','Assemble bowl with rice/beans/veg'] },
        { name:'Salmon + Veg + Quinoa', kcal: Math.round(kcal*0.35), protein_g:40, carbs_g:40, fat_g:20,
          ingredients:['salmon','quinoa','broccoli','olive oil','lemon'],
          instructions:['Bake salmon','Steam broccoli','Cook quinoa','Plate, drizzle oil + lemon'] }
      ]
    }],
    notes: `Fallback plan • diet: ${diet} • target ~${kcal} kcal/day.`,
    _meta: { fallback: true, ...meta }
  };
}
