const https = require('https');

exports.handler = async (event) => {
  try {
    const profile = JSON.parse(event.body);

    // prepare messages for ChatGPT
    const messages = [
      { role: "system", content: "You are a fitness and nutrition coach ..." },
      { role: "user", content: JSON.stringify(profile) }
    ];

    // call OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    const model  = process.env.OPENAI_MODEL || "gpt-4";
    const data = JSON.stringify({ model, messages, temperature: 0.7 });

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data)
        }
      }, (res) => {
        let chunks = "";
        res.on("data", (chunk) => chunks += chunk);
        res.on("end", () => resolve(JSON.parse(chunks)));
      });
      req.on("error", (e) => reject(e));
      req.write(data);
      req.end();
    });

    const aiMessage = response.choices[0].message.content.trim();
    // ensure the AI’s reply is valid JSON
    const plan = JSON.parse(aiMessage);

    return {
      statusCode: 200,
      body: JSON.stringify(plan)
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
