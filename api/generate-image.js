export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, description } = req.body || {};
    if (!title || !description || description.trim().length < 20) {
        return res.status(400).json({ error: 'Title and description (min 20 chars) required' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const prompt = `A vibrant, photorealistic image for a free community event in Israel. Event: "${title}". ${description.trim()}. Style: warm, communal, inviting, Israeli local feel, high quality photography, natural lighting. No text or logos.`;

    try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'dall-e-3',
                prompt,
                n: 1,
                size: '1024x1024',
                quality: 'standard',
                response_format: 'url',
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return res.status(502).json({ error: err?.error?.message || 'Image generation failed' });
        }

        const data = await response.json();
        const url = data?.data?.[0]?.url;
        if (!url) return res.status(502).json({ error: 'No image URL returned' });

        return res.status(200).json({ url });
    } catch (e) {
        return res.status(500).json({ error: 'Internal error' });
    }
}
