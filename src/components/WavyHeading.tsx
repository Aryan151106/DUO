import React from 'react';

const ROTATIONS = [-1.5, 1.2, -1, 1.8, -1.2];

export const WavyText: React.FC<{ text: string; className?: string; isDisplay?: boolean }> = ({
  text,
  className = '',
  isDisplay = false,
}) => {
  const words = text.split(' ');
  return (
    <span className={`inline-block ${isDisplay ? 'font-display' : 'font-heading'} ${className}`}>
      {words.map((word, k) => {
        if (!word) return null;
        const rot = ROTATIONS[k % ROTATIONS.length];
        return (
          <React.Fragment key={k}>
            {k > 0 && ' '}
            <span
              className="u"
              style={
                {
                  '--i': k,
                  '--r': `${rot}deg`,
                  '--y': '0px',
                } as React.CSSProperties
              }
            >
              {word}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
};
