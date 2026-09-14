/**
 * KOL CALL LEDGER — the receipts.
 *
 * A realized, market-fair track record for one KOL. Headline row: a credibility
 * grade badge (A–F or "—"), the archetype chip, and the stats that matter —
 * hit-rate, market-beat-rate ("beat BTC on N% of calls"), avg alpha vs BTC,
 * best / worst call. Below: a scannable list of calls, each row a token + entry→
 * now multiple (5.2x green / 0.30x red), an alpha chip (+28pp / −12pp vs BTC),
 * a peak chip, and a status tone.
 *
 * THE UX LAW (the founder was explicit): never make a KOL look bad on thin data.
 * When track_record.sample is 'limited'/'none' OR credibility.basis is
 * 'limited'/'health', we render a calm "Building track record" panel with the
 * backend note — NO F grade, NO red archetype, NO punitive framing. Returns are
 * always framed vs the market (alpha), because a flat call in a bear market can
 * still be a good call.
 *
 * Two shapes via `compact`:
 *   - full (profile)  : grade + archetype + 4 stat tiles + up to ~12 call rows.
 *   - compact (drawer): grade + archetype inline + 2 key stats + ~5 call rows.
 *
 * Pure presentational. Numbers tabular mono (.xd-num). Prefix: kcl-.
 */
import { useTranslation } from 'react-i18next'
import { Avatar } from '../../xd-bits'
import { relativeTime, fmtUsd } from '../../x-dash-utils'
import { archetypeMeta, gradeTone, isBuilding } from './kol-archetype'
import './kol-call-ledger.css'

/* status → tone class for the row dot + multiple tint. */
const STATUS_TONE = {
  win: 'win',
  loss: 'loss',
  flat: 'flat',
  dead: 'dead',
  unknown: 'unknown',
}

/* call return multiple → "5.2x" / "0.30x". Below 1x we show 2dp so a 0.30x
   reads precisely (a 0.3x is a very different call than a 0.03x); at/above 1x,
   1dp keeps the row scannable. green ≥1x, red <1x — bull/bear is correct here. */
function fmtX(x) {
  const n = Number(x)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 100) return `${Math.round(n)}x`
  if (n >= 1) return `${n.toFixed(1)}x`
  return `${n.toFixed(2)}x`
}

/* alpha (percentage points vs BTC over the same window) → "+28pp" / "−12pp". */
function fmtAlpha(pp) {
  const n = Number(pp)
  if (!Number.isFinite(n)) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(Math.round(n))}pp`
}

/* avg %-return → "+340%" / "−18%". */
function fmtPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(Math.round(n))}%`
}

function alphaTone(pp) {
  const n = Number(pp)
  if (!Number.isFinite(n) || n === 0) return 'flat'
  return n > 0 ? 'win' : 'loss'
}

/* one call row — logo + $SYM, called-when, entry→now multiple, alpha chip,
   peak chip, status tone. */
function CallRow({ call, t, compact }) {
  const sym = call.symbol ? `$${String(call.symbol).toUpperCase()}` : (call.name || '?')
  const logo = call.image || call.image_small || call.image_url
  const status = STATUS_TONE[String(call.status || '').toLowerCase()] || 'unknown'
  const x = fmtX(call.current_x)
  const peak = fmtX(call.peak_x)
  const alpha = fmtAlpha(call.alpha_pct)
  const aTone = alphaTone(call.alpha_pct)
  const beat = call.beat_market === true

  return (
    <li className={`kcl-row kcl-row--${status}`}>
      <span className="kcl-row__token">
        <Avatar src={logo} alt={call.symbol || call.name} size={compact ? 24 : 28} className="kcl-row__logo" />
        <span className="kcl-row__id">
          <span className="kcl-row__sym xd-num">{sym}</span>
          <span className="kcl-row__when">
            {relativeTime(call.called_at, t)}
            {call.market_cap > 0 && <span className="kcl-row__mc xd-num"> · {fmtUsd(call.market_cap)}</span>}
          </span>
        </span>
      </span>

      <span className="kcl-row__metrics">
        <span className={`kcl-mult kcl-mult--${x ? (Number(call.current_x) >= 1 ? 'up' : 'down') : 'na'}`}>
          {x ? <span className="xd-num">{x}</span> : <span className="kcl-mult__na">—</span>}
        </span>

        {alpha ? (
          <span
            className={`kcl-alpha kcl-alpha--${aTone}`}
            title={beat
              ? t('kolRadar.ledger.beatTip', 'Beat BTC over the same window')
              : t('kolRadar.ledger.alphaTip', 'Call return minus BTC return over the same window')}
          >
            <span className="xd-num">{alpha}</span>
          </span>
        ) : (
          <span className="kcl-alpha kcl-alpha--na"><span className="kcl-mult__na">—</span></span>
        )}

        {!compact && (
          peak ? (
            <span className="kcl-peak" title={t('kolRadar.ledger.peakTip', 'Best multiple this call reached')}>
              <span className="kcl-peak__cap">{t('kolRadar.ledger.peak', 'peak')}</span>
              <span className="xd-num">{peak}</span>
            </span>
          ) : (
            <span className="kcl-peak kcl-peak--na"><span className="kcl-mult__na">—</span></span>
          )
        )}
      </span>
    </li>
  )
}

