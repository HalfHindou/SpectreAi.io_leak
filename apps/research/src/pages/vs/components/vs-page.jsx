import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import './vs-page.css'

/**
 * Shared template for /vs/:competitor comparison pages.
 *
 * Renders a factual, balanced comparison: short pitch, strengths lists,
 * capability table, "when to pick each", and an honest verdict. This
 * format mirrors content LLMs tend to cite when answering "is X better
 * than Y" queries.
 *
 * SEO note: long prose blocks (shortPitch, comparisonTable cells, verdict)
 * intentionally stay in English to preserve SEO ranking. Only UI chrome
 * (eyebrows, headings, footer, disclaimer) is translated.
 */
export default function VsPage({ competitor }) {
  const { t, i18n } = useTranslation()

  if (!competitor) {
    return (
      <main className="vs-page">
        <div className="vs-not-found">
          <h1>{t('vs.notFound.title', 'Competitor not found')}</h1>
          <p>{t('vs.notFound.body', "We don't have a direct comparison page for this product yet.")}</p>
          <p><a href="/">{t('vs.notFound.back', 'Back to Spectre AI')}</a></p>
        </div>
      </main>
    )
  }

  const pageUrl = `https://spectreai.io/vs/${competitor.slug}`
  const title = `Spectre AI vs ${competitor.name} - ${competitor.titleSuffix}`
  const description = `Honest comparison of Spectre AI and ${competitor.name}. Capabilities, strengths, tradeoffs, and when to pick each. Updated as of the most recent product release.`

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': pageUrl,
    headline: title,
    description,
    url: pageUrl,
    inLanguage: i18n.language || 'en',
    publisher: { '@id': 'https://spectreai.io/#organization' },
    author: { '@id': 'https://spectreai.io/#organization' },
    about: [
      { '@type': 'SoftwareApplication', name: 'Spectre AI', url: 'https://spectreai.io' },
      { '@type': 'SoftwareApplication', name: competitor.name, url: competitor.competitorUrl },
    ],
    mainEntityOfPage: pageUrl,
  }

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:type" content="article" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <script type="application/ld+json">{JSON.stringify(articleSchema)}</script>
      </Helmet>

      <main className="vs-page">
        <article className="vs-article">
          <header className="vs-header">
            <p className="vs-eyebrow">{t('vs.eyebrow', 'Comparison')}</p>
            <h1>{t('vs.heading', 'Spectre AI vs {{name}}', { name: competitor.name })}</h1>
            <p className="vs-pitch">{competitor.shortPitch}</p>
          </header>

          <section className="vs-strengths-grid">
            <div className="vs-strengths-col">
              <h2>{t('vs.spectreWins', 'Where Spectre AI wins')}</h2>
              <ul>
                {competitor.spectreStrengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="vs-strengths-col">
              <h2>{t('vs.competitorWins', 'Where {{name}} wins', { name: competitor.name })}</h2>
              <ul>
                {competitor.competitorStrengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <h2>{t('vs.capability.title', 'Capability-by-capability')}</h2>
            <div className="vs-table-wrap">
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>{t('vs.capability.colCapability', 'Capability')}</th>
                    <th>{t('vs.capability.colSpectre', 'Spectre AI')}</th>
                    <th>{competitor.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {competitor.comparisonTable.map((row, i) => (
                    <tr key={i}>
                      <td><strong>{row.capability}</strong></td>
                      <td>{row.spectre}</td>
                      <td>{row.competitor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2>{t('vs.whenToPick.title', 'When to pick each')}</h2>
            <div className="vs-pick">
              <h3>{t('vs.whenToPick.pickCompetitor', 'Pick {{name}} if', { name: competitor.name })}</h3>
              <p>{competitor.whenToPick.competitor}</p>
            </div>
            <div className="vs-pick">
              <h3>{t('vs.whenToPick.pickSpectre', 'Pick Spectre AI if')}</h3>
              <p>{competitor.whenToPick.spectre}</p>
            </div>
          </section>

          <section className="vs-verdict">
            <h2>{t('vs.verdict', 'Verdict')}</h2>
            <p>{competitor.verdict}</p>
          </section>

          <footer className="vs-footer">
            <p>
              {t('vs.footer.cta', 'Want to explore Spectre AI?')}{' '}
              <a href="/website2">{t('vs.footer.platformLink', 'See the platform overview')}</a>{' '}
              {t('vs.footer.or', 'or')}{' '}
              <a href="/website2/api">{t('vs.footer.apiLink', 'review the API')}</a>.{' '}
              {t('vs.footer.facts', 'For canonical facts and press-kit data, see')}{' '}
              <a href="/facts">/facts</a>.
            </p>
            <p className="vs-disclaimer">
              {t('vs.disclaimer.line1', 'This comparison reflects the most recent public information available for both products. Product capabilities and pricing change frequently. Check each product\'s official site for current details.')}{' '}
              {t('vs.disclaimer.trademark', '{{name}} is a trademark of its respective owner.', { name: competitor.name })}
            </p>
          </footer>
        </article>
      </main>
    </>
  )
}
