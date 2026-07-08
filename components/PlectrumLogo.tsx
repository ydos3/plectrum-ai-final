
import React, { useId } from 'react';

interface LogoProps {
  className?: string;
  animate?: boolean;
}

// Brand mark: glossy plectrum with a gold "spectrum" of bars. This mirrors the
// favicon/app-icon exactly.
//
// Gradient IDs are made unique PER INSTANCE via useId(). The logo renders in
// several places at once (header, sidebar, watermark, assistant orb); with
// shared IDs the visible copies inherited their paint from whichever <defs>
// came first in the DOM — which is the desktop sidebar's copy. On mobile that
// sidebar is display:none, so its gradients don't paint and every other copy
// lost its fill, leaving only the stroke + dot ("empty outline"). Unique IDs
// make each SVG fully self-contained.
const PlectrumLogo: React.FC<LogoProps> = ({ className = "w-12 h-12", animate = false }) => {
  const raw = useId();
  const uid = raw.replace(/[^a-zA-Z0-9]/g, '');
  const bodyId = `pl-body-${uid}`;
  const barId = `pl-bar-${uid}`;
  const glossId = `pl-gloss-${uid}`;

  return (
    <svg viewBox="0 0 200 200" className={`${className} drop-shadow-2xl overflow-visible`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={bodyId} x1="38" y1="27" x2="161" y2="173" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#b45309" />
          <stop offset="45%" stopColor="#92400e" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>
        <linearGradient id={barId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#fde68a" />
        </linearGradient>
        {/* Soft top gloss highlight */}
        <radialGradient id={glossId} cx="50%" cy="26%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* The Classic Plectrum Shape */}
      <path
        d="M100 189C100 189 178 128 178 61C178 28 150 9 100 9C50 9 22 28 22 61C22 128 100 189 100 189Z"
        fill={`url(#${bodyId})`}
        stroke="#fbbf24"
        strokeWidth="6"
        strokeLinejoin="round"
      />

      {/* Glossy Reflection */}
      <path
        d="M38 39 Q100 75 163 39 Q144 22 100 22 Q56 22 38 39Z"
        fill={`url(#${glossId})`}
      />

      {/* Spectrum Analyzer bars */}
      <g>
        {/* Central bar */}
        <rect x="94" y="59" width="12" height="66" rx="6" fill={`url(#${barId})`}>
          {animate && <animate attributeName="height" values="66;86;52;66" dur="0.8s" repeatCount="indefinite" />}
          {animate && <animate attributeName="y" values="59;39;73;59" dur="0.8s" repeatCount="indefinite" />}
        </rect>

        {/* Inner side bars */}
        <rect x="70" y="73" width="11" height="44" rx="5.5" fill={`url(#${barId})`} opacity="0.92">
          {animate && <animate attributeName="height" values="44;62;34;44" dur="0.65s" repeatCount="indefinite" />}
          {animate && <animate attributeName="y" values="73;55;83;73" dur="0.65s" repeatCount="indefinite" />}
        </rect>
        <rect x="119" y="73" width="11" height="44" rx="5.5" fill={`url(#${barId})`} opacity="0.92">
          {animate && <animate attributeName="height" values="44;58;36;44" dur="0.72s" repeatCount="indefinite" />}
          {animate && <animate attributeName="y" values="73;59;81;73" dur="0.72s" repeatCount="indefinite" />}
        </rect>

        {/* Outer side bars */}
        <rect x="51" y="88" width="9" height="25" rx="4.5" fill={`url(#${barId})`} opacity="0.72">
          {animate && <animate attributeName="height" values="25;40;16;25" dur="0.9s" repeatCount="indefinite" />}
          {animate && <animate attributeName="y" values="88;73;97;88" dur="0.9s" repeatCount="indefinite" />}
        </rect>
        <rect x="140" y="88" width="9" height="25" rx="4.5" fill={`url(#${barId})`} opacity="0.72">
          {animate && <animate attributeName="height" values="25;36;14;25" dur="0.55s" repeatCount="indefinite" />}
          {animate && <animate attributeName="y" values="88;77;99;88" dur="0.55s" repeatCount="indefinite" />}
        </rect>
      </g>

      {/* Circuit node at the tip */}
      <path d="M100 125 L100 150" stroke="#fbbf24" strokeWidth="2" strokeDasharray="3 3" opacity="0.75" />
      <circle cx="100" cy="150" r="5" fill="#fbbf24" className={animate ? "animate-pulse" : ""} />
    </svg>
  );
};

export default PlectrumLogo;
