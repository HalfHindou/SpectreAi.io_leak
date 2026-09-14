import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Card } from './Card';
import { Button } from '../Button';
import { Badge } from '../Badge';

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Cards are containers for grouping related content and actions.

## Variants

- **Default**: Standard card with subtle border
- **Elevated**: Raised card with shadow
- **Glass**: Glassmorphism effect with backdrop blur
- **Outlined**: Transparent background with border

## Features

- Optional header and footer sections
- Hoverable state for interactive cards
- Customizable padding
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'elevated', 'glass', 'outlined'],
    },
    hoverable: {
      control: 'boolean',
    },
    padding: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic
export const Default: Story = {
  args: {
    children: (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Card Title</h3>
        <p style={{ margin: 0, color: 'var(--spectre-text-secondary)' }}>
          This is some card content. Cards are used to group related information.
        </p>
      </div>
    ),
  },
};

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    children: (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Elevated Card</h3>
        <p style={{ margin: 0, color: 'var(--spectre-text-secondary)' }}>
          This card has a shadow for more emphasis.
        </p>
      </div>
    ),
  },
};

export const Glass: Story = {
  args: {
    variant: 'glass',
    children: (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Glass Card</h3>
        <p style={{ margin: 0, color: 'var(--spectre-text-secondary)' }}>
          Glassmorphism effect with backdrop blur.
        </p>
      </div>
    ),
  },
  parameters: {
    backgrounds: { default: 'spectre-surface' },
  },
};

export const Outlined: Story = {
  args: {
    variant: 'outlined',
    children: (
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>Outlined Card</h3>
        <p style={{ margin: 0, color: 'var(--spectre-text-secondary)' }}>
          Transparent background with border only.
        </p>
      </div>
    ),
  },
};

// With Header
export const WithHeader: Story = {
  args: {
    header: <span>Token Stats</span>,
    children: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--spectre-text-tertiary)' }}>Market Cap</span>
          <span style={{ fontFamily: 'var(--spectre-font-mono)' }}>$1.2M</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--spectre-text-tertiary)' }}>24h Volume</span>
          <span style={{ fontFamily: 'var(--spectre-font-mono)' }}>$234K</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--spectre-text-tertiary)' }}>Holders</span>
          <span style={{ fontFamily: 'var(--spectre-font-mono)' }}>1,234</span>
        </div>
      </div>
    ),
  },
};

// With Footer
export const WithFooter: Story = {
  args: {
    header: <span>SPECTRE</span>,
    children: (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: '32px', fontFamily: 'var(--spectre-font-mono)', fontWeight: 600, marginBottom: '8px' }}>
          $0.00234
        </div>
        <div style={{ color: 'var(--spectre-bull)', fontSize: '14px' }}>
          ↑ +12.45%
        </div>
      </div>
    ),
    footer: (
      <div style={{ display: 'flex', gap: '8px' }}>
        <Button variant="success" size="sm" fullWidth>Buy</Button>
        <Button variant="danger" size="sm" fullWidth>Sell</Button>
      </div>
    ),
  },
};

// Hoverable
export const Hoverable: Story = {
  args: {
    hoverable: true,
    children: (
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: 'var(--spectre-accent-gradient)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '24px',
        }}>
          👻
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontWeight: 600 }}>SPECTRE</span>
            <Badge variant="success" size="sm">Verified</Badge>
          </div>
          <div style={{ color: 'var(--spectre-text-tertiary)', fontSize: '14px' }}>
            Spectre AI Token
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--spectre-font-mono)', fontWeight: 600 }}>$0.00234</div>
          <div style={{ color: 'var(--spectre-bull)', fontSize: '14px' }}>+12.45%</div>
        </div>
      </div>
    ),
  },
  parameters: {
    docs: {
      description: {
        story: 'Hoverable cards are great for clickable items like token lists.',
      },
    },
  },
};

// All Variants
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', width: '600px' }}>
      <Card variant="default">
        <h4 style={{ margin: '0 0 8px' }}>Default</h4>
        <p style={{ margin: 0, color: 'var(--spectre-text-tertiary)', fontSize: '14px' }}>
          Standard card style
        </p>
      </Card>
      <Card variant="elevated">
        <h4 style={{ margin: '0 0 8px' }}>Elevated</h4>
        <p style={{ margin: 0, color: 'var(--spectre-text-tertiary)', fontSize: '14px' }}>
          With shadow
        </p>
      </Card>
      <Card variant="glass">
        <h4 style={{ margin: '0 0 8px' }}>Glass</h4>
        <p style={{ margin: 0, color: 'var(--spectre-text-tertiary)', fontSize: '14px' }}>
          Backdrop blur effect
        </p>
      </Card>
      <Card variant="outlined">
        <h4 style={{ margin: '0 0 8px' }}>Outlined</h4>
        <p style={{ margin: 0, color: 'var(--spectre-text-tertiary)', fontSize: '14px' }}>
          Border only
        </p>
      </Card>
    </div>
  ),
};
