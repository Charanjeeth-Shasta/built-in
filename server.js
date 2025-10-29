import express from 'express';
import cors from 'cors';
import { YoutubeTranscript } from 'youtube-transcript';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow requests from the Chrome extension
app.use(express.json());

// --- Gemini API Configuration ---

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=";
// The API key is an empty string. It's assumed the environment (like Canvas) will provide it.
// If running locally, set this via a .env file and `process.env.GEMINI_API_KEY`.
const API_KEY = ""; 

// Define the structured JSON schema for our study guide
const studyGuideSchema = {
  type: "OBJECT",
  properties: {
    "title": { "type": "STRING", "description": "A concise, academic title for the study guide based on the video." },
    "keyConcepts": {
      "type": "ARRAY",
      "description": "A list of the most important concepts, definitions, or topics.",
      "items": {
        "type": "OBJECT",
        "properties": {
          "concept": { "type": "STRING", "description": "The name of the key concept." },
          "explanation": { "type": "STRING", "description": "A brief, clear explanation of the concept." }
        },
        "required": ["concept", "explanation"]
      }
    },
    "detailedSummary": { "type": "STRING", "description": "A comprehensive, multi-paragraph summary of the entire video." },
    "quizQuestions": {
      "type": "ARRAY",
      "description": "A list of multiple-choice questions to test understanding.",
      "items": {
        "type": "OBJECT",
        "properties": {
          "question": { "type": "STRING", "description": "The question text." },
          "options": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "An array of 4-5 potential answers." },
          "answer": { "type": "STRING", "description": "The correct answer from the options array." }
        },
        "required": ["question", "options", "answer"]
      }
    }
  },
  "required": ["title", "keyConcepts", "detailedSummary", "quizQuestions"]
};

/**
 * A helper function to call the Gemini API with exponential backoff.
 * @param {object} payload - The payload to send to the Gemini API.
 * @param {number} retries - The number of retries left.
 * @returns {Promise<object>} - The API response data.
 */
async function callGemini(payload, retries = 3, delay = 1000) {
  const apiUrl = `${GEMINI_API_URL}${API_KEY}`;
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const candidate = result.candidates?.[0];

    if (candidate?.content?.parts?.[0]?.text) {
      return candidate.content.parts[0].text;
    } else {
      throw new Error("Invalid API response structure.");
    }
  } catch (error) {
    if (retries > 0) {
      // Don't log retry attempts to the console
      await new Promise(res => setTimeout(res, delay));
      return callGemini(payload, retries - 1, delay * 2);
    } else {
      console.error("Gemini API call failed after multiple retries:", error);
      throw error; // Re-throw the final error
    }
  }
}

// --- API Endpoints ---

/**
 * Main endpoint to generate the complete study guide.
 * Takes a YouTube URL, fetches the transcript, and calls Gemini
 * with the structured JSON schema.
 */
app.post('/api/generate-guide', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required.' });
  }

  let transcriptText = '';
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(url);
    transcriptText = transcript.map(t => t.text).join(' ');
    if (!transcriptText) {
      throw new Error("No transcript found or transcript is empty.");
    }
  } catch (error) {
    console.error("Transcript fetch error:", error);
    return res.status(500).json({ error: 'Failed to fetch video transcript. The video may not have one.' });
  }

  // Construct the payload for Gemini
  const systemPrompt = "You are an AI assistant, 'ScholarSync.' Your job is to turn a long video transcript into a comprehensive, academic study guide. Respond ONLY with the requested JSON object.";
  const userQuery = `Please analyze the following video transcript and generate a study guide:\n\nTRANSCRIPT:\n"""\n${transcriptText}\n"""`;

  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: studyGuideSchema
    }
  };

  try {
    const jsonString = await callGemini(payload);
    const studyGuideData = JSON.parse(jsonString);
    res.json(studyGuideData);
  } catch (error) {
    console.error("Study guide generation error:", error);
    res.status(500).json({ error: 'Failed to generate AI study guide.' });
  }
});

/**
 * Generic endpoint for secondary AI actions (Rewrite, Translate, Proofread).
 */
app.post('/api/perform-action', async (req, res) => {
  const { text, action, context } = req.body;
  
  if (!text || !action) {
    return res.status(400).json({ error: 'Text and action are required.' });
  }

  let systemPrompt, userQuery;

  switch (action) {
    case 'rewrite':
      systemPrompt = "You are an AI Rewriter. Rewrite the provided text to be more academic and formal. Respond only with the rewritten text.";
      userQuery = `Rewrite this text: "${text}"`;
      break;
    case 'translate':
      systemPrompt = `You are an AI Translator. Translate the provided text into ${context || 'Spanish'}. Respond only with the translated text.`;
      userQuery = `Translate this text: "${text}"`;
      break;
    case 'proofread':
      systemPrompt = "You are an AI Proofreader. Correct all spelling and grammar mistakes in the provided text. Respond only with the corrected text.";
      userQuery = `Proofread this text: "${text}"`;
      break;
    default:
      return res.status(400).json({ error: 'Invalid action.' });
  }

  const payload = {
    contents: [{ parts: [{ text: userQuery }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };

  try {
    const resultText = await callGemini(payload);
    res.json({ result: resultText.trim() });
  } catch (error) {
    console.error(`Error during ${action}:`, error);
    res.status(500).json({ error: `Failed to ${action} text.` });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`ScholarSync backend listening at http://localhost:${port}`);
});
