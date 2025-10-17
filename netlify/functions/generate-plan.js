// netlify/functions/generate-plan.js

const fetch = require('node-fetch');

/**
 * Netlify serverless function to generate a personalized plan via OpenAI.
 * Expects a POST request with a JSON body containing a "profile" object.
 * Requires environment variables:
 *   - OPENAI_API_KEY: your OpenAI API key
 *   - OPENAI_MODEL (optional): model name (defaults to "gpt-3.5-turbo")
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed', message: 'Use POST' })
    };
  }

  let profile;
  try {
    profile = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON', message: 'Request body must be valid JSON' })
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing API key', message: 'OPENAI_API_KEY environment variable not set' })
    };
  }
  const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

  // Create a prompt to guide the model to produce structured JSON output
  const systemPrompt = `You are an AI fitness and nutrition coach. Create a 4-week plan tailored to the user's profile. 
The plan should be valid JSON with this structure:
{
  "week": [
    {
      "day": number,
      "focus": "full" or "upper" or "lower" or ...,
      "workouts": [
        { "exercise": string, "sets": number, "reps": string, "rest_sec": number, "tempo": string, "notes": string }
      ],
      "meals": [
        {
          "name": string,
          "kcal": number,
          "protein_g": number,
          "carbs_g": number,
          "fat_g": number,
          "ingredients": [string],
          "instructions": [string]
        }
      ]
    },
    ...
  ]
}
Do not wrap the JSON in markdown. Ensure it parses without errors.`;

  // Use the profile as context in the user prompt
  const userPrompt = `User profile: ${JSON.stringify(profile, null, 2)}\nPlease generate the 4-week plan described above.`;

  try {
    // Call OpenAI's chat/completions endpoint
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'OpenAI API error', message: errorBody })
      };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Empty response', message: 'No content returned from OpenAI' })
      };
    }

    // Try to parse the JSON from the AI response
    let plan;
    try {
      plan = JSON.parse(content);
    } catch (parseErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Invalid JSON from AI',
          message: 'The AI did not return valid JSON. Raw content: ' + content
        })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(plan)
    };
  } catch (err) {
    // Handle unexpected errors
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', message: err.message })
    };
  }
};
