import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import {
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
} from './formatters';

const meta: Meta = {
  title: 'Utilities/Formatters',
  parameters: {
    docs: {
      description: {
        component: `
Text formatting utilities for trading and fintech applications.

## Installation

\`\`\`tsx
import { 
  formatCurrency, 
  formatCompact, 
  formatPercent,
  formatPriceChange,
  formatTokenAmount,
  truncateAddress,
  formatRelativeTime,
  formatMarketCap 
} from '@spectre-ai/ui';
\`\`\`

## Usage Examples

All formatters are pure functions that take values and return formatted strings.
        `,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

// Helper component to display formatter results
function FormatterDemo({ 
  title, 
  examples 
}: { 
  title: string; 
  examples: { input: string; output: string }[] 
}) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <h3 style={{ marginBottom: '16px', color: 'var(--spectre-text-primary)' }}>{title}</h3>
      <div style={{ 
        background: 'var(--spectre-bg-surface)', 
        borderRadius: '8px', 
        overflow: 'hidden',
        border: '1px solid var(--spectre-border-default)'
      }}>
        {examples.map((ex, i) => (
          <div 
            key={i}
            style={{ 
              display: 'flex', 
              borderBottom: i < examples.length - 1 ? '1px solid var(--spectre-border-subtle)' : 'none'
            }}
          >
            <code style={{ 
              flex: 1, 
              padding: '12px 16px', 
              color: 'var(--spectre-text-secondary)',
              fontFamily: 'var(--spectre-font-mono)',
              fontSize: '0.875rem',
              borderRight: '1px solid var(--spectre-border-subtle)'
            }}>
              {ex.input}
            </code>
            <code style={{ 
              flex: 1, 
              padding: '12px 16px', 
              color: 'var(--spectre-accent)',
              fontFamily: 'var(--spectre-font-mono)',
              fontSize: '0.875rem'
            }}>
              {ex.output}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Currency: Story = {
  render: () => (
    <FormatterDemo
      title="formatCurrency(value, currency?, decimals?)"
      examples={[
        { input: 'formatCurrency(1234.56)', output: formatCurrency(1234.56) },
        { input: 'formatCurrency(1234.56, "EUR")', output: formatCurrency(1234.56, 'EUR') },
        { input: 'formatCurrency(0.00001234, "USD", 8)', output: formatCurrency(0.00001234, 'USD', 8) },
        { input: 'formatCurrency(1234567.89)', output: formatCurrency(1234567.89) },
      ]}
    />
  ),
};

export const Compact: Story = {
  render: () => (
    <FormatterDemo
      title="formatCompact(value)"
      examples={[
        { input: 'formatCompact(999)', output: formatCompact(999) },
        { input: 'formatCompact(1234)', output: formatCompact(1234) },
        { input: 'formatCompact(1234567)', output: formatCompact(1234567) },
        { input: 'formatCompact(1234567890)', output: formatCompact(1234567890) },
        { input: 'formatCompact(1234567890123)', output: formatCompact(1234567890123) },
      ]}
    />
  ),
};

export const Percent: Story = {
  render: () => (
    <FormatterDemo
      title="formatPercent(value, decimals?, includeSign?)"
      examples={[
        { input: 'formatPercent(0.1234)', output: formatPercent(0.1234) },
        { input: 'formatPercent(0.1234, 1)', output: formatPercent(0.1234, 1) },
        { input: 'formatPercent(0.1234, 2, true)', output: formatPercent(0.1234, 2, true) },
        { input: 'formatPercent(-0.05)', output: formatPercent(-0.05) },
      ]}
    />
  ),
};

export const PriceChange: Story = {
  render: () => {
    const up = formatPriceChange(0.0534);
    const down = formatPriceChange(-0.0234);
    const neutral = formatPriceChange(0);
    
    return (
      <div>
        <FormatterDemo
          title="formatPriceChange(value)"
          examples={[
            { input: 'formatPriceChange(0.0534)', output: `{ value: "${up.value}", direction: "${up.direction}" }` },
            { input: 'formatPriceChange(-0.0234)', output: `{ value: "${down.value}", direction: "${down.direction}" }` },
            { input: 'formatPriceChange(0)', output: `{ value: "${neutral.value}", direction: "${neutral.direction}" }` },
          ]}
        />
        <div style={{ marginTop: '16px' }}>
          <h4 style={{ marginBottom: '8px' }}>Visual Example:</h4>
          <div style={{ display: 'flex', gap: '16px' }}>
            <span style={{ color: 'var(--spectre-bull)', fontFamily: 'var(--spectre-font-mono)' }}>
              ↑ {up.value}
            </span>
            <span style={{ color: 'var(--spectre-bear)', fontFamily: 'var(--spectre-font-mono)' }}>
              ↓ {down.value}
            </span>
          </div>
        </div>
      </div>
    );
  },
};

export const TokenAmount: Story = {
  render: () => (
    <FormatterDemo
      title="formatTokenAmount(value, maxDecimals?)"
      examples={[
        { input: 'formatTokenAmount(1234567890)', output: formatTokenAmount(1234567890) },
        { input: 'formatTokenAmount(1234.567)', output: formatTokenAmount(1234.567) },
        { input: 'formatTokenAmount(1.234567)', output: formatTokenAmount(1.234567) },
        { input: 'formatTokenAmount(0.00001234)', output: formatTokenAmount(0.00001234) },
        { input: 'formatTokenAmount(0.00000001)', output: formatTokenAmount(0.00000001) },
      ]}
    />
  ),
};

export const TruncateAddress: Story = {
  render: () => (
    <FormatterDemo
      title="truncateAddress(address, startChars?, endChars?)"
      examples={[
        { 
          input: 'truncateAddress("0x1234567890abcdef...")', 
          output: truncateAddress('0x1234567890abcdef1234567890abcdef12345678') 
        },
        { 
          input: 'truncateAddress("0x1234...", 8, 6)', 
          output: truncateAddress('0x1234567890abcdef1234567890abcdef12345678', 8, 6) 
        },
        { 
          input: 'truncateAddress("short")', 
          output: truncateAddress('short') 
        },
      ]}
    />
  ),
};

export const RelativeTime: Story = {
  render: () => (
    <FormatterDemo
      title="formatRelativeTime(timestamp)"
      examples={[
        { input: 'formatRelativeTime(now - 30s)', output: formatRelativeTime(Date.now() - 30000) },
        { input: 'formatRelativeTime(now - 5m)', output: formatRelativeTime(Date.now() - 300000) },
        { input: 'formatRelativeTime(now - 2h)', output: formatRelativeTime(Date.now() - 7200000) },
        { input: 'formatRelativeTime(now - 1d)', output: formatRelativeTime(Date.now() - 86400000) },
        { input: 'formatRelativeTime(now - 7d)', output: formatRelativeTime(Date.now() - 604800000) },
      ]}
    />
  ),
};

export const MarketCap: Story = {
  render: () => (
    <FormatterDemo
      title="formatMarketCap(value)"
      examples={[
        { input: 'formatMarketCap(1234)', output: formatMarketCap(1234) },
        { input: 'formatMarketCap(1234567)', output: formatMarketCap(1234567) },
        { input: 'formatMarketCap(1234567890)', output: formatMarketCap(1234567890) },
        { input: 'formatMarketCap(123456789012)', output: formatMarketCap(123456789012) },
      ]}
    />
  ),
};

export const AllFormatters: Story = {
  render: () => (
    <div>
      <h2 style={{ marginBottom: '24px' }}>All Formatters Overview</h2>
      
      <FormatterDemo
        title="Currency & Numbers"
        examples={[
          { input: 'formatCurrency(1234.56)', output: formatCurrency(1234.56) },
          { input: 'formatCompact(1234567)', output: formatCompact(1234567) },
          { input: 'formatNumber(1234567.89)', output: formatNumber(1234567.89) },
          { input: 'formatMarketCap(1234567890)', output: formatMarketCap(1234567890) },
        ]}
      />
      
      <FormatterDemo
        title="Percentages"
        examples={[
          { input: 'formatPercent(0.1234)', output: formatPercent(0.1234) },
          { input: 'formatPriceChange(0.05).value', output: formatPriceChange(0.05).value },
        ]}
      />
      
      <FormatterDemo
        title="Crypto-specific"
        examples={[
          { input: 'formatTokenAmount(0.00001234)', output: formatTokenAmount(0.00001234) },
          { input: 'truncateAddress("0x1234...")', output: truncateAddress('0x1234567890abcdef1234567890abcdef12345678') },
        ]}
      />
      
      <FormatterDemo
        title="Time & Date"
        examples={[
          { input: 'formatRelativeTime(now - 1h)', output: formatRelativeTime(Date.now() - 3600000) },
          { input: 'formatDate(new Date())', output: formatDate(new Date()) },
          { input: 'formatDate(new Date(), "long")', output: formatDate(new Date(), 'long') },
        ]}
      />
      
      <FormatterDemo
        title="Utilities"
        examples={[
          { input: 'pluralize(1, "token", "tokens")', output: pluralize(1, 'token', 'tokens') },
          { input: 'pluralize(5, "token", "tokens")', output: pluralize(5, 'token', 'tokens') },
        ]}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Complete overview of all available formatters.',
      },
    },
  },
};
