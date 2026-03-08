export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { prompt } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

    const categories = ['concert','festival','theater','culture','art','exhibition','museum','film','comedy','dance','sport','outdoor','nature','beach','food','market','tour','workshop','lecture','tech','family','kids','community','volunteering','wellness','yoga','meditation','nightlife','party','photography','other'];

    const systemPrompt = `You are an event planning assistant for FreeIL, a Hebrew community events platform in Israel.
Given a short description of an event, generate event details in Hebrew.
Return ONLY a valid JSON object (no markdown, no code blocks) with these exact fields:
- "title": short catchy Hebrew event title, max 60 characters
- "category": exactly one value from this list: ${categories.join(', ')}
- "description": engaging Hebrew event description, 2-3 sentences

User input: "${prompt.trim()}"`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: systemPrompt }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 512 },
                }),
            }
        );

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return res.status(502).json({ error: err?.error?.message || 'Generation failed' });
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let result;
        try {
            const clean = text.replace(/```json\n?|\n?```/g, '').trim();
            result = JSON.parse(clean);
        } catch {
            return res.status(502).json({ error: 'Failed to parse AI response' });
        }

        return res.status(200).json({
            title: result.title || '',
            category: categories.includes(result.category) ? result.category : 'other',
            description: result.description || '',
        });
    } catch {
        return res.status(500).json({ error: 'Internal error' });
    }
}
