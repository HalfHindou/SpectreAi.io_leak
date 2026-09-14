/**
 * Spectre Studio -- Theme definitions
 *
 * 12 canvas themes organised into four groups:
 *   dark  -- Void, Terminal, Deep Space
 *   light -- Zen Minimal (default), Paper, Whiteboard
 *   color -- Street Art, Infrared, Ocean
 *   mood  -- Bull Run, Blood Streets, Neutral Zone
 *
 * Each theme provides the full visual context for the canvas,
 * sticker containers, and the top toolbar.
 */

export const STUDIO_THEMES = {
  /* ------------------------------------------------------------------ */
  /*  DARK                                                               */
  /* ------------------------------------------------------------------ */

  void: {
    id: 'void',
    name: 'Void',
    group: 'dark',
    canvasBg: '#000000',
    stickerText: {
      primary: 'rgba(255,255,255,1)',
      secondary: 'rgba(255,255,255,0.72)',
      tertiary: 'rgba(255,255,255,0.48)',
    },
    stickerBg: {
      background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
      border: '1px solid rgba(255,255,255,0.06)',
      shadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(0,0,0,0.8)',
    accentColor: '#8b5cf6',
  },

  terminal: {
    id: 'terminal',
    name: 'Terminal',
    group: 'dark',
    canvasBg: '#0a0e1a',
    stickerText: {
      primary: '#00FF88',
      secondary: 'rgba(255,255,255,0.6)',
      tertiary: 'rgba(255,255,255,0.4)',
    },
    stickerBg: {
      background: 'rgba(10,14,26,0.9)',
      border: '1px solid rgba(0,255,136,0.08)',
      shadow: 'none',
      backdropFilter: 'none',
    },
    toolbarBg: '#0a0e1a',
    accentColor: '#00FF88',
  },

  'deep-space': {
    id: 'deep-space',
    name: 'Deep Space',
    group: 'dark',
    canvasBg: '#06060a',
    stickerText: {
      primary: 'rgba(255,255,255,1)',
      secondary: 'rgba(255,255,255,0.65)',
      tertiary: 'rgba(255,255,255,0.45)',
    },
    stickerBg: {
      background: 'rgba(100,150,255,0.02)',
      border: '1px solid rgba(100,150,255,0.06)',
      shadow: 'inset 0 1px 0 rgba(100,150,255,0.04)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(6,6,10,0.85)',
    accentColor: '#648cff',
  },

  /* ------------------------------------------------------------------ */
  /*  LIGHT                                                              */
  /* ------------------------------------------------------------------ */

  'zen-minimal': {
    id: 'zen-minimal',
    name: 'Zen Minimal',
    group: 'light',
    canvasBg: '#f5f0e8',
    stickerText: {
      primary: '#1a1a1f',
      secondary: 'rgba(0,0,0,0.55)',
      tertiary: 'rgba(0,0,0,0.35)',
    },
    stickerBg: {
      background: '#ffffff',
      border: '1px solid rgba(0,0,0,0.06)',
      shadow: '0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)',
      backdropFilter: 'none',
    },
    toolbarBg: 'rgba(245,240,232,0.95)',
    accentColor: '#1a1a1f',
  },

  paper: {
    id: 'paper',
    name: 'Paper',
    group: 'light',
    canvasBg: '#faf8f3',
    stickerText: {
      primary: '#2a2a2a',
      secondary: 'rgba(0,0,0,0.5)',
      tertiary: 'rgba(0,0,0,0.3)',
    },
    stickerBg: {
      background: '#faf8f3',
      border: 'none',
      shadow: '0 1px 4px rgba(0,0,0,0.06)',
      backdropFilter: 'none',
    },
    toolbarBg: '#faf8f3',
    accentColor: '#2a2a2a',
  },

  whiteboard: {
    id: 'whiteboard',
    name: 'Whiteboard',
    group: 'light',
    canvasBg: '#ffffff',
    stickerText: {
      primary: '#1a1a1f',
      secondary: 'rgba(0,0,0,0.55)',
      tertiary: 'rgba(0,0,0,0.35)',
    },
    stickerBg: {
      background: '#ffffff',
      border: '1px solid rgba(100,140,255,0.1)',
      shadow: '0 1px 4px rgba(100,140,255,0.06)',
      backdropFilter: 'none',
    },
    toolbarBg: '#ffffff',
    accentColor: '#648cff',
  },

  /* ------------------------------------------------------------------ */
  /*  COLOR                                                              */
  /* ------------------------------------------------------------------ */

  'street-art': {
    id: 'street-art',
    name: 'Street Art',
    group: 'color',
    canvasBg: '#f5f0e8',
    stickerText: {
      primary: '#1a1a1f',
      secondary: 'rgba(0,0,0,0.6)',
      tertiary: 'rgba(0,0,0,0.4)',
    },
    stickerBg: {
      background: 'rgba(245,240,232,0.85)',
      border: '2px solid #000000',
      shadow: '4px 4px 0 rgba(0,0,0,0.15)',
      backdropFilter: 'none',
    },
    toolbarBg: '#f5f0e8',
    accentColor: '#F7C31A',
  },

  infrared: {
    id: 'infrared',
    name: 'Infrared',
    group: 'color',
    canvasBg: '#0a0505',
    stickerText: {
      primary: 'rgba(255,240,230,1)',
      secondary: 'rgba(255,200,180,0.7)',
      tertiary: 'rgba(255,180,160,0.5)',
    },
    stickerBg: {
      background: 'rgba(255,50,50,0.04)',
      border: '1px solid rgba(255,50,50,0.08)',
      shadow: 'inset 0 1px 0 rgba(255,50,50,0.06)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(10,5,5,0.85)',
    accentColor: '#ff3232',
  },

  ocean: {
    id: 'ocean',
    name: 'Ocean',
    group: 'color',
    canvasBg: 'linear-gradient(180deg, #0a1628 0%, #0d2137 50%, #0f2942 100%)',
    stickerText: {
      primary: 'rgba(255,255,255,1)',
      secondary: 'rgba(200,240,255,0.7)',
      tertiary: 'rgba(200,240,255,0.5)',
    },
    stickerBg: {
      background: 'rgba(0,180,255,0.04)',
      border: '1px solid rgba(0,180,255,0.06)',
      shadow: 'inset 0 1px 0 rgba(0,180,255,0.04)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(10,22,40,0.85)',
    accentColor: '#00b4ff',
  },

  /* ------------------------------------------------------------------ */
  /*  MOOD                                                               */
  /* ------------------------------------------------------------------ */

  'bull-run': {
    id: 'bull-run',
    name: 'Bull Run',
    group: 'mood',
    canvasBg: '#050a05',
    stickerText: {
      primary: 'rgba(255,255,255,1)',
      secondary: 'rgba(200,255,220,0.7)',
      tertiary: 'rgba(200,255,220,0.5)',
    },
    stickerBg: {
      background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
      border: '1px solid rgba(16,185,129,0.1)',
      shadow: 'inset 0 1px 0 rgba(16,185,129,0.06)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(5,10,5,0.85)',
    accentColor: '#10B981',
  },

  'blood-streets': {
    id: 'blood-streets',
    name: 'Blood Streets',
    group: 'mood',
    canvasBg: '#0a0404',
    stickerText: {
      primary: 'rgba(255,255,255,1)',
      secondary: 'rgba(255,200,200,0.7)',
      tertiary: 'rgba(255,200,200,0.5)',
    },
    stickerBg: {
      background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
      border: '1px solid rgba(239,68,68,0.06)',
      shadow: 'inset 0 1px 0 rgba(239,68,68,0.04)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(10,4,4,0.85)',
    accentColor: '#EF4444',
  },

  'neutral-zone': {
    id: 'neutral-zone',
    name: 'Neutral Zone',
    group: 'mood',
    canvasBg: '#08080c',
    stickerText: {
      primary: 'rgba(255,255,255,1)',
      secondary: 'rgba(255,255,255,0.6)',
      tertiary: 'rgba(255,255,255,0.4)',
    },
    stickerBg: {
      background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
      border: '1px solid rgba(255,255,255,0.06)',
      shadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      backdropFilter: 'blur(12px)',
    },
    toolbarBg: 'rgba(8,8,12,0.85)',
    accentColor: '#f59e0b',
  },
};

/**
 * Returns a flat list of { id, name, group } for rendering
 * theme pickers without carrying the full style payload.
 */
export function getThemeList() {
  return Object.values(STUDIO_THEMES).map(({ id, name, group }) => ({
    id,
    name,
    group,
  }));
}
