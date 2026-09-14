import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ToastProvider, useToast } from './Toast';
import { Button } from '../Button';

const meta: Meta = {
  title: 'Components/Toast',
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The Toast component provides non-intrusive notifications for user feedback.

## Setup

Wrap your app with \`ToastProvider\`:

\`\`\`tsx
import { ToastProvider } from '@spectre-ai/ui';

function App() {
  return (
    <ToastProvider position="bottom-right">
      <YourApp />
    </ToastProvider>
  );
}
\`\`\`

## Usage

Use the \`useToast\` hook to trigger toasts:

\`\`\`tsx
import { useToast } from '@spectre-ai/ui';

function MyComponent() {
  const { toast } = useToast();
  
  return (
    <Button onClick={() => toast({ 
      message: 'Success!', 
      variant: 'success' 
    })}>
      Show Toast
    </Button>
  );
}
\`\`\`

## Features

- **Auto-dismiss**: Toasts automatically disappear after a set duration
- **Variants**: success, error, warning, info, default
- **Actions**: Add custom action buttons
- **Positions**: 6 position options
- **Accessibility**: Proper ARIA attributes for screen readers
        `,
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <ToastProvider position="bottom-right">
        <Story />
      </ToastProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj;

// Demo component
function ToastDemo({ variant, message, description, duration, action }: any) {
  const { toast } = useToast();

  return (
    <Button
      onClick={() =>
        toast({
          message,
          description,
          variant,
          duration,
          action,
        })
      }
    >
      Show {variant || 'default'} toast
    </Button>
  );
}

// Basic variants
export const Default: Story = {
  render: () => <ToastDemo message="This is a default toast notification" />,
};

export const Success: Story = {
  render: () => (
    <ToastDemo 
      variant="success" 
      message="Transaction successful!" 
      description="Your trade has been executed."
    />
  ),
};

export const Error: Story = {
  render: () => (
    <ToastDemo 
      variant="error" 
      message="Transaction failed" 
      description="Insufficient balance for this trade."
    />
  ),
};

export const Warning: Story = {
  render: () => (
    <ToastDemo 
      variant="warning" 
      message="High slippage detected" 
      description="This trade may result in unfavorable rates."
    />
  ),
};

export const Info: Story = {
  render: () => (
    <ToastDemo 
      variant="info" 
      message="New tokens available" 
      description="5 new tokens have been added to Trending."
    />
  ),
};

// With Action
export const WithAction: Story = {
  render: () => {
    const { toast } = useToast();

    return (
      <Button
        onClick={() =>
          toast({
            message: 'Token copied to clipboard',
            variant: 'success',
            action: {
              label: 'Undo',
              onClick: () => console.log('Undo clicked'),
            },
          })
        }
      >
        Show toast with action
      </Button>
    );
  },
};

// Long duration
export const LongDuration: Story = {
  render: () => (
    <ToastDemo 
      message="This toast stays for 10 seconds" 
      duration={10000}
    />
  ),
};

// All Variants Showcase
export const AllVariants: Story = {
  render: () => {
    const { toast } = useToast();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Button
          onClick={() => toast({ message: 'Default notification' })}
        >
          Default
        </Button>
        <Button
          variant="success"
          onClick={() =>
            toast({
              message: 'Transaction successful!',
              description: 'Your trade has been executed.',
              variant: 'success',
            })
          }
        >
          Success
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            toast({
              message: 'Transaction failed',
              description: 'Please try again.',
              variant: 'error',
            })
          }
        >
          Error
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              message: 'Warning',
              description: 'Proceed with caution.',
              variant: 'warning',
            })
          }
        >
          Warning
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            toast({
              message: 'Info',
              description: 'Here is some information.',
              variant: 'info',
            })
          }
        >
          Info
        </Button>
      </div>
    );
  },
};

// Trading Use Cases
export const TradingToasts: Story = {
  render: () => {
    const { toast } = useToast();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Button
          variant="success"
          onClick={() =>
            toast({
              message: 'Buy order executed',
              description: 'Bought 1,000 SPECTRE for 0.5 SOL',
              variant: 'success',
            })
          }
        >
          Buy Success
        </Button>
        <Button
          variant="danger"
          onClick={() =>
            toast({
              message: 'Sell order executed',
              description: 'Sold 500 SPECTRE for 0.25 SOL',
              variant: 'success',
            })
          }
        >
          Sell Success
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast({
              message: 'Token added to watchlist',
              variant: 'info',
              action: {
                label: 'View',
                onClick: () => console.log('View watchlist'),
              },
            })
          }
        >
          Add to Watchlist
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            toast({
              message: 'CA copied to clipboard',
              variant: 'success',
              duration: 2000,
            })
          }
        >
          Copy Address
        </Button>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Common toast patterns used in the trading platform.',
      },
    },
  },
};
