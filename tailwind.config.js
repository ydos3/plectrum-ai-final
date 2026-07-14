import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  // Scan every source file so all utility classes (incl. arbitrary values used
  // in template literals) are generated at build time — same classes the CDN
  // produced at runtime, so the UI is identical but paints instantly.
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Match Tailwind's font utilities to the app's brand fonts so font-sans /
      // font-mono render exactly as designed (was relying on the CDN + inline CSS).
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [animate],
};
