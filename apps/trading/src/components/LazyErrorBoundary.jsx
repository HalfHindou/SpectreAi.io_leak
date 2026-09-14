/**
 * LazyErrorBoundary - catches dynamic import failures (network blips, deploys)
 * and renders a retry button instead of crashing the page.
 */
import React, { Component } from 'react'

class LazyErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(err) {
    console.error('[LazyErrorBoundary] Chunk load failed:', err?.message)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '24px 16px', color: 'rgba(245,245,247,0.5)',
          fontSize: 13, fontFamily: 'var(--font-body)'
        }}>
          <span>Failed to load</span>
          <button
            onClick={this.handleRetry}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, padding: '4px 12px', color: '#f5f5f7',
              fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font-body)'
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default LazyErrorBoundary
