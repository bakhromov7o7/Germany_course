const fetch = require('node-fetch');
require('dotenv').config();

async function checkAI() {
  const apiKey = process.env.GROQ_API_KEY;
  const apiBase = process.env.OPENAI_API_BASE || 'https://api.groq.com/openai/v1';
  const model = process.env.OPENAI_MODEL || 'openai/gpt-oss-20b';

  console.log('Checking AI status...');
  console.log('Model:', model);
  console.log('Base URL:', apiBase);

  try {
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say "AI is working"' }],
        max_tokens: 10
      })
    });

    const data = await response.json();
    if (response.ok) {
      console.log('Success:', data.choices[0].message.content);
    } else {
      console.log('Error:', data);
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

checkAI();
