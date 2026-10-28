import React from 'react';

export interface GoogleIconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number | string;
  filled?: boolean;
  weight?: number;
  className?: string;
}

/**
 * GoogleIcon renders an official Google Fonts Material Symbol.
 * Supports filled and regular weights, size, and custom classes.
 */
export const GoogleIcon: React.FC<GoogleIconProps> = ({
  name,
  size,
  filled = false,
  weight = 400,
  className = '',
  style,
  ...rest
}) => {
  return (
    <span
      className={`material-symbols-rounded ${filled ? 'filled' : ''} ${className}`}
      style={{
        ...(size ? { fontSize: typeof size === 'number' ? `${size}px` : size } : {}),
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    >
      {name}
    </span>
  );
};
