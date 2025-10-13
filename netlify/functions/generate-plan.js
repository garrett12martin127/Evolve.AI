// /.netlify/functions/generate-plan.js
//
// This Netlify serverless function receives a POST request with a user profile
// and calls the OpenAI API to generate a personalized weekly workout and meal plan.
// It expects two environment variables to be set in Netlify’s settings:
//   OPENAI_API_KEY  – your secret API key (looks like 'sk-...')
//   OPENAI_MODEL    – the model name (e.g., 'gpt-4-turbo' or 'gpt-3.5-turbo')
// You do not need to edit this file. Just deploy with your API key/model set.

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

exports.handler = async function (event, context) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Use POST' })
    };
  }

  // Parse the incoming request body
  let profile;
  try {
    profile = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON in request body', details: e.message })
    };
  }

  // Ensure required environment variables are present
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4-turbo';

  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing OPENAI_API_KEY environment variable' })
    };
  }

  // Construct the prompt for the model.  You can adjust the wording
  // here if you need different output formats, but the model will always
  // return pure JSON in the final response.
  const systemPrompt = `
You are a professional strength coach and nutritionist AI. 
Given a user profile, you produce a one-week plan with:
- workouts: Supersetted A/B/C blocks with exercises, sets, reps, rest seconds, tempo, and optional notes.
- meals: Balanced breakfast, lunch, dinner, and snacks with calories, macros, ingredients, and instructions.
Return valid JSON. Do not wrap in code fences. The JSON format:
{
  "week": [
    {
      "day": 1,
      "focus": "upper" | "lower" | "full" | "push" | "pull" | "cardio",
      "blocks": [
        {
          "block": "A",
          "items": [
            {
              "exercise": "Bench Press",
              "sets": 4,
              "reps": "6–8",
              "rest_sec": 90,
              "tempo": "2-1-1",
              "notes": "Use 75% 1RM"
            },
            …
          ]
        },
        …
      ],
      "meals": [
        {
          "name": "Breakfast",
          "kcal": 500,
          "protein_g": 35,
          "carbs_g": 50,
          "fat_g": 15,
          "ingredients": ["egg whites", "oats", "banana"],
          "instructions": ["Cook oats", "Add sliced banana", "Serve with scrambled egg whites"]
        },
        …
      ]
    },
    …
  ]
}`;
  const userPrompt = `User profile:\n${JSON.stringify(profile, null, 2)}\nPlease generate the JSON plan.`;

  // Prepare the API call
  const apiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt.trim() },
        { role: 'user', content: userPrompt.trim() }
      ],
      temperature: 0.7,
      max_tokens: 1800
    })
  });

  // If OpenAI returns an error code, propagate it
  const aiData = await apiResponse.json();
  if (!apiResponse.ok) {
    return {
      statusCode: apiResponse.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: aiData.error || aiData })
    };
  }

  // Extract and clean the assistant’s content
  let content = aiData?.choices?.[0]?.message?.content || '';
  content = content.trim();

  // Strip code fences if present (the model may sometimes wrap JSON in ``` blocks)
  if (content.startsWith('```')) {
    content = content.replace(/^```json[\s\S]*?\n/, '').replace(/```$/, '');
  }

  // Attempt to parse the JSON from the response
  let plan;
  try {
    plan = JSON.parse(content);
  } catch (err) {
    // If parsing fails, return a structured error with the raw content
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Invalid JSON returned by model',
        raw: content,
        details: err.message
      })
    };
  }

  // Return the parsed plan
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan)
  };
};
