// netlify/functions/generate-plan.js
// Chat Completions + JSON mode + safe fallback + test switch

const MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

exports.handler = async (event) => {
  // --- CORS ---
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return json(405, { error: 'Use POST' });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const profile = JSON.parse(event.body || '{}');

    // 1) No key? Always return a valid demo plan so UI renders
    if (!OPENAI_API_KEY) return json(200, planFallback(profile, { reason: 'missing_api_key' }));

    // 2) Test switch: append ?test=1 to URL to force a good JSON plan
    const url = new URL(event.rawUrl || `https://x${event.path}`);
    if (url.searchParams.get('test') === '1') {
      return json(200, planFallback(profile, { reason: 'test_mode' }));
    }

    // 3) Build prompts
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
- Respect injuries/medical; use safe substitutions in per-exercise "notes" if needed.
- Match equipment_access & equipment list; reflect listed sports when relevant.
- Balance across days_per_week; include recovery/mobility/conditioning if stress/sleep suggest.
- Meals follow diet_style; avoid allergies/dislikes; hit calorie_target ±10% with practical macros.
`.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'User profile JSON:\n' + JSON.stringify(profile, null, 2) + '\nReturn ONLY the JSON object.' }
    ];

    // 4) Call OpenAI (JSON mode)
    const out = await chatJSON(OPENAI_API_KEY, MODEL, messages, 0.6);
    const parsed = tryParseJSON(out.text);

    if (!parsed.ok) {
      // Retry once a bit stricter
      const out2 = await chatJSON(OPENAI_API_KEY, MODEL, [
        { role: 'system', content: systemPrompt + '\nSTRICT: Reply must be only a single JSON object.' },
        messages[1]
      ], 0.4);
      const parsed2 = tryParseJSON(out2.text);

      if (!parsed2.ok) {
        // Final: return a valid fallback so UI shows a plan, with error details in _meta
        const fallback = planFallback(profile, { reason: 'bad_json', model: MODEL, raw: out2.text || out.text });
        return json(200, fallback);
      }
      parsed2.value._meta = { model: MODEL, retry: true };
      return json(200, parsed2.value);
    }

    parsed.value._meta = { model: MODEL, retry: false };
    return json(200, parsed.value);

  } catch (e) {
    // Return a valid plan even on unexpected errors
    return json(200, planFallback({}, { reason: 'exception', error: String(e) }));
  }
};

/* ---------------- helpers ---------------- */
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
function json(code, obj) {
  return { statusCode: code, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(obj) };
}
async function chatJSON(key, model, messages, temperature) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages,
      temperature,
      max_tokens: 3000
    })
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return { text, data };
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
        { exercise:'Back Squat', sets:5, reps:'5',    rest_sec:120, notes:'Stay tight; neutral spine.' },
        { exercise:'Bench Press', sets:5, reps:'5',   rest_sec:120, notes:'Shoulder blades retracted.' },
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
          instructions:['Bake salmon','Steam broccoli','Cook quinoa','Plate & drizzle oil + lemon'] }
      ]
    }],
    notes: `Fallback plan • diet: ${diet} • target ~${kcal} kcal/day.`,
    _meta: { fallback: true, ...meta }
  };
}
