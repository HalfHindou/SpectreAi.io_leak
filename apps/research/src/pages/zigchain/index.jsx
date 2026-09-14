import useSettingsStore from '@/store/useSettingsStore'
import ZIGChainHub from './ZIGChainHub'

export default function ZIGChainPage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <ZIGChainHub dayMode={dayMode} />
}
