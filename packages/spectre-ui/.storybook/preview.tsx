import React from 'react';
import type { Preview } from '@storybook/react';
import { withThemeByClassName } from '@storybook/addon-themes';
import { SpectreThemeProvider } from '../src/tokens/ThemeProvider';
import '../src/tokens/variables.css';
import '../src/styles/global.css';
import './storybook.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
      expanded: true,
      sort: 'requiredFirst',
    },
    backgrounds: {
      default: 'spectre-base',
      values: [
        { name: 'spectre-void', value: '#050508' },
        { name: 'spectre-base', value: '#0a0a0f' },
        { name: 'spectre-surface', value: '#12121a' },
        { name: 'spectre-elevated', value: '#1a1a24' },
        { name: 'light', value: '#ffffff' },
      ],
    },
    layout: 'centered',
    docs: {
      toc: {
        contentsSelector: '.sbdocs-content',
        headingSelector: 'h2, h3',
        ignoreSelector: '.docs-story h2, .docs-story h3',
        disable: false,
      },
    },
    options: {
      storySort: {
        method: 'alphabetical',
        order: [
          'Introduction',
          'Foundation',
          ['Design Tokens', '*'],
          'Components',
          ['Button', 'Input', 'Modal', 'Toast', 'AuthGate'],
          'Utilities',
          '*',
        ],
      },
    },
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: true },
          { id: 'button-name', enabled: true },
          { id: 'image-alt', enabled: true },
          { id: 'label', enabled: true },
          { id: 'link-name', enabled: true },
        ],
      },
      options: {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
      },
    },
  },
  decorators: [
    (Story, context) => {
      // Don't wrap the Welcome page
      if (context.title === 'Introduction') {
        return <Story />;
      }
      
      return (
        <SpectreThemeProvider>
          <div className="story-wrapper">
            <Story />
          </div>
        </SpectreThemeProvider>
      );
    },
    withThemeByClassName({
      themes: {
        dark: 'spectre-dark',
        light: 'spectre-light',
      },
      defaultTheme: 'dark',
    }),
  ],
  tags: ['autodocs'],
};

export default preview;
