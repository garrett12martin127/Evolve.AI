/*
 * Netlify function to generate a personalised four‑week training and meal plan.
 *
 * This version has been rewritten to be more robust and avoid common errors
 * encountered with missing environment variables, undefined fields and API
 * timeouts. It uses sensible defaults, provides defensive destructuring and
 * includes comprehensive error handling. The OpenAI model can be set via
 * the OPENAI_MODEL environment variable; otherwise it falls back to a
 * production‑ready default. To keep responses within Netlify’s time limits,
 * max_tokens is reduced from 2500 to 1500.
 */

const { OpenAI } = require('openai');

// Initialise the OpenAI client using the API key from the environment. If
// OPENAI_API_KEY is undefined, the constructor will throw and the handler
// will catch this and return a clear error.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Choose a default model if one is not supplied via the OPENAI_MODEL
// environment variable. We use gpt‑4o‑mini as a good balance of quality
// and cost. You can override this in Netlify’s environment settings.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Extract JSON from a string. OpenAI sometimes wraps JSON in backticks
 * or includes commentary before/after. This helper finds the first
 * well‑formed JSON object and parses it. If no JSON is found, it throws.
 *
 * @param {string} text The raw AI response
 * @returns {any} Parsed JSON object
 */
function parseJsonFromResponse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('Response did not contain valid JSON');
  }
}

exports.handler = async (event) => {
  // Only POST requests are accepted. Reject all other HTTP methods.
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
    };
  }

  let profile;
  try {
    profile = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body.' }),
    };
  }

  // Safely extract fields from the profile. Use sensible defaults for arrays
  // to avoid undefined values causing template issues. We also alias
  // protein_per_lb from protein_lb to support both names.
  const {
    age,
    sex,
    height_cm,
    weight_kg,
    weight_lb: weightLbProvided,
    protein_per_lb: proteinPerLb = profile.protein_lb,
    training_for,
    sports = [],
    activity_level,
    training_time,
    session_length,
    days_per_week,
    equipment_access,
    equipment = [],
    injuries = [],
    medical = [],
    diet_style,
    allergies = [],
    food_dislikes = [],
    calorie_target,
    sleep_hours,
    stress_level,
    motivation,
    tracking_pref,
    reminders,
  } = profile;

  // Convert weight to pounds if only kilograms are provided. Use the
  // provided weight_lb if available; otherwise compute it. Round to one
  // decimal place for display.
  const weightLb = weightLbProvided
    ? Number(weightLbProvided)
    : weight_kg
    ? parseFloat((weight_kg * 2.20462).toFixed(1))
    : undefined;

  // Compose the prompt for the AI. We list each field explicitly and provide
  // defaults (such as 'none') for empty arrays. The prompt instructs the
  // assistant to respond with strict JSON only.
  const prompt = `You are Evolve.AI, a world‑class personal trainer and nutritionist. Based on the following user profile, create a four‑week program with day‑by‑day workouts and meals. Each week has 7 days. Use realistic exercises and macros.

User profile:
- Age: ${age}, Sex: ${sex}
- Height: ${height_cm} cm, Weight: ${weight_kg} kg (${weightLb ?? 'n/a'} lb)
- Protein target: ${proteinPerLb} grams per pound
- Goal: ${training_for}
- Sports: ${sports.length ? sports.join(', ') : 'none'}
- Activity level: ${activity_level}
- Preferred training time: ${training_time}, Session length: ${session_length}
- Days per week training: ${days_per_week}
- Equipment: ${equipment_access}; Available equipment: ${equipment.length ? equipment.join(', ') : 'none'}
- Injuries/limitations: ${injuries.length ? injuries.join(', ') : 'none'}
- Medical conditions: ${medical.length ? medical.join(', ') : 'none'}
- Diet style: ${diet_style}, Allergies: ${allergies.length ? allergies.join(', ') : 'none'}, Food dislikes: ${food_dislikes.length ? food_dislikes.join(', ') : 'none'}
- Calorie target: ${calorie_target}
- Sleep: ${sleep_hours} hours/night, Stress level: ${stress_level}
- Motivation: ${motivation}, Tracking preference: ${tracking_pref}, Reminders: ${reminders}

Requirements:
1. Structure workouts into A/B/C blocks (supersets) for each day.
   - Block A: one or two main lifts (e.g., compound movements).
   - Block B: accessory lifts.
   - Block C: mobility or stability work.
2. Provide 3–5 sets per exercise with reps and rest intervals. Include a tempo if relevant.
3. Vary the focus across the week (full‑body, upper/lower splits, etc.) and apply progressive overload weekly.
4. Output meal plans that meet the calorie and diet guidelines. Include calories (kcal) and macros for each meal (protein_g, carbs_g, fat_g).
5. Represent the plan in strict JSON format with the following structure:

{
  "week": [
    {
      "week": 1,
      "days": [
        {
          "day": 1,
          "focus": "string",
          "blocks": [
            {
              "block": "A",
              "items": [
                {
                  "exercise": "string",
                  "sets": number,
                  "reps": "string",
                  "rest_sec": number,
                  "tempo": "string"
                }
              ]
            }
          ],
          "meals": [
            {
              "name": "string",
              "kcal": number,
              "protein_g": number,
              "carbs_g": number,
              "fat_g": number,
              "ingredients": ["string"],
              "instructions": ["string"]
            }
          ]
        }
      ]
    }
  ]
}

Only include the JSON in the reply with no additional commentary.`;

  try {
    // Call the OpenAI Chat API to generate the plan. We lower max_tokens
    // to 1500 to avoid hitting Netlify’s execution time limit. You can
    // adjust this if you find responses are too short or too long.
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a professional personal trainer and nutritionist delivering structured JSON plans.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const message = response.choices[0]?.message?.content?.trim();
    if (!message) {
      throw new Error('No content from OpenAI response.');
    }

    // Parse the JSON from the AI’s response. This will throw if the
    // returned text does not contain valid JSON.
    const plan = parseJsonFromResponse(message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    };
  } catch (error) {
    console.error('Error generating plan:', error.message);
    // Distinguish between timeouts and other errors for easier debugging
    const message = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: message }),
    };
  }
};
