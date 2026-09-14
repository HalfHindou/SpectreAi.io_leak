/**
 * CompanyLogo — the pre-IPO surfaces' mark.
 *
 * Kept as a named export so the pre-IPO components do not all have to change
 * import paths; the resolution itself now lives in pm-logo.jsx and is shared
 * with the deal feed, so the two surfaces cannot drift apart again.
 */
import PmLogo from './pm-logo'

export default function CompanyLogo({ company, logoUrl, domain, className = '' }) {
  return <PmLogo company={company} logoUrl={logoUrl} domain={domain} className={`pi-logo ${className}`.trim()} />
}
