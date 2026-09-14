import { useParams } from 'react-router-dom'
import DossierPage from './components/dossier-page'

export default function DossierPageWrapper() {
  const { chain, ca } = useParams()
  return <DossierPage chain={chain} ca={ca} />
}
