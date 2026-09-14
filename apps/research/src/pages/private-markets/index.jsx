/**
 * Private Markets — page wrapper (thin).
 * Pulls store/context state and forwards props per page-patterns.md.
 */
import PrivateMarketsPageComponent from './components/private-markets-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function PrivateMarketsPage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()

  return <PrivateMarketsPageComponent dayMode={dayMode} isMobile={isMobile} />
}
