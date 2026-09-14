import { useNavigate } from 'react-router-dom'
import TokenizedAssetsPageComponent from './components/tokenized-assets-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function TokenizedAssetsPage() {
  const navigate = useNavigate()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()
  return <TokenizedAssetsPageComponent dayMode={dayMode} isMobile={isMobile} />
}
