import { Helmet } from 'react-helmet-async'
import { useLocation } from 'react-router-dom'
import { resolveMeta, DEFAULT_OG_IMAGE, SITE_URL, SITE_NAME } from '@/constants/pageMeta'

/**
 * Human-readable section labels for breadcrumb trail. First segment only.
 * Fallback is titlecase of the segment.
 */
const SECTION_LABELS = {
  'research-zone': 'Research Zone',
  'vs': 'Comparisons',
  'intelligence': 'Intelligence',
  'news': 'News',
  'website2': 'Platform',
  'predictions': 'Predictions',
  'facts': 'Facts',
  'fear-greed': 'Fear and Greed',
  'liquidation-heatmap': 'Liquidation Heatmap',
  'economic-calendar': 'Economic Calendar',
}

function titleCase(slug) {
  if (!slug) return ''
  return slug
    .split('-')
    .map((w) => (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

function buildBreadcrumb(pathname) {
  // Always start with Home
  const segments = pathname.split('/').filter(Boolean)
  const items = [
    {
      '@type': 'ListItem',
      position: 1,
      name: SITE_NAME,
      item: `${SITE_URL}/`,
    },
  ]
  let acc = ''
  segments.forEach((seg, idx) => {
    acc += '/' + seg
    const label = idx === 0
      ? (SECTION_LABELS[seg] || titleCase(seg))
      : titleCase(seg)
    items.push({
      '@type': 'ListItem',
      position: idx + 2,
      name: label,
      item: `${SITE_URL}${acc}`,
    })
  })
  // Only emit breadcrumb for non-root paths with at least one segment
  if (items.length < 2) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  }
}

/**
 * Injects per-route <title>, <meta description>, canonical, Open Graph /
 * Twitter tags, and a BreadcrumbList JSON-LD schema based on the current
 * pathname. Mounted once near the top of <Routes> in App.jsx so every
 * navigation updates the document head.
 *
 * Pages that want to override with richer schemas (Article, AboutPage,
 * HowTo) emit their own Helmet + script tags at the page level - Helmet
 * appends, so page-level tags take precedence.
 */
export default function RouteMeta() {
  const { pathname } = useLocation()
  const { title, description, canonical } = resolveMeta(pathname)
  const breadcrumb = buildBreadcrumb(pathname)

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={DEFAULT_OG_IMAGE} />

      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:url" content={canonical} />
      <meta name="twitter:image" content={DEFAULT_OG_IMAGE} />

      {breadcrumb && (
        <script type="application/ld+json">{JSON.stringify(breadcrumb)}</script>
      )}
    </Helmet>
  )
}
