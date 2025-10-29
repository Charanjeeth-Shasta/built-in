const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY is not set. Set it in backend/.env');
}

const PORT = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(apiKey || '');
const model = () => genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

function buildStudyGuidePrompt(transcript) {
  return [
    'You are an assistant that produces structured study guides from YouTube transcripts.',
    'Return ONLY valid minified JSON matching this exact schema, no code fences:',
    '{"summary":"string","keyConcepts":["string"],"quiz":[{"question":"string","options":["string"],"answer":"string"}]}',
    'Rules:',
    '- Keep summary concise (3-5 sentences).',
    '- Provide 5-10 key concepts as "Concept: Explanation" strings.',
    '- Create 5 multiple-choice questions. Each has 4 options and one correct answer that exactly matches one option.',
    '- Do not include any markdown, explanation, or extra text. Output must be PURE JSON.',
    '',
    'Transcript:',
    transcript
  ].join('\n');
}

function extractJson(text) {
  if (!text) return null;
  // Try direct parse first
  try { return JSON.parse(text); } catch (_) {}
  // Strip code fences if present
  const fenceMatch = text.match(/```[\s\S]*?```/);
  if (fenceMatch) {
    const inner = fenceMatch[0].replace(/```json|```/g, '').trim();
    try { return JSON.parse(inner); } catch (_) {}
  }
  // Find first JSON object via braces balancing
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = text.slice(start, end + 1);
    try { return JSON.parse(slice); } catch (_) {}
  }
  return null;
}

app.post('/api/generate', async (req, res) => {
  try {
    const { transcript } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return res.status(400).json({ error: 'Missing or invalid transcript' });
    }

    const prompt = buildStudyGuidePrompt(transcript);
    const response = await model().generateContent(prompt);
    const text = response?.response?.text?.() || '';

    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') {
      return res.status(502).json({ error: 'AI returned invalid JSON', raw: text });
    }

    // Basic shape validation
    if (!('summary' in parsed) || !('keyConcepts' in parsed) || !('quiz' in parsed)) {
      return res.status(502).json({ error: 'AI JSON missing required fields', raw: parsed });
    }

    return res.json(parsed);
  } catch (err) {
    console.error('Error in /api/generate:', err);
    const message = err?.message || 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

app.post('/api/modify', async (req, res) => {
  try {
    const { text, action } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid text' });
    }
    if (!['rewrite', 'translate', 'proofread'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use rewrite|translate|proofread' });
    }

    let instruction;
    switch (action) {
      case 'rewrite':
        instruction = 'Rewrite this text for clarity and concision, preserving meaning:';
        break;
      case 'translate':
        instruction = 'Translate this text to Spanish. Output only the translated text:';
        break;
      case 'proofread':
        instruction = 'Proofread and correct grammar/spelling. Output the corrected text only:';
        break;
    }

    const prompt = `${instruction}\n\n${text}`;
    const response = await model().generateContent(prompt);
    const modifiedText = (response?.response?.text?.() || '').trim();
    if (!modifiedText) {
      return res.status(502).json({ error: 'AI returned empty modification' });
    }
    return res.json({ modifiedText });
  } catch (err) {
    console.error('Error in /api/modify:', err);
    const message = err?.message || 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

app.get('/', (_req, res) => {
  res.send('ScholarSync backend is running');
});

app.listen(PORT, () => {
  console.log(`ScholarSync backend listening on http://localhost:${PORT}`);
});


