import React, { useState, useEffect, ReactNode, createContext, useContext } from 'react';
import './AuthGate.css';

interface AuthContextValue {
  isAuthenticated: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export interface AuthGateProps {
  /** The content to show when authenticated */
  children: ReactNode;
  /** The password required to access */
  password: string;
  /** Storage key for auth state persistence */
  storageKey?: string;
  /** Custom title for the login screen */
  title?: string;
  /** Custom subtitle/description */
  subtitle?: string;
  /** Logo element to display */
  logo?: ReactNode;
  /** Custom branding color */
  brandColor?: string;
}

/**
 * AuthGate component provides password-based access control.
 * 
 * @example
 * ```tsx
 * <AuthGate 
 *   password="secret123"
 *   title="My App"
 *   subtitle="Enter password to continue"
 * >
 *   <App />
 * </AuthGate>
 * ```
 */
export function AuthGate({
  children,
  password,
  storageKey = 'spectre-auth',
  title = 'Access Required',
  subtitle = 'Enter your credentials to continue',
  logo,
  brandColor,
}: AuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Check auth status on mount
  useEffect(() => {
    const authStatus = localStorage.getItem(storageKey);
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, [storageKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (inputValue === password) {
      localStorage.setItem(storageKey, 'true');
      setIsAuthenticated(true);
    } else {
      setError('Incorrect password');
      setInputValue('');
    }
  };

  const logout = () => {
    localStorage.removeItem(storageKey);
    setIsAuthenticated(false);
    setInputValue('');
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="spectre-auth-loading">
        <div className="spectre-auth-spinner" />
      </div>
    );
  }

  // Show login screen
  if (!isAuthenticated) {
    return (
      <div 
        className="spectre-auth-gate"
        style={brandColor ? { '--auth-brand-color': brandColor } as React.CSSProperties : undefined}
      >
        <div className="spectre-auth-background">
          <div className="spectre-auth-gradient" />
        </div>
        <div className="spectre-auth-card">
          {logo && <div className="spectre-auth-logo">{logo}</div>}
          <h1 className="spectre-auth-title">{title}</h1>
          <p className="spectre-auth-subtitle">{subtitle}</p>
          
          <form onSubmit={handleSubmit} className="spectre-auth-form">
            <div className="spectre-auth-input-wrapper">
              <input
                type="password"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Enter password"
                className={`spectre-auth-input ${error ? 'spectre-auth-input--error' : ''}`}
                autoFocus
                aria-label="Password"
                aria-invalid={!!error}
              />
              {error && (
                <span className="spectre-auth-error" role="alert">
                  {error}
                </span>
              )}
            </div>
            <button type="submit" className="spectre-auth-button">
              <span>Access</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
          
          <p className="spectre-auth-footer">
            Contact your administrator for access
          </p>
        </div>
      </div>
    );
  }

  // Show authenticated content
  return (
    <AuthContext.Provider value={{ isAuthenticated, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth state and logout function.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthGate');
  }
  return context;
}

export default AuthGate;
