/**
 * KeycapChip — glass keycap pill used in the command palette and the
 * header search trigger. Refined from the inline `<kbd>` styling that
 * used to live in `CommandPalette/palette.css` (kept the same look,
 * lifted to a reusable primitive so the palette footer + the header
 * Cmd+K chip both consume one component).
 *
 * Props
 *   children: the glyph or label (e.g. `⌘`, `K`, `↵`, `esc`)
 *   size:    'sm' (default) | 'md'
 *   tone:    'default' (default) | 'accent' — accent variant is used
 *            inline on a keyboard-focused row to confirm "press ↵"
 *   className: optional extra class
 */
import React from 'react'
import './KeycapChip.css'

function KeycapChip({ children, size = 'sm', tone = 'default', className = '', ...rest }) {
  return (
    <span
      className={[
        'keycap',
        `keycap--${size}`,
        tone !== 'default' && `keycap--${tone}`,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  )
}

export default React.memo(KeycapChip)
