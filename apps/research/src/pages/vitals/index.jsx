/**
 * /vitals — Platform fundamentals.
 *
 * Thin wrapper per the folder-per-page convention: this file picks the index or
 * the detail view off the route param; all UI lives in components/.
 */

import { useParams } from 'react-router-dom'
import VitalsPage from './components/vitals-page'
import VitalsPlatformPage from './components/vitals-platform'

export default function Vitals() {
  const { slug } = useParams()
  return slug ? <VitalsPlatformPage /> : <VitalsPage />
}
