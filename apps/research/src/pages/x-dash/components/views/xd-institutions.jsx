import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useGtmProposal } from '../use-gtm-proposal'
import { searchBrands, searchCreators } from '../xd-gtm-data'
import XDGtmMap from '../xd-gtm-map'
import '../xd-institutions.css'

/* X Dash → Institutions & Creators: Crypto GTM. A subject (a brand OR an IRL
   creator / personal brand) + a goal in, a scannable go-to-market plan out, 
   where to land/launch (ecosystems), who to partner/build-with (projects &
   rails), which voices (KOLs & co-signs), the plays, and what to avoid.

   The moat is authenticity: every project + voice carries a manufactured-vs-real
   score so a BRAND never anchors on bought attention, and a CREATOR never
   torches their audience's trust with a cash-grab. Same engine, flipped. */

/* Per-subject-type copy + controls. The engine returns the same proposal shape
   either way; this just relabels the surface so each audience reads its own doc. */
const MODES = {
  brand: {
    tag: 'Institutions',
    title: 'Institutions · Crypto GTM',
    sub: 'A brand and a goal in, a go-to-market proposal out. Spectre maps where to land, who to partner with, and which voices to back, then grades every project and KOL on real-vs-manufactured attention, so the plan anchors on genuine reach, never bought hype.',
    placeholder: 'Search any company, Nike, Pfizer, your client…',
    showcase: ['Nike', 'Adidas', 'Red Bull', 'Spotify', 'Gucci'],
    defaultSubject: 'Nike',
    goals: [
      { id: 'awareness', label: 'Awareness' },
      { id: 'community', label: 'Community' },
      { id: 'product', label: 'Product' },
      { id: 'loyalty', label: 'Loyalty' },
    ],
    defaultGoal: 'community',
    sec: {
      land: 'Where to land', landSub: 'Ecosystems ranked by brand fit',
      partner: 'Who to partner', partnerSub: 'Projects, fit + authenticity-graded',
      voices: 'Which voices', voicesSub: 'KOLs to back, authenticity-graded',
      angles: 'Activation angles', anglesSub: 'How to show up',
    },
    llmLabel: 'Spectre AI · full proposal',
    llmCtaFirst: 'Generate full proposal',
    llmHint: 'Generate the long-form proposal, Spectre writes the full GTM brief in plain English: the landing thesis, the partner shortlist with reasoning, the voice plan, and the activation calendar, all graded on real attention.',
    building: 'Building…',
    buildCta: 'Build proposal',
  },
  creator: {
    tag: 'Creators',
    title: 'Creators · Crypto GTM',
    sub: 'A creator or personal brand and a goal in, an owned-audience business plan out. The audience is the market and you own the sales cycle, Spectre maps where to launch, who to build with, and which product plays win, then grades every rail on whether it aligns to the creator\'s success, never a cash-grab that burns the fans.',
    placeholder: 'Search any creator, MrBeast, a musician, your @handle…',
    showcase: ['MrBeast', 'Markiplier', 'Steven Bartlett', 'Snoop Dogg', 'Cobie'],
    defaultSubject: 'MrBeast',
    goals: [
      { id: 'own-audience', label: 'Own audience' },
      { id: 'monetize', label: 'Monetize' },
      { id: 'product', label: 'Launch product' },
      { id: 'tokenize', label: 'Tokenize' },
    ],
    defaultGoal: 'monetize',
    sec: {
      land: 'Where to launch', landSub: 'Ecosystems ranked by creator fit',
      partner: 'Who to build with', partnerSub: 'Creator rails, aligned vs extraction',
      voices: 'Collabs & co-signs', voicesSub: 'Voices to back, authenticity-graded',
      angles: 'Product plays', anglesSub: 'Build a business on your audience',
    },
    llmLabel: 'Spectre AI · full plan',
    llmCtaFirst: 'Generate full plan',
    llmHint: 'Generate the long-form plan, Spectre writes the full creator GTM in plain English: where to launch, the rails to build with and why they align, the collab plan, and the product plays (coin, content coins, owned community, app, card, consumer brand), all graded on real audience trust.',
    building: 'Building…',
    buildCta: 'Build plan',
  },
}

