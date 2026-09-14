import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AuthGate } from './AuthGate';

const meta: Meta<typeof AuthGate> = {
  title: 'Components/AuthGate',
  component: AuthGate,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
AuthGate provides a password-protected entry point for your application.

## Features

- **Session Persistence**: Auth state is saved to localStorage
- **Customizable Branding**: Custom title, subtitle, logo, and colors
- **Error Handling**: Visual feedback for incorrect passwords
- **Accessible**: Proper ARIA attributes and keyboard navigation

## Usage

Wrap your entire app or protected sections:

\`\`\`tsx
import { AuthGate } from '@spectre-ai/ui';

function App() {
  return (
    <AuthGate 
      password={process.env.APP_PASSWORD}
      title="My Trading App"
      subtitle="Team access only"
    >
      <Dashboard />
    </AuthGate>
  );
}
\`\`\`

## Security Note

This is designed for simple team access control, not production security.
For production apps, use proper authentication services.
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    password: {
      control: 'text',
      description: 'The password required for access',
    },
    title: {
      control: 'text',
    },
    subtitle: {
      control: 'text',
    },
    storageKey: {
      control: 'text',
      description: 'localStorage key for persisting auth state',
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Note: Stories show the login screen by default since we clear localStorage
// The password for all demos is "demo123"

export const Default: Story = {
  args: {
    password: 'demo123',
    title: 'Access Required',
    subtitle: 'Enter your credentials to continue',
    storageKey: 'storybook-auth-default',
    children: (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center',
        background: 'var(--spectre-bg-base)',
        minHeight: '100vh'
      }}>
        <h1>🎉 You're In!</h1>
        <p style={{ color: 'var(--spectre-text-secondary)' }}>
          Authentication successful. This is the protected content.
        </p>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Default auth gate. Password: `demo123`',
      },
    },
  },
  play: async () => {
    // Clear auth for demo
    localStorage.removeItem('storybook-auth-default');
  },
};

export const WithLogo: Story = {
  args: {
    password: 'demo123',
    title: 'Spectre AI',
    subtitle: 'Trading Platform Access',
    storageKey: 'storybook-auth-logo',
    logo: <span style={{ fontSize: '2rem' }}>👻</span>,
    children: <div>Protected Content</div>,
  },
  play: async () => {
    localStorage.removeItem('storybook-auth-logo');
  },
};

export const CustomBranding: Story = {
  args: {
    password: 'demo123',
    title: 'Admin Portal',
    subtitle: 'Restricted access area',
    storageKey: 'storybook-auth-custom',
    children: <div>Protected Content</div>,
  },
  play: async () => {
    localStorage.removeItem('storybook-auth-custom');
  },
};

export const TradingPlatform: Story = {
  args: {
    password: 'trade2024',
    title: 'Spectre Trading',
    subtitle: 'Enter your team password',
    storageKey: 'storybook-auth-trading',
    logo: (
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" style={{ width: '40px', height: '40px' }}>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    children: (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center',
        background: 'var(--spectre-bg-base)',
        minHeight: '100vh'
      }}>
        <h1>Trading Dashboard</h1>
        <p style={{ color: 'var(--spectre-text-secondary)' }}>
          Welcome to the trading platform!
        </p>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Trading platform auth gate. Password: `trade2024`',
      },
    },
  },
  play: async () => {
    localStorage.removeItem('storybook-auth-trading');
  },
};

// Show what happens after authentication
export const Authenticated: Story = {
  args: {
    password: 'demo123',
    title: 'Auth Gate',
    subtitle: 'This story shows authenticated state',
    storageKey: 'storybook-auth-authenticated',
    children: (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center',
        background: 'var(--spectre-bg-base)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px'
      }}>
        <h1 style={{ fontSize: '2rem' }}>🔓 Authenticated!</h1>
        <p style={{ color: 'var(--spectre-text-secondary)', maxWidth: '400px' }}>
          This is what users see after successfully authenticating. 
          The auth state persists in localStorage.
        </p>
        <button 
          onClick={() => {
            localStorage.removeItem('storybook-auth-authenticated');
            window.location.reload();
          }}
          style={{
            padding: '8px 16px',
            background: 'var(--spectre-accent)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          Logout (for demo)
        </button>
      </div>
    ),
  },
  play: async () => {
    // Pre-authenticate for this story
    localStorage.setItem('storybook-auth-authenticated', 'true');
  },
};
