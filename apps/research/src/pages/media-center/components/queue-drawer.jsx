/**
 * Queue Drawer — Apple Cinematic
 * Slide-out panel for queue management, auto-play toggle, and playlists.
 * Portalled to document.body so position:fixed works inside scroll containers.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import useMediaStore from '@/store/useMediaStore'
import InfoTip from '@/components/InfoTip'
import './queue-drawer.css'

const QueueDrawer = ({ open, dayMode = false }) => {
  const { t } = useTranslation()
  const queue = useMediaStore(s => s.queue)
  const queueIndex = useMediaStore(s => s.queueIndex)
  const activeVideo = useMediaStore(s => s.activeVideo)
  const autoPlay = useMediaStore(s => s.autoPlay)
  const playlists = useMediaStore(s => s.playlists)
  const removeFromQueue = useMediaStore(s => s.removeFromQueue)
  const clearQueue = useMediaStore(s => s.clearQueue)
  const reorderQueue = useMediaStore(s => s.reorderQueue)
  const playFromQueue = useMediaStore(s => s.playFromQueue)
  const setAutoPlay = useMediaStore(s => s.setAutoPlay)
  const toggleQueueDrawer = useMediaStore(s => s.toggleQueueDrawer)
  const createPlaylist = useMediaStore(s => s.createPlaylist)
  const deletePlaylist = useMediaStore(s => s.deletePlaylist)
  const renamePlaylist = useMediaStore(s => s.renamePlaylist)
  const playPlaylist = useMediaStore(s => s.playPlaylist)

  /* ── Local state ───────────────────────── */
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [showNewPlaylist, setShowNewPlaylist] = useState(false)
  const [editingPlaylistId, setEditingPlaylistId] = useState(null)
  const [editingPlaylistName, setEditingPlaylistName] = useState('')
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  const newPlaylistRef = useRef(null)
  const editPlaylistRef = useRef(null)

  const drawerRef = useRef(null)

  /* ── Escape key + click-outside closes drawer ── */
  useEffect(() => {
    if (!open) return
    const handleKey = (e) => {
      if (e.key === 'Escape') toggleQueueDrawer()
    }
    const handleClickOutside = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        toggleQueueDrawer()
      }
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, toggleQueueDrawer])

  /* ── Focus new-playlist input when shown ── */
  useEffect(() => {
    if (showNewPlaylist && newPlaylistRef.current) {
      newPlaylistRef.current.focus()
    }
  }, [showNewPlaylist])

  /* ── Focus rename input when editing ────── */
  useEffect(() => {
    if (editingPlaylistId && editPlaylistRef.current) {
      editPlaylistRef.current.focus()
      editPlaylistRef.current.select()
    }
  }, [editingPlaylistId])

  /* ── Drag and drop handlers ────────────── */
  const handleDragStart = useCallback((e, index) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }, [])

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  const handleDrop = useCallback((e, toIndex) => {
    e.preventDefault()
    const fromIndex = dragIndex
    if (fromIndex !== null && fromIndex !== toIndex) {
      reorderQueue(fromIndex, toIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, reorderQueue])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  /* ── Playlist creation ─────────────────── */
  const handleCreatePlaylist = useCallback(() => {
    const name = newPlaylistName.trim()
    if (name) {
      createPlaylist(name)
      setNewPlaylistName('')
      setShowNewPlaylist(false)
    }
  }, [newPlaylistName, createPlaylist])

  /* ── Playlist rename ───────────────────── */
  const handleStartRename = useCallback((playlist) => {
    setEditingPlaylistId(playlist.id)
    setEditingPlaylistName(playlist.name)
  }, [])

  const handleFinishRename = useCallback(() => {
    const name = editingPlaylistName.trim()
    if (name && editingPlaylistId) {
      renamePlaylist(editingPlaylistId, name)
    }
    setEditingPlaylistId(null)
    setEditingPlaylistName('')
  }, [editingPlaylistId, editingPlaylistName, renamePlaylist])

  /* ── Compute "up next" items ───────────── */
  const upNextItems = queue
    .map((video, i) => ({ video, originalIndex: i }))
    .filter((_, i) => i !== queueIndex)

  if (!open) return null

  return createPortal(
      <div ref={drawerRef} className={`mc-drawer${dayMode ? ' day-mode' : ''}`}>
        {/* ── Header ───────────────────── */}
        <div className="mc-drawer-header">
          <h2 className="mc-drawer-title">{t('mediaCenter.drawer.title')}<InfoTip text={t('mediaCenter.drawer.tip')} position="left" /></h2>
          <button
            type="button"
            className="mc-drawer-close"
            onClick={toggleQueueDrawer}
            title={t('mediaCenter.drawer.closeQueue')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable body ──────────── */}
        <div className="mc-drawer-body">

          {/* ── Auto-play toggle ────────── */}
          <div className="mc-drawer-section">
            <div className="mc-drawer-autoplay">
              <span className="mc-drawer-autoplay-label">{t('mediaCenter.drawer.autoPlay')}<InfoTip text={t('mediaCenter.drawer.autoPlayTip')} position="left" /></span>
              <button
                type="button"
                className={`mc-drawer-toggle${autoPlay ? ' on' : ''}`}
                onClick={() => setAutoPlay(!autoPlay)}
                title={autoPlay ? t('mediaCenter.drawer.disableAutoplay') : t('mediaCenter.drawer.enableAutoplay')}
              >
                <span className="mc-drawer-toggle-dot" />
              </button>
            </div>
          </div>

          {/* ── Now Playing ─────────────── */}
          {activeVideo && (
            <div className="mc-drawer-section">
              <h3 className="mc-drawer-section-title">{t('mediaCenter.drawer.nowPlaying')}</h3>
              <div className="mc-drawer-now-playing">
                <div className="mc-drawer-now-thumb">
                  <img
                    src={`https://img.youtube.com/vi/${activeVideo.id}/default.jpg`}
                    alt=""
                    className="mc-drawer-thumb-img"
                    loading="lazy"
                  />
                  <div className="mc-drawer-now-indicator">
                    <span className="mc-drawer-eq-bar" />
                    <span className="mc-drawer-eq-bar" />
                    <span className="mc-drawer-eq-bar" />
                  </div>
                </div>
                <div className="mc-drawer-now-info">
                  <p className="mc-drawer-now-title">{activeVideo.title}</p>
                  {activeVideo.channel && (
                    <p className="mc-drawer-now-channel">{activeVideo.channel?.name || activeVideo.channel}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Up Next ────────────────── */}
          <div className="mc-drawer-section">
            <div className="mc-drawer-section-header">
              <h3 className="mc-drawer-section-title">
                {t('mediaCenter.drawer.upNext')}
                {upNextItems.length > 0 && (
                  <span className="mc-drawer-count">{upNextItems.length}</span>
                )}
              </h3>
            </div>

            {upNextItems.length === 0 ? (
              <div className="mc-drawer-empty">
                <p className="mc-drawer-empty-text">{t('mediaCenter.drawer.queueEmpty')}</p>
              </div>
            ) : (
              <div className="mc-drawer-queue-list">
                {upNextItems.map(({ video, originalIndex }, i) => (
                  <div
                    key={`${video.id}-${originalIndex}`}
                    className={`mc-drawer-queue-item${
                      dragOverIndex === originalIndex ? ' drag-over' : ''
                    }${dragIndex === originalIndex ? ' dragging' : ''}`}
                    draggable="true"
                    onDragStart={(e) => handleDragStart(e, originalIndex)}
                    onDragOver={(e) => handleDragOver(e, originalIndex)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, originalIndex)}
                    onDragEnd={handleDragEnd}
                    onClick={() => playFromQueue(originalIndex)}
                  >
                    <span className="mc-drawer-drag-handle" title={t('mediaCenter.drawer.dragToReorder')}>
                      <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                        <circle cx="5" cy="3" r="1.2" />
                        <circle cx="11" cy="3" r="1.2" />
                        <circle cx="5" cy="8" r="1.2" />
                        <circle cx="11" cy="8" r="1.2" />
                        <circle cx="5" cy="13" r="1.2" />
                        <circle cx="11" cy="13" r="1.2" />
                      </svg>
                    </span>
                    <span className="mc-drawer-queue-num">{i + 1}</span>
                    <div className="mc-drawer-queue-thumb">
                      <img
                        src={`https://img.youtube.com/vi/${video.id}/default.jpg`}
                        alt=""
                        className="mc-drawer-thumb-img"
                        loading="lazy"
                      />
                    </div>
                    <div className="mc-drawer-queue-info">
                      <p className="mc-drawer-queue-title">{video.title}</p>
                      {video.channel && (
                        <p className="mc-drawer-queue-channel">{video.channel?.name || video.channel}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="mc-drawer-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFromQueue(originalIndex)
                      }}
                      title={t('mediaCenter.drawer.removeFromQueue')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {queue.length > 1 && (
              <button
                type="button"
                className="mc-drawer-clear-queue"
                onClick={clearQueue}
              >
                {t('mediaCenter.drawer.clearQueue')}
              </button>
            )}
          </div>

          {/* ── Playlists ──────────────── */}
          <div className="mc-drawer-section">
            <div className="mc-drawer-section-header">
              <h3 className="mc-drawer-section-title">{t('mediaCenter.drawer.playlists')}<InfoTip text={t('mediaCenter.drawer.playlistsTip')} position="left" /></h3>
              <button
                type="button"
                className="mc-drawer-new-pl-btn"
                onClick={() => setShowNewPlaylist(true)}
                title={t('mediaCenter.drawer.createNewPlaylist')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('mediaCenter.drawer.newPlaylist')}
              </button>
            </div>

            {/* New playlist inline input */}
            {showNewPlaylist && (
              <div className="mc-drawer-new-pl-row">
                <input
                  ref={newPlaylistRef}
                  type="text"
                  className="mc-drawer-pl-input"
                  placeholder={t('mediaCenter.drawer.playlistNamePlaceholder')}
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreatePlaylist()
                    if (e.key === 'Escape') {
                      setShowNewPlaylist(false)
                      setNewPlaylistName('')
                    }
                  }}
                  onBlur={() => {
                    if (!newPlaylistName.trim()) {
                      setShowNewPlaylist(false)
                      setNewPlaylistName('')
                    }
                  }}
                />
                <button
                  type="button"
                  className="mc-drawer-pl-confirm"
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim()}
                  title={t('mediaCenter.drawer.create')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            )}

            {playlists.length === 0 && !showNewPlaylist && (
              <div className="mc-drawer-empty">
                <p className="mc-drawer-empty-text">{t('mediaCenter.drawer.noPlaylists')}</p>
              </div>
            )}

            {playlists.map((playlist) => (
              <div key={playlist.id} className="mc-drawer-pl-row">
                {editingPlaylistId === playlist.id ? (
                  <input
                    ref={editPlaylistRef}
                    type="text"
                    className="mc-drawer-pl-input mc-drawer-pl-rename"
                    value={editingPlaylistName}
                    onChange={(e) => setEditingPlaylistName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishRename()
                      if (e.key === 'Escape') {
                        setEditingPlaylistId(null)
                        setEditingPlaylistName('')
                      }
                    }}
                    onBlur={handleFinishRename}
                  />
                ) : (
                  <button
                    type="button"
                    className="mc-drawer-pl-name"
                    onClick={() => handleStartRename(playlist)}
                    title={t('mediaCenter.drawer.clickToRename')}
                  >
                    <span className="mc-drawer-pl-label">{playlist.name}</span>
                    <span className="mc-drawer-pl-count">
                      {t(
                        playlist.videos.length === 1
                          ? 'mediaCenter.drawer.videoCountOne'
                          : 'mediaCenter.drawer.videoCountOther',
                        { count: playlist.videos.length }
                      )}
                    </span>
                  </button>
                )}
                <div className="mc-drawer-pl-actions">
                  <button
                    type="button"
                    className="mc-drawer-pl-play"
                    onClick={() => playPlaylist(playlist.id)}
                    title={t('mediaCenter.drawer.playPlaylist')}
                    disabled={playlist.videos.length === 0}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                      <path d="M8 5.14v14l11-7-11-7z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="mc-drawer-pl-delete"
                    onClick={() => deletePlaylist(playlist.id)}
                    title={t('mediaCenter.drawer.deletePlaylist')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>,
      document.body
  )
}

export default QueueDrawer