const TIER_LABEL = { mega: 'Mega', mid: 'Mid', native: 'Native' }

/* Authenticity band → tone. Guards a missing score (renders neutral). */
function authBand(score) {
  if (score == null || Number.isNaN(Number(score))) return { tone: 'none', label: 'Unscored' }
  const n = Number(score)
  if (n >= 75) return { tone: 'high', label: 'Authentic' }
  if (n >= 50) return { tone: 'mid', label: 'Mixed' }
  return { tone: 'low', label: 'Manufactured' }
}

function AuthBadge({ score }) {
  const { t: tr } = useTranslation()
  const band = authBand(score)
  return (
    <span className={`xgtm-auth xgtm-auth--${band.tone}`}>
      <span className="xgtm-auth__num">{score == null || Number.isNaN(Number(score)) ? '-' : Math.round(score)}</span>
      <span className="xgtm-auth__cap">{tr(`xDash.gtm.auth.${band.tone}`, band.label)}</span>
    </span>
  )
}

function FitBar({ score }) {
  const pct = Math.max(0, Math.min(100, Number(score) || 0))
  return (
    <div className="xgtm-fit" role="img" aria-label={`Fit ${pct} of 100`}>
      <div className="xgtm-fit__bar"><span style={{ width: `${pct}%` }} /></div>
      <span className="xgtm-fit__num">{pct}</span>
    </div>
  )
}

