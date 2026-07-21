import React, { useEffect, useRef } from 'react';

// Ambient, procedural watercolor background for karaoke — sits BEHIND the lyrics
// (z-0, pointer-events-none) and drifts gently as the song plays. It is modular:
// a per-song "theme" (derived from the title) picks the palette and an optional
// accent (e.g. drifting petals). Honest note: it animates autonomously on a time
// base, not to real beat data — YouTube's audio can't be analysed cross-origin,
// so we do NOT fake beat-sync. Respects prefers-reduced-motion and pauses when
// the tab is hidden; fully self-contained and cleaned up on unmount.

export type ThemeKind = 'watercolor' | 'petals' | 'embers' | 'aqua';

interface Props { seed: string; playing: boolean; }

// Choose a theme + palette from the song title so different songs feel different,
// without hardcoding any single song into the component.
const themeFor = (seed: string): { kind: ThemeKind; palette: string[] } => {
  const s = (seed || '').toLowerCase();
  if (/(dandelion|flower|phool|rose|spring|bahaar|savera)/.test(s)) return { kind: 'petals', palette: ['#f9a8d4', '#fcd34d', '#fca5a5', '#fde68a'] };
  if (/(fire|jalna|ishq|dard|toofan|storm|thunder)/.test(s)) return { kind: 'embers', palette: ['#f97316', '#ef4444', '#fbbf24', '#b45309'] };
  if (/(rain|ocean|sea|barish|paani|wave|blue|neend)/.test(s)) return { kind: 'aqua', palette: ['#38bdf8', '#22d3ee', '#818cf8', '#a5f3fc'] };
  // Stable hash → pick a default watercolor palette variant.
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const palettes = [
    ['#c084fc', '#f0abfc', '#fbbf24', '#93c5fd'],
    ['#fca5a5', '#fdba74', '#fcd34d', '#f9a8d4'],
    ['#5eead4', '#93c5fd', '#c4b5fd', '#fde68a'],
  ];
  return { kind: 'watercolor', palette: palettes[Math.abs(h) % palettes.length] };
};

const KaraokeAmbience: React.FC<Props> = ({ seed, playing }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const { kind, palette } = themeFor(seed);
    let raf = 0;
    let running = true;
    let W = 0, H = 0, dpr = 1;

    const resize = () => {
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(W * dpr));
      canvas.height = Math.max(1, Math.floor(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Soft watercolor blobs drifting slowly.
    const N = reduce ? 4 : 6;
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const blobs = Array.from({ length: N }, (_, i) => ({
      x: rand(0, 1), y: rand(0, 1), r: rand(0.18, 0.4),
      vx: rand(-0.02, 0.02), vy: rand(-0.015, 0.015),
      color: palette[i % palette.length], phase: rand(0, Math.PI * 2),
    }));
    // Accent particles (petals/embers/bubbles) hug the edges so they never cover text.
    const M = reduce ? 0 : (kind === 'watercolor' ? 0 : 16);
    const parts = Array.from({ length: M }, () => ({
      edge: Math.random() < 0.5 ? 0 : 1, // left or right side
      x: rand(0, 1), y: rand(0, 1), s: rand(3, 8), sway: rand(0, Math.PI * 2),
      vy: rand(0.02, 0.06), color: palette[Math.floor(rand(0, palette.length))],
    }));

    let t = 0;
    const drawStatic = () => {
      // Reduced-motion / paused: one calm painterly wash, no animation.
      ctx.clearRect(0, 0, W, H);
      blobs.forEach(b => {
        const g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, b.r * Math.max(W, H));
        g.addColorStop(0, b.color + '30'); g.addColorStop(1, b.color + '00');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      });
    };

    const frame = () => {
      if (!running) return;
      t += 0.006;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of blobs) {
        b.x += b.vx * 0.6; b.y += b.vy * 0.6;
        if (b.x < -0.2) b.x = 1.2; if (b.x > 1.2) b.x = -0.2;
        if (b.y < -0.2) b.y = 1.2; if (b.y > 1.2) b.y = -0.2;
        const pulse = 0.85 + 0.15 * Math.sin(t + b.phase);
        const rad = b.r * Math.max(W, H) * pulse;
        const g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, rad);
        g.addColorStop(0, b.color + '2b'); g.addColorStop(1, b.color + '00');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x * W, b.y * H, rad, 0, Math.PI * 2); ctx.fill();
      }
      // edge accents
      ctx.globalCompositeOperation = 'source-over';
      for (const p of parts) {
        p.y -= p.vy * 0.01; if (p.y < -0.05) p.y = 1.05;
        p.sway += 0.02;
        const baseX = p.edge === 0 ? 0.06 : 0.94;
        const x = (baseX + Math.sin(p.sway) * 0.04) * W;
        const y = p.y * H;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        if (kind === 'petals') { ctx.ellipse(x, y, p.s, p.s * 0.55, p.sway, 0, Math.PI * 2); }
        else { ctx.arc(x, y, p.s * 0.6, 0, Math.PI * 2); }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const start = () => { running = true; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    if (reduce || !playing) drawStatic();
    else start();

    const onVis = () => { if (document.hidden) stop(); else if (playing && !reduce) start(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [seed, playing]);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none z-0 opacity-70" />;
};

export default KaraokeAmbience;
