import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Badges are used for status indicators, labels, and categorization.

## Usage Guidelines

- **Default**: Neutral labels, counts, metadata
- **Accent**: Featured items, highlights
- **Success**: Verified, safe, positive states
- **Danger**: Warnings, high risk, errors
- **Warning**: Caution, attention needed
- **Info**: Informational, trending

## Trading Use Cases

- Token verification status
- Risk level indicators
- Trending/new listings
- Price change direction
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'accent', 'success', 'danger', 'warning', 'info'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
    dot: {
      control: 'boolean',
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic variants
export const Default: Story = {
  args: {
    children: 'Default',
  },
};

export const Accent: Story = {
  args: {
    variant: 'accent',
    children: 'Featured',
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Verified',
  },
};

export const Danger: Story = {
  args: {
    variant: 'danger',
    children: 'High Risk',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Trending',
  },
};

export const Info: Story = {
  args: {
    variant: 'info',
    children: 'New',
  },
};

// With Dot
export const WithDot: Story = {
  args: {
    variant: 'success',
    children: 'Live',
    dot: true,
  },
};

// Sizes
export const Small: Story = {
  args: {
    size: 'sm',
    children: 'Small',
  },
};

// All Variants
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
      <Badge>Default</Badge>
      <Badge variant="accent">Featured</Badge>
      <Badge variant="success">Verified</Badge>
      <Badge variant="danger">High Risk</Badge>
      <Badge variant="warning">Trending</Badge>
      <Badge variant="info">New</Badge>
    </div>
  ),
};

// Trading Examples
export const TradingBadges: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h4 style={{ color: 'var(--spectre-text-secondary)', marginBottom: '12px', fontSize: '14px' }}>
          Token Status
        </h4>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Badge variant="success">Verified</Badge>
          <Badge variant="accent">Featured</Badge>
          <Badge variant="warning">New Listing</Badge>
        </div>
      </div>
      
      <div>
        <h4 style={{ color: 'var(--spectre-text-secondary)', marginBottom: '12px', fontSize: '14px' }}>
          Risk Levels
        </h4>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Badge variant="success">Low Risk</Badge>
          <Badge variant="warning">Medium Risk</Badge>
          <Badge variant="danger">High Risk</Badge>
        </div>
      </div>
      
      <div>
        <h4 style={{ color: 'var(--spectre-text-secondary)', marginBottom: '12px', fontSize: '14px' }}>
          Live Status
        </h4>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Badge variant="success" dot>Live</Badge>
          <Badge variant="info" dot>Updating</Badge>
          <Badge variant="default">Offline</Badge>
        </div>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Common badge patterns used in the trading platform.',
      },
    },
  },
};
