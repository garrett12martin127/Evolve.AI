// netlify/functions/generate-plan.js
import fetch from "node-fetch";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
  }

  // 1) Parse the user profile sent from index.html
  let profile = {};
  try { profile = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON in request" }) }; }

  // 2) Read secrets from Netlify (never put your key in the front-end)
  const apiKey = process.env.OPENAI_API_KEY;
  const model  = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing OPENAI_API_KEY" }) };
  }

  // 3) Strong instructions so the model creates unique, pro-grade plans
  const systemPrompt = [
    "You are Evolve.AI, a certified strength & conditioning coach and sports nutritionist.",
    "Create a fresh 7-day plan from scratch based on the user's profile (goals, equipment, injuries).",
    "Use A/B/C superset blocks with realistic sets, reps, rest, tempo, and coaching notes.",
    "Meals must land within ±5% of the daily calorie target with reasonable macros.",
    "Avoid repeating identical exercises across the week unless justified by the goal.",
    "Return VALID JSON only, matching the schema. No extra commentary."
  ].join("\n");

  // 4) JSON schema that matches what index.html expects
  const schema = {
    type: "object",
    properties: {
      week: {
        type: "array",
        items: {
          type: "object",
          properties: {
            day: { type: "number" },
            focus: { type: "string" },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  block: { type: "string" }, // "A", "B", "C"
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        code: { type: "string" },        // "A1", "A2"
                        exercise: { type: "string" },
                        sets: { type: "number" },
                        reps: { type: "string" },        // "6–8"
                        rest_sec: { type: "number" },    // 60, 90
                        tempo: { type: "string" },       // "2-0-1"
                        notes: { type: "string" }
                      },
                      required: ["code","exercise","sets","reps","rest_sec"]
                    }
                  }
                },
                required: ["block","items"]
              }
            },
            meals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  kcal: { type: "number" },
                  protein_g: { type: "number" },
                  carbs_g: { type: "number" },
                  fat_g: { type: "number" },
                  ingredients: { type: "array", items: { type: "string" } },
                  instructions: { type: "array", items: { type: "string" } }
                },
                required: ["name","kcal"]
              }
            }
          },
          required: ["day","blocks","meals"]
        }
      }
    },
    required: ["week"]
  };

  // 5) Helper to call OpenAI with creative settings (variety) and structured JSON
  async function callModel(temp=0.95) {
    const body = {
      model,
      temperature: temp,            // ↑ more variety
      top_p: 0.9,                   // keep coherent, still creative
      response_format: { type: "json_schema", json_schema: { name: "PlanSchema", schema } },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Generate a 7-day plan following the schema exactly. Tailor to this profile:\n" +
            JSON.stringify(profile)
        }
      ]
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const out = await r.json();
    if (!r.ok) throw new Error(out?.error?.message || "Model error");
    const text = out?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Empty model response");
    return JSON.parse(text); // guaranteed JSON due to response_format
  }

  try {
    // First try: creative
    let plan = await callModel(0.95);
    // If you still see repeats, you can lightly shuffle items here or re-ask the model for a variant.

    return { statusCode: 200, body: JSON.stringify(plan) };
  } catch (e1) {
    // Second try: more deterministic (safer)
    try {
      const plan = await callModel(0.6);
      return { statusCode: 200, body: JSON.stringify(plan) };
    } catch (e2) {
      return { statusCode: 500, body: JSON.stringify({ error: e2.message || e1.message }) };
    }
  }
};
