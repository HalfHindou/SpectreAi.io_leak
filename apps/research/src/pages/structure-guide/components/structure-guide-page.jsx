/**
 * Structure Guide
 * Living documentation of the Spectre monorepo: architecture, pages, patterns.
 */
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import './structure-guide-page.css'
import GlossaryPage from '@/pages/glossary/components/glossary-page'
import useSettingsStore from '@/store/useSettingsStore'

const TABS = [
  { id: 'structure', tKey: 'structureGuide.tabs.structure' },
  { id: 'glossary', tKey: 'structureGuide.tabs.glossary' },
]

const ARCHITECTURE = [
  { id: 'research', name: 'apps/research', stack: 'React 18 - Vite 5 - port 5180' },
  { id: 'trading', name: 'apps/trading', stack: 'React 18 - Vite 5 - port 5181' },
  { id: 'server', name: 'packages/server', stack: 'Node - port 3001' },
  { id: 'spectreUi', name: 'packages/spectre-ui', stack: 'TypeScript - Storybook - port 6006' },
  { id: 'chromeExtension', name: 'packages/chrome-extension', stack: 'Manifest V3' },
]

const DATA_FLOW = ['browser', 'proxy', 'server', 'external']

const PAGE_GROUPS = [
  {
    id: 'markets',
    pages: [
      { id: 'researchPlatform', path: '/' },
      { id: 'discover', path: '/discover' },
      { id: 'aiScreener', path: '/trade' },
      { id: 'watchlists', path: '/watchlists' },
      { id: 'categories', path: '/categories' },
      { id: 'heatmaps', path: '/heatmaps' },
      { id: 'bubbles', path: '/bubbles' },
      { id: 'fearGreed', path: '/fear-greed' },
      { id: 'liquidationHeatmap', path: '/liquidation-heatmap' },
      { id: 'tokenizedAssets', path: '/tokenized-assets' },
      { id: 'predictions', path: '/predictions' },
    ],
  },
  {
    id: 'intelligence',
    pages: [
      { id: 'intelligence', path: '/intelligence' },
      { id: 'intelligenceFeed', path: '/insights' },
      { id: 'news', path: '/news' },
      { id: 'aiMarketAnalysis', path: '/ai-market-analysis' },
      { id: 'aiCharts', path: '/ai-charts' },
      { id: 'aiMediaCenter', path: '/ai-media-center' },
      { id: 'monarchAiChat', path: '/monarch-chat' },
      { id: 'brain', path: '/brain' },
      { id: 'pulse', path: '/pulse' },
      { id: 'tradersCorner', path: '/traders-corner' },
    ],
  },
  {
    id: 'social',
    pages: [
      { id: 'socialZone', path: '/social-zone' },
      { id: 'xDash', path: '/x-dash' },
      { id: 'xIntel', path: '/x-intel' },
      { id: 'xIntelligence', path: '/x-intelligence' },
      { id: 'xBubbles', path: '/x-bubbles' },
      { id: 'lens', path: '/lens' },
      { id: 'world', path: '/world' },
    ],
  },
  {
    id: 'tools',
    pages: [
      { id: 'economicCalendar', path: '/economic-calendar' },
      { id: 'roiCalculator', path: '/roi-calculator' },
      { id: 'searchEngine', path: '/search-engine' },
      { id: 'structureGuide', path: '/structure-guide' },
      { id: 'alerts', path: '/alerts' },
      { id: 'dossier', path: '/dossier' },
    ],
  },
  {
    id: 'user',
    pages: [
      { id: 'you', path: '/you' },
      { id: 'userDashboard', path: '/user-dashboard' },
      { id: 'researchZone', path: '/research-zone' },
      { id: 'gmDashboard', path: '/gm-dashboard' },
    ],
  },
  {
    id: 'standalone',
    pages: [
      { id: 'newsroom', path: '/newsroom' },
      { id: 'website', path: '/website' },
      { id: 'pricing', path: '/pricing' },
      { id: 'ventures', path: '/ventures' },
      { id: 'privateMarkets', path: '/private-markets' },
      { id: 'zigchain', path: '/zigchain' },
    ],
  },
]

const ROUTING_TIERS = [
  {
    id: 'standalone',
    routes: ['/newsroom', '/website', '/website2', '/lp', '/facts', '/vs/:competitor', '/how-to/:guide'],
  },
  {
    id: 'appShellOnly',
    routes: ['/token', '/gm-dashboard', '/monarch-chat', '/world', '/x-intelligence', '/x-bubbles'],
  },
  {
    id: 'appShellPageShell',
    routes: ['/', '/discover', '/news', '/intelligence', '/heatmaps', '/predictions', '/you'],
    extra: true,
  },
]

