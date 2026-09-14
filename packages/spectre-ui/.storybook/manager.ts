import { addons } from '@storybook/manager-api';
import { create } from '@storybook/theming/create';

const spectreTheme = create({
  base: 'dark',
  
  // Brand
  brandTitle: 'Spectre AI Design System',
  brandUrl: 'https://spectre-ai-trading.vercel.app',
  brandTarget: '_blank',
  
  // Colors
  colorPrimary: '#8B5CF6',
  colorSecondary: '#6366F1',
  
  // UI
  appBg: '#0a0a0f',
  appContentBg: '#0a0a0f',
  appPreviewBg: '#0a0a0f',
  appBorderColor: 'rgba(255, 255, 255, 0.08)',
  appBorderRadius: 8,
  
  // Text colors
  textColor: '#f4f4f5',
  textInverseColor: '#0a0a0f',
  textMutedColor: '#71717a',
  
  // Toolbar
  barTextColor: '#a1a1aa',
  barSelectedColor: '#8B5CF6',
  barHoverColor: '#A78BFA',
  barBg: '#12121a',
  
  // Form colors
  inputBg: '#1a1a24',
  inputBorder: 'rgba(255, 255, 255, 0.1)',
  inputTextColor: '#f4f4f5',
  inputBorderRadius: 8,
  
  // Button
  buttonBg: '#8B5CF6',
  buttonBorder: 'transparent',
  
  // Boolean (toggle)
  booleanBg: '#1a1a24',
  booleanSelectedBg: '#8B5CF6',
  
  // Grid
  gridCellSize: 12,
});

addons.setConfig({
  theme: spectreTheme,
  sidebar: {
    showRoots: true,
    collapsedRoots: [],
  },
  toolbar: {
    title: { hidden: false },
    zoom: { hidden: false },
    eject: { hidden: true },
    copy: { hidden: false },
    fullscreen: { hidden: false },
  },
  enableShortcuts: true,
});
