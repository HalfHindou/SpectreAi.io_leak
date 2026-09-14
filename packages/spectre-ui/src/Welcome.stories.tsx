import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

const meta: Meta = {
  title: 'Introduction',
  parameters: {
    layout: 'fullscreen',
    previewTabs: {
      canvas: { hidden: true },
    },
    viewMode: 'docs',
    options: {
      showPanel: false,
    },
  },
};

export default meta;
type Story = StoryObj;

export const Welcome: Story = {
  render: () => (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #12121a 50%, #0a0a0f 100%)',
      color: '#f4f4f5',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Hero Section */}
      <div style={{
        padding: '80px 48px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Glow Effect */}
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '600px',
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
          pointerEvents: 'none',
        }} />
        
        {/* Logo */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '80px',
          height: '80px',
          background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
          borderRadius: '20px',
          marginBottom: '32px',
          fontSize: '40px',
          boxShadow: '0 0 60px rgba(139, 92, 246, 0.4)',
          position: 'relative',
        }}>
          👻
        </div>
        
        <h1 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: '48px',
          fontWeight: 700,
          margin: '0 0 16px',
          background: 'linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          position: 'relative',
        }}>
          Spectre AI Design System
        </h1>
        
        <p style={{
          fontSize: '18px',
          color: '#a1a1aa',
          maxWidth: '600px',
          margin: '0 auto 40px',
          lineHeight: 1.6,
          position: 'relative',
        }}>
          A comprehensive component library and design token system for building 
          premium dark-themed trading and fintech applications in the Spectre ecosystem.
        </p>

        {/* Version Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: 'rgba(139, 92, 246, 0.15)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '9999px',
          fontSize: '14px',
          position: 'relative',
        }}>
          <span style={{ color: '#8B5CF6' }}>●</span>
          Version 1.0.0
        </div>
      </div>

      {/* Quick Start */}
      <div style={{
        padding: '60px 48px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <h2 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: '28px',
          fontWeight: 600,
          marginBottom: '32px',
          color: '#f4f4f5',
        }}>
          🚀 Quick Start
        </h2>

        <div style={{
          background: '#12121a',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          overflow: 'hidden',
          marginBottom: '48px',
        }}>
          <div style={{
            padding: '12px 16px',
            background: '#1a1a24',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '13px',
            color: '#71717a',
            display: 'flex',
            gap: '8px',
          }}>
            <span style={{ color: '#EF4444' }}>●</span>
            <span style={{ color: '#FBBF24' }}>●</span>
            <span style={{ color: '#10B981' }}>●</span>
            <span style={{ marginLeft: '8px' }}>Terminal</span>
          </div>
          <pre style={{
            padding: '24px',
            margin: 0,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: '14px',
            lineHeight: 1.6,
            color: '#f4f4f5',
            overflow: 'auto',
          }}>
            <code>
              <span style={{ color: '#71717a' }}># Install the package</span>{'\n'}
              <span style={{ color: '#10B981' }}>npm</span> install @spectre-ai/ui{'\n\n'}
              <span style={{ color: '#71717a' }}># Import in your app</span>{'\n'}
              <span style={{ color: '#EC4899' }}>import</span> {'{'} Button, Modal, useToast {'}'} <span style={{ color: '#EC4899' }}>from</span> <span style={{ color: '#FBBF24' }}>'@spectre-ai/ui'</span>;{'\n'}
              <span style={{ color: '#EC4899' }}>import</span> <span style={{ color: '#FBBF24' }}>'@spectre-ai/ui/tokens/variables.css'</span>;
            </code>
          </pre>
        </div>

        {/* Feature Cards */}
        <h2 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: '28px',
          fontWeight: 600,
          marginBottom: '32px',
          color: '#f4f4f5',
        }}>
          ✨ Features
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
          marginBottom: '48px',
        }}>
          {[
            { icon: '🎨', title: 'Design Tokens', desc: '60+ CSS variables for colors, typography, spacing, shadows, and animations' },
            { icon: '🧩', title: 'Components', desc: 'Button, Input, Modal, Toast, AuthGate - all fully accessible and customizable' },
            { icon: '🌙', title: 'Dark Theme', desc: 'Optimized for dark mode with carefully crafted color contrast ratios' },
            { icon: '📊', title: 'Trading Ready', desc: 'Bull/bear colors, price formatters, and trading-specific components' },
            { icon: '♿', title: 'Accessible', desc: 'WCAG 2.1 compliant with keyboard navigation and screen reader support' },
            { icon: '📝', title: 'TypeScript', desc: 'Full type definitions with IntelliSense support for all components' },
          ].map((feature, i) => (
            <div key={i} style={{
              padding: '24px',
              background: '#12121a',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '16px',
              transition: 'all 0.2s ease',
            }}>
              <div style={{
                fontSize: '32px',
                marginBottom: '16px',
              }}>{feature.icon}</div>
              <h3 style={{
                fontSize: '16px',
                fontWeight: 600,
                marginBottom: '8px',
                color: '#f4f4f5',
              }}>{feature.title}</h3>
              <p style={{
                fontSize: '14px',
                color: '#71717a',
                margin: 0,
                lineHeight: 1.5,
              }}>{feature.desc}</p>
            </div>
          ))}
        </div>

        {/* Navigation */}
        <h2 style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: '28px',
          fontWeight: 600,
          marginBottom: '32px',
          color: '#f4f4f5',
        }}>
          📚 Explore
        </h2>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}>
          {[
            { icon: '🎨', title: 'Design Tokens', path: '/?path=/docs/foundation-design-tokens--docs' },
            { icon: '🔘', title: 'Button', path: '/?path=/docs/components-button--docs' },
            { icon: '📝', title: 'Input', path: '/?path=/docs/components-input--docs' },
            { icon: '🪟', title: 'Modal', path: '/?path=/docs/components-modal--docs' },
            { icon: '🔔', title: 'Toast', path: '/?path=/docs/components-toast--docs' },
            { icon: '🔐', title: 'AuthGate', path: '/?path=/docs/components-authgate--docs' },
            { icon: '🔧', title: 'Formatters', path: '/?path=/docs/utilities-formatters--docs' },
          ].map((item, i) => (
            <a 
              key={i} 
              href={item.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '16px 20px',
                background: '#1a1a24',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '12px',
                textDecoration: 'none',
                color: '#f4f4f5',
                fontSize: '15px',
                fontWeight: 500,
                transition: 'all 0.2s ease',
              }}
            >
              <span style={{ fontSize: '20px' }}>{item.icon}</span>
              {item.title}
              <svg style={{ marginLeft: 'auto', width: '16px', height: '16px', color: '#71717a' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '40px 48px',
        borderTop: '1px solid rgba(255, 255, 255, 0.06)',
        textAlign: 'center',
        color: '#52525b',
        fontSize: '14px',
      }}>
        <p style={{ margin: '0 0 8px' }}>Built with 💜 by Spectre AI</p>
        <p style={{ margin: 0 }}>
          <a href="https://spectre-ai-trading.vercel.app" style={{ color: '#8B5CF6', textDecoration: 'none' }}>
            spectre-ai-trading.vercel.app
          </a>
        </p>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      page: null,
    },
  },
};
