/**
 * Private Markets — one company, as its own page.
 *
 * Route target for `/private-markets/:companySlug`. Thin per page-patterns.md:
 * it resolves the slug and hands off to the same spotlight the tab renders, so
 * the roster's "open full page" and the spotlight tab can never drift apart.
 */
import { useParams } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { CompanySpotlightByName } from './components/company-spotlight'
import { SPOTLIGHT } from './components/preipo-constants'
import './components/private-markets-page.css'
import './components/private-markets-page.day-mode.css'
import './components/private-markets-page.mobile.css'
import './components/pre-ipo.css'
import './components/pre-ipo.day-mode.css'

export default function PrivateMarketsCompanyPage() {
  const { companySlug } = useParams()
  // Same root classes the tab page sets, so the phone pass (scoped under
  // `.pm-page.pm-mobile` in the mobile sheet) reaches the routed page too.
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()

  // The spotlight company keeps its curated tweet queries and event framing when
  // reached by URL; every other company gets the plain treatment, which is the
  // same page minus the editorial extras.
  const isSpotlight = companySlug === 'anthropic'
    || companySlug === String(SPOTLIGHT.company || '').toLowerCase()
  const extras = isSpotlight ? SPOTLIGHT : {}

  return (
    <div className={`pm-page pm-company-page${dayMode ? ' pm-day' : ''}${isMobile ? ' pm-mobile' : ''}`}>
      <CompanySpotlightByName {...extras} company={undefined} slug={companySlug} showBack />
    </div>
  )
}
