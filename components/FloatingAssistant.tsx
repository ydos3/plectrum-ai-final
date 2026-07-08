import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import PlectrumLogo from './PlectrumLogo';

interface FloatingAssistantProps {
  onOpen: () => void;
  onVoice: () => void;
}

const POS_KEY = 'plectrum_fab_pos_v1';
const SIZE = 56; // px
const MARGIN = 12;
const DRAG_THRESHOLD = 6; // px moved before it counts as a drag, not a tap

type Pos = { x: number; y: number };

const clampToViewport = (p: Pos): Pos => {
  const maxX = Math.max(MARGIN, window.innerWidth - SIZE - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  return {
    x: Math.min(maxX, Math.max(MARGIN, p.x)),
    y: Math.min(maxY, Math.max(MARGIN, p.y)),
  };
};

const defaultPos = (): Pos => ({
  x: (typeof window !== 'undefined' ? window.innerWidth : 400) - SIZE - 24,
  y: (typeof window !== 'undefined' ? window.innerHeight : 800) - SIZE - 96,
});

// A draggable, translucent assistant button that uses the Plectrum logo and
// carries a voice (mic) shortcut. It stays out of the way — the user can park
// it anywhere and its position persists.
const FloatingAssistant: React.FC<FloatingAssistantProps> = ({ onOpen, onVoice }) => {
  const [pos, setPos] = useState<Pos>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return clampToViewport(saved);
    } catch { /* ignore */ }
    return defaultPos();
  });
  const [dragging, setDragging] = useState(false);
  const dragState = useRef({ active: false, moved: false, startX: 0, startY: 0, offX: 0, offY: 0 });

  useEffect(() => {
    const onResize = () => setPos(p => clampToViewport(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const persist = useCallback((p: Pos) => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragState.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - pos.x,
      offY: e.clientY - pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st.active) return;
    if (!st.moved && Math.hypot(e.clientX - st.startX, e.clientY - st.startY) > DRAG_THRESHOLD) {
      st.moved = true;
      setDragging(true);
    }
    if (st.moved) {
      setPos(clampToViewport({ x: e.clientX - st.offX, y: e.clientY - st.offY }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const st = dragState.current;
    st.active = false;
    if (st.moved) {
      setDragging(false);
      setPos(p => { persist(p); return p; });
    } else {
      onOpen(); // treat as a tap
    }
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div
      className="fixed z-40 no-global-click touch-none select-none"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Voice shortcut */}
      <button
        onClick={(e) => { e.stopPropagation(); onVoice(); }}
        aria-label="Ask Bes with your voice"
        title="Ask with voice"
        className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-amber-500/80 hover:bg-amber-400 text-amber-950 flex items-center justify-center shadow-lg border border-white/20 backdrop-blur-sm z-10 active:scale-90 transition-transform"
      >
        <Mic className="w-3.5 h-3.5" />
      </button>

      {/* Draggable assistant orb (translucent, uses the logo) */}
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        aria-label="Open Bes, your guide"
        title="Bes — drag to move, tap to chat"
        className={`w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-amber-200/30 shadow-[0_8px_30px_rgba(0,0,0,0.35)] flex items-center justify-center transition-colors ${dragging ? 'cursor-grabbing scale-105' : 'cursor-grab'}`}
      >
        <PlectrumLogo className="w-9 h-9 pointer-events-none" animate={dragging} />
      </button>
    </div>
  );
};

export default FloatingAssistant;
