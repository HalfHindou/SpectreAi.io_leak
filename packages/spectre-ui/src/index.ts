/**
 * Spectre AI Design System
 * ========================
 * A comprehensive design system for building Spectre ecosystem applications.
 * 
 * @packageDocumentation
 */

// Components
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export { Input, type InputProps, type InputSize } from './components/Input';
export { Modal, type ModalProps, type ModalSize } from './components/Modal';
export { ToastProvider, useToast, type Toast, type ToastVariant, type ToastPosition } from './components/Toast';
export { AuthGate, useAuth, type AuthGateProps } from './components/AuthGate';
export { Badge, type BadgeProps, type BadgeVariant, type BadgeSize } from './components/Badge';
export { Card, type CardProps, type CardVariant } from './components/Card';

// Theme Provider
export { SpectreThemeProvider, useTheme, type ThemeMode } from './tokens/ThemeProvider';

// Utilities
export {
  formatCurrency,
  formatCompact,
  formatPercent,
  formatPriceChange,
  formatTokenAmount,
  truncateAddress,
  formatRelativeTime,
  formatDate,
  formatMarketCap,
  formatNumber,
  pluralize,
} from './utils';

// CSS imports (for consumers to import)
// import '@spectre-ai/ui/styles'