const PAGE_ANATOMY = [
  { id: 'indexJsx', token: 'index.jsx' },
  { id: 'componentJsx', token: 'components/<name>.jsx' },
  { id: 'componentCss', token: 'components/<name>.css' },
  { id: 'dayModeCss', token: 'components/<name>.day-mode.css' },
  { id: 'mobileCss', token: 'components/<name>.mobile.css' },
  { id: 'cinemaModeCss', token: 'components/<name>.cinema-mode.css' },
  { id: 'useHook', token: 'components/use-<name>.js' },
  { id: 'constants', token: 'components/<name>-constants.js' },
]

const STATE_LAYERS = [
  {
    id: 'zustand',
    items: [
      { id: 'settings', name: 'useSettingsStore' },
      { id: 'notification', name: 'useNotificationStore' },
      { id: 'media', name: 'useMediaStore' },
    ],
  },
  {
    id: 'contexts',
    items: [
      { id: 'appState', name: 'AppStateContext' },
      { id: 'watchlists', name: 'WatchlistsContext' },
      { id: 'i18nCurrency', name: 'I18nCurrencyContext' },
      { id: 'monarch', name: 'MonarchContext' },
      { id: 'copyToast', name: 'CopyToastContext' },
    ],
  },
  {
    id: 'servicesHooks',
    items: [
      { id: 'codexApi', name: 'services/codexApi' },
      { id: 'coinGeckoApi', name: 'services/coinGeckoApi' },
      { id: 'binanceApi', name: 'services/binanceApi' },
      { id: 'useCodexData', name: 'hooks/useCodexData' },
      { id: 'useWalletBalances', name: 'hooks/useWalletBalances' },
      { id: 'analytics', name: 'services/analytics' },
    ],
  },
]

const DESIGN_TOKENS = [
  { id: 'background', tokens: [
    { name: '--bg-void', value: '#09090b' },
    { name: '--bg-surface', value: '#111113' },
    { name: '--bg-elevated', value: '#18181b' },
  ]},
  { id: 'text', tokens: [
    { name: '--text-primary', value: '#f5f5f7' },
    { name: '--text-secondary', value: 'rgba(245,245,247,0.6)' },
    { name: '--text-tertiary', value: 'rgba(245,245,247,0.5)' },
  ]},
  { id: 'trading', tokens: [
    { name: '--bull', value: '#10B981' },
    { name: '--bear', value: '#EF4444' },
    { name: '--accent', value: '#f5f5f7' },
  ]},
  { id: 'radius', tokens: [
    { name: '--radius-sm', value: '8px' },
    { name: '--radius-md', value: '12px' },
    { name: '--radius-lg', value: '16px' },
  ]},
]

