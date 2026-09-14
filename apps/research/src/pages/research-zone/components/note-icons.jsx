/**
 * Icon catalog for chart annotations. Each icon is 24×24 viewBox stroke art
 * (Lucide-style geometry) — sized down via CSS in both the picker and the pin.
 * Used by RzNotePopover (picker UI) and trading-chart's DOM pin renderer.
 */
import React from 'react'

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const NOTE_ICONS = [
  {
    id: 'pin',
    label: 'Pin',
    svg: (
      <svg {...stroke}>
        <path d="M12 17v5" />
        <path d="M9 10.76V6h-.5a1.5 1.5 0 0 1 0-3h7a1.5 1.5 0 0 1 0 3H15v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76Z" />
      </svg>
    ),
  },
  {
    id: 'map-pin',
    label: 'Marker',
    svg: (
      <svg {...stroke}>
        <path d="M20 10.5c0 5.5-8 11-8 11s-8-5.5-8-11a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="2.6" />
      </svg>
    ),
  },
  {
    id: 'note',
    label: 'Note',
    svg: (
      <svg {...stroke}>
        <path d="M14.5 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5L14.5 3Z" />
        <path d="M14 3v5h6" />
        <path d="M8 13h8" />
        <path d="M8 17h5" />
      </svg>
    ),
  },
  {
    id: 'bookmark',
    label: 'Bookmark',
    svg: (
      <svg {...stroke}>
        <path d="m19 21-7-4.5L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z" />
      </svg>
    ),
  },
  {
    id: 'flag',
    label: 'Flag',
    svg: (
      <svg {...stroke}>
        <path d="M5 21V4" />
        <path d="M5 4h11l-1.6 3.5L16 11H5" />
      </svg>
    ),
  },
  {
    id: 'bolt',
    label: 'Catalyst',
    svg: (
      <svg {...stroke}>
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
      </svg>
    ),
  },
  {
    id: 'star',
    label: 'Star',
    svg: (
      <svg {...stroke}>
        <path d="m12 2.6 2.86 6 6.64.6-5 4.6 1.5 6.5L12 17l-5.99 3.3 1.5-6.5-5-4.6 6.64-.6L12 2.6Z" />
      </svg>
    ),
  },
  {
    id: 'comment',
    label: 'Comment',
    svg: (
      <svg {...stroke}>
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 9 9 0 0 1-4.6-1.2L3 20l1.3-4.4A8.5 8.5 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.38 8.38 0 0 1 9 8.5Z" />
      </svg>
    ),
  },
]

export const DEFAULT_NOTE_ICON = 'pin'

export function getNoteIcon(id) {
  return NOTE_ICONS.find(i => i.id === id) || NOTE_ICONS[0]
}
