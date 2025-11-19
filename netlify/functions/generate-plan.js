const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

/**
 * Helper to extract JSON from within triple backticks or plain text
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

  const {
    age, sex, height_cm, weight_kg, weight_lb, protein_lb, training_for, sports,
    activity_level, training_time, session_length, days_per_week, equipment_access,
    equipment, injuries, medical, diet_style, allergies, food_dislikes,
    calorie_target, sleep_hours, stress_level, motivation, tracking_pref, reminders
  } = profile;

  // Compose a detailed prompt for OpenAI
  const prompt = `
You are Evolve.AI, a world-class personal trainer and nutritionist. Based on the following user profile, create a four-week program with day-by-day workouts and meals. Each week has 7 days. Use realistic exercises and macros.

User profile:
- Age: ${age}, Sex: ${sex}
- Height: ${height_cm} cm, Weight: ${weight_kg} kg ( ${weight_lb} lb )
- Protein target: ${protein_lb} grams per pound
- Goal: ${training_for}
- Sports: ${sports.join(', ') || 'none'}
- Activity level: ${activity_level}
- Preferred training time: ${training_time}, Session length: ${session_length}
- Days per week training: ${days_per_week}
- Equipment: ${equipment_access}; Available equipment: ${equipment.join(', ') || 'none'}
- Injuries/limitations: ${injuries.join(', ') || 'none'}
- Medical conditions: ${medical.join(', ') || 'none'}
- Diet style: ${diet_style}, Allergies: ${allergies.join(', ') || 'none'}, Food dislikes: ${food_dislikes.join(', ') || 'none'}
- Calorie target: ${calorie_target}
- Sleep: ${sleep_hours} hours/night, Stress level: ${stress_level}
- Motivation: ${motivation}, Tracking preference: ${tracking_pref}, Reminders: ${reminders}

Requirements:
1. Structure workouts into A/B/C blocks (supersets) for each day. Typically:
   - Block A: one or two main lifts (e.g., compound movements).  
   - Block B: accessory lifts.
   - Block C: mobility or stability work.
2. Provide 3–5 sets per exercise with reps and rest intervals. Include a tempo if relevant.
3. Vary the focus across the week (full-body, upper/lower splits, etc.) and apply progressive overload weekly.
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

Only include the JSON in the reply with no additional commentary.
`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a professional personal trainer and nutritionist delivering structured JSON plans.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2500,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const message = response.choices[0].message?.content?.trim();
    if (!message) {
      throw new Error('No content from OpenAI response.');
    }

    const plan = parseJsonFromResponse(message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    };
  } catch (error) {
    console.error('Error generating plan:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
