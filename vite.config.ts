import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { handleGeminiProxyRequest } from './server/geminiProxy';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.API_KEY || '';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'local-gemini-api',
          configureServer(server) {
            server.middlewares.use('/api/gemini', async (req, res) => {
              if (req.method !== 'POST') {
                res.statusCode = 405;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Method not allowed.' }));
                return;
              }

              try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) {
                  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                const result = await handleGeminiProxyRequest(payload);
                res.statusCode = result.status;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(result.body));
              } catch {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Invalid Gemini request.' }));
              }
            });
          }
        }
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
