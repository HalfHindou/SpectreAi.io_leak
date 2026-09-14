import React from 'react'
import './page-layout.css'

const DEFAULT_MAX_WIDTH = '960px'

export default function PageLayout({ children, centered = false, maxWidth = DEFAULT_MAX_WIDTH, className = '', noSidebar = false }) {
  const rootClass = [
    'page-layout',
    centered ? 'page-layout--centered' : '',
    noSidebar ? 'page-layout--no-sidebar' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={rootClass} style={centered ? { '--page-layout-max-width': maxWidth } : undefined}>
      <div className="page-layout__content">
        {centered ? <div className="page-layout__inner">{children}</div> : children}
      </div>
    </div>
  )
}
