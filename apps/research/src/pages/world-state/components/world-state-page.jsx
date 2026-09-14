/**
 * World State — a briefing wall that is demonstrably being maintained.
 *
 * The defensible thing on this page is not the eight macro numbers; they are
 * available anywhere. It is that this is EDITION 1,183 and that the page can
 * say exactly what changed to make it 1,183 — and say so just as plainly when
 * nothing changed at all. Hence the two structural moves: the version number
 * is the loudest chrome on the screen, and the diff strip states its silence
 * at full weight. Everything below those two is evidence.
 *
 * ── WHY THERE IS NO useCurrency() HERE ────────────────────────────────────
 * Deliberate, and please do not "fix" it. Every quantity on this page is a
 * USD-denominated policy or market-structure figure: the Fed's balance sheet
 * net of the TGA and reverse repo, CME contract positioning, prediction-market
 * open interest in dollars, the stablecoin float. Rendering "€5,412B" of
 * WALCL would be a number that exists in no document anywhere — the Fed does
 * not publish a euro balance sheet, and converting one at today's spot rate
 * invents a quantity nobody reported. The unit is stated once, in the
 * provenance band. Prices in the tape cells are the same story: they are the
 * document's own record of what it saw, not a live quote for the reader to
 * trade against.
 *
 * ── THE ANTI-GRAY-WALL LAW ────────────────────────────────────────────────
 * Every band is a different shape, so the page is navigable peripherally:
 * tide = signed bar off a centre zero · rates = countdown + ladder · COT =
 * the only mirrored form · stances = the only serif and only prose · policy =
 * the ladder again (a deliberate rhyme) · stablecoins = display figure +
 * cells · docket = a dated single column. Seven identical grids would make
 * this a dashboard; it is a document.
 */
import React, { useMemo } from 'react'
import useWorldDoc from './use-world-doc'
import worldFact from './wst-fact'
import WstMasthead from './wst-masthead'
import WstDiff from './wst-diff'
import WstEngine from './wst-engine'
import WstTide from './wst-tide'
import WstRates from './wst-rates'
import WstCot from './wst-cot'
import WstStances from './wst-stances'
import WstPolicy from './wst-policy'
import WstLiq from './wst-liq'
import WstDocket from './wst-docket'
import WstProv from './wst-prov'
import WstSkeleton from './wst-skeleton'
import './world-state-page.css'
import './world-state-page.day-mode.css'
import './world-state-page.mobile.css'

/* A doc section maps to the band(s) that render it, so only bands whose data
   genuinely differs carry the 30s change mark. */
const BAND_OF = {
  net_liquidity: ['tide'],
  rates: ['rates'],
  cot_btc: ['cot'],
  politics: ['stances', 'policy'],
  markets: ['liq'],
  stablecoins: ['liq'],
  regulatory_docket: ['docket'],
}

export default function WorldStatePage() {
  const world = useWorldDoc()
  const {
    doc, prevDoc, version, ts, diff, stale, lastOkAt, prevVersion, changedAt,
    changedSections, editions, loading, empty, history, historyState,
    loadHistory, refetch, pollMinutes, endpoint,
  } = world

  const now = Date.now()

  const fact = useMemo(
    () => worldFact({ doc, prevDoc, version, ts, now, endpoint }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, prevDoc, version, ts, endpoint],
  )

  const changed = useMemo(() => {
    const set = new Set()
    for (const k of changedSections || []) for (const b of BAND_OF[k] || []) set.add(b)
    return set
  }, [changedSections])

  if (loading && !doc) {
    return <div className="wst-root"><WstSkeleton /></div>
  }

  /* Cold: the worker has not published an edition yet (the endpoint 404s until
     it does). That is an empty state with an action, not an error screen — and
     it is the one place on this page that addresses the reader directly. */
  if (empty && !doc) {
    return (
      <div className="wst-root">
        <WstMasthead fact={fact} version={null} ts={null} editions={editions} />
        <div className="wst-cold">
          <button type="button" className="wst-retry" onClick={refetch}>Try again</button>
        </div>
        <WstProv doc={null} version={null} ts={null} pollMinutes={pollMinutes} endpoint={endpoint} />
      </div>
    )
  }

  return (
    <div className="wst-root">
      <WstMasthead
        fact={fact}
        version={version}
        ts={ts}
        prevVersion={prevVersion}
        editions={editions}
        stale={stale}
        lastOkAt={lastOkAt}
        regime={doc?.markets?.regime}
        flash={Boolean(changedAt)}
      />

      <WstDiff
        diff={diff}
        version={version}
        prevVersion={prevVersion}
        ts={ts}
        editions={editions}
        history={history}
        historyState={historyState}
        onOpenLog={loadHistory}
        now={now}
      />

      {/* The engine sits under the two chrome bands and above the evidence: it
          is a VIEW of the same document, never a source. It self-suppresses
          under prefers-reduced-motion or without WebGL, and the seven bands
          below neither know nor care whether it rendered. */}
      <WstEngine doc={doc} version={version} ts={ts} />

      <WstTide liq={doc?.net_liquidity} changed={changed.has('tide')} />
      <WstRates rates={doc?.rates} changed={changed.has('rates')} now={now} />
      <WstCot cot={doc?.cot_btc} changed={changed.has('cot')} />
      <WstStances stances={doc?.politics?.figure_stances} changed={changed.has('stances')} />
      <WstPolicy politics={doc?.politics} changed={changed.has('policy')} now={now} />
      <WstLiq stables={doc?.stablecoins} markets={doc?.markets} changed={changed.has('liq')} />
      <WstDocket docket={doc?.regulatory_docket} changed={changed.has('docket')} />
      <WstProv doc={doc} version={version} ts={ts} pollMinutes={pollMinutes} endpoint={endpoint} />
    </div>
  )
}
