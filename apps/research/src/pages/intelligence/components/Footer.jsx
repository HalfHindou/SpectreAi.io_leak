/**
 * Footer - Publication footer for The Spectre Edition.
 * Masthead echo, RSS links, copyright notice.
 */
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import '../Intelligence.css'

export default function Footer() {
  const { t } = useTranslation()
  // In-app navigation to the Intelligence hub, filtered by real category keys
  // (the hub only recognises: all, spectre, bitcoin, ethereum, defi, stocks,
  // macro, regulation, ai - via the ?category= param).
  const NAV_LINKS = [
    { label: t('intelligencePage.categoryAll', 'All'),           to: '/intelligence' },
    { label: t('intelligencePage.categoryBitcoin', 'Bitcoin'),   to: '/intelligence?category=bitcoin' },
    { label: t('intelligencePage.categoryEthereum', 'Ethereum'), to: '/intelligence?category=ethereum' },
    { label: t('intelligencePage.categoryStocks', 'Stocks'),     to: '/intelligence?category=stocks' },
    { label: t('intelligencePage.categoryDefi', 'DeFi'),         to: '/intelligence?category=defi' },
  ]
  // The scrollable element is some app-shell ancestor (overflow:auto), not the
  // window. Walk up from the clicked link to find whichever ancestor actually
  // scrolls, then reset it - robust to whatever layout wraps this page.
  const scrollToTop = (e) => {
    let el = e?.currentTarget?.parentElement
    while (el) {
      const style = getComputedStyle(el)
      const scrolls = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight
      if (scrolls) { el.scrollTo({ top: 0, behavior: 'auto' }); return }
      el = el.parentElement
    }
    // Fallbacks if no scrolling ancestor was found
    ;(document.querySelector('.app-main-content')
      || document.scrollingElement
      || document.documentElement)?.scrollTo({ top: 0, behavior: 'auto' })
    window.scrollTo({ top: 0, behavior: 'auto' })
  }
  return (
    <footer className="st-footer" role="contentinfo">
      {/* Divider */}
      <div className="st-footer__divider" aria-hidden="true" />

      {/* Publication name */}
      <p className="st-footer__pub">
        {t('intelligencePage.publishedBy', 'The Spectre Edition - Published by Spectre AI Agents')}
      </p>

      {/* Category navigation */}
      <nav className="st-footer__rss" aria-label={t('intelligencePage.browseCategories', 'Browse categories')}>
        {NAV_LINKS.map((link, i) => (
          <span key={link.to}>
            <Link
              to={link.to}
              className="st-footer__rss-link"
              onClick={scrollToTop}
            >
              {link.label}
            </Link>
            {i < NAV_LINKS.length - 1 && (
              <span className="st-footer__rss-sep" aria-hidden="true"> &middot; </span>
            )}
          </span>
        ))}
      </nav>

      {/* Copyright */}
      <p className="st-footer__copyright">
        {t('intelligencePage.copyright', '(c) 2026 Spectre AI - AI-generated research. Not financial advice.')}
      </p>
    </footer>
  )
}
