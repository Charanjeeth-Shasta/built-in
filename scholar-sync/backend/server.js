const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { HfInference } = require('@huggingface/inference');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const hfToken = process.env.HF_TOKEN || process.env.HUGGING_FACE_TOKEN || process.env.HUGGINGFACE_API_KEY;
if (!hfToken) {
  console.warn('Warning: HF_TOKEN is not set. Set it in backend/.env');
}

const PORT = process.env.PORT || 3000;

const hf = new HfInference(hfToken || '');
// Choose a strong instruct model; can be changed if desired
const HF_MODEL = process.env.HF_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct';

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
    const response = await hf.textGeneration({
      model: HF_MODEL,
      inputs: prompt,
      parameters: {
        max_new_tokens: 500,
        temperature: 0.7,
        do_sample: true,
        return_full_text: false
      }
    });
    const text = (response?.generated_text || '').trim();

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
    const response = await hf.textGeneration({
      model: HF_MODEL,
      inputs: prompt,
      parameters: {
        max_new_tokens: 300,
        temperature: 0.3,
        do_sample: true,
        return_full_text: false
      }
    });
    const modifiedText = (response?.generated_text || '').trim();
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