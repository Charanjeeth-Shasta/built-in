ScholarSync: AI-Powered YouTube Study Guides

This project turns any YouTube educational video into a structured study guide, complete with summaries, key concepts, and quizzes. All AI runs on-device using Chrome’s Built‑in AI APIs; there is no backend.

Project Structure

scholar-sync/
└── extension/
    ├── icons/
    │   ├── icon16.png
    │   ├── icon48.png
    │   └── icon128.png
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    ├── content-script.js
    └── styles.css


How to Run (Chrome Extension Only)

1) Open Google Chrome.
2) Go to chrome://extensions/.
3) Enable "Developer mode" in the top-right corner.
4) Click "Load unpacked".
5) Select the scholar-sync/extension directory.

Usage

1) Open a YouTube video with captions/transcript.
2) Click the ScholarSync icon and then "Generate Study Guide".
3) The extension locally computes:
   - Summary (Summarizer API)
   - Key concepts (Prompt API with JSON schema)
   - Quiz (Prompt API with JSON schema)
4) Secondary actions operate on selected text on the page:
   - Rewrite (Rewriter API)
   - Translate (Translator API)
   - Proofread (Proofreader API)
5) Multimodal: "Ask about frame" captures the current frame and answers your question using the Prompt API (image+text) and renders a student-friendly explanation via the Writer API.

Notes

- Requires Chrome with Built‑in AI features enabled on your device. If an API is unavailable, the UI will show an error for that action.
- All processing is on-device; nothing is sent to external servers.