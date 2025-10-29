ScholarSync: AI-Powered YouTube Study Guides

This project turns any YouTube educational video into a structured study guide, complete with summaries, key concepts, and quizzes.

Project Structure

scholar-sync/
├── backend/
│   ├── node_modules/
│   ├── .env
│   ├── package.json
│   └── server.js
└── extension/
    ├── icons/
    │   ├── icon16.png
    │   ├── icon48.png
    │   └── icon128.png
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    └── styles.css


How to Run

1. Backend Setup

Navigate to the backend directory:

cd backend


Install the dependencies:

npm install


IMPORTANT: The backend server.js file is configured to use the Gemini API. The apiKey constant is left as "" to work within the specific environment this code is generated for. If you run this on your own machine, you will need to create a .env file and add your own GEMINI_API_KEY.

Start the server:

node server.js


The server will be running at http://localhost:3000.

2. Chrome Extension Setup

Open Google Chrome.

Go to chrome://extensions/.

Enable "Developer mode" in the top-right corner.

Click "Load unpacked".

Select the scholar-sync/extension directory.

The ScholarSync icon will appear in your Chrome toolbar.

How to Use

Navigate to any YouTube video page that has a transcript.

Click the ScholarSync icon in your toolbar.

Click the "Generate Study Guide" button.

The extension will show a loading state, then populate the UI with the generated summary, key concepts, and an interactive quiz.

You can then use the secondary buttons (Rewrite, Translate, Proofread) on the generated content.