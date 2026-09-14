import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import EtfFlowsPageComponent from './components/etf-flows-page'

export default function EtfFlowsPage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()
  return <EtfFlowsPageComponent dayMode={dayMode} isMobile={isMobile} />
}
