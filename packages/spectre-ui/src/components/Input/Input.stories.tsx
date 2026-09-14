import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'Components/Input',
  component: Input,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The Input component handles all text-based user input in the Spectre ecosystem.

## Features

- **Labels & Helper Text**: Built-in support for accessible labels
- **Error States**: Visual and accessible error handling
- **Icons**: Support for left/right icons or custom elements
- **Password Toggle**: Built-in show/hide for password inputs
- **Sizes**: Three size variants for different contexts

## Accessibility

- Labels are properly associated with inputs via \`htmlFor\`
- Error messages use \`role="alert"\` and \`aria-describedby\`
- \`aria-invalid\` is set when errors are present
        `,
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    type: {
      control: 'select',
      options: ['text', 'password', 'email', 'number', 'search'],
    },
    fullWidth: {
      control: 'boolean',
    },
    disabled: {
      control: 'boolean',
    },
  },
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic
export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Token Address',
    placeholder: 'Enter token address...',
  },
};

export const WithHelperText: Story = {
  args: {
    label: 'Wallet Address',
    placeholder: '0x...',
    helperText: 'Enter your Solana or Ethereum wallet address',
  },
};

export const WithError: Story = {
  args: {
    label: 'Amount',
    placeholder: '0.00',
    error: 'Insufficient balance',
    defaultValue: '1000',
  },
};

// Types
export const Password: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter password...',
  },
  parameters: {
    docs: {
      description: {
        story: 'Password input with built-in show/hide toggle.',
      },
    },
  },
};

export const Number: Story = {
  args: {
    label: 'Amount',
    type: 'number',
    placeholder: '0.00',
  },
};

export const Search: Story = {
  args: {
    type: 'search',
    placeholder: 'Search tokens, wallets, or paste address...',
    leftElement: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
};

// Sizes
export const Small: Story = {
  args: {
    size: 'sm',
    placeholder: 'Small input',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
    placeholder: 'Medium input',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    placeholder: 'Large input',
  },
};

// States
export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: 'Disabled input',
    defaultValue: 'Cannot edit',
  },
};

export const FullWidth: Story = {
  args: {
    fullWidth: true,
    label: 'Full Width Input',
    placeholder: 'Takes full container width',
  },
  parameters: {
    layout: 'padded',
  },
};

// With Elements
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

const CurrencyBadge = () => (
  <span style={{ 
    fontSize: '0.75rem', 
    fontWeight: 600,
    color: 'var(--spectre-text-secondary)',
    background: 'var(--spectre-bg-elevated)',
    padding: '2px 8px',
    borderRadius: 'var(--spectre-radius-sm)',
  }}>
    SOL
  </span>
);

export const WithLeftIcon: Story = {
  args: {
    leftElement: <SearchIcon />,
    placeholder: 'Search...',
  },
};

export const WithRightElement: Story = {
  args: {
    label: 'Amount',
    placeholder: '0.00',
    rightElement: <CurrencyBadge />,
    type: 'number',
  },
};

// Trading specific
export const TokenSearch: Story = {
  args: {
    placeholder: 'Search tokens, wallets, or paste address...',
    leftElement: <SearchIcon />,
    size: 'lg',
    fullWidth: true,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Used in the header for searching tokens and wallets.',
      },
    },
  },
};

export const AmountInput: Story = {
  args: {
    label: 'You Pay',
    placeholder: '0.00',
    type: 'number',
    rightElement: <CurrencyBadge />,
    helperText: 'Balance: 10.5 SOL',
    fullWidth: true,
  },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        story: 'Used in the swap widget for entering trade amounts.',
      },
    },
  },
};

// All Variants Showcase
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '320px' }}>
      <Input label="Default" placeholder="Enter text..." />
      <Input label="With Helper" placeholder="Enter..." helperText="This is helper text" />
      <Input label="With Error" placeholder="Enter..." error="This field is required" />
      <Input label="Password" type="password" placeholder="Enter password..." />
      <Input 
        placeholder="Search..." 
        leftElement={<SearchIcon />}
      />
      <Input 
        label="Amount" 
        type="number" 
        placeholder="0.00" 
        rightElement={<CurrencyBadge />}
      />
      <Input label="Disabled" disabled defaultValue="Cannot edit" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Overview of all input variants and states.',
      },
    },
  },
};
