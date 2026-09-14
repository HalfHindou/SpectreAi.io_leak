/**
 * Educational Glossary – terms users see on the landing page and across the app
 */
import React, { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './glossary-page.css'

const GlossaryPage = ({ dayMode = false, onBack }) => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const GLOSSARY = [
    {
      category: t('glossary.catMarketData'),
      terms: [
        { term: t('glossary.termMcap'), definition: t('glossary.defMcap') },
        { term: t('glossary.term24h'), definition: t('glossary.def24h') },
        { term: t('glossary.termVolume'), definition: t('glossary.defVolume') },
        { term: t('glossary.termPrice'), definition: t('glossary.defPrice') },
        { term: t('glossary.termLiquidity'), definition: t('glossary.defLiquidity') },
      ],
    },
    {
      category: t('glossary.catSentiment'),
      terms: [
        { term: t('glossary.termFearGreed'), definition: t('glossary.defFearGreed') },
        { term: t('glossary.termAltSeason'), definition: t('glossary.defAltSeason') },
        { term: t('glossary.termDominance'), definition: t('glossary.defDominance') },
        { term: t('glossary.termRiskOnOff'), definition: t('glossary.defRiskOnOff') },
      ],
    },
    {
      category: t('glossary.catOnChain'),
      terms: [
        { term: t('glossary.termOnChain'), definition: t('glossary.defOnChain') },
        { term: t('glossary.termFunding'), definition: t('glossary.defFunding') },
        { term: t('glossary.termLiquidations'), definition: t('glossary.defLiquidations') },
        { term: t('glossary.termWhaleFlows'), definition: t('glossary.defWhaleFlows') },
      ],
    },
    {
      category: t('glossary.catPlatform'),
      terms: [
        { term: t('glossary.termCommandCenter'), definition: t('glossary.defCommandCenter') },
        { term: t('glossary.termWatchlist'), definition: t('glossary.defWatchlist') },
        { term: t('glossary.termTopCoins'), definition: t('glossary.defTopCoins') },
        { term: t('glossary.termPredictionMarkets'), definition: t('glossary.defPredictionMarkets') },
        { term: t('glossary.termNarrative'), definition: t('glossary.defNarrative') },
      ],
    },
  ]

  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase()
    if (!q) return GLOSSARY
    return GLOSSARY.map(({ category, terms }) => ({
      category,
      terms: terms.filter(
        (t) =>
          t.term.toLowerCase().includes(q) ||
          t.definition.toLowerCase().includes(q)
      ),
    })).filter((g) => g.terms.length > 0)
  }, [search, t])

  return (
    <div className={`glossary-page ${dayMode ? 'day-mode' : ''}`}>
      <div className="glossary-header">
        <div className="glossary-header-inner">
          {onBack && (
            <button
              type="button"
              className="glossary-back"
              onClick={onBack}
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('glossary.back')}
            </button>
          )}
          <h1 className="glossary-title">{t('glossary.title')}</h1>
          <p className="glossary-subtitle">{t('glossary.subtitle')}</p>
          <div className="glossary-search-wrap">
            <span className="glossary-search-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </span>
            <input
              type="search"
              className="glossary-search"
              placeholder={t('glossary.searchTerms')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search glossary"
            />
          </div>
        </div>
      </div>

      <div className="glossary-content">
        {filtered.length === 0 ? (
          <p className="glossary-empty">{t('glossary.noTermsFound')}</p>
        ) : (
          filtered.map(({ category, terms }) => (
            <section key={category} className="glossary-category">
              <h2 className="glossary-category-head">{category}</h2>
              <dl className="glossary-category-body">
                {terms.map(({ term, definition }) => (
                  <div key={term} className="glossary-term">
                    <dt className="glossary-term-name">{term}</dt>
                    <dd className="glossary-term-definition">{definition}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

export default GlossaryPage
