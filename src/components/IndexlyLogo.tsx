// src/components/IndexlyLogo.tsx — Icono oficial vectorial de IndexLy Desktop
import React from 'react';

export interface IndexlyLogoProps {
  size?: number;
  variant?: 'box' | 'circle';
  className?: string;
  style?: React.CSSProperties;
}

export const IndexlyLogo: React.FC<IndexlyLogoProps> = ({
  size = 24,
  variant = 'box',
  className = '',
  style = {},
}) => {
  const isCircle = variant === 'circle';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="122.84 212.71 356.24 356.24"
      width={size}
      height={size}
      className={className}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style,
      }}
      aria-label="IndexLy Desktop"
      role="img"
    >
      {isCircle ? (
        <path
          d="M300.959 212.712 C399.33 212.712 479.075 292.457 479.075 390.828 C479.075 489.198 399.33 568.944 300.959 568.944 C202.588 568.944 122.843 489.198 122.843 390.828 C122.843 292.457 202.588 212.712 300.959 212.712 Z"
          fill="#46bef4"
        />
      ) : (
        <path
          d="M176.475 212.712 L425.443 212.712 C455.063 212.712 479.075 236.723 479.075 266.343 L479.075 515.312 C479.075 544.932 455.063 568.944 425.443 568.944 L176.475 568.944 C146.855 568.944 122.843 544.932 122.843 515.312 L122.843 266.343 C122.843 236.723 146.855 212.712 176.475 212.712 Z"
          fill="#46bef4"
        />
      )}
      <circle cx="306.197" cy="351.037" r="87.319" fill="#007ebf" />
      <circle cx="306.197" cy="352.718" r="61.79" fill="#e6e6e6" />
      <path
        d="M279.956 455.077 C276.878 435.742 261.705 432.976 246.977 447.82 C229.642 465.29 247.174 497.743 229.847 515.222 C222.523 522.611 208.735 523.939 208.446 524.086 C206.965 524.84 243.369 539.165 262.19 510.147 C272.798 493.792 282.667 472.106 279.956 455.077 Z"
        fill="#007ebf"
      />
    </svg>
  );
};
