// netlify/functions/generate-plan.js
// CommonJS format (most compatible on Netlify)
// Reads your enhanced onboarding profile and asks OpenAI to build a tailored 7-day plan.

exports.handler = async (event) => {
  // --- CORS preflight ---
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
    if (!OPENAI_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Missing OPENAI_API_KEY on server' }) };
    }

    // ----- Parse & lightly validate incoming profile -----
    const body = JSON.parse(event.body || '{}');

    // Expect these keys from your enhanced onboarding form (already converted to metric on the frontend):
    const profile = {
      age: body.age,
      sex: body.sex,
      height_cm: body.height_cm,        // from ft+in (converted in HTML)
      weight_kg: body.weight_kg,        // from lb (converted in HTML)
      goal: body.goal,                  // same as training_for
      training_for: body.training_for,
      sports: body.sports || [],
      activity_level: body.activity_level,   // sedentary/light/moderate/very active
      training_time: body.training_time,     // morning/midday/evening
      session_length: body.session_length,   // "30 min" | "45 min" | "60 min" | "90 min"
      days_per_week: body.days_per_week,
      equipment_access: body.equipment_access, // full gym/home gym/limited/no equipment
      equipment: body.equipment || [],

      injuries: body.injuries || [],
      medical: body.medical || [],

      diet_style: body.diet_style,  // balanced/high protein/lower carb/vegetarian/pescatarian/plant-based/paleo/keto
      allergies: body.allergies || [],
      food_dislikes: body.food_dislikes || [],

      calorie_target: body.calorie_target,
      sleep_hours: body.sleep_hours, // numeric hours
      stress_level: body.stress_level, // low/medium/high

      motivation: body.motivation,     // why now?
      tracking_pref: body.tracking_pref, // scale/PRs/photos/etc.
      reminders: body.reminders        // none/weekly/daily
    };

    // Gate: basic sanity (keep it simple for MVP)
    if (!profile.age || !profile.height_cm || !profile.weight_kg) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required basics (age/height/weight)' }) };
    }

    // ----- Build prompt that leverages ALL fields -----
    const prompt = `
You are Evolve.AI, an expert coach and sports nutritionist.
Create a 7-day workout + meal plan as STRICT JSON following this schema:
{
  "week": [
    {
      "day": 1-7,
      "focus": "upper|lower|full|recovery|conditioning|hypertrophy|power|mobility",
      "workouts": [
        {"exercise":"...", "sets": number, "reps": "x-y or seconds", "rest_sec": number, "notes": "optional coaching cue"}
      ],
      "meals": [
        {"name":"...", "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number,
         "ingredients": ["..."], "instructions": ["..."]}
      ]
    }
  ],
  "notes": "short overall guidance for the week (max 2 sentences)"
}

User profile (use ALL of it):
- Age: ${profile.age}, Sex: ${profile.sex}
- Height: ${profile.height_cm} cm, Weight: ${profile.weight_kg} kg
- Training for: ${profile.training_for} (goal = ${profile.goal})
- Sports: ${profile.sports.join(', ') || 'none'}
- Lifestyle activity: ${profile.activity_level}
- Preferred training time: ${profile.training_time}
- Session length: ${profile.session_length}
- Days per week: ${profile.days_per_week}
- Equipment access: ${profile.equipment_access}
- Equipment list: ${profile.equipment.join(', ') || 'none'}
- Injuries/limitations: ${profile.injuries.join(', ') || 'none'}
- Medical considerations: ${profile.medical.join(', ') || 'none'}
- Diet style: ${profile.diet_style}
- Allergies: ${profile.allergies.join(', ') || 'none'}
- Food dislikes/restrictions: ${profile.food_dislikes.join(', ') || 'none'}
- Calorie target: ${profile.calorie_target} kcal/day (stay within ±10%)
- Sleep: ${profile.sleep_hours} h/night
- Stress: ${profile.stress_level}
- Motivation: ${profile.motivation}
- Tracking preference: ${profile.tracking_pref}
- Reminders: ${profile.reminders}

Programming rules:
- Professional-grade training on training days: include 6–7 movements; pick compounds first; respect ${profile.session_length} and ${profile.training_time}.
- Respect injuries/medical limits: avoid contraindicated movements, suggest substitutions; keep coaching cues in "notes".
- Match ${profile.equipment_access} and available equipment.
- Reflect sports (${profile.sports.join(', ') || 'none'}) with movement selection or conditioning when relevant.
- Balance weekly structure across ${profile.days_per_week} days; include at least one recovery/mobility/conditioning day if goal and stress suggest it.
- Meals must follow ${profile.diet_style}, avoid allergies/dislikes, and match ${profile.calorie_target} kcal/day ±10% with reasonable macros.
- Keep instructions concise and practical; ingredients should be grocery-store realistic.
- Return ONLY JSON that matches the schema exactly (no markdown, no extra text).
`;

    // ----- Call OpenAI Responses API -----
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Pick a model your plan supports (or upgrade to a larger one if needed)
        model: 'gpt-5.1-mini',
        input: prompt,
        temperature: 0.7,
        max_output_tokens: 3000
      })
    });

    const data = await resp.json();

    // Extract text; different responses formats exist, support common ones
    const text =
      data?.output_text ||
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      '';

    // Robust JSON parse (with fallback)
    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      const match = String(text).match(/\{[\s\S]*\}$/); // try to grab the last JSON block
      plan = match ? JSON.parse(match[0]) : { error: 'Model did not return valid JSON', raw: text };
    }

    // Optional: attach a tiny echo of key settings for debugging in UI JSON panel
    plan._meta = {
      calorie_target: profile.calorie_target,
      days_per_week: profile.days_per_week,
      diet_style: profile.diet_style,
      equipment_access: profile.equipment_access,
      injuries: profile.injuries,
      sports: profile.sports
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(plan)
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: String(e) })
    };
  }
};
