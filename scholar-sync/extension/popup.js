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
      const execRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          function collectText(els) {
            return Array.from(els).map(e => e.innerText?.trim()).filter(Boolean).join(' ');
          }
          // Old transcript layout
          const oldEls = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
          if (oldEls && oldEls.length) {
            return collectText(oldEls);
          }
          // New layout attempt
          const newEls = document.querySelectorAll('yt-formatted-string.segment-text, ytd-transcript-segment-renderer #segment-text, ytd-transcript-segment-renderer yt-formatted-string');
          if (newEls && newEls.length) {
            return collectText(newEls);
          }
          // Fallback: try common transcript container text
          const host = document.querySelector('ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer');
          return host?.innerText || '';
        }
      });

      const transcript = execRes?.[0]?.result?.trim() || '';
      if (!transcript) {
        setError('No transcript found. Open a YouTube video and ensure transcript is visible.');
        hide(loader);
        return;
      }

      const resp = await fetch('http://localhost:3000/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript })
      });

      if (!resp.ok) {
        const err = await safeJson(resp);
        throw new Error(err?.error || `API error (${resp.status})`);
      }

      const data = await resp.json();
      displaySummary(data.summary);
      displayKeyConcepts(data.keyConcepts || []);
      displayQuiz(data.quiz || []);
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

  // Optional secondary actions: operate on current page selection
  async function runModify(action) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const execRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const sel = window.getSelection();
          return sel ? sel.toString() : '';
        }
      });
      const text = execRes?.[0]?.result?.trim() || '';
      if (!text) { setError('Select some text on the page to use this action.'); return; }
      setError('');
      show(loader);
      const resp = await fetch('http://localhost:3000/api/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, action })
      });
      if (!resp.ok) {
        const err = await safeJson(resp);
        throw new Error(err?.error || `API error (${resp.status})`);
      }
      const data = await resp.json();
      await navigator.clipboard.writeText(data.modifiedText || '');
      setError('Modified text copied to clipboard.');
    } catch (e) {
      setError(e?.message || 'Failed to modify text');
    } finally {
      hide(loader);
    }
  }

  rewriteBtn?.addEventListener('click', () => runModify('rewrite'));
  translateBtn?.addEventListener('click', () => runModify('translate'));
  proofreadBtn?.addEventListener('click', () => runModify('proofread'));
});