const StructureGuidePage = () => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('structure')
  const dayMode = useSettingsStore((s) => s.dayMode)

  const sections = useMemo(() => ([
    { key: 'monorepo', num: '01' },
    { key: 'dataFlow', num: '02' },
    { key: 'routingTiers', num: '03' },
    { key: 'pages', num: '04' },
    { key: 'pageAnatomy', num: '05' },
    { key: 'stateData', num: '06' },
    { key: 'designTokens', num: '07' },
  ]), [])

  const sectionMeta = (key) => ({
    title: t(`structureGuide.sections.${key}.title`),
    desc: t(`structureGuide.sections.${key}.desc`),
    num: sections.find((s) => s.key === key)?.num,
  })

  return (
    <div className="sg-page">
      <div className="sg-container">
        <header className="sg-header">
          <span className="sg-eyebrow">{t('structureGuide.eyebrow')}</span>
          <h1 className="sg-title">{t('structureGuide.title')}</h1>
          <p className="sg-subtitle">{t('structureGuide.subtitle')}</p>
          <div className="sg-tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`sg-tab${activeTab === tab.id ? ' sg-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.tKey)}
              </button>
            ))}
          </div>
        </header>

        {activeTab === 'glossary' && <GlossaryPage dayMode={dayMode} />}

        {activeTab === 'structure' && (
          <div className="sg-body">

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('monorepo').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('monorepo').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('monorepo').desc}</p>
                </div>
              </div>
              <div className="sg-grid sg-grid--arch">
                {ARCHITECTURE.map((item) => (
                  <article key={item.id} className="sg-card">
                    <div className="sg-card-head">
                      <code className="sg-card-path">{item.name}</code>
                      <span className="sg-pill">{t(`structureGuide.architecture.${item.id}.role`)}</span>
                    </div>
                    <div className="sg-card-meta">{item.stack}</div>
                    <p className="sg-card-body">{t(`structureGuide.architecture.${item.id}.summary`)}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('dataFlow').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('dataFlow').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('dataFlow').desc}</p>
                </div>
              </div>
              <div className="sg-flow">
                {DATA_FLOW.map((stepId, idx) => (
                  <React.Fragment key={stepId}>
                    <div className="sg-flow-step">
                      <span className="sg-flow-num">{String(idx + 1).padStart(2, '0')}</span>
                      <div className="sg-flow-label">{t(`structureGuide.dataFlow.${stepId}.label`)}</div>
                      <div className="sg-flow-detail">{t(`structureGuide.dataFlow.${stepId}.detail`)}</div>
                    </div>
                    {idx < DATA_FLOW.length - 1 && <span className="sg-flow-sep" aria-hidden="true" />}
                  </React.Fragment>
                ))}
              </div>
            </section>

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('routingTiers').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('routingTiers').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('routingTiers').desc}</p>
                </div>
              </div>
              <div className="sg-grid sg-grid--tiers">
                {ROUTING_TIERS.map((tier) => (
                  <article key={tier.id} className="sg-card">
                    <div className="sg-card-head">
                      <h3 className="sg-card-title">{t(`structureGuide.routingTiers.${tier.id}.name`)}</h3>
                      <span className="sg-pill">{t(`structureGuide.routingTiers.${tier.id}.badge`)}</span>
                    </div>
                    <p className="sg-card-body">{t(`structureGuide.routingTiers.${tier.id}.note`)}</p>
                    <ul className="sg-route-list">
                      {tier.routes.map((route) => (
                        <li key={route}><code>{route}</code></li>
                      ))}
                      {tier.extra && (
                        <li><code>{t('structureGuide.routingTiers.moreRoutes')}</code></li>
                      )}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('pages').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('pages').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('pages').desc}</p>
                </div>
              </div>
              <div className="sg-groups">
                {PAGE_GROUPS.map((group) => (
                  <div key={group.id} className="sg-group">
                    <div className="sg-group-head">
                      <h3 className="sg-group-title">{t(`structureGuide.pageGroups.${group.id}.title`)}</h3>
                      <span className="sg-group-count">{group.pages.length}</span>
                    </div>
                    <p className="sg-group-desc">{t(`structureGuide.pageGroups.${group.id}.desc`)}</p>
                    <ul className="sg-page-list">
                      {group.pages.map((page) => (
                        <li key={page.id} className="sg-page-item">
                          <div className="sg-page-item-head">
                            <code className="sg-page-path">{page.path}</code>
                            <span className="sg-page-id">{page.id}</span>
                          </div>
                          <p className="sg-page-desc">{t(`structureGuide.pageGroups.${group.id}.pages.${page.id}`)}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('pageAnatomy').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('pageAnatomy').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('pageAnatomy').desc}</p>
                </div>
              </div>
              <div className="sg-anatomy">
                {PAGE_ANATOMY.map((row) => (
                  <div key={row.id} className="sg-anatomy-row">
                    <code className="sg-anatomy-token">{row.token}</code>
                    <span className="sg-anatomy-detail">{t(`structureGuide.anatomy.${row.id}`)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('stateData').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('stateData').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('stateData').desc}</p>
                </div>
              </div>
              <div className="sg-grid sg-grid--state">
                {STATE_LAYERS.map((layer) => (
                  <article key={layer.id} className="sg-card">
                    <h3 className="sg-card-title">{t(`structureGuide.state.${layer.id}.title`)}</h3>
                    <ul className="sg-state-list">
                      {layer.items.map((item) => (
                        <li key={item.id}>
                          <code className="sg-state-name">{item.name}</code>
                          <span className="sg-state-detail">{t(`structureGuide.state.${layer.id}.items.${item.id}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="sg-section">
              <div className="sg-section-head">
                <span className="sg-section-num">{sectionMeta('designTokens').num}</span>
                <div>
                  <h2 className="sg-section-title">{sectionMeta('designTokens').title}</h2>
                  <p className="sg-section-desc">{sectionMeta('designTokens').desc}</p>
                </div>
              </div>
              <div className="sg-token-grid">
                {DESIGN_TOKENS.map((group) => (
                  <div key={group.id} className="sg-token-group">
                    <div className="sg-token-group-title">{t(`structureGuide.designTokenGroups.${group.id}`)}</div>
                    {group.tokens.map((token) => (
                      <div key={token.name} className="sg-token-row">
                        <span
                          className="sg-token-chip"
                          style={token.value.startsWith('#') || token.value.startsWith('rgb')
                            ? { background: token.value }
                            : undefined}
                          aria-hidden="true"
                        />
                        <code className="sg-token-name">{token.name}</code>
                        <code className="sg-token-value">{token.value}</code>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

          </div>
        )}
      </div>
    </div>
  )
}

export default StructureGuidePage
