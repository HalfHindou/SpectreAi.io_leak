import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Modal } from './Modal';
import { Button } from '../Button';
import { Input } from '../Input';

const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The Modal component provides a dialog overlay for confirmations, forms, and detailed content.

## Features

- **Focus Trap**: Keyboard focus is contained within the modal
- **Escape to Close**: Press Escape to close (configurable)
- **Click Outside**: Click overlay to close (configurable)
- **Body Scroll Lock**: Prevents background scrolling
- **Accessibility**: Proper ARIA attributes and focus management

## Sizes

- \`sm\`: 400px max - Simple confirmations
- \`md\`: 500px max - Forms and dialogs (default)
- \`lg\`: 640px max - Detailed content
- \`xl\`: 800px max - Large forms or content
- \`full\`: Full screen - Complex workflows
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl', 'full'],
    },
    closeOnOverlayClick: {
      control: 'boolean',
    },
    closeOnEscape: {
      control: 'boolean',
    },
    showCloseButton: {
      control: 'boolean',
    },
  },
  args: {
    onClose: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Interactive wrapper for demos
const ModalDemo = ({ children, ...props }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setIsOpen(true)}>Open Modal</Button>
      <Modal {...props} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        {children}
      </Modal>
    </>
  );
};

// Basic
export const Default: Story = {
  render: (args) => (
    <ModalDemo {...args}>
      <p>This is a basic modal with some content. You can add any React content here.</p>
    </ModalDemo>
  ),
  args: {
    title: 'Modal Title',
  },
};

export const WithFooter: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Open Modal</Button>
        <Modal
          {...args}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setIsOpen(false)}>
                Confirm
              </Button>
            </>
          }
        >
          <p>Are you sure you want to proceed with this action?</p>
        </Modal>
      </>
    );
  },
  args: {
    title: 'Confirm Action',
  },
};

// Sizes
export const Small: Story = {
  render: (args) => (
    <ModalDemo {...args}>
      <p>A small modal for simple confirmations.</p>
    </ModalDemo>
  ),
  args: {
    title: 'Small Modal',
    size: 'sm',
  },
};

export const Large: Story = {
  render: (args) => (
    <ModalDemo {...args}>
      <p>A large modal with more space for content. This is useful for displaying detailed information or forms with multiple fields.</p>
      <p style={{ marginTop: '16px' }}>You can include any content here including images, forms, or complex layouts.</p>
    </ModalDemo>
  ),
  args: {
    title: 'Large Modal',
    size: 'lg',
  },
};

export const ExtraLarge: Story = {
  render: (args) => (
    <ModalDemo {...args}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div>
          <h3 style={{ marginBottom: '12px' }}>Section 1</h3>
          <p>Content for the first section with detailed information.</p>
        </div>
        <div>
          <h3 style={{ marginBottom: '12px' }}>Section 2</h3>
          <p>Content for the second section with additional details.</p>
        </div>
      </div>
    </ModalDemo>
  ),
  args: {
    title: 'Extra Large Modal',
    size: 'xl',
  },
};

// Use Cases
export const ConfirmationDialog: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button variant="danger" onClick={() => setIsOpen(true)}>
          Delete Token
        </Button>
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Delete Token"
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setIsOpen(false)}>
                Delete
              </Button>
            </>
          }
        >
          <p>Are you sure you want to remove this token from your watchlist? This action cannot be undone.</p>
        </Modal>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'A confirmation dialog for destructive actions.',
      },
    },
  },
};

export const FormModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>
          Connect Wallet
        </Button>
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Connect Wallet"
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setIsOpen(false)}>
                Connect
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input
              label="Wallet Address"
              placeholder="Enter your wallet address..."
              fullWidth
            />
            <Input
              label="Network"
              placeholder="Select network..."
              fullWidth
            />
          </div>
        </Modal>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'A modal containing a form for user input.',
      },
    },
  },
};

export const TradeConfirmation: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button variant="success" onClick={() => setIsOpen(true)}>
          Execute Trade
        </Button>
        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Confirm Trade"
          footer={
            <>
              <Button variant="ghost" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="success" onClick={() => setIsOpen(false)}>
                Confirm Trade
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              padding: '12px', 
              background: 'var(--spectre-bg-elevated)', 
              borderRadius: 'var(--spectre-radius-md)' 
            }}>
              <span style={{ color: 'var(--spectre-text-tertiary)' }}>You Pay</span>
              <span style={{ fontFamily: 'var(--spectre-font-mono)', fontWeight: 600 }}>1.5 SOL</span>
            </div>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              padding: '12px', 
              background: 'var(--spectre-bg-elevated)', 
              borderRadius: 'var(--spectre-radius-md)' 
            }}>
              <span style={{ color: 'var(--spectre-text-tertiary)' }}>You Receive</span>
              <span style={{ fontFamily: 'var(--spectre-font-mono)', fontWeight: 600, color: 'var(--spectre-bull)' }}>~2,450 SPECTRE</span>
            </div>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              padding: '12px', 
              background: 'var(--spectre-bg-elevated)', 
              borderRadius: 'var(--spectre-radius-md)' 
            }}>
              <span style={{ color: 'var(--spectre-text-tertiary)' }}>Slippage</span>
              <span>0.5%</span>
            </div>
          </div>
        </Modal>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Trade confirmation modal showing transaction details.',
      },
    },
  },
};

// No close button
export const NoCloseButton: Story = {
  render: (args) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Open Modal</Button>
        <Modal
          {...args}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          showCloseButton={false}
          footer={
            <Button onClick={() => setIsOpen(false)}>
              Got it
            </Button>
          }
        >
          <p>This modal has no close button. Use the footer button to dismiss.</p>
        </Modal>
      </>
    );
  },
  args: {
    title: 'Important Notice',
    closeOnOverlayClick: false,
    closeOnEscape: false,
  },
};
