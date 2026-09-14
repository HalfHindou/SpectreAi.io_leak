import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

const meta: Meta = {
  title: 'Foundation/Design Tokens',
  parameters: {
    docs: {
      description: {
        component: `
Design tokens are the foundational visual values of the Spectre design system.
They ensure consistency across all applications in the ecosystem.

## Usage

Import the CSS variables in your app:

\`\`\`tsx
import '@spectre-ai/ui/tokens/variables.css';
\`\`\`

Then use the variables in your CSS:

\`\`\`css
.my-component {
  background: var(--spectre-bg-surface);
  color: var(--spectre-text-primary);
  border-radius: var(--spectre-radius-md);
}
\`\`\`
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// Color swatch component
function ColorSwatch({ name, value, textColor = 'white' }: { name: string; value: string; textColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
      <div 
        style={{ 
          width: '48px', 
          height: '48px', 
          borderRadius: '8px', 
          background: value,
          border: '1px solid var(--spectre-border-default)',
          flexShrink: 0,
        }} 
      />
      <div>
        <code style={{ color: 'var(--spectre-accent)', fontSize: '0.875rem' }}>{name}</code>
        <div style={{ color: 'var(--spectre-text-tertiary)', fontSize: '0.75rem', marginTop: '2px' }}>{value}</div>
      </div>
    </div>
  );
}

// Color group component
function ColorGroup({ title, colors }: { title: string; colors: { name: string; value: string }[] }) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <h3 style={{ marginBottom: '16px', color: 'var(--spectre-text-primary)' }}>{title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
        {colors.map((c) => (
          <ColorSwatch key={c.name} name={c.name} value={c.value} />
        ))}
      </div>
    </div>
  );
}

export const Colors: Story = {
  render: () => (
    <div>
      <ColorGroup
        title="Brand Accent"
        colors={[
          { name: '--spectre-accent', value: '#8B5CF6' },
          { name: '--spectre-accent-hover', value: '#A78BFA' },
          { name: '--spectre-accent-secondary', value: '#6366F1' },
        ]}
      />
      
      <ColorGroup
        title="Backgrounds"
        colors={[
          { name: '--spectre-bg-void', value: '#050508' },
          { name: '--spectre-bg-base', value: '#0a0a0f' },
          { name: '--spectre-bg-surface', value: '#12121a' },
          { name: '--spectre-bg-elevated', value: '#1a1a24' },
        ]}
      />
      
      <ColorGroup
        title="Text"
        colors={[
          { name: '--spectre-text-primary', value: '#f4f4f5' },
          { name: '--spectre-text-secondary', value: '#a1a1aa' },
          { name: '--spectre-text-tertiary', value: '#71717a' },
          { name: '--spectre-text-muted', value: '#52525b' },
        ]}
      />
      
      <ColorGroup
        title="Trading"
        colors={[
          { name: '--spectre-bull', value: '#10B981' },
          { name: '--spectre-bull-bright', value: '#34D399' },
          { name: '--spectre-bear', value: '#EF4444' },
          { name: '--spectre-bear-bright', value: '#F87171' },
        ]}
      />
      
      <ColorGroup
        title="Secondary Accents"
        colors={[
          { name: '--spectre-cyan', value: '#22D3EE' },
          { name: '--spectre-orange', value: '#F97316' },
          { name: '--spectre-pink', value: '#EC4899' },
          { name: '--spectre-yellow', value: '#FBBF24' },
        ]}
      />
    </div>
  ),
};

export const Typography: Story = {
  render: () => (
    <div>
      <h3 style={{ marginBottom: '24px', color: 'var(--spectre-text-primary)' }}>Font Families</h3>
      
      <div style={{ marginBottom: '32px' }}>
        <p style={{ fontFamily: 'var(--spectre-font-body)', marginBottom: '8px' }}>
          <strong>Body:</strong> Inter, -apple-system, sans-serif
        </p>
        <p style={{ fontFamily: 'var(--spectre-font-display)', marginBottom: '8px' }}>
          <strong>Display:</strong> Space Grotesk, Inter, sans-serif
        </p>
        <p style={{ fontFamily: 'var(--spectre-font-mono)' }}>
          <strong>Mono:</strong> JetBrains Mono, Fira Code, monospace
        </p>
      </div>
      
      <h3 style={{ marginBottom: '24px', color: 'var(--spectre-text-primary)' }}>Type Scale</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-4xl</code>
          <p style={{ fontSize: '2.5rem', fontFamily: 'var(--spectre-font-display)' }}>Display XL (40px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-3xl</code>
          <p style={{ fontSize: '2rem', fontFamily: 'var(--spectre-font-display)' }}>Display LG (32px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-2xl</code>
          <p style={{ fontSize: '1.5rem' }}>Display MD (24px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-xl</code>
          <p style={{ fontSize: '1.125rem' }}>Heading (18px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-lg</code>
          <p style={{ fontSize: '1rem' }}>Large (16px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-md</code>
          <p style={{ fontSize: '0.875rem' }}>Medium (14px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-base</code>
          <p style={{ fontSize: '0.8125rem' }}>Base (13px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-sm</code>
          <p style={{ fontSize: '0.75rem' }}>Small (12px)</p>
        </div>
        <div>
          <code style={{ color: 'var(--spectre-accent)' }}>--spectre-text-xs</code>
          <p style={{ fontSize: '0.6875rem' }}>Extra Small (11px)</p>
        </div>
      </div>
    </div>
  ),
};

export const Spacing: Story = {
  render: () => {
    const spaces = [
      { name: '--spectre-space-1', value: '4px' },
      { name: '--spectre-space-2', value: '8px' },
      { name: '--spectre-space-3', value: '12px' },
      { name: '--spectre-space-4', value: '16px' },
      { name: '--spectre-space-5', value: '20px' },
      { name: '--spectre-space-6', value: '24px' },
      { name: '--spectre-space-8', value: '32px' },
      { name: '--spectre-space-10', value: '40px' },
      { name: '--spectre-space-12', value: '48px' },
      { name: '--spectre-space-16', value: '64px' },
    ];

    return (
      <div>
        <h3 style={{ marginBottom: '24px', color: 'var(--spectre-text-primary)' }}>Spacing Scale (4px grid)</h3>
        {spaces.map((s) => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
            <div 
              style={{ 
                width: s.value, 
                height: '24px', 
                background: 'var(--spectre-accent)',
                borderRadius: '4px',
              }} 
            />
            <code style={{ color: 'var(--spectre-accent)', width: '180px' }}>{s.name}</code>
            <span style={{ color: 'var(--spectre-text-tertiary)' }}>{s.value}</span>
          </div>
        ))}
      </div>
    );
  },
};

export const BorderRadius: Story = {
  render: () => {
    const radii = [
      { name: '--spectre-radius-sm', value: '4px' },
      { name: '--spectre-radius-md', value: '8px' },
      { name: '--spectre-radius-lg', value: '12px' },
      { name: '--spectre-radius-xl', value: '16px' },
      { name: '--spectre-radius-2xl', value: '24px' },
      { name: '--spectre-radius-full', value: '9999px' },
    ];

    return (
      <div>
        <h3 style={{ marginBottom: '24px', color: 'var(--spectre-text-primary)' }}>Border Radius</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
          {radii.map((r) => (
            <div key={r.name} style={{ textAlign: 'center' }}>
              <div 
                style={{ 
                  width: '80px', 
                  height: '80px', 
                  background: 'var(--spectre-accent)',
                  borderRadius: r.value,
                  marginBottom: '8px',
                }} 
              />
              <code style={{ color: 'var(--spectre-accent)', fontSize: '0.75rem' }}>{r.name}</code>
              <div style={{ color: 'var(--spectre-text-tertiary)', fontSize: '0.75rem' }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

export const Shadows: Story = {
  render: () => {
    const shadows = [
      { name: '--spectre-shadow-xs', value: '0 1px 2px rgba(0, 0, 0, 0.5)' },
      { name: '--spectre-shadow-sm', value: '0 2px 8px rgba(0, 0, 0, 0.6)' },
      { name: '--spectre-shadow-md', value: '0 4px 16px rgba(0, 0, 0, 0.5)' },
      { name: '--spectre-shadow-lg', value: '0 8px 32px rgba(0, 0, 0, 0.6)' },
      { name: '--spectre-shadow-xl', value: '0 16px 48px rgba(0, 0, 0, 0.7)' },
      { name: '--spectre-shadow-glow', value: '0 0 40px rgba(139, 92, 246, 0.5)' },
    ];

    return (
      <div>
        <h3 style={{ marginBottom: '24px', color: 'var(--spectre-text-primary)' }}>Shadows</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '24px' }}>
          {shadows.map((s) => (
            <div key={s.name} style={{ textAlign: 'center' }}>
              <div 
                style={{ 
                  width: '100%', 
                  height: '80px', 
                  background: 'var(--spectre-bg-elevated)',
                  borderRadius: '8px',
                  boxShadow: s.value,
                  marginBottom: '12px',
                }} 
              />
              <code style={{ color: 'var(--spectre-accent)', fontSize: '0.75rem' }}>{s.name}</code>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

export const Animation: Story = {
  render: () => (
    <div>
      <h3 style={{ marginBottom: '24px', color: 'var(--spectre-text-primary)' }}>Animation Tokens</h3>
      
      <h4 style={{ marginBottom: '12px', color: 'var(--spectre-text-secondary)' }}>Durations</h4>
      <div style={{ marginBottom: '24px' }}>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-duration-fast</code>: 150ms</div>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-duration-normal</code>: 250ms</div>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-duration-slow</code>: 400ms</div>
      </div>
      
      <h4 style={{ marginBottom: '12px', color: 'var(--spectre-text-secondary)' }}>Easing Functions</h4>
      <div style={{ marginBottom: '24px' }}>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-easing-default</code>: cubic-bezier(0.4, 0, 0.2, 1)</div>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-easing-in</code>: cubic-bezier(0.4, 0, 1, 1)</div>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-easing-out</code>: cubic-bezier(0, 0, 0.2, 1)</div>
        <div><code style={{ color: 'var(--spectre-accent)' }}>--spectre-easing-spring</code>: cubic-bezier(0.34, 1.56, 0.64, 1)</div>
      </div>
      
      <h4 style={{ marginBottom: '12px', color: 'var(--spectre-text-secondary)' }}>Example Usage</h4>
      <pre style={{ 
        background: 'var(--spectre-bg-elevated)', 
        padding: '16px', 
        borderRadius: '8px',
        fontSize: '0.875rem',
        overflow: 'auto'
      }}>
{`.button {
  transition: all var(--spectre-duration-fast) var(--spectre-easing-default);
}

.modal {
  animation: fadeIn var(--spectre-duration-normal) var(--spectre-easing-spring);
}`}
      </pre>
    </div>
  ),
};
