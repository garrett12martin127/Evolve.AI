// netlify/functions/generate-plan.js
// CommonJS; includes CORS + a safe fallback if OPENAI_API_KEY is missing.

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

    const body = JSON.parse(event.body || '{}');
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

    // Build prompt from profile
    const profile = body;
    const prompt = `
You are Evolve.AI, an expert coach and sports nutritionist.
Create a 7-day workout + meal plan as STRICT JSON (no extra text). Schema:
{
  "week": [
    {"day":1-7,"focus":"upper|lower|full|recovery|conditioning|hypertrophy|power|mobility",
     "workouts":[{"exercise":"...","sets":number,"reps":"x-y or seconds","rest_sec":number,"notes":"optional"}],
     "meals": [{"name":"...","kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,"ingredients":["..."],"instructions":["..."]}]
    }
  ],
  "notes":"short weekly guidance"
}
User profile JSON:
${JSON.stringify(profile)}
Rules: professional-grade training (6–7 movements per training day); respect injuries & equipment; match diet style & allergies; hit calorie_target ±10%; keep instructions concise. Return ONLY JSON.
`;

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.1-mini',   // change if your account uses a different model, e.g. 'gpt-4o-mini'
        input: prompt,
        temperature: 0.7,
        max_output_tokens: 3000
      })
    });

    const data = await resp.json();
    const text = data?.output_text || data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';

    let plan;
    try { plan = JSON.parse(text); }
    catch {
      const match = String(text).match(/\{[\s\S]*\}$/);
      plan = match ? JSON.parse(match[0]) : { error:'Model did not return valid JSON', raw:text };
    }

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
    
