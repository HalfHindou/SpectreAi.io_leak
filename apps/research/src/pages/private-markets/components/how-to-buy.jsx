/**
 * how-to-buy.jsx — the routes an investor actually has into a private company.
 *
 * A pre-IPO page that shows a $183B valuation and no way to act on it is a
 * museum exhibit. This answers the question the page provokes: can I get
 * exposure to this, and how?
 *
 * It is INFORMATION about routes that exist, not advice and not a
 * recommendation. Three rules it holds itself to:
 *
 *   1. **A corporate backer is not an asset manager.** Amazon put its own
 *      balance sheet into Anthropic, so owning AMZN carries a real (heavily
 *      diluted) claim on that stake. BlackRock and Fidelity invested CLIENT
 *      money through funds — owning BLK buys you a fee stream, not the position.
 *      Listing those two together would be the most plausible-sounding lie on
 *      the page, so they are separated and the difference is stated.
 *   2. **No sizing, ever.** We do not hold stake percentages, so we never imply
 *      what a share of the parent is worth in terms of this company.
 *   3. **No fund holdings we cannot source.** Vehicles that hold private
 *      positions are named as vehicles; what they hold today is theirs to
 *      disclose, and the reader is told to check.
 */

import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import './how-to-buy.css'
import './how-to-buy.day-mode.css'

/**
 * Investors that are themselves publicly listed.
 *
 * `kind` is the whole point of this map:
 *   strategic — invested from its own balance sheet; its shareholders hold the stake
 *   manager   — invested clients' money through a fund; its shareholders do not
 */
const LISTED_INVESTORS = {
  amazon:            { ticker: 'AMZN',  name: 'Amazon',            kind: 'strategic' },
  google:            { ticker: 'GOOGL', name: 'Alphabet',          kind: 'strategic' },
  alphabet:          { ticker: 'GOOGL', name: 'Alphabet',          kind: 'strategic' },
  microsoft:         { ticker: 'MSFT',  name: 'Microsoft',         kind: 'strategic' },
  nvidia:            { ticker: 'NVDA',  name: 'Nvidia',            kind: 'strategic' },
  salesforce:        { ticker: 'CRM',   name: 'Salesforce',        kind: 'strategic' },
  cisco:             { ticker: 'CSCO',  name: 'Cisco',             kind: 'strategic' },
  qualcomm:          { ticker: 'QCOM',  name: 'Qualcomm',          kind: 'strategic' },
  intel:             { ticker: 'INTC',  name: 'Intel',             kind: 'strategic' },
  softbank:          { ticker: '9984.T', name: 'SoftBank Group',   kind: 'strategic' },
  tencent:           { ticker: '0700.HK', name: 'Tencent',         kind: 'strategic' },
  coinbase:          { ticker: 'COIN',  name: 'Coinbase',          kind: 'strategic' },
  paypal:            { ticker: 'PYPL',  name: 'PayPal',            kind: 'strategic' },
  visa:              { ticker: 'V',     name: 'Visa',              kind: 'strategic' },
  mastercard:        { ticker: 'MA',    name: 'Mastercard',        kind: 'strategic' },
  blackrock:         { ticker: 'BLK',   name: 'BlackRock',         kind: 'manager' },
  't. rowe price':   { ticker: 'TROW',  name: 'T. Rowe Price',     kind: 'manager' },
  'goldman sachs':   { ticker: 'GS',    name: 'Goldman Sachs',     kind: 'manager' },
  'morgan stanley':  { ticker: 'MS',    name: 'Morgan Stanley',    kind: 'manager' },
  'franklin templeton': { ticker: 'BEN', name: 'Franklin Resources', kind: 'manager' },
}

/** Secondary marketplaces where employee and early-investor shares change hands. */
const VENUES = [
  { name: 'Forge Global',          url: 'https://forgeglobal.com',         noteKey: 'forge' },
  { name: 'EquityZen',             url: 'https://equityzen.com',           noteKey: 'equityzen' },
  { name: 'Hiive',                 url: 'https://hiive.com',               noteKey: 'hiive' },
  { name: 'Nasdaq Private Market', url: 'https://nasdaqprivatemarket.com', noteKey: 'nasdaq' },
  { name: 'Linqto',                url: 'https://linqto.com',              noteKey: 'linqto' },
]

/** Listed vehicles whose mandate is holding private companies. */
const VEHICLES = [
  { ticker: 'DXYZ',  name: 'Destiny Tech100',  noteKey: 'dxyz' },
  { ticker: 'ARKVX', name: 'ARK Venture Fund', noteKey: 'arkvx' },
]

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+inc\.?$|\s+corp\.?$|,.*$/i, '')

