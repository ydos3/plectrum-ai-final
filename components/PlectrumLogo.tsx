
import React from 'react';

interface LogoProps {
  className?: string;
  animate?: boolean;
}

const PlectrumLogo: React.FC<LogoProps> = ({ className = "w-12 h-12", animate = false }) => {
  return (
    <svg viewBox="0 0 200 200" className={`${className} drop-shadow-2xl`} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="plectrumBody" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#78350f" />
          <stop offset="50%" stopColor="#92400e" />
          <stop offset="100%" stopColor="#451a03" />
        </linearGradient>
        <linearGradient id="spectrumGradient" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#fcd34d" />
        </linearGradient>
        <filter id="innerShadow">
           <feComponentTransfer in="SourceAlpha">
                <feFuncA type="table" tableValues="1 0" />
           </feComponentTransfer>
           <feGaussianBlur stdDeviation="3"/>
           <feOffset dx="0" dy="2" result="offsetblur"/>
           <feFlood floodColor="rgba(0,0,0,0.5)" result="color"/>
           <feComposite in2="offsetblur" operator="in"/>
           <feComposite in2="SourceAlpha" operator="in" />
           <feMerge>
            <feMergeNode in="SourceGraphic"/>
            <feMergeNode/>
          </feMerge>
        </filter>
      </defs>
      
      {/* The Classic Plectrum Shape */}
      <path 
        d="M100 195C100 195 185 130 185 60C185 25 155 5 100 5C45 5 15 25 15 60C15 130 100 195 100 195Z" 
        fill="url(#plectrumBody)" 
        stroke="#d97706" 
        strokeWidth="3"
        filter="url(#innerShadow)"
      />

      {/* Embedded Spectrum Analyzer */}
      <g transform="translate(0, 10)">
          {/* Central Bars */}
          <rect x="95" y="60" width="10" height="60" rx="5" fill="url(#spectrumGradient)" opacity="0.9">
             {animate && <animate attributeName="height" values="60;85;50;60" dur="0.8s" repeatCount="indefinite" />}
             {animate && <animate attributeName="y" values="60;35;70;60" dur="0.8s" repeatCount="indefinite" />}
          </rect>
          
          <rect x="75" y="70" width="8" height="40" rx="4" fill="url(#spectrumGradient)" opacity="0.7">
             {animate && <animate attributeName="height" values="40;60;30;40" dur="0.6s" repeatCount="indefinite" />}
             {animate && <animate attributeName="y" values="70;50;80;70" dur="0.6s" repeatCount="indefinite" />}
          </rect>
          
          <rect x="117" y="70" width="8" height="40" rx="4" fill="url(#spectrumGradient)" opacity="0.7">
             {animate && <animate attributeName="height" values="40;65;35;40" dur="0.7s" repeatCount="indefinite" />}
             {animate && <animate attributeName="y" values="70;45;75;70" dur="0.7s" repeatCount="indefinite" />}
          </rect>

          <rect x="58" y="80" width="6" height="20" rx="3" fill="url(#spectrumGradient)" opacity="0.5">
             {animate && <animate attributeName="height" values="20;40;15;20" dur="0.9s" repeatCount="indefinite" />}
             {animate && <animate attributeName="y" values="80;60;85;80" dur="0.9s" repeatCount="indefinite" />}
          </rect>

          <rect x="136" y="80" width="6" height="20" rx="3" fill="url(#spectrumGradient)" opacity="0.5">
             {animate && <animate attributeName="height" values="20;35;10;20" dur="0.5s" repeatCount="indefinite" />}
             {animate && <animate attributeName="y" values="80;65;90;80" dur="0.5s" repeatCount="indefinite" />}
          </rect>
      </g>

      {/* "AI" Circuit Node at the tip */}
      <circle cx="100" cy="160" r="4" fill="#fbbf24" className={animate ? "animate-pulse" : ""} />
      <path d="M100 120 L100 160" stroke="#fbbf24" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />

      {/* Glossy Reflection */}
      <path 
        d="M40 40 Q 100 80 160 40 Q 140 20 100 20 Q 60 20 40 40" 
        fill="white" 
        opacity="0.1" 
      />
    </svg>
  );
};

export default PlectrumLogo;
