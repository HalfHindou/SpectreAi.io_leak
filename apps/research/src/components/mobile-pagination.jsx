import { useMemo } from 'react'
import './mobile-pagination.css'

/**
 * Numbered pagination bar for mobile lists — Binance/CMC style.
 *
 *   « 1 2 … 8 9 10 »
 *        26-50 of 75
 *
 * Shows the first page, last page, a window around current, and ellipses
 * between gaps. Keeps the rendered button count low (max 7) so it fits on
 * narrow screens.
 */
export default function MobilePagination({
  currentPage = 1,
  totalPages = 1,
  onSelect,
  isLoading = false,
  className = '',
  rangeLabel = null,
}) {
  const pages = useMemo(() => buildPageList(currentPage, totalPages), [currentPage, totalPages])

  if (totalPages <= 1) return null

  const prev = Math.max(1, currentPage - 1)
  const next = Math.min(totalPages, currentPage + 1)

  return (
    <nav className={`mobile-pagination ${className}`.trim()} aria-label="Pagination">
      <div className="mobile-pagination__row">
      <button
        type="button"
        className="mobile-pagination__arrow"
        onClick={() => onSelect?.(prev)}
        disabled={currentPage === 1 || isLoading}
        aria-label="Previous page"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {pages.map((p, i) => (
        p === '…' ? (
          <span key={`gap-${i}`} className="mobile-pagination__gap" aria-hidden="true">…</span>
        ) : (
          <button
            key={p}
            type="button"
            className={`mobile-pagination__num${p === currentPage ? ' is-active' : ''}`}
            onClick={() => onSelect?.(p)}
            disabled={isLoading && p !== currentPage}
            aria-current={p === currentPage ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </button>
        )
      ))}

      <button
        type="button"
        className="mobile-pagination__arrow"
        onClick={() => onSelect?.(next)}
        disabled={currentPage === totalPages || isLoading}
        aria-label="Next page"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      </div>

      {/* "26-50 of 75" - without it a numbered pager on a phone gives no sense
          of where you are in the list once the header has scrolled away. */}
      {rangeLabel && <div className="mobile-pagination__range">{rangeLabel}</div>}
    </nav>
  )
}

// Page-list builder: up to 7 slots (first, ellipsis, window of 3 around current,
// ellipsis, last). Collapses ellipses when pages are contiguous.
function buildPageList(current, total) {
  if (total <= 7) return range(1, total)
  const out = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) out.push('…')
  for (let p = start; p <= end; p++) out.push(p)
  if (end < total - 1) out.push('…')
  out.push(total)
  return out
}

function range(a, b) {
  const out = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}
