<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Vsb5fqeWxMrLUN4D1_2RVq6cpH2v8L72

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY`
3. Run the app:
   `npm run dev`

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). Gemini runs through a server-side `/api/gemini` proxy so the API key is not exposed in the browser bundle.