export default function HowToBuy({ company, entry, status }) {
  const { t } = useTranslation()
  const { strategic, managers } = useMemo(() => {
    const seen = new Set()
    const strat = []
    const mgr = []
    for (const raw of entry?.investors || []) {
      const hit = LISTED_INVESTORS[norm(raw)]
      if (!hit || seen.has(hit.ticker)) continue
      seen.add(hit.ticker)
      ;(hit.kind === 'strategic' ? strat : mgr).push(hit)
    }
    return { strategic: strat, managers: mgr }
  }, [entry])

  const filing = status === 'filed' || status === 'ipo'

  return (
    <section className="htb">
      <header className="htb__head">
        <span className="pi-eyebrow">{t('privateMarkets.howToBuy.eyebrow', 'How to buy')}</span>
        <h3>{t('privateMarkets.howToBuy.title', 'Getting exposure to {{company}}', { company })}</h3>
        <p className="htb__sub">
          {t('privateMarkets.howToBuy.sub', '{{company}} is private, so its shares are not on an exchange. These are the routes that exist — what each one really gets you, and what it costs you to use it.', { company })}
        </p>
      </header>

      <ol className="htb__routes">
        {strategic.length ? (
          <li className="htb__route">
            <div className="htb__route-head">
              <span className="htb__num">1</span>
              <h4>{t('privateMarkets.howToBuy.backerTitle', 'Buy a listed backer')}</h4>
              <span className="htb__tag htb__tag--open">{t('privateMarkets.howToBuy.tagAnyBrokerage', 'Any brokerage')}</span>
            </div>
            <p>
              <Trans i18nKey="privateMarkets.howToBuy.backerBody" values={{ company }} components={{ 1: <strong /> }} />
            </p>
            <ul className="htb__tickers">
              {strategic.map((s) => (
                <li key={s.ticker}>
                  <span className="htb__ticker">{s.ticker}</span>
                  <span className="htb__ticker-name">{s.name}</span>
                </li>
              ))}
            </ul>
            {managers.length ? (
              <p className="htb__warn">
                <Trans
                  i18nKey="privateMarkets.howToBuy.backerWarn"
                  count={managers.length}
                  values={{
                    names: managers.map((m) => m.name).join(' / '),
                    tickers: managers.map((m) => m.ticker).join(' / '),
                  }}
                  components={{ 1: <strong /> }}
                />
              </p>
            ) : null}
          </li>
        ) : null}

        <li className="htb__route">
          <div className="htb__route-head">
            <span className="htb__num">{strategic.length ? 2 : 1}</span>
            <h4>{t('privateMarkets.howToBuy.secondaryTitle', 'Secondary marketplaces')}</h4>
            <span className="htb__tag">{t('privateMarkets.howToBuy.tagAccredited', 'Accredited only')}</span>
          </div>
          <p>
            <Trans i18nKey="privateMarkets.howToBuy.secondaryBody" components={{ 1: <strong /> }} />
          </p>
          <ul className="htb__venues">
            {VENUES.map((v) => (
              <li key={v.name}>
                <a href={v.url} target="_blank" rel="noopener noreferrer">{v.name}</a>
                <span>{t(`privateMarkets.howToBuy.venueNotes.${v.noteKey}`)}</span>
              </li>
            ))}
          </ul>
        </li>

        <li className="htb__route">
          <div className="htb__route-head">
            <span className="htb__num">{strategic.length ? 3 : 2}</span>
            <h4>{t('privateMarkets.howToBuy.vehiclesTitle', 'Listed vehicles that hold private companies')}</h4>
            <span className="htb__tag htb__tag--open">{t('privateMarkets.howToBuy.tagAnyBrokerage', 'Any brokerage')}</span>
          </div>
          <p>
            {t('privateMarkets.howToBuy.vehiclesBody', 'These trade like a stock and hold private positions inside. Whether either holds {{company}} today is theirs to disclose — check the current holdings before assuming, and check what the vehicle trades at against its own net asset value.', { company })}
          </p>
          <ul className="htb__tickers">
            {VEHICLES.map((v) => (
              <li key={v.ticker}>
                <span className="htb__ticker">{v.ticker}</span>
                <span className="htb__ticker-name">{v.name}</span>
                <span className="htb__ticker-note">{t(`privateMarkets.howToBuy.vehicleNotes.${v.noteKey}`)}</span>
              </li>
            ))}
          </ul>
        </li>

        <li className="htb__route">
          <div className="htb__route-head">
            <span className="htb__num">{strategic.length ? 4 : 3}</span>
            <h4>{t('privateMarkets.howToBuy.listingTitle', 'Wait for the listing')}</h4>
            <span className="htb__tag htb__tag--open">{t('privateMarkets.howToBuy.tagAnyBrokerage', 'Any brokerage')}</span>
          </div>
          <p>
            {filing
              ? t('privateMarkets.howToBuy.listingFiled', { company })
              : t('privateMarkets.howToBuy.listingNotFiled', { company })}
          </p>
        </li>
      </ol>

      <p className="htb__disclaimer caption">
        {t('privateMarkets.howToBuy.disclaimer')}
      </p>
    </section>
  )
}
