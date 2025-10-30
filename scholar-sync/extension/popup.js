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

  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function setError(msg) {
    if (!msg) { hide(errorEl); errorEl.textContent = ''; return; }
    errorEl.textContent = msg;
    show(errorEl);
  }

  generateBtn.addEventListener('click', async () => {
    hide(resultsContainer);
    setError('');
    show(loader);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const msgRes = await chrome.tabs.sendMessage(tab.id, { type: 'SS_GET_TRANSCRIPT' });
      const transcript = msgRes?.transcript?.trim() || '';
      if (!transcript) {
        const reason = msgRes?.error || 'No transcript found. Open a YouTube video and ensure transcript is visible.';
        setError(reason);
        hide(loader);
        return;
      }

      // Local on-device AI calls
      const summary = await summarizeLocal(transcript);
      displaySummary(summary);

      const keyConcepts = await generateKeyConceptsLocal(transcript);
      displayKeyConcepts(keyConcepts.map(k => `${k.term}: ${k.definition} (e.g., ${k.example})`));

      const quiz = await generateQuizLocal(transcript);
      displayQuiz(quiz.map(q => ({ question: q.question, options: q.choices, answer: String(q.choices[q.answerIndex] ?? '') })));
      show(resultsContainer);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Something went wrong.');
    } finally {
      hide(loader);
    }
  });

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

  async function rewriteLocal(text) {
    if (!('ai' in window) || !window.ai?.rewriter) throw new Error('Rewriter API unavailable');
    const rewriter = await window.ai.rewriter.create({ tone: 'concise', audience: 'student' });
    return await rewriter.rewrite(text);
  }

  async function translateLocal(text, targetLanguage) {
    if (!('ai' in window) || !window.ai?.translator) throw new Error('Translator API unavailable');
    const translator = await window.ai.translator.create({ targetLanguage, detect: true });
    return await translator.translate(text);
  }

  async function proofreadLocal(text) {
    if (!('ai' in window) || !window.ai?.proofreader) throw new Error('Proofreader API unavailable');
    const proofreader = await window.ai.proofreader.create({ level: 'standard' });
    return await proofreader.proofread(text);
  }

  rewriteBtn?.addEventListener('click', async () => {
    try {
      setError(''); show(loader);
      const text = await getSelectionText();
      if (!text) throw new Error('Select some text on the page to rewrite.');
      const out = await rewriteLocal(text);
      await navigator.clipboard.writeText(out || '');
      setError('Rewritten text copied to clipboard.');
    } catch (e) {
      setError(e?.message || 'Rewrite failed');
    } finally { hide(loader); }
  });

  translateBtn?.addEventListener('click', async () => {
    try {
      setError(''); show(loader);
      const text = await getSelectionText();
      if (!text) throw new Error('Select some text on the page to translate.');
      const out = await translateLocal(text, 'es');
      await navigator.clipboard.writeText(out || '');
      setError('Translated text copied to clipboard.');
    } catch (e) {
      setError(e?.message || 'Translate failed');
    } finally { hide(loader); }
  });

  proofreadBtn?.addEventListener('click', async () => {
    try {
      setError(''); show(loader);
      const text = await getSelectionText();
      if (!text) throw new Error('Select some text on the page to proofread.');
      const res = await proofreadLocal(text);
      const corrected = res?.correctedText || res?.text || '';
      await navigator.clipboard.writeText(corrected);
      setError('Proofread text copied to clipboard.');
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
      const blob = await (await fetch(dataUrl)).blob();
      const analysis = await analyzeImageWithPrompt(blob, q);
      const explanation = await writeFriendlyExplanation(analysis);
      await navigator.clipboard.writeText(explanation);
      setError('Answer copied to clipboard.');
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
    if (!('ai' in window)) throw new Error('On-device AI unavailable in this Chrome.');
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
    if (!('ai' in window) || !window.ai?.languageModel) throw new Error('Prompt API unavailable');
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
    return result.output.concepts || [];
  }

  async function generateQuizLocal(transcript) {
    if (!('ai' in window) || !window.ai?.languageModel) throw new Error('Prompt API unavailable');
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
    return result.output.questions || [];
  }
});


