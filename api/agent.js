export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message, systemPrompt, agents } = req.body;

  if (!message) return res.status(400).json({ error: 'No message provided' });

  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    // Return graceful fallback if key not configured
    return res.status(200).json({
      response: `🧠 FarmAds AI Brain is initialising. To activate full AI responses, add your GOOGLE_API_KEY to Vercel environment variables. In the meantime — FarmAds.ng connects Nigerian farmers to global buyers with AI brokers, pre-harvest orders, and escrow protection. Register now to get started!`,
      agents,
      fallback: true
    });
  }

  try {
    const prompt = `${systemPrompt}\n\nUser message: ${message}\n\nRespond as the FarmAds AI Brain in 3-5 sentences maximum. Be specific and actionable.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          ]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errText);
      throw new Error(`Gemini API error: ${geminiRes.status}`);
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('Empty response from Gemini');

    return res.status(200).json({ response: text, agents });

  } catch (err) {
    console.error('Agent API error:', err.message);
    // Fallback on any error — don't expose error to user
    return res.status(200).json({
      response: `🧠 FarmAds AI: I'm temporarily operating in fallback mode. FarmAds connects Nigerian farmers directly to verified international buyers in Europe, China and Asia. Our AI brokers handle export compliance, and every payment is escrow-protected. Register on FarmAds.ng to get started — it's free.`,
      agents,
      fallback: true
    });
  }
}
