import EtfFlowsView from '@/components/etf/etf-flows-view'
import './etf-flows-page.css'
import './etf-flows-page.day-mode.css'
import './etf-flows-page.mobile.css'

/**
 * /etfs — the dedicated page around the shared EtfFlowsView.
 *
 * The masthead is the app's page pattern (kicker -> display title -> lead),
 * the same shape /vitals, /why and /alt-rotation use. It passes `standalone`
 * so the surface below drops its own subject line: the two used to sit one
 * line apart saying the same sentence twice.
 */
export default function EtfFlowsPageComponent() {
  return (
    <div className="etfp">
      <header className="etfp-head">
        <span className="etfp-kicker">Institutional flows</span>
        <h1 className="etfp-title">ETF Flows</h1>
        <p className="etfp-lead">
          Institutional money moving into Bitcoin and Ethereum spot ETFs — daily net inflow, holdings broken out by
          issuer, and the spot price the flows are running against.
        </p>
      </header>
      <EtfFlowsView enabled standalone />
    </div>
  )
}
