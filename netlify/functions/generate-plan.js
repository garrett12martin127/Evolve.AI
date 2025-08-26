export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), { status: 405 });
    }

    const body = await req.json();
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "Server missing OPENAI_API_KEY" }), { status: 500 });
    }

    const prompt = `
You are Evolve.AI. Create a 7-day workout+meal plan as valid JSON with this schema:
{
  "week": [
    {
      "day": 1-7,
      "focus": "upper|lower|full|recovery",
      "workouts": [{"exercise": "...", "sets": n, "reps": "x-y", "rest_sec": n}],
      "meals": [{"name":"...", "kcal": n, "protein_g": n, "carbs_g": n, "fat_g": n,
                 "ingredients": ["..."], "instructions": ["..."]}]
    }
  ],
  "notes": "string"
}
Constraints:
- Use ${body.days_per_week || 5} days/week pattern.
- Diet style: ${body.diet_style || "balanced"}; allergies: ${(body.allergies || []).join(", ") || "none"}.
- Equipment: ${(body.equipment || []).join(", ") || "bodyweight only"}.
- Calorie target per day: ${body.calorie_target || 2200} (±10%).
- Professional-grade workouts: 6–7 movements on training days.
Return ONLY JSON, no extra text.
`;

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.1-mini",   // use any model your account has access to
        input: prompt,
        temperature: 0.7
      })
    });

    const data = await resp.json();
    const text = data?.output_text || data?.choices?.[0]?.message?.content || "";

    let plan;
    try {
      plan = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}$/);
      plan = match ? JSON.parse(match[0]) : { error: "Model did not return valid JSON", raw: text };
    }

    return new Response(JSON.stringify(plan), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
};

export const config = { path: "/generate-plan" };
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    }
  });
}
