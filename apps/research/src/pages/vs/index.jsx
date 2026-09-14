import { useParams } from 'react-router-dom'
import VsPage from './components/vs-page'
import { getCompetitor } from './competitors'

/**
 * Route entrypoint for /vs/:competitor. Looks up the competitor's data
 * from the catalog and passes it into the shared VsPage template. If the
 * slug is unknown, VsPage renders a friendly not-found body.
 */
export default function VsRoute() {
  const { competitor: slug } = useParams()
  const competitor = getCompetitor(slug)
  return <VsPage competitor={competitor} />
}
