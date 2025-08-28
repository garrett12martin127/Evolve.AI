// netlify/functions/generate-plan.js
// JSON-mode, robust parsing, retry-on-bad-JSON. CommonJS for Netlify.

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; 
// Tip: if you want to try the other one, set OPENAI_MODEL in Netlify env to "gpt-5.1-mini" or similar.

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const body = JSON.parse(event.body || '{}');

    // Fallback plan so UI shows something even without a key (helps diagnose plumbing)
    if (!OPENAI_API_KEY) {
      return {
        statusCode: 200,
        headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' },
        body: JSON.stringify({
          week: [{
            day: 1, focus: 'full',
            workouts: [
              { exercise:'Goblet Squat', sets:4, reps:'8-10', rest_sec:75 },
              { exercise:'Push-Up', sets:4, reps:'AMRAP', rest_sec:60 },
              { exercise:'DB Row', sets:3, reps:'10-12', rest_sec:60 },
              { exercise:'RDL', sets:3, reps:'8-10', rest_sec:90 },
              { exercise:'Plank', sets:3, reps:'45s', rest_sec:45 }
            ],
            meals: [
              { name:'Omelet + Avocado', kcal:520, protein_g:32, carbs_g:18, fat_g:35,
                ingredients:['eggs','avocado','spinach'],
                instructions:['Whisk eggs','Cook with spinach','Top with avocado'] }
            ]
          }],
          notes: 'Demo plan: add OPENAI_API_KEY in Netlify to enable live AI.'
        })
      };
    }

    const profile = body;

    // Single source of truth for the prompt
    const systemPrompt = `
You are Evolve.AI, an expert coach and sports nutritionist.
Return ONLY a valid JSON object that matches this schema, with no extra text, no markdown fences:
{
  "week": [
    {
      "day": 1-7,
      "focus": "upper|lower|full|recovery|conditioning|hypertrophy|power|mobility",
      "workouts": [
        {"exercise":"...", "sets": number, "reps":"x-y or seconds", "rest_sec": number, "notes":"optional coaching cue"}
      ],
      "meals": [
        {"name":"...", "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number,
         "ingredients": ["..."], "instructions": ["..."]}
      ]
    }
  ],
  "notes": "short overall guidance for the week (max 2 sentences)"
}

Programming rules:
- Professional-grade training on training days: 6–7 movements; compounds first; match session_length and training_time.
- Respect injuries/medical limits; suggest safe substitutions in "notes" per exercise if needed.
- Match equipment_access and provided equipment list.
- Reflect sports with appropriate movement selection/conditioning when relevant.
- Balance the week across days_per_week; include at least one recovery/mobility/conditioning day if stress/sleep suggest it.
- Meals must follow diet_style, avoid allergies/dislikes, and hit calorie_target ±10% with practical macros and concise instructions.
`;

    const userPrompt = {
      role: "user",
      content:
        "User profile JSON:\n" +
        JSON.stringify(profile, null, 2) +
        "\n\nReturn ONLY the JSON object, no prose, no markdown."
    };

    async function callOpenAI() {
      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          // Many OpenAI models honor this structured JSON response format:
          response_format: { type: "json_object" },
          // Use the "input" (Responses API) with messages-style content:
          input: [
            { role: "system", content: systemPrompt },
            userPrompt
          ],
          temperature: 0.7,
          max_output_tokens: 3500
        })
      });
      return resp.json();
    }

    function tryParseJSON(text) {
      try { return { ok: true, value: JSON.parse(text) }; }
      catch {
        // try to salvage the largest {...} block
        const first = text.indexOf('{');
        const last  = text.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
          const slice = text.slice(first, last + 1);
          try { return { ok: true, value: JSON.parse(slice) }; } catch {}
        }
        return { ok: false, error: 'Invalid JSON', raw: text };
      }
    }

    // First attempt (JSON mode)
    let data = await callOpenAI();
    let text = data?.output_text || data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';

    let parsed = tryParseJSON(text);

    // If still bad, do one retry with a stricter instruction
    if (!parsed.ok) {
      const retry = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          response_format: { type: "json_object" },
          input: [
            { role: "system", content: systemPrompt + "\nSTRICT MODE: Your entire reply MUST be a single JSON object, no leading/trailing text." },
            userPrompt
          ],
          temperature: 0.4,
          max_output_tokens: 3500
        })
      }).then(r => r.json());

      text = retry?.output_text || retry?.choices?.[0]?.message?.content || retry?.choices?.[0]?.text || '';
      parsed = tryParseJSON(text);
    }

    if (!parsed.ok) {
      // Return a clear error + raw model text for debugging in your JSON panel
      return {
        statusCode: 200,
        headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' },
        body: JSON.stringify({
          error: 'Model did not return valid JSON after retry.',
          hint: 'Check OPENAI_MODEL env or try a different model. You can also show this to the UI for debugging.',
          raw: text
        })
      };
    }

    // Attach a tiny _meta for troubleshooting if you like
    const plan = parsed.value;
    plan._meta = {
      model: MODEL,
      calorie_target: profile.calorie_target,
      days_per_week: profile.days_per_week,
      diet_style: profile.diet_style
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' },
      body: JSON.stringify(plan)
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' },
      body: JSON.stringify({ error: String(e) })
    };
  }
};
