import { Helmet } from 'react-helmet-async'
import { useTranslation } from 'react-i18next'
import './how-to-page.css'

/**
 * Shared template for /how-to/:slug. Renders a HowTo JSON-LD schema
 * (which LLMs cite heavily for step-based queries) plus a clean
 * visual walkthrough.
 *
 * SEO note: guide content (name, description, step text) intentionally
 * stays in English to preserve SEO ranking and HowTo schema integrity.
 * Only chrome (eyebrow, footer, not-found state) is translated.
 */
export default function HowToPage({ guide }) {
  const { t, i18n } = useTranslation()

  if (!guide) {
    return (
      <main className="howto-page">
        <div className="howto-not-found">
          <h1>{t('howTo.notFound.title', 'Guide not found')}</h1>
          <p><a href="/">{t('howTo.notFound.back', 'Back to Spectre AI')}</a></p>
        </div>
      </main>
    )
  }

  const pageUrl = `https://spectreai.io/how-to/${guide.slug}`

  const howToSchema = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    '@id': pageUrl,
    name: guide.name,
    description: guide.description,
    url: pageUrl,
    inLanguage: i18n.language || 'en',
    totalTime: guide.totalTime,
    step: guide.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
      url: `${pageUrl}#step-${i + 1}`,
    })),
    publisher: { '@id': 'https://spectreai.io/#organization' },
  }

  return (
    <>
      <Helmet>
        <title>{guide.name} | Spectre AI</title>
        <meta name="description" content={guide.description} />
        <link rel="canonical" href={pageUrl} />
        <meta property="og:title" content={guide.name} />
        <meta property="og:description" content={guide.description} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:type" content="article" />
        <meta name="twitter:title" content={guide.name} />
        <meta name="twitter:description" content={guide.description} />
        <script type="application/ld+json">{JSON.stringify(howToSchema)}</script>
      </Helmet>

      <main className="howto-page">
        <article className="howto-article">
          <header className="howto-header">
            <p className="howto-eyebrow">{t('howTo.eyebrow', 'Guide')}</p>
            <h1>{guide.name}</h1>
            <p className="howto-description">{guide.description}</p>
          </header>

          <ol className="howto-steps">
            {guide.steps.map((step, i) => (
              <li key={i} id={`step-${i + 1}`} className="howto-step">
                <div className="howto-step-index">{i + 1}</div>
                <div className="howto-step-body">
                  <h2>{step.name}</h2>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <footer className="howto-footer">
            <p>
              {t('howTo.footer.cta', 'Want to explore Spectre AI?')}{' '}
              <a href="/website2">{t('howTo.footer.platformLink', 'See the platform')}</a>{' '}
              {t('howTo.footer.or', 'or')}{' '}
              <a href="/website2/api">{t('howTo.footer.apiLink', 'review the API')}</a>.
            </p>
          </footer>
        </article>
      </main>
    </>
  )
}