/* the calm forming-track-record state — NO grade, NO red. Shown when the sample
   is too thin to fairly judge. Carries the archetype chip (always neutral here)
   + the backend note. */
function BuildingPanel({ archetype, note, compact, t }) {
  const meta = archetypeMeta(archetype || 'building')
  return (
    <div className={`kcl-building${compact ? ' kcl-building--compact' : ''}`}>
      <span className="kcl-chip kcl-chip--neutral kcl-building__chip">
        {t(meta.key, meta.fallback)}
      </span>
      <p className="kcl-building__note">
        {note || t('kolRadar.ledger.buildingNote', 'Not enough realized calls yet to grade fairly. Their track record is still forming — we will surface it the moment there is a real sample.')}
      </p>
    </div>
  )
}

function StatTile({ label, value, tone, sub }) {
  return (
    <div className="kcl-stat">
      <span className="kcl-stat__label">{label}</span>
      <span className={`kcl-stat__value xd-num${tone ? ` kcl-stat__value--${tone}` : ''}`}>{value}</span>
      {sub && <span className="kcl-stat__sub">{sub}</span>}
    </div>
  )
}

export default function KolCallLedger({ trackRecord, archetype, credibility, compact = false }) {
  const { t } = useTranslation()
  const tr = trackRecord || {}
  const building = isBuilding({ trackRecord: tr, credibility })

  const calls = Array.isArray(tr.calls) ? tr.calls : []
  const archMeta = archetypeMeta(building ? 'building' : archetype)
  const grade = credibility?.grade || '—'
  const score = credibility?.score
  const gTone = building ? 'neutral' : gradeTone(grade)

  /* derived stat strings — guard each so a missing field renders "—" not NaN. */
  const hitRate = tr.hit_rate != null ? `${Math.round(Number(tr.hit_rate) * (Number(tr.hit_rate) <= 1 ? 100 : 1))}%` : null
  const beatRate = tr.market_beat_rate != null
    ? `${Math.round(Number(tr.market_beat_rate) * (Number(tr.market_beat_rate) <= 1 ? 100 : 1))}%`
    : null
  const avgAlpha = fmtAlpha(tr.avg_alpha_pct)
  const avgReturn = fmtPct(tr.avg_return_pct)
  const best = tr.best && tr.best.symbol ? tr.best : null
  const worst = tr.worst && tr.worst.symbol ? tr.worst : null

  const rowCap = compact ? 5 : 12
  const shownCalls = calls.slice(0, rowCap)
  const moreCalls = calls.length - shownCalls.length

  return (
    <section className={`kcl${compact ? ' kcl--compact' : ''}`}>
      {/* HEADLINE — grade + archetype */}
      <div className="kcl-head">
        <div className="kcl-head__verdict">
          <div
            className={`kcl-grade kcl-grade--${gTone}`}
            title={building
              ? t('kolRadar.ledger.gradePending', 'Credibility grade pending — still building a track record')
              : t('kolRadar.ledger.gradeTip', 'Credibility grade from realized, market-fair call performance')}
          >
            <span className="kcl-grade__letter xd-num">{building ? '—' : grade}</span>
            {!building && score != null && (
              <span className="kcl-grade__score xd-num">{Math.round(Number(score))}</span>
            )}
          </div>
          <div className="kcl-head__id">
            <span className={`kcl-chip kcl-chip--${archMeta.cls} kcl-head__arch`}>
              {t(archMeta.key, archMeta.fallback)}
            </span>
            <span className="kcl-head__title">
              {t('kolRadar.ledger.title', 'Call Ledger')}
            </span>
          </div>
        </div>
        {!building && tr.total_calls != null && (
          <span className="kcl-head__count xd-num" title={t('kolRadar.ledger.scoredTip', 'Calls with a realized, market-comparable outcome')}>
            {tr.scored_count != null
              ? t('kolRadar.ledger.scoredOf', '{{scored}} scored / {{total}} calls', { scored: tr.scored_count, total: tr.total_calls })
              : t('kolRadar.ledger.totalCalls', '{{total}} calls', { total: tr.total_calls })}
          </span>
        )}
      </div>

      {building ? (
        <BuildingPanel archetype={archetype} note={tr.note} compact={compact} t={t} />
      ) : (
        <>
          {/* STATS */}
          <div className={`kcl-stats${compact ? ' kcl-stats--compact' : ''}`}>
            <StatTile
              label={t('kolRadar.ledger.hitRate', 'Hit rate')}
              value={hitRate || '—'}
              tone={hitRate ? 'win' : null}
            />
            <StatTile
              label={t('kolRadar.ledger.beatBtc', 'Beat BTC')}
              value={beatRate || '—'}
              tone={beatRate ? 'win' : null}
              sub={!compact && beatRate ? t('kolRadar.ledger.ofCalls', 'of calls') : null}
            />
            {!compact && (
              <StatTile
                label={t('kolRadar.ledger.avgAlpha', 'Avg alpha')}
                value={avgAlpha || '—'}
                tone={avgAlpha ? alphaTone(tr.avg_alpha_pct) : null}
                sub={t('kolRadar.ledger.vsBtc', 'vs BTC')}
              />
            )}
            {!compact && (
              <StatTile
                label={t('kolRadar.ledger.avgReturn', 'Avg return')}
                value={avgReturn || '—'}
                tone={avgReturn ? alphaTone(tr.avg_return_pct) : null}
              />
            )}
          </div>

          {/* BEST / WORST */}
          {!compact && (best || worst) && (
            <div className="kcl-extremes">
              {best && (
                <span className="kcl-extreme kcl-extreme--best">
                  <span className="kcl-extreme__cap">{t('kolRadar.ledger.best', 'Best')}</span>
                  <span className="kcl-extreme__sym xd-num">${String(best.symbol).toUpperCase()}</span>
                  <span className="kcl-extreme__x kcl-extreme__x--up xd-num">{fmtX(best.x) || '—'}</span>
                </span>
              )}
              {worst && (
                <span className="kcl-extreme kcl-extreme--worst">
                  <span className="kcl-extreme__cap">{t('kolRadar.ledger.worst', 'Worst')}</span>
                  <span className="kcl-extreme__sym xd-num">${String(worst.symbol).toUpperCase()}</span>
                  <span className="kcl-extreme__x kcl-extreme__x--down xd-num">{fmtX(worst.x) || '—'}</span>
                </span>
              )}
            </div>
          )}

          {/* CALL LIST */}
          {shownCalls.length > 0 ? (
            <ul className="kcl-list">
              {shownCalls.map((call, i) => (
                <CallRow key={call.cg_id || call.symbol || i} call={call} t={t} compact={compact} />
              ))}
            </ul>
          ) : (
            <p className="kcl-empty">{t('kolRadar.ledger.noCalls', 'No scored calls in the window yet.')}</p>
          )}

          {moreCalls > 0 && (
            <p className="kcl-more xd-num">
              {t('kolRadar.ledger.moreCalls', '+{{count}} more calls', { count: moreCalls })}
            </p>
          )}
        </>
      )}
    </section>
  )
}
