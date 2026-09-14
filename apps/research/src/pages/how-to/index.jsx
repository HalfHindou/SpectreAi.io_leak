import { useParams } from 'react-router-dom'
import HowToPage from './components/how-to-page'
import { getGuide } from './guides'

export default function HowToRoute() {
  const { guide: slug } = useParams()
  const guide = getGuide(slug)
  return <HowToPage guide={guide} />
}
