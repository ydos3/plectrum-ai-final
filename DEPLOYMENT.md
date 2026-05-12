# Plectrum.ai Deployment Checklist

## Security

- Never put `GEMINI_API_KEY` in client code or `VITE_*` variables.
- Use Vercel project environment variables:
  - `GEMINI_API_KEY`
- `.env.local` is for local development only and is gitignored.
- Rotate the current Gemini key before public launch because it was shared in chat.

## Local Production Check

```bash
npm install
npm audit
npm run build
npm run preview
```

## Vercel

The frontend builds to `dist`. The backend Gemini proxy lives at `api/gemini.ts`.

```bash
vercel login
vercel link
vercel env add GEMINI_API_KEY production
vercel env add GEMINI_API_KEY preview
vercel --prod
```

After deploy:

```bash
vercel domains add plectrum.in
vercel alias set <deployment-url> plectrum.in
```

In Namecheap, point DNS to Vercel using the records Vercel gives you after adding the domain.

## Supabase

Supabase is not required for the current build because songs, auth state, and recordings are local-first. Add Supabase when you want cross-device accounts, saved arrangements, subscription state, or public sharing.

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

Do not add Supabase service-role keys to Vite/client env variables. Only use service-role keys in server-side functions.

## Token/Cost Controls

- Search suggestions, YouTube lookup, recommendations, and chat use Flash.
- Song generation and image analysis use Pro only where quality matters.
- Chat sends only the last 6 messages and trims long messages.
- Responses use `candidateCount: 1` and `maxOutputTokens` caps.
- Song search tries LRCLIB first before spending Gemini tokens.
