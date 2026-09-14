import SocialZonePageComponent from './components/social-zone-page'
import useSettingsStore from '@/store/useSettingsStore'

export default function SocialZonePage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  return <SocialZonePageComponent dayMode={dayMode} />
}
