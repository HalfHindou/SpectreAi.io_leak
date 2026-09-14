/**
 * Icon – Apple-style SVG icon component using spectre-icons.
 * Use <Icon name="search" /> or <Icon name="chevron-down" size={20} className="..." />.
 * Icons inherit color via currentColor.
 */
import React from 'react'
import './Icon.css'

const iconModules = import.meta.glob('/spectre-icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true
})

const iconMap = {}
for (const [path, raw] of Object.entries(iconModules)) {
  const name = path.replace(/^.*[/\\]spectre-icons[/\\]/, '').replace(/\.svg$/i, '')
  iconMap[name] = raw
}

export const ICON_NAMES = Object.keys(iconMap)

function Icon({ name, size = 24, className = '', style = {}, ...rest }) {
  const raw = iconMap[name]
  if (!raw) return null

  const sized = String(raw)
    .replace(/\bwidth="24"/, `width="${size}"`)
    .replace(/\bheight="24"/, `height="${size}"`)

  // Safe: `sized` originates from `import.meta.glob('/spectre-icons/*.svg')`
  // which Vite bundles at build time. The only runtime mutation is replacing
  // the literal `width="24"` / `height="24"` with `size` (a Number). No user
  // input ever reaches this prop.
  return (
    <span
      className={`icon-wrap ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        color: 'inherit',
        ...style
      }}
      dangerouslySetInnerHTML={{ __html: sized }}
      {...rest}
    />
  )
}

export default Icon
