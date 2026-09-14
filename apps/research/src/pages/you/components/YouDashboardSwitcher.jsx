/**
 * YouDashboardSwitcher — toolbar dropdown for picking + creating dashboards.
 *
 * Renders a button showing the current dashboard name. Click opens a small
 * panel with the list of dashboards (rename/delete inline) and a "+ New
 * dashboard" action.
 */

import { useEffect, useRef, useState } from 'react'
import './YouDashboardSwitcher.css'

export default function YouDashboardSwitcher({
  dashboards,
  currentId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handle = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const current = dashboards.find(d => d.id === currentId) || dashboards[0]

  const startEdit = (d) => {
    setEditingId(d.id)
    setEditingName(d.name)
  }

  const commitEdit = () => {
    if (editingId && editingName.trim()) {
      onRename(editingId, editingName.trim().slice(0, 40))
    }
    setEditingId(null)
    setEditingName('')
  }

  return (
    <div className="you-ds" ref={rootRef}>
      <button
        type="button"
        className={`you-ds-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Switch dashboard"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span className="you-ds-name">{current?.name || 'Dashboard'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="you-ds-caret">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="you-ds-panel" role="menu">
          <div className="you-ds-panel-list">
            {dashboards.map(d => {
              const isCurrent = d.id === currentId
              const isEditing = editingId === d.id
              return (
                <div key={d.id} className={`you-ds-item${isCurrent ? ' is-current' : ''}`}>
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      className="you-ds-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { commitEdit() }
                        if (e.key === 'Escape') { setEditingId(null); setEditingName('') }
                      }}
                      maxLength={40}
                    />
                  ) : (
                    <button
                      type="button"
                      className="you-ds-item-label"
                      onClick={() => { onSwitch(d.id); setOpen(false) }}
                    >
                      <span className="you-ds-item-dot" aria-hidden="true" />
                      <span className="you-ds-item-name">{d.name}</span>
                      <span className="you-ds-item-count mono">{d.widgets.length}</span>
                    </button>
                  )}
                  {!isEditing && (
                    <div className="you-ds-item-actions">
                      <button
                        type="button"
                        className="you-ds-icon"
                        title="Rename"
                        onClick={(e) => { e.stopPropagation(); startEdit(d) }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                      {dashboards.length > 1 && (
                        <button
                          type="button"
                          className="you-ds-icon you-ds-icon--danger"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Delete "${d.name}"? This can't be undone.`)) {
                              onDelete(d.id)
                            }
                          }}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            className="you-ds-new"
            onClick={() => {
              const newId = onCreate(`Dashboard ${dashboards.length + 1}`)
              setOpen(false)
              if (newId) {
                // Open rename inline once the new dashboard renders
                setTimeout(() => startEdit({ id: newId, name: `Dashboard ${dashboards.length + 1}` }), 50)
              }
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New dashboard</span>
          </button>
        </div>
      )}
    </div>
  )
}
