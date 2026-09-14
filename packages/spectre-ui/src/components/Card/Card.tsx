import React, { ReactNode, HTMLAttributes } from 'react';
import './Card.css';

export type CardVariant = 'default' | 'elevated' | 'glass' | 'outlined';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** The content of the card */
  children: ReactNode;
  /** The visual variant */
  variant?: CardVariant;
  /** Card header content */
  header?: ReactNode;
  /** Card footer content */
  footer?: ReactNode;
  /** Whether the card has a hover effect */
  hoverable?: boolean;
  /** Whether the card has padding */
  padding?: boolean;
  /** Custom class name */
  className?: string;
}

/**
 * Card component for grouping related content.
 * 
 * @example
 * ```tsx
 * <Card header={<h3>Token Stats</h3>}>
 *   <p>Market Cap: $1.2M</p>
 * </Card>
 * ```
 */
export function Card({
  children,
  variant = 'default',
  header,
  footer,
  hoverable = false,
  padding = true,
  className = '',
  ...props
}: CardProps) {
  const classes = [
    'spectre-card',
    `spectre-card--${variant}`,
    hoverable && 'spectre-card--hoverable',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...props}>
      {header && <div className="spectre-card-header">{header}</div>}
      <div className={`spectre-card-content ${padding ? '' : 'spectre-card-content--no-padding'}`}>
        {children}
      </div>
      {footer && <div className="spectre-card-footer">{footer}</div>}
    </div>
  );
}

export default Card;
