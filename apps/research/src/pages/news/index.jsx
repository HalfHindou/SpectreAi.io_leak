import { Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import useSettingsStore from '@/store/useSettingsStore'
import { useParams } from 'react-router-dom'
import NewsPage from './components/NewsPage'
// Article reader only renders on /news/:articleId — keep it out of the
// main /news feed bundle.
const NewsArticleReader = lazy(() => import('./components/NewsArticleReader'))

export default function NewsPageWrapper() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const { articleId } = useParams()

  if (articleId) {
    return (
      <Suspense fallback={null}>
        <NewsArticleReader articleId={articleId} dayMode={dayMode} />
      </Suspense>
    )
  }

  return <NewsPage dayMode={dayMode} />
}
