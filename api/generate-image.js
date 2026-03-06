export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, description } = req.body || {};
    if (!title || !description || description.trim().length < 20) {
        return res.status(400).json({ error: 'Title and description (min 20 chars) required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'API key not configured' });
    }

    const prompt = `A vibrant, photorealistic image for a free community event in Israel. Event: "${title}". ${description.trim()}. Style: warm, communal, inviting, Israeli local feel, high quality photography, natural lighting. No text or logos.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt }],
                    parameters: { sampleCount: 1, aspectRatio: '16:9' },
                }),
            }
        );

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return res.status(502).json({ error: err?.error?.message || 'Image generation failed' });
        }

        const data = await response.json();
        const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
        const mime = data?.predictions?.[0]?.mimeType || 'image/png';
        if (!b64) return res.status(502).json({ error: 'No image returned' });

        return res.status(200).json({ url: `data:${mime};base64,${b64}` });
    } catch (e) {
        return res.status(500).json({ error: 'Internal error' });
    }
}
