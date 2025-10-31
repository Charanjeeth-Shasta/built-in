document.addEventListener('DOMContentLoaded', () => {
  const generateBtn = document.getElementById('generate-btn');
  const loader = document.getElementById('loader');
  const errorEl = document.getElementById('error-message');
  const resultsContainer = document.getElementById('results-container');
  const summaryEl = document.getElementById('summary');
  const keyConceptsEl = document.getElementById('key-concepts');
  const quizEl = document.getElementById('quiz');

  const rewriteBtn = document.getElementById('rewrite-btn');
  const translateBtn = document.getElementById('translate-btn');
  const proofreadBtn = document.getElementById('proofread-btn');
  const askBtn = document.getElementById('ask-btn');
  const askWrap = document.getElementById('ask-wrap');
  const questionInput = document.getElementById('question-input');
  const secondaryOutput = document.getElementById('secondary-output');
  const secondaryContent = document.getElementById('secondary-content');

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }
  function setError(msg) {
    if (!msg) { hide(errorEl); errorEl.textContent = ''; return; }
    errorEl.textContent = msg;
    show(errorEl);
  }

  // Feature-detect APIs and pre-disable buttons if needed
  function detectApis() {
    // Keep buttons enabled; runtime will route calls via page main world if popup lacks APIs
    return;
  }
  // Ensure initial UI state
  hide(loader);
  hide(errorEl);
  hide(resultsContainer);
  hide(secondaryOutput);
  detectApis();

  async function ensureTranscriptMessage(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'SS_GET_TRANSCRIPT' });
    } catch (e) {
      // Inject content script and retry once
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content-script.js'] });
        return await chrome.tabs.sendMessage(tabId, { type: 'SS_GET_TRANSCRIPT' });
      } catch (e2) {
        throw e2;
      }
    }
  }

  async function callBackendGenerate(transcript) {
    const resp = await fetch('http://localhost:3000/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript })
    });
    if (!resp.ok) {
      const err = await safeJson(resp);
      throw new Error(err?.error || `Backend error ${resp.status}`);
    }
    return await resp.json();
  }

  generateBtn.addEventListener('click', async () => {
    hide(resultsContainer);
    setError('');
    show(loader);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const msgRes = await ensureTranscriptMessage(tab.id);
      const transcript = msgRes?.transcript?.trim() || '';
      if (!transcript) {
        const reason = msgRes?.error || 'No transcript found. Open a YouTube video and ensure transcript is visible.';
        setError(reason);
        return;
      }

      const data = await callBackendGenerate(transcript);
      displaySummary(data?.summary || '');
      displayKeyConcepts(Array.isArray(data?.keyConcepts) ? data.keyConcepts : []);
      const quizArr = Array.isArray(data?.quiz) ? data.quiz : [];
      displayQuiz(quizArr.map(q => ({ question: q.question, options: q.options, answer: String(q.answer || '') })));
      show(resultsContainer);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Something went wrong.');
    } finally {
      hide(loader);
    }
  });
  async function getActiveTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }

  async function runInPageAi(op, payload) {
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error('No active tab');
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (operation, data) => {
        async function withPromptFallbackSummarize(text) {
          if (!('ai' in window)) throw new Error('On-device AI unavailable');
          if (window.ai?.summarizer) {
            try {
              const summarizer = await window.ai.summarizer.create({ type: 'long-form' });
              return await summarizer.summarize(text);
            } catch {}
          }
          if (!window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const model = await window.ai.languageModel.create({
            systemPrompt: 'Summarize educational transcripts clearly with bullet points and a brief overview.'
          });
          const result = await model.generate({
            prompt: 'Summarize the following transcript into a short overview followed by 5-8 bullet points.',
            input: [{ type: 'text', text }]
          });
          return typeof result.output === 'string' ? result.output : String(result.output);
        }

        async function concepts(text) {
          if (!('ai' in window) || !window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const schema = {
            type: 'object',
            required: ['concepts'],
            properties: { concepts: { type: 'array', minItems: 5, items: { type: 'object', required: ['term','definition','example'], properties: { term: {type:'string'}, definition:{type:'string'}, example:{type:'string'} } } } }
          };
          const model = await window.ai.languageModel.create({
            systemPrompt: 'Extract concise, undergraduate-level key concepts with one-sentence definitions and examples.'
          });
          const res = await model.generate({
            prompt: 'From the transcript, list key concepts with term, definition, and brief concrete example.',
            input: [{ type: 'text', text }],
            response: { format: 'json', schema }
          });
          return res.output || {};
        }

        async function quiz(text) {
          if (!('ai' in window) || !window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const schema = {
            type: 'object', required: ['questions'], properties: { questions: { type: 'array', minItems: 5, items: { type: 'object', required: ['question','choices','answerIndex','explanation'], properties: { question:{type:'string'}, choices:{type:'array', minItems:4, maxItems:4, items:{type:'string'}}, answerIndex:{type:'integer', minimum:0, maximum:3}, explanation:{type:'string'} } } } }
          };
          const model = await window.ai.languageModel.create({ systemPrompt: 'Write unambiguous multiple-choice quizzes (4 choices each) from transcripts.' });
          const res = await model.generate({ prompt: 'Create a beginner-friendly quiz from the transcript. Cover different ideas. Return only JSON.', input: [{ type:'text', text }], response: { format:'json', schema } });
          return res.output || {};
        }

        function normalizeString(out) {
          return typeof out === 'string' ? out : (out ? String(out) : '');
        }

        async function rewrite(text) {
          if (!('ai' in window)) throw new Error('On-device AI unavailable');
          if (window.ai?.rewriter) {
            try { const r = await window.ai.rewriter.create({ tone:'concise', audience:'student' }); return normalizeString(await r.rewrite(text)); } catch {}
          }
          if (!window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const lm = await window.ai.languageModel.create({ systemPrompt: 'Rewrite text for students: concise, clear, neutral tone.' });
          const res = await lm.generate({ prompt: 'Rewrite the following text for clarity and concision.', input: [{ type:'text', text }] });
          return normalizeString(res.output);
        }

        async function translate(text, lang) {
          if (!('ai' in window)) throw new Error('On-device AI unavailable');
          if (window.ai?.translator) {
            try { const t = await window.ai.translator.create({ targetLanguage: lang, detect: true }); return normalizeString(await t.translate(text)); } catch {}
          }
          if (!window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const lm = await window.ai.languageModel.create({ systemPrompt: `Translate to ${lang}. Preserve meaning; output only translation.` });
          const res = await lm.generate({ prompt: `Translate to ${lang} (no extra commentary):`, input: [{ type:'text', text }] });
          return normalizeString(res.output);
        }

        async function proofread(text) {
          if (!('ai' in window)) throw new Error('On-device AI unavailable');
          if (window.ai?.proofreader) {
            try { const p = await window.ai.proofreader.create({ level:'standard' }); return { correctedText: normalizeString(await p.proofread(text)) }; } catch {}
          }
          if (!window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const lm = await window.ai.languageModel.create({ systemPrompt: 'Proofread and correct grammar/spelling. Output only corrected text.' });
          const res = await lm.generate({ prompt: 'Proofread and correct the following text. Output only corrected text.', input: [{ type:'text', text }] });
          return { correctedText: normalizeString(res.output) };
        }

        async function analyzeImage(dataUrl, question) {
          if (!('ai' in window) || !window.ai?.languageModel) throw new Error('Prompt API unavailable');
          const schema = { type:'object', required:['facts'], properties:{ facts:{ type:'array', items:{ type:'string' }, minItems:3 } } };
          const model = await window.ai.languageModel.create({ systemPrompt: 'You analyze educational video frames and extract concise factual points.' });
          const blob = await (await fetch(dataUrl)).blob();
          const res = await model.generate({
            prompt: question,
            input: [ { type:'image', data: blob }, { type:'text', text: question } ],
            response: { format:'json', schema }
          });
          return res.output || {};
        }

        async function writeExplain(analysis) {
          if (!('ai' in window) || !window.ai?.writer) throw new Error('Writer API unavailable');
          const writer = await window.ai.writer.create({ audience: 'student', tone: 'friendly' });
          const factsList = Array.isArray(analysis?.facts) ? analysis.facts.join('\n- ') : '';
          const prompt = `Explain these facts clearly with an analogy and 2 follow-up questions:\n- ${factsList}`;
          return await writer.write(prompt);
        }

        switch (operation) {
          case 'summarize': return withPromptFallbackSummarize(data.text);
          case 'concepts': return concepts(data.text);
          case 'quiz': return quiz(data.text);
          case 'rewrite': return rewrite(data.text);
          case 'translate': return translate(data.text, data.lang || 'es');
          case 'proofread': return proofread(data.text);
          case 'analyzeImage': return analyzeImage(data.dataUrl, data.question);
          case 'writeExplain': return writeExplain(data.analysis);
          default: throw new Error('Unknown op');
        }
      },
      args: [op, payload]
    });
    return result;
  }

  async function safeJson(resp) {
    try { return await resp.json(); } catch { return null; }
  }

  function displaySummary(text) {
    summaryEl.textContent = text || '';
  }

  function displayKeyConcepts(concepts) {
    keyConceptsEl.innerHTML = '';
    (concepts || []).forEach(item => {
      const li = document.createElement('li');
      li.textContent = String(item);
      keyConceptsEl.appendChild(li);
    });
  }

  function displayQuiz(quizArray) {
    quizArray = Array.isArray(quizArray) ? quizArray : [];
    quizEl.innerHTML = '';
    quizArray.forEach((q, idx) => {
      const item = document.createElement('div');
      item.className = 'quiz-item';

      const question = document.createElement('div');
      question.className = 'quiz-question';
      question.textContent = `${idx + 1}. ${q.question || ''}`;
      item.appendChild(question);

      const optionsWrap = document.createElement('div');
      optionsWrap.className = 'quiz-options';

      const name = `quiz-q-${idx}`;
      const options = Array.isArray(q.options) ? q.options : [];
      options.forEach((opt, oi) => {
        const id = `${name}-${oi}`;
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = String(opt);
        input.id = id;
        const span = document.createElement('span');
        span.textContent = String(opt);
        label.appendChild(input);
        label.appendChild(span);
        optionsWrap.appendChild(label);
      });
      item.appendChild(optionsWrap);

      item.dataset.answer = String(q.answer ?? '');

      const checkBtn = document.createElement('button');
      checkBtn.className = 'quiz-check';
      checkBtn.textContent = 'Check Answer';
      checkBtn.addEventListener('click', () => {
        item.classList.remove('correct', 'incorrect');
        const selected = item.querySelector(`input[name="${name}"]:checked`);
        if (!selected) return;
        const correct = (item.dataset.answer || '').trim();
        if (selected.value.trim() === correct) {
          item.classList.add('correct');
        } else {
          item.classList.add('incorrect');
        }
      });

      item.appendChild(checkBtn);
      quizEl.appendChild(item);
    });
  }

  // Local secondary actions using on-device APIs on selected text
  async function getSelectionText() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const execRes = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const sel = window.getSelection();
        return sel ? sel.toString() : '';
      }
    });
    return execRes?.[0]?.result?.trim() || '';
  }

  function normalizeString(out) {
    return typeof out === 'string' ? out : (out ? String(out) : '');
  }

  async function rewriteLocal(text) {
    if (!('ai' in window)) throw new Error('On-device AI unavailable in this Chrome.');
    if (window.ai?.rewriter) {
      try {
        const rewriter = await window.ai.rewriter.create({ tone: 'concise', audience: 'student' });
        return normalizeString(await rewriter.rewrite(text));
      } catch {}
    }
    if (!window.ai?.languageModel) throw new Error('Rewriter API unavailable and Prompt API not available to fallback.');
    const lm = await window.ai.languageModel.create({ systemPrompt: 'Rewrite text for students: concise, clear, neutral tone.' });
    const res = await lm.generate({ prompt: 'Rewrite the following text for clarity and concision.', input: [{ type: 'text', text }] });
    return normalizeString(res.output);
  }

  async function translateLocal(text, targetLanguage) {
    if (!('ai' in window)) throw new Error('On-device AI unavailable in this Chrome.');
    if (window.ai?.translator) {
      try {
        const translator = await window.ai.translator.create({ targetLanguage, detect: true });
        return normalizeString(await translator.translate(text));
      } catch {}
    }
    if (!window.ai?.languageModel) throw new Error('Translator API unavailable and Prompt API not available to fallback.');
    const lm = await window.ai.languageModel.create({ systemPrompt: `Translate to ${targetLanguage}. Preserve meaning; output only translation.` });
    const res = await lm.generate({ prompt: `Translate to ${targetLanguage} (no extra commentary):`, input: [{ type: 'text', text }] });
    return normalizeString(res.output);
  }

  async function proofreadLocal(text) {
    if (!('ai' in window)) throw new Error('On-device AI unavailable in this Chrome.');
    if (window.ai?.proofreader) {
      try {
        const proofreader = await window.ai.proofreader.create({ level: 'standard' });
        return { correctedText: normalizeString(await proofreader.proofread(text)) };
      } catch {}
    }
    if (!window.ai?.languageModel) throw new Error('Proofreader API unavailable and Prompt API not available to fallback.');
    const lm = await window.ai.languageModel.create({ systemPrompt: 'Proofread and correct grammar/spelling. Output only corrected text.' });
    const res = await lm.generate({ prompt: 'Proofread and correct the following text. Output only corrected text.', input: [{ type: 'text', text }] });
    return { correctedText: normalizeString(res.output) };
  }

  function showSecondaryOutput(text) {
    secondaryContent.textContent = text || '';
    show(secondaryOutput);
  }

  async function callBackendModify(action, text) {
    const resp = await fetch('http://localhost:3000/api/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, text })
    });
    if (!resp.ok) {
      const err = await safeJson(resp);
      throw new Error(err?.error || `Backend error ${resp.status}`);
    }
    const json = await resp.json();
    return normalizeString(json?.modifiedText);
  }

  rewriteBtn?.addEventListener('click', async () => {
    try {
      setError(''); show(loader);
      const text = await getSelectionText();
      if (!text) throw new Error('Select some text on the page to rewrite.');
      const out = await callBackendModify('rewrite', text);
      showSecondaryOutput(out);
    } catch (e) {
      setError(e?.message || 'Rewrite failed');
    } finally { hide(loader); }
  });

  translateBtn?.addEventListener('click', async () => {
    try {
      setError(''); show(loader);
      const text = await getSelectionText();
      if (!text) throw new Error('Select some text on the page to translate.');
      const out = await callBackendModify('translate', text);
      showSecondaryOutput(out);
    } catch (e) {
      setError(e?.message || 'Translate failed');
    } finally { hide(loader); }
  });

  proofreadBtn?.addEventListener('click', async () => {
    try {
      setError(''); show(loader);
      const text = await getSelectionText();
      if (!text) throw new Error('Select some text on the page to proofread.');
      const corrected = await callBackendModify('proofread', text);
      showSecondaryOutput(corrected);
    } catch (e) {
      setError(e?.message || 'Proofread failed');
    } finally { hide(loader); }
  });

  // Multimodal: Ask about current frame (Prompt multimodal + Writer)
  askBtn?.addEventListener('click', async () => {
    askWrap.classList.remove('hidden');
    questionInput?.focus();
  });

  questionInput?.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    try {
      setError(''); show(loader);
      const q = questionInput.value.trim();
      if (!q) throw new Error('Enter a question.');
      const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: 'png' });
      let analysis, explanation;
      try {
        const blob = await (await fetch(dataUrl)).blob();
        analysis = await analyzeImageWithPrompt(blob, q);
      } catch {
        analysis = await runInPageAi('analyzeImage', { dataUrl, question: q });
      }
      try {
        explanation = await writeFriendlyExplanation(analysis);
      } catch {
        explanation = await runInPageAi('writeExplain', { analysis });
      }
      showSecondaryOutput(normalizeString(explanation));
    } catch (err) {
      setError(err?.message || 'Ask failed');
    } finally { hide(loader); }
  });

  async function analyzeImageWithPrompt(imageBlob, question) {
    if (!('ai' in window) || !window.ai?.languageModel) throw new Error('Prompt API unavailable');
    const schema = {
      type: 'object',
      required: ['facts'],
      properties: {
        facts: { type: 'array', items: { type: 'string' }, minItems: 3 }
      }
    };
    const model = await window.ai.languageModel.create({
      systemPrompt: 'You analyze educational video frames and extract concise factual points.'
    });
    const result = await model.generate({
      prompt: question,
      input: [
        { type: 'image', data: imageBlob },
        { type: 'text', text: question }
      ],
      response: { format: 'json', schema }
    });
    return result.output;
  }

  async function writeFriendlyExplanation(analysis) {
    if (!('ai' in window) || !window.ai?.writer) throw new Error('Writer API unavailable');
    const writer = await window.ai.writer.create({ audience: 'student', tone: 'friendly' });
    const factsList = Array.isArray(analysis?.facts) ? analysis.facts.join('\n- ') : '';
    const prompt = `Explain these facts clearly with an analogy and 2 follow-up questions:\n- ${factsList}`;
    return await writer.write(prompt);
  }

  // On-device main features
  async function summarizeLocal(transcript) {
    if (!('ai' in window)) {
      // Run in page main world where AI may be exposed even if popup lacks it
      const out = await runInPageAi('summarize', { text: transcript });
      return out;
    }
    if (window.ai?.summarizer) {
      try {
        const summarizer = await window.ai.summarizer.create({ type: 'long-form' });
        return await summarizer.summarize(transcript);
      } catch (e) {
        // fall through to Prompt-based summarization
      }
    }
    if (!window.ai?.languageModel) throw new Error('Summarizer API unavailable and Prompt API not available to fallback.');
    const model = await window.ai.languageModel.create({
      systemPrompt: 'Summarize educational transcripts clearly with bullet points and a brief overview.'
    });
    const result = await model.generate({
      prompt: 'Summarize the following transcript into a short overview followed by 5-8 bullet points.',
      input: [{ type: 'text', text: transcript }]
    });
    return typeof result.output === 'string' ? result.output : String(result.output);
  }

  async function generateKeyConceptsLocal(transcript) {
    if (!('ai' in window) || !window.ai?.languageModel) {
      const out = await runInPageAi('concepts', { text: transcript });
      return out?.concepts || [];
    }
    const schema = {
      type: 'object',
      required: ['concepts'],
      properties: {
        concepts: {
          type: 'array',
          minItems: 5,
          items: {
            type: 'object',
            required: ['term', 'definition', 'example'],
            properties: {
              term: { type: 'string' },
              definition: { type: 'string' },
              example: { type: 'string' }
            }
          }
        }
      }
    };
    const model = await window.ai.languageModel.create({
      systemPrompt: 'Extract concise, undergraduate-level key concepts with one-sentence definitions and examples.'
    });
    const result = await model.generate({
      prompt: 'From the transcript, list key concepts with term, definition, and brief concrete example.',
      input: [{ type: 'text', text: transcript }],
      response: { format: 'json', schema }
    });
    const out = result?.output;
    if (out?.concepts) return out.concepts;
    if (typeof out === 'string') {
      try { const parsed = JSON.parse(out); return parsed?.concepts || []; } catch {}
    }
    return [];
  }

  async function generateQuizLocal(transcript) {
    if (!('ai' in window) || !window.ai?.languageModel) {
      const out = await runInPageAi('quiz', { text: transcript });
      return out?.questions || [];
    }
    const quizSchema = {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 5,
          items: {
            type: 'object',
            required: ['question', 'choices', 'answerIndex', 'explanation'],
            properties: {
              question: { type: 'string' },
              choices: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string' } },
              answerIndex: { type: 'integer', minimum: 0, maximum: 3 },
              explanation: { type: 'string' }
            }
          }
        }
      }
    };
    const model = await window.ai.languageModel.create({
      systemPrompt: 'Write unambiguous multiple-choice quizzes (4 choices each) from transcripts.'
    });
    const result = await model.generate({
      prompt: 'Create a beginner-friendly quiz from the transcript. Cover different ideas. Return only JSON.',
      input: [{ type: 'text', text: transcript }],
      response: { format: 'json', schema: quizSchema }
    });
    const out = result?.output;
    if (out?.questions) return out.questions;
    if (typeof out === 'string') {
      try { const parsed = JSON.parse(out); return parsed?.questions || []; } catch {}
    }
    return [];
  }
});


