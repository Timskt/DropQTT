import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export const DropQTTLogo: React.FC<LogoProps> = ({ className = '', size = 36 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`drop-shadow-[0_4px_12px_rgba(6,182,212,0.3)] ${className}`}
    >
      <defs>
        {/* Background Gradient */}
        <linearGradient id="bgGrad" x1="256" y1="36" x2="256" y2="476" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>

        {/* Upper Vector: Cyan -> Electric Blue */}
        <linearGradient id="upperGrad" x1="166" y1="176" x2="346" y2="236" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>

        {/* Core Diamond Gradient */}
        <linearGradient id="coreGrad" x1="236" y1="236" x2="336" y2="276" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>

        {/* Lower Vector: Violet -> Indigo */}
        <linearGradient id="lowerGrad" x1="166" y1="276" x2="346" y2="336" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {/* Apple Squircle Base with inner glow */}
      <rect
        x="36"
        y="36"
        width="440"
        height="440"
        rx="104"
        fill="url(#bgGrad)"
        stroke="rgba(255, 255, 255, 0.14)"
        strokeWidth="2"
      />

      {/* Central Slanted Origami Geometric Vectors (-5 deg shear) */}
      <g transform="translate(256 256) skewX(-5) translate(-256 -256)">
        {/* Upper Chevrons */}
        <path
          d="M 166 176 L 276 176 L 346 236 L 296 236 L 236 216 L 166 216 Z"
          fill="url(#upperGrad)"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.5"
        />

        {/* Central Core Packet */}
        <path
          d="M 236 236 L 296 236 L 336 276 L 276 276 Z"
          fill="url(#coreGrad)"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.5"
        />

        {/* Lower Chevrons */}
        <path
          d="M 346 336 L 236 336 L 166 276 L 216 276 L 276 296 L 346 296 Z"
          fill="url(#lowerGrad)"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  );
};