export default function XDInstitutions() {
  // `t` is a parameter name in run()/switchType() below, so alias the hook.
  const { t: tr } = useTranslation()
  const { proposal, loading, error, generate, narrative, narrativeState, runNarrative } = useGtmProposal()
  const [subjectType, setSubjectType] = useState('brand') // 'brand' | 'creator'
  const [brand, setBrand] = useState('Nike')
  const [goal, setGoal] = useState('community')
  const [mode, setMode] = useState('plan') // 'plan' | 'map'
  const [suggest, setSuggest] = useState([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const searchRef = useRef(null)

  const cfg = MODES[subjectType] || MODES.brand

  const run = useCallback((b, g, t) => {
    const type = t || subjectType
    const name = (b != null ? b : brand).trim()
    if (!name) return
    setBrand(name)
    setSuggest([])
    setSuggestOpen(false)
    const target = g || goal
    setGoal(target)
    generate(name, target, type)
  }, [brand, goal, subjectType, generate])

  // Flip Brand <-> Creator: reset the goal to that mode's default, seed the
  // headline showcase subject, and rebuild so the surface is never empty.
  const switchType = useCallback((t) => {
    if (t === subjectType) return
    const next = MODES[t] || MODES.brand
    setSubjectType(t)
    setSuggest([])
    setSuggestOpen(false)
    setGoal(next.defaultGoal)
    setBrand(next.defaultSubject)
    generate(next.defaultSubject, next.defaultGoal, t)
  }, [subjectType, generate])

  const onBrandChange = useCallback((v) => {
    setBrand(v)
    const raw = subjectType === 'creator' ? searchCreators(v, 7) : searchBrands(v, 7)
    const matches = raw.map((m) => ({ name: m.name, sub: m.archetypeLabel || m.verticalLabel || '' }))
    setSuggest(matches)
    setSuggestOpen(matches.length > 0)
  }, [subjectType])

  // close the suggestions dropdown on outside click
  useEffect(() => {
    if (!suggestOpen) return undefined
    const onDoc = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSuggestOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [suggestOpen])

  // Auto-load the Nike · community showcase on first mount.
  useEffect(() => { generate('Nike', 'community', 'brand') /* eslint-disable-next-line */ }, [])

  const isCreator = subjectType === 'creator'

  return (
    <div className="xgtm">
      <header className="xgtm-hero">
        <div className="xgtm-hero__title">
          <h2>{tr(`xDash.gtm.${subjectType}.title`, cfg.title)}</h2>
          <span className="xgtm-hero__tag">authenticity-graded</span>
          <div className="xgtm-modetoggle" role="group" aria-label={tr('xDash.gtm.subjectType', 'Subject type')}>
            <button type="button" className={`xgtm-modetoggle__opt${!isCreator ? ' is-active' : ''}`} onClick={() => switchType('brand')} aria-pressed={!isCreator}>{tr('xDash.gtm.typeBrand', 'Brand')}</button>
            <button type="button" className={`xgtm-modetoggle__opt${isCreator ? ' is-active' : ''}`} onClick={() => switchType('creator')} aria-pressed={isCreator}>{tr('xDash.gtm.typeCreator', 'Creator')}</button>
          </div>
        </div>
        <p className="xgtm-hero__sub">{tr(`xDash.gtm.${subjectType}.sub`, cfg.sub)}</p>

        <form className="xgtm-controls" onSubmit={(e) => { e.preventDefault(); run() }}>
          <div className="xgtm-search" ref={searchRef}>
            <input
              className="xgtm-controls__input"
              value={brand}
              onChange={(e) => onBrandChange(e.target.value)}
              onFocus={() => { if (suggest.length) setSuggestOpen(true) }}
              placeholder={tr(`xDash.gtm.${subjectType}.placeholder`, cfg.placeholder)}
              spellCheck={false}
              autoComplete="off"
            />
            {suggestOpen && suggest.length > 0 && (
              <ul className="xgtm-suggest">
                {suggest.map((s) => (
                  <li key={s.name}>
                    <button type="button" className="xgtm-suggest__opt" onClick={() => run(s.name, goal)}>
                      <span className="xgtm-suggest__name">{s.name}</span>
                      <span className="xgtm-suggest__vert">{s.sub}</span>
                    </button>
                  </li>
                ))}
                {brand.trim() && (
                  <li>
                    <button type="button" className="xgtm-suggest__opt xgtm-suggest__opt--free" onClick={() => run(brand, goal)}>
                      Analyze “{brand.trim()}” →
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="xgtm-seg" role="group" aria-label={tr('xDash.gtm.campaignGoal', 'Campaign goal')}>
            {cfg.goals.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`xgtm-seg__opt${goal === g.id ? ' xgtm-seg__opt--active' : ''}`}
                onClick={() => setGoal(g.id)}
                aria-pressed={goal === g.id}
              >
                {tr(`xDash.gtm.${subjectType}.goal.${g.id}`, g.label)}
              </button>
            ))}
          </div>
          <button type="submit" className="xgtm-controls__go" disabled={loading}>
            {loading ? tr(`xDash.gtm.${subjectType}.building`, cfg.building) : tr(`xDash.gtm.${subjectType}.buildCta`, cfg.buildCta)}
          </button>
        </form>

        <div className="xgtm-chips">
          {cfg.showcase.map((c) => (
            <button key={c} type="button" className="xgtm-chip" onClick={() => run(c, goal)}>{c}</button>
          ))}
        </div>
      </header>

      {loading && (
        <div className="xgtm-skel">
          <div className="xgtm-skel__line animate-shimmer" />
          <div className="xgtm-skel__grid">
            <div className="xgtm-skel__card animate-shimmer" />
            <div className="xgtm-skel__card animate-shimmer" />
            <div className="xgtm-skel__card animate-shimmer" />
          </div>
        </div>
      )}
      {!loading && error && (
        <div className="xgtm-msg">
          {error}
          <button type="button" className="xgtm-msg__retry" onClick={() => run()}>{tr('xDash.gtm.retry', 'Retry')}</button>
        </div>
      )}

      {!loading && proposal && (
        <>
          <section className="xgtm-summary">
            <div className="xgtm-summary__top">
              <span className="xgtm-summary__brand">{proposal.brand || brand}</span>
              {proposal.vertical && <span className="xgtm-summary__vertical">{proposal.vertical}</span>}
              {proposal.goal && <span className="xgtm-summary__goal">{proposal.goal}</span>}
              <div className="xgtm-viewtoggle" role="group" aria-label={tr('xDash.gtm.view', 'View')}>
                <button type="button" className={`xgtm-viewtoggle__opt${mode === 'plan' ? ' is-active' : ''}`} onClick={() => setMode('plan')} aria-pressed={mode === 'plan'}>{tr('xDash.gtm.plan', 'Plan')}</button>
                <button type="button" className={`xgtm-viewtoggle__opt${mode === 'map' ? ' is-active' : ''}`} onClick={() => setMode('map')} aria-pressed={mode === 'map'}>{tr('xDash.gtm.map', 'Map')}</button>
              </div>
            </div>
            {proposal.summary && <p className="xgtm-summary__line">{proposal.summary}</p>}
            {isCreator && proposal.audienceNote && (
              <p className="xgtm-summary__audience"><span className="xgtm-summary__audience-k">{tr('xDash.gtm.audience', 'Audience')}</span> {proposal.audienceNote}</p>
            )}
          </section>

          {mode === 'map' && <XDGtmMap proposal={proposal} />}

          {mode !== 'map' && (
          <>
          {(proposal.ecosystems || []).length > 0 && (
            <section className="xgtm-sec">
              <div className="xgtm-sec__head">
                <h3 className="xgtm-sec__title">{tr(`xDash.gtm.${subjectType}.sec.land`, cfg.sec.land)}</h3>
                <span className="xgtm-sec__sub">{tr(`xDash.gtm.${subjectType}.sec.landSub`, cfg.sec.landSub)}</span>
              </div>
              <div className="xgtm-eco-grid">
                {(proposal.ecosystems || []).map((eco, i) => (
                  <article key={eco.id || eco.name || i} className="xgtm-eco">
                    <div className="xgtm-eco__head">
                      <div className="xgtm-eco__id">
                        <span className="xgtm-eco__name">{eco.name}</span>
                        {eco.chain && <span className="xgtm-eco__chain">{eco.chain}</span>}
                      </div>
                      <FitBar score={eco.fitScore} />
                    </div>
                    {eco.why && <p className="xgtm-eco__why">{eco.why}</p>}
                    {(eco.precedents || []).length > 0 && (
                      <div className="xgtm-eco__prec">
                        {(eco.precedents || []).map((p, pi) => (
                          <span key={pi} className="xgtm-prec">{p}</span>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {(proposal.projects || []).length > 0 && (
            <section className="xgtm-sec">
              <div className="xgtm-sec__head">
                <h3 className="xgtm-sec__title">{tr(`xDash.gtm.${subjectType}.sec.partner`, cfg.sec.partner)}</h3>
                <span className="xgtm-sec__sub">{tr(`xDash.gtm.${subjectType}.sec.partnerSub`, cfg.sec.partnerSub)}</span>
              </div>
              <div className="xgtm-proj-list">
                {(proposal.projects || []).map((p, i) => (
                  <div key={p.symbol || p.name || i} className="xgtm-proj">
                    <div className="xgtm-proj__id">
                      <span className="xgtm-proj__sym">{p.symbol ? `$${String(p.symbol).replace(/^\$/, '')}` : (p.name || '-')}</span>
                      <span className="xgtm-proj__name">{p.name}</span>
                      {p.category && <span className="xgtm-proj__cat">{p.category}</span>}
                    </div>
                    <div className="xgtm-proj__scores">
                      <FitBar score={p.fitScore} />
                      <AuthBadge score={p.authenticity} />
                    </div>
                    {p.why && <p className="xgtm-proj__why">{p.why}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(proposal.kols || []).length > 0 && (
            <section className="xgtm-sec">
              <div className="xgtm-sec__head">
                <h3 className="xgtm-sec__title">{tr(`xDash.gtm.${subjectType}.sec.voices`, cfg.sec.voices)}</h3>
                <span className="xgtm-sec__sub">{tr(`xDash.gtm.${subjectType}.sec.voicesSub`, cfg.sec.voicesSub)}</span>
              </div>
              <div className="xgtm-kol-list">
                {(proposal.kols || []).map((k, i) => {
                  const handle = String(k.handle || '').replace(/^@/, '')
                  // Some recs are deliberate ARCHETYPES (a voice profile to source,
                  // not a named account), render those as a label, never a broken link.
                  const isArchetype = handle.toLowerCase().startsWith('archetype:')
                  const archLabel = isArchetype
                    ? handle.slice('archetype:'.length).replace(/-/g, ' ') + ' · archetype'
                    : null
                  return (
                    <div key={handle || i} className="xgtm-kol">
                      <div className="xgtm-kol__id">
                        {isArchetype ? (
                          <span className="xgtm-kol__handle xgtm-kol__handle--arch">{archLabel}</span>
                        ) : handle ? (
                          <a
                            className="xgtm-kol__handle"
                            href={`https://x.com/${handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            @{handle}
                          </a>
                        ) : null}
                        {k.niche && <span className="xgtm-kol__niche">{k.niche}</span>}
                        {k.tier && <span className={`xgtm-tier xgtm-tier--${k.tier}`}>{tr(`xDash.gtm.tier.${k.tier}`, TIER_LABEL[k.tier] || k.tier)}</span>}
                      </div>
                      <div className="xgtm-kol__scores">
                        <AuthBadge score={k.authenticity} />
                      </div>
                      {k.why && <p className="xgtm-kol__why">{k.why}</p>}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {(proposal.angles || []).length > 0 && (
            <section className="xgtm-sec">
              <div className="xgtm-sec__head">
                <h3 className="xgtm-sec__title">{tr(`xDash.gtm.${subjectType}.sec.angles`, cfg.sec.angles)}</h3>
                <span className="xgtm-sec__sub">{tr(`xDash.gtm.${subjectType}.sec.anglesSub`, cfg.sec.anglesSub)}</span>
              </div>
              <div className="xgtm-angle-grid">
                {(proposal.angles || []).map((a, i) => (
                  <article key={a.title || i} className="xgtm-angle">
                    <span className="xgtm-angle__no">{String(i + 1).padStart(2, '0')}</span>
                    {a.title && <h4 className="xgtm-angle__title">{a.title}</h4>}
                    {a.thesis && <p className="xgtm-angle__thesis">{a.thesis}</p>}
                  </article>
                ))}
              </div>
            </section>
          )}

          {(proposal.avoid || []).length > 0 && (
            <section className="xgtm-avoid">
              <span className="xgtm-avoid__label">{tr('xDash.gtm.avoid', 'Avoid')}</span>
              <ul className="xgtm-avoid__list">
                {(proposal.avoid || []).map((a, i) => (
                  <li key={i} className="xgtm-avoid__item">{a}</li>
                ))}
              </ul>
            </section>
          )}
          </>
          )}

          <section className="xgtm-llm">
            <div className="xgtm-llm__head">
              <span className="xgtm-llm__label">{tr(`xDash.gtm.${subjectType}.llmLabel`, cfg.llmLabel)}</span>
              {narrativeState !== 'streaming' && (
                <button type="button" className="xgtm-llm__run" onClick={runNarrative}>
                  {narrativeState === 'done' || narrativeState === 'error' ? tr('xDash.gtm.regenerate', 'Re-generate') : tr(`xDash.gtm.${subjectType}.llmCtaFirst`, cfg.llmCtaFirst)}
                </button>
              )}
              {narrativeState === 'streaming' && <span className="xgtm-llm__live">analyzing…</span>}
            </div>
            {narrativeState === 'error' && !narrative && (
              <p className="xgtm-llm__hint">The full {isCreator ? 'plan' : 'proposal'} couldn't be generated. Try again.</p>
            )}
            {narrative
              ? <p className="xgtm-llm__body">{narrative}</p>
              : narrativeState !== 'streaming' && narrativeState !== 'error' && (
                <p className="xgtm-llm__hint">{tr(`xDash.gtm.${subjectType}.llmHint`, cfg.llmHint)}</p>
              )}
          </section>
        </>
      )}
    </div>
  )
}
