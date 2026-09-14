import React, { ReactNode } from 'react';
import './Badge.css';

export type BadgeVariant = 'default' | 'accent' | 'success' | 'danger' | 'warning' | 'info';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  /** The content of the badge */
  children: ReactNode;
  /** The visual variant */
  variant?: BadgeVariant;
  /** The size of the badge */
  size?: BadgeSize;
  /** Optional icon before the label */
  icon?: ReactNode;
  /** Whether the badge has a dot indicator */
  dot?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Badge component for status indicators and labels.
 * 
 * @example
 * ```tsx
 * <Badge variant="success">Verified</Badge>
 * <Badge variant="danger" dot>High Risk</Badge>
 * ```
 */
export function Badge({
  children,
  variant = 'default',
  size = 'md',
  icon,
  dot = false,
  className = '',
}: BadgeProps) {
  const classes = [
    'spectre-badge',
    `spectre-badge--${variant}`,
    `spectre-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes}>
      {dot && <span className="spectre-badge-dot" />}
      {icon && <span className="spectre-badge-icon">{icon}</span>}
      {children}
    </span>
  );
}

export default Badge;
